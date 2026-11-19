import crypto from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { z } from 'zod'
import { addMember } from './access.js'
import { adminUi } from './admin-ui.js'
import { hashPassword, verifyPassword } from './auth.js'
import { editorsSnapshot, revalidateCollab } from './collab.js'
import { config } from './config.js'
import { db, now } from './db.js'
import { onlineSnapshot, revalidateLive } from './live.js'
import { uid } from './pages.js'
import { onPresenceChange } from './presence.js'

/**
 * The admin dashboard: a second server on its own port with its own account and login, so it can stay off the internet
 * while the notebook itself is shared. It decides who has an account and which worlds each person can open.
 */
const COOKIE = 'dnd_admin'
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const role = z.enum(['owner', 'editor', 'viewer'])
const memberRole = z.enum(['editor', 'viewer'])

export function ensureAdmin(): boolean {
  const count = (db.prepare('SELECT COUNT(*) c FROM admins').get() as { c: number }).c
  if (count > 0) return true
  if (!config.adminPanelPassword || config.adminPanelPassword.length < 8) return false
  db.prepare('INSERT INTO admins(id,username,pass_hash,created_at) VALUES(?,?,?,?)').run(
    crypto.randomUUID(), config.adminPanelUser, hashPassword(config.adminPanelPassword), now())
  console.log(`Created admin dashboard account "${config.adminPanelUser}"`)
  return true
}

interface Admin { id: string; username: string }
declare module 'fastify' {
  interface FastifyRequest { admin?: Admin }
}

