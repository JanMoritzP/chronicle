import crypto from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from './config.js'
import { db, now } from './db.js'

export type Role = 'owner' | 'editor' | 'viewer'
export interface AuthUser { id: string; username: string; role: Role }

declare module 'fastify' {
  interface FastifyRequest { user?: AuthUser }
}

const COOKIE = 'dnd_session'
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(pw, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length)
  return crypto.timingSafeEqual(expected, actual)
}

export function ensureOwner() {
  const count = (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c
  if (count > 0) return
  if (!config.adminPassword || config.adminPassword.length < 8) {
    throw new Error('No users exist. Set ADMIN_PASSWORD (min 8 chars) for the first start; it creates the owner account.')
  }
  db.prepare('INSERT INTO users(id,username,pass_hash,role,created_at) VALUES(?,?,?,?,?)').run(
    crypto.randomUUID(), config.adminUser, hashPassword(config.adminPassword), 'owner', now(),
  )
  console.log(`Created owner account "${config.adminUser}"`)
}

function userFromRequest(req: FastifyRequest): AuthUser | undefined {
  const token = req.cookies[COOKIE]
  if (!token) return
  const row = db.prepare(
    `SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).get(sha(token), now()) as AuthUser | undefined
  return row
}

export const requireUser = async (req: FastifyRequest, reply: FastifyReply) => {
  req.user = userFromRequest(req)
  if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
}

export const requireEditor = async (req: FastifyRequest, reply: FastifyReply) => {
  req.user = userFromRequest(req)
  if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
  if (req.user.role === 'viewer') return reply.code(403).send({ error: 'read-only account' })
}

export const requireOwner = async (req: FastifyRequest, reply: FastifyReply) => {
  req.user = userFromRequest(req)
  if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
  if (req.user.role !== 'owner') return reply.code(403).send({ error: 'owner only' })
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ username: z.string().max(100), password: z.string().max(500) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad request' })
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(body.data.username) as
      | { id: string; username: string; pass_hash: string; role: Role } | undefined
    // Always run a hash so response time doesn't reveal whether the user exists.
    const ok = verifyPassword(body.data.password, u?.pass_hash ?? hashPassword('x'))
    if (!u || !ok) return reply.code(401).send({ error: 'Invalid username or password' })
    const token = crypto.randomBytes(32).toString('base64url')
    const ttl = config.sessionDays * 86400_000
    db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(sha(token), u.id, now(), now() + ttl)
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now())
    reply.setCookie(COOKIE, token, {
      // Secure only when the request really came in over HTTPS (cloudflared sets X-Forwarded-Proto), so LAN access over plain http still logs in.
      httpOnly: true, sameSite: 'lax', secure: req.protocol === 'https', path: '/', maxAge: ttl / 1000,
    })
    return { id: u.id, username: u.username, role: u.role }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE]
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token))
    reply.clearCookie(COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/auth/me', { preHandler: requireUser }, async (req) => req.user)

  app.post('/api/auth/password', { preHandler: requireUser, config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ current: z.string().max(500), next: z.string().min(8).max(500) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'The new password needs at least 8 characters' })
    const row = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(req.user!.id) as { pass_hash: string }
    if (!verifyPassword(body.data.current, row.pass_hash)) return reply.code(403).send({ error: 'Current password is wrong' })
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(body.data.next), req.user!.id)
    // every other device is logged out; this one stays
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user!.id, sha(req.cookies[COOKIE]!))
    return { ok: true }
  })

  /** Owner sets a new password for someone else (forgotten password); that person is logged out everywhere. */
  app.post('/api/users/:id/password', { preHandler: requireOwner }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = z.object({ password: z.string().min(8).max(500) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'Password min 8 chars' })
    const r = db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(body.data.password), id)
    if (!r.changes) return reply.code(404).send({ error: 'not found' })
    if (id !== req.user!.id) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
    return { ok: true }
  })

  app.get('/api/users', { preHandler: requireOwner }, async () =>
    db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at').all())

  app.post('/api/users', { preHandler: requireOwner }, async (req, reply) => {
    const body = z.object({
      username: z.string().min(2).max(50),
      password: z.string().min(8).max(500),
      role: z.enum(['editor', 'viewer']),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'Username min 2 chars, password min 8 chars' })
    try {
      const id = crypto.randomUUID()
      db.prepare('INSERT INTO users(id,username,pass_hash,role,created_at) VALUES(?,?,?,?,?)').run(
        id, body.data.username, hashPassword(body.data.password), body.data.role, now())
      return { id, username: body.data.username, role: body.data.role }
    } catch {
      return reply.code(409).send({ error: 'Username already taken' })
    }
  })

  app.delete('/api/users/:id', { preHandler: requireOwner }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (id === req.user!.id) return reply.code(400).send({ error: "You can't delete yourself" })
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
    return { ok: true }
  })
}
