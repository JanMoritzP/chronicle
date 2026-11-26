import type { ServerResponse } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { requireUser, type AuthUser } from './auth.js'
import { db } from './db.js'
import { visibleWorldIds, worldRole, type WorldRole } from './access.js'
import { presenceChanged } from './presence.js'

/**
 * One server-sent-events stream per open browser tab. It carries "something changed" notices for the world the tab is in,
 * who else is online there, and "your worlds changed" notices when an admin reassigns access.
 */
interface LiveConn { res: ServerResponse; user: AuthUser; ws: string | null; clientId: string; since: number }

const conns = new Set<LiveConn>()

const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`

function write(c: LiveConn, text: string) {
  try { c.res.write(text) } catch { conns.delete(c) }
}

export function publishWorld(ws: string, event: unknown, exceptClient = '') {
  const text = frame(event)
  for (const c of conns) if (c.ws === ws && (!exceptClient || c.clientId !== exceptClient)) write(c, text)
}

/** Sends each person in the world their own version of an event, or nothing when the function says null. */
export function publishWorldTo(ws: string, eventFor: (user: AuthUser, role: WorldRole) => unknown) {
  for (const c of conns) {
    if (c.ws !== ws) continue
    const role = worldRole(c.user, ws)
    const event = role ? eventFor(c.user, role) : null
    if (event) write(c, frame(event))
  }
}

export function publishUser(userId: string, event: unknown) {
  const text = frame(event)
  for (const c of conns) if (c.user.id === userId) write(c, text)
}

function onlineIn(ws: string) {
  const seen = new Map<string, string>()
  for (const c of conns) if (c.ws === ws) seen.set(c.user.id, c.user.username)
  return [...seen].map(([id, username]) => ({ id, username }))
}

function announce(ws: string | null) {
  if (ws) publishWorld(ws, { k: 'presence', users: onlineIn(ws) })
}

/** Who is connected right now, for the admin dashboard. */
export function onlineSnapshot() {
  return [...conns].map((c) => ({ userId: c.user.id, username: c.user.username, worldId: c.ws, since: c.since }))
}

/** After access changed (membership, role, deleted account): drop what is no longer allowed and tell the people affected to reload their worlds. */
export function revalidateLive(changedUsers?: string[]) {
  const touched = new Set<string | null>()
  for (const c of [...conns]) {
    if (changedUsers && !changedUsers.includes(c.user.id)) continue
    const row = userRow(c.user.id)
    if (!row) { c.res.end(); conns.delete(c); touched.add(c.ws); continue }
    c.user = row
    if (c.ws && !worldRole(row, c.ws)) { touched.add(c.ws); c.ws = null }
    write(c, frame({ k: 'worlds', ids: visibleWorldIds(row) }))
  }
  for (const ws of touched) announce(ws)
  presenceChanged()
}

function userRow(id: string): AuthUser | undefined {
  return db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id) as AuthUser | undefined
}

export function closeAllLive() {
  for (const c of conns) { try { c.res.end() } catch { /* already gone */ } }
  conns.clear()
}

export async function liveRoutes(app: FastifyInstance) {
  app.get('/api/live', { preHandler: requireUser }, async (req, reply) => {
    const q = req.query as { ws?: string; c?: string }
    const user = req.user!
    let ws: string | null = null
    if (q.ws) {
      if (!worldRole(user, q.ws)) return reply.code(404).send({ error: 'not found' })
      ws = q.ws
    }
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff',
    })
    const conn: LiveConn = { res, user, ws, clientId: String(q.c ?? ''), since: Date.now() }
    conns.add(conn)
    res.write('retry: 3000\n\n')
    announce(ws)
    presenceChanged()
    const beat = setInterval(() => write(conn, ': keep-alive\n\n'), 25_000)
    req.raw.on('close', () => {
      clearInterval(beat)
      conns.delete(conn)
      announce(conn.ws)
      presenceChanged()
    })
  })
}
