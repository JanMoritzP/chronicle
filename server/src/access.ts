import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { userFromRequest, type AuthUser } from './auth.js'
import { db } from './db.js'
import { publishWorld } from './live.js'
import { levelOnPage, worldAccess, type MemberRole, type WorldAccess } from './pageAccess.js'
import { playsInWorld } from './players.js'

export type WorldRole = MemberRole

declare module 'fastify' {
  interface FastifyRequest {
    worldId?: string
    /** the role in the world the request is about */
    worldRole?: WorldRole
    /** a read-only member changing a page they were given (the character they play, or a page opened to them): only its text and sheet */
    playerEdit?: boolean
  }
}

/**
 * What a user may do in a world, or null when the world is not theirs. Owners are GMs of every world.
 * A viewer account stays read-only everywhere, whatever the membership says, and so can not be a GM.
 */
export function worldRole(user: AuthUser, wsId: string): WorldRole | null {
  if (!db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(wsId)) return null
  if (user.role === 'owner') return 'gm'
  const m = db.prepare('SELECT role, gm FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(wsId, user.id) as { role: 'editor' | 'viewer'; gm: number } | undefined
  if (!m) return null
  if (user.role === 'viewer') return 'viewer'
  return m.gm && m.role === 'editor' ? 'gm' : m.role
}

/** Writes in the world at all: GMs and editors. */
export const writes = (role: WorldRole | null | undefined) => role === 'gm' || role === 'editor'

const cache = new WeakMap<FastifyRequest, WorldAccess>()
/** What the request's user may see and change in the request's world, worked out once per request. */
export function accessOf(req: FastifyRequest, ws: string = req.worldId ?? ''): WorldAccess {
  const hit = cache.get(req)
  if (hit) return hit
  const role = req.worldRole ?? (req.user ? worldRole(req.user, ws) : null) ?? 'viewer'
  const a = worldAccess(req.user!, ws, role)
  cache.set(req, a)
  return a
}

export function visibleWorldIds(user: AuthUser): string[] {
  const rows = user.role === 'owner'
    ? db.prepare('SELECT id FROM workspaces WHERE deleted_at IS NULL').all()
    : db.prepare('SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = ? AND w.deleted_at IS NULL').all(user.id)
  return (rows as { id: string }[]).map((r) => r.id)
}

export function addMember(wsId: string, userId: string, role: WorldRole, at: number) {
  db.prepare(
    `INSERT INTO workspace_members(workspace_id,user_id,role,gm,created_at) VALUES(?,?,?,?,?)
     ON CONFLICT(workspace_id,user_id) DO UPDATE SET role = excluded.role, gm = excluded.gm`,
  ).run(wsId, userId, role === 'gm' ? 'editor' : role, role === 'gm' ? 1 : 0, at)
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
  [/^\/api\/encounters\/([^/]+)/, 'SELECT workspace_id AS w FROM encounters WHERE id = ?'],
  [/^\/api\/invites\/([^/]+)/, 'SELECT workspace_id AS w FROM invites WHERE id = ?'],
  [/^\/api\/macros\/([^/]+)/, 'SELECT workspace_id AS w FROM macros WHERE id = ?'],
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

/** The page a request is about, for routes addressed by a page or one of its versions. */
function pageOfPath(path: string): string | undefined {
  const p = /^\/api\/pages\/([^/]+)/.exec(path)
  if (p) return p[1]
  const v = /^\/api\/versions\/([^/]+)/.exec(path)
  if (v) return (db.prepare('SELECT page_id AS p FROM page_versions WHERE id = ?').get(v[1]) as { p: string } | undefined)?.p
  return undefined
}

const WRITES = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
const PLAYER_PAGE = /^\/api\/pages\/([^/]+)$/
const PLAYER_UPLOAD = /^\/api\/workspaces\/[^/]+\/uploads$/
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
    const write = WRITES.has(req.method)

    // a page this person does not reach does not exist for them; one they only read can not be changed by them
    const pageId = pageOfPath(path)
    const level = pageId ? levelOnPage(user, pageId, role) : null
    if (level === 'none') return reply.code(404).send({ error: 'not found' })

    if (role === 'viewer' && write) {
      // a reader may change a page given to them (the character they play, or one opened to them), and upload a picture for it
      const page = req.method === 'PATCH' ? PLAYER_PAGE.exec(path)?.[1] : undefined
      const upload = req.method === 'POST' && PLAYER_UPLOAD.test(path)
      if (!(page && level === 'edit') && !(upload && playsInWorld(ws, user.id))) return reply.code(403).send({ error: 'read-only account' })
      req.playerEdit = true
    } else if (write && level === 'view') {
      return reply.code(403).send({ error: 'You can read this page but not change it.' })
    }
    req.user = user
    req.worldId = ws
    req.worldRole = role
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