function adminOf(req: FastifyRequest): Admin | undefined {
  const token = req.cookies[COOKIE]
  if (!token) return
  return db.prepare(
    `SELECT a.id, a.username FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).get(sha(token), now()) as Admin | undefined
}

const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
  req.admin = adminOf(req)
  if (!req.admin) return reply.code(401).send({ error: 'unauthorized' })
}

const afterAccessChange = () => { revalidateLive(); revalidateCollab() }

function overview() {
  const users = db.prepare('SELECT id, username, role, created_at AS createdAt FROM users ORDER BY username COLLATE NOCASE').all() as
    { id: string; username: string; role: string; createdAt: number }[]
  const worlds = db.prepare('SELECT id, name, created_at AS createdAt FROM workspaces WHERE deleted_at IS NULL ORDER BY created_at').all() as
    { id: string; name: string; createdAt: number }[]
  const pages = new Map((db.prepare('SELECT workspace_id AS w, COUNT(*) n FROM pages WHERE deleted_at IS NULL GROUP BY workspace_id').all() as { w: string; n: number }[]).map((r) => [r.w, r.n]))
  const members = db.prepare('SELECT workspace_id AS worldId, user_id AS userId, role FROM workspace_members').all() as { worldId: string; userId: string; role: string }[]
  const titles = new Map((db.prepare('SELECT id, title FROM pages').all() as { id: string; title: string }[]).map((r) => [r.id, r.title]))
  const worldName = new Map(worlds.map((w) => [w.id, w.name]))
  const editing = new Map<string, { pageId: string; title: string; world: string; canWrite: boolean }[]>()
  for (const e of editorsSnapshot()) {
    const list = editing.get(e.userId) ?? []
    list.push({ pageId: e.pageId, title: titles.get(e.pageId) ?? '', world: worldName.get(e.worldId) ?? '', canWrite: e.canWrite })
    editing.set(e.userId, list)
  }
  const online = new Map<string, { userId: string; username: string; worlds: Set<string>; since: number }>()
  for (const c of onlineSnapshot()) {
    const cur = online.get(c.userId) ?? { userId: c.userId, username: c.username, worlds: new Set<string>(), since: c.since }
    if (c.worldId && worldName.has(c.worldId)) cur.worlds.add(worldName.get(c.worldId)!)
    cur.since = Math.min(cur.since, c.since)
    online.set(c.userId, cur)
  }
  return {
    users: users.map((u) => ({ ...u, worlds: members.filter((m) => m.userId === u.id).map((m) => ({ id: m.worldId, role: m.role })) })),
    worlds: worlds.map((w) => ({ ...w, pages: pages.get(w.id) ?? 0, members: members.filter((m) => m.worldId === w.id).map((m) => ({ userId: m.userId, role: m.role })) })),
    online: [...online.values()].map((o) => ({ userId: o.userId, username: o.username, worlds: [...o.worlds], since: o.since, editing: editing.get(o.userId) ?? [] })),
  }
}

function lastOwner(id: string) {
  const u = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined
  if (u?.role !== 'owner') return false
  return (db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'owner'").get() as { c: number }).c <= 1
}

export async function startAdmin() {
  if (!config.adminPort) return null
  if (!ensureAdmin()) {
    console.log('Admin dashboard is off: set ADMIN_PANEL_PASSWORD (8+ characters) for the first start to create its account.')
    return null
  }
  const app = Fastify({ logger: { level: 'warn' }, trustProxy: true })
  // bodyless requests that still carry a JSON content-type (DELETE from fetch wrappers) are fine
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body) return done(null, undefined)
    try { done(null, JSON.parse(body as string)) } catch { done(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }), undefined) }
  })
  await app.register(cookie)
  await app.register(rateLimit, { global: false })

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    if (!reply.hasHeader('cache-control')) reply.header('Cache-Control', 'no-store')
  })
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return
    const origin = req.headers.origin
    if (origin && new URL(origin).host !== req.headers.host) return reply.code(403).send({ error: 'bad origin' })
  })

  app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send(adminUi.html))
  app.get('/admin.js', async (_req, reply) => reply.type('text/javascript; charset=utf-8').send(adminUi.js))
  app.get('/admin.css', async (_req, reply) => reply.type('text/css; charset=utf-8').send(adminUi.css))

  app.post('/api/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ username: z.string().max(100), password: z.string().max(500) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const a = db.prepare('SELECT * FROM admins WHERE username = ?').get(b.data.username) as { id: string; username: string; pass_hash: string } | undefined
    const ok = verifyPassword(b.data.password, a?.pass_hash ?? hashPassword('x'))
    if (!a || !ok) return reply.code(401).send({ error: 'Invalid username or password' })
    const token = crypto.randomBytes(32).toString('base64url')
    const ttl = 12 * 3600_000
    db.prepare('INSERT INTO admin_sessions(token_hash,admin_id,created_at,expires_at) VALUES(?,?,?,?)').run(sha(token), a.id, now(), now() + ttl)
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now())
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.protocol === 'https', path: '/', maxAge: ttl / 1000 })
    return { username: a.username }
  })

  app.post('/api/logout', async (req, reply) => {
    const token = req.cookies[COOKIE]
    if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha(token))
    reply.clearCookie(COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/me', { preHandler: requireAdmin }, async (req) => req.admin)

  app.post('/api/password', { preHandler: requireAdmin, config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ current: z.string().max(500), next: z.string().min(8).max(500) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'The new password needs at least 8 characters' })
    const row = db.prepare('SELECT pass_hash FROM admins WHERE id = ?').get(req.admin!.id) as { pass_hash: string }
    if (!verifyPassword(b.data.current, row.pass_hash)) return reply.code(403).send({ error: 'Current password is wrong' })
    db.prepare('UPDATE admins SET pass_hash = ? WHERE id = ?').run(hashPassword(b.data.next), req.admin!.id)
    db.prepare('DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash != ?').run(req.admin!.id, sha(req.cookies[COOKIE]!))
    return { ok: true }
  })

  app.get('/api/overview', { preHandler: requireAdmin }, async () => overview())

  // Pushes a notice whenever someone comes online, leaves or opens another page, so the Online tab never waits for a timer.
  // The notice carries no data: the page asks for the overview again, so everything stays behind the same login check.
  const streams = new Set<import('node:http').ServerResponse>()
  onPresenceChange(() => { for (const r of streams) { try { r.write('data: {"k":"online"}\n\n') } catch { streams.delete(r) } } })
  app.get('/api/events', { preHandler: requireAdmin }, async (req, reply) => {
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' })
    res.write('retry: 3000\n\n')
    streams.add(res)
    const beat = setInterval(() => { try { res.write(': keep-alive\n\n') } catch { streams.delete(res) } }, 25_000)
    req.raw.on('close', () => { clearInterval(beat); streams.delete(res) })
  })
  app.addHook('onClose', async () => { for (const r of streams) { try { r.end() } catch { /* already gone */ } } streams.clear() })

  // ---------- people ----------
  app.post('/api/users', { preHandler: requireAdmin }, async (req, reply) => {
    const b = z.object({ username: z.string().trim().min(2).max(50), password: z.string().min(8).max(500), role }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'The name needs at least 2 characters and the password at least 8' })
    const id = crypto.randomUUID()
    try {
      db.prepare('INSERT INTO users(id,username,pass_hash,role,created_at) VALUES(?,?,?,?,?)').run(id, b.data.username, hashPassword(b.data.password), b.data.role, now())
    } catch {
      return reply.code(409).send({ error: 'That name is already taken' })
    }
    return { id }
  })

  app.patch('/api/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({ role }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    if (b.data.role !== 'owner' && lastOwner(id)) return reply.code(400).send({ error: 'Keep at least one owner account' })
    const r = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.data.role, id)
    if (!r.changes) return reply.code(404).send({ error: 'not found' })
    afterAccessChange()
    return { ok: true }
  })

  app.post('/api/users/:id/password', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({ password: z.string().min(8).max(500) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'The password needs at least 8 characters' })
    const r = db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(b.data.password), id)
    if (!r.changes) return reply.code(404).send({ error: 'not found' })
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
    return { ok: true }
  })

  app.post('/api/users/:id/signout', { preHandler: requireAdmin }, async (req) => {
    const { id } = req.params as { id: string }
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
    return { ok: true }
  })

  app.delete('/api/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (lastOwner(id)) return reply.code(400).send({ error: 'Keep at least one owner account' })
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
    afterAccessChange()
    return { ok: true }
  })

  // ---------- worlds and who can open them ----------
  app.post('/api/worlds', { preHandler: requireAdmin }, async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'The world needs a name' })
    const id = uid()
    db.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(id, b.data.name, now())
    afterAccessChange()
    return { id }
  })

  app.patch('/api/worlds/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'The world needs a name' })
    const r = db.prepare('UPDATE workspaces SET name = ? WHERE id = ? AND deleted_at IS NULL').run(b.data.name, id)
    if (!r.changes) return reply.code(404).send({ error: 'not found' })
    afterAccessChange()
    return { ok: true }
  })

  app.delete('/api/worlds/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const r = db.prepare('UPDATE workspaces SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now(), id)
    if (!r.changes) return reply.code(404).send({ error: 'not found' })
    afterAccessChange()
    return { ok: true }
  })

  app.put('/api/worlds/:id/members/:userId', { preHandler: requireAdmin }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string }
    const b = z.object({ role: memberRole }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    if (!db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(id) || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) {
      return reply.code(404).send({ error: 'not found' })
    }
    addMember(id, userId, b.data.role, now())
    afterAccessChange()
    return { ok: true }
  })

  app.delete('/api/worlds/:id/members/:userId', { preHandler: requireAdmin }, async (req) => {
    const { id, userId } = req.params as { id: string; userId: string }
    db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(id, userId)
    afterAccessChange()
    return { ok: true }
  })

  await app.listen({ port: config.adminPort, host: config.adminHost })
  console.log(`Admin dashboard on http://${config.adminHost}:${config.adminPort}`)
  return app
}
