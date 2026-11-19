import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { userFromRequest, type AuthUser } from './auth.js'
import { db } from './db.js'
import { publishWorld } from './live.js'

export type WorldRole = 'editor' | 'viewer'

declare module 'fastify' {
  interface FastifyRequest { worldId?: string }
}

/**
 * What a user may do in a world, or null when the world is not theirs. Owners reach every world.
 * A viewer account stays read-only everywhere, whatever the membership says.
 */
export function worldRole(user: AuthUser, wsId: string): WorldRole | null {
  if (!db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(wsId)) return null
  if (user.role === 'owner') return 'editor'
  const m = db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(wsId, user.id) as { role: WorldRole } | undefined
  if (!m) return null
  return user.role === 'viewer' ? 'viewer' : m.role
}

export function visibleWorldIds(user: AuthUser): string[] {
  const rows = user.role === 'owner'
    ? db.prepare('SELECT id FROM workspaces WHERE deleted_at IS NULL').all()
    : db.prepare('SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = ? AND w.deleted_at IS NULL').all(user.id)
  return (rows as { id: string }[]).map((r) => r.id)
}

export function addMember(wsId: string, userId: string, role: WorldRole, at: number) {
  db.prepare(
    `INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES(?,?,?,?)
     ON CONFLICT(workspace_id,user_id) DO UPDATE SET role = excluded.role`,
  ).run(wsId, userId, role, at)
}

// Routes addressed by the id of something inside a world: how to find that world.
const OWNER_OF: [RegExp, string][] = [
  [/^\/api\/pages\/([^/]+)/, 'SELECT workspace_id AS w FROM pages WHERE id = ?'],
  [/^\/api\/folders\/([^/]+)/, 'SELECT workspace_id AS w FROM folders WHERE id = ?'],
  [/^\/api\/zettels\/([^/]+)/, 'SELECT workspace_id AS w FROM zettels WHERE id = ?'],
  [/^\/api\/maps\/([^/]+)/, 'SELECT workspace_id AS w FROM maps WHERE id = ?'],
  [/^\/api\/layers\/([^/]+)/, 'SELECT m.workspace_id AS w FROM map_layers l JOIN maps m ON m.id = l.map_id WHERE l.id = ?'],
  [/^\/api\/items\/([^/]+)/, 'SELECT m.workspace_id AS w FROM map_items i JOIN maps m ON m.id = i.map_id WHERE i.id = ?'],
  [/^\/api\/events\/([^/]+)/, 'SELECT workspace_id AS w FROM events WHERE id = ?'],
  [/^\/api\/relations\/([^/]+)/, 'SELECT workspace_id AS w FROM relations WHERE id = ?'],
  [/^\/api\/sessions\/([^/]+)/, 'SELECT workspace_id AS w FROM game_sessions WHERE id = ?'],
  [/^\/api\/templates\/([^/]+)/, 'SELECT workspace_id AS w FROM templates WHERE id = ?'],
  [/^\/api\/page-types\/([^/]+)/, 'SELECT workspace_id AS w FROM page_types WHERE id = ?'],
  [/^\/api\/stat-templates\/([^/]+)/, 'SELECT workspace_id AS w FROM stat_templates WHERE id = ?'],
  [/^\/api\/versions\/([^/]+)/, 'SELECT p.workspace_id AS w FROM page_versions v JOIN pages p ON p.id = v.page_id WHERE v.id = ?'],
  [/^\/api\/uploads\/([^/]+)/, 'SELECT workspace_id AS w FROM uploads WHERE id = ?'],
]
const IN_WORLD = /^\/api\/workspaces\/([^/]+)(?:\/|$)/

/** The world a request is about, from its path: undefined when it is not about one, null when the thing does not exist. */
export function worldOfPath(path: string): string | null | undefined {
  const m = IN_WORLD.exec(path)
  if (m) return m[1]
  for (const [re, sql] of OWNER_OF) {
    const hit = re.exec(path)
    if (hit) return (db.prepare(sql).get(hit[1]) as { w: string } | undefined)?.w ?? null
  }
  return undefined
}

const WRITES = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
const AREA = /^\/api\/(?:workspaces\/[^/]+\/)?([a-z-]+)/

export function accessRoutes(app: FastifyInstance) {
  // Every request that reaches into a world is checked here once, so a route can never forget to.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0]
    if (!path.startsWith('/api/')) return
    const ws = worldOfPath(path)
    if (ws === undefined) return
    const user = userFromRequest(req)
    if (!user) return // the route answers 401
    if (ws === null) return // the route answers 404
    const role = worldRole(user, ws)
    if (!role) return reply.code(404).send({ error: 'not found' })
    if (role === 'viewer' && WRITES.has(req.method)) return reply.code(403).send({ error: 'read-only account' })
    req.user = user
    req.worldId = ws
  })

  // Tell everyone else in the world that something changed, so their copy catches up without a reload.
  app.addHook('onResponse', async (req, reply) => {
    if (!req.worldId || !WRITES.has(req.method) || reply.statusCode >= 400) return
    const path = req.url.split('?')[0]
    const page = /^\/api\/pages\/([^/]+)/.exec(path)?.[1]
    const area = AREA.exec(path)?.[1] ?? ''
    publishWorld(req.worldId, { k: 'refresh', area, ...(page ? { pageId: page } : {}) }, String(req.headers['x-client-id'] ?? ''))
  })
}
