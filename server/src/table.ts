import fs from 'node:fs'
import path from 'node:path'
import type { Server as HttpServer } from 'node:http'
import sharp from 'sharp'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import { worldRole } from './access.js'
import { userFromCookieHeader, type AuthUser } from './auth.js'
import { config } from './config.js'
import { db, now } from './db.js'
import { uid } from './pages.js'
import { presenceChanged } from './presence.js'
import { ALLOWED } from './routes/uploads.js'
import {
  canCreateToken, canMoveToken, canPing, canRuler, canSeeToken, clientMessage, makeLimiter, parseSettings, roleAt, settingsSchema,
  type ClientMessage, type TableRole, type TableSettings, type TokenRow,
} from './tabletop.js'

/**
 * The live table of a world: scenes, tokens and who is looking at them. One WebSocket per open browser tab at /api/table/:world.
 * The server is the only writer. A client sends small JSON messages, the server checks each one against the sender's role,
 * stores the result and tells everyone who may see it. Nothing hidden is ever sent to a connection that may not see it.
 */
const CLOSE_DENIED = 4003

interface Conn {
  socket: WebSocket; user: AuthUser; ws: string; wr: 'editor' | 'viewer'; role: TableRole; scene: string | null
  alive: boolean; limit: () => boolean; queue: Promise<void>
}
const conns = new Set<Conn>()

interface SceneRow {
  id: string; workspace_id: string; name: string; sort: number; bg: string; width: number; height: number
  grid: string; grid_size: number; unit: string; dist: number; diagonal: string
}
const sceneJson = (r: SceneRow) => ({
  id: r.id, name: r.name, sort: r.sort, bg: r.bg, width: r.width, height: r.height,
  grid: r.grid, gridSize: r.grid_size, unit: r.unit, dist: r.dist, diagonal: r.diagonal,
})
const SCENE_COLUMNS: Record<string, string> = { name: 'name', bg: 'bg', width: 'width', height: 'height', grid: 'grid', gridSize: 'grid_size', unit: 'unit', dist: 'dist', diagonal: 'diagonal' }

interface TokenDb {
  id: string; scene_id: string; name: string; x: number; y: number; size: number; rotation: number; image: string; color: string
  page_id: string | null; hidden: number; locked: number; owners: string; z: number; data: string
}
const parse = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) as T } catch { return fallback } }
export const tokenJson = (r: TokenDb): TokenRow => ({
  id: r.id, sceneId: r.scene_id, name: r.name, x: r.x, y: r.y, size: r.size, rotation: r.rotation, image: r.image, color: r.color,
  pageId: r.page_id, hidden: !!r.hidden, locked: !!r.locked, owners: parse<string[]>(r.owners, []), z: r.z, data: parse<Record<string, unknown>>(r.data, {}),
})
const TOKEN_COLUMNS: Record<string, string> = { name: 'name', x: 'x', y: 'y', size: 'size', rotation: 'rotation', image: 'image', color: 'color', pageId: 'page_id', hidden: 'hidden', locked: 'locked', owners: 'owners', z: 'z', data: 'data' }

const scenesOf = (ws: string) => (db.prepare('SELECT * FROM scenes WHERE workspace_id = ? ORDER BY sort, created_at').all(ws) as SceneRow[]).map(sceneJson)
const sceneRow = (id: string, ws: string) => db.prepare('SELECT * FROM scenes WHERE id = ? AND workspace_id = ?').get(id, ws) as SceneRow | undefined
const tokenRow = (id: string, ws: string) => { const r = db.prepare('SELECT * FROM tokens WHERE id = ? AND workspace_id = ?').get(id, ws) as TokenDb | undefined; return r ? tokenJson(r) : undefined }

function stateOf(ws: string) {
  const row = db.prepare('SELECT active_scene_id AS a, settings FROM table_state WHERE workspace_id = ?').get(ws) as { a: string | null; settings: string } | undefined
  return { active: row?.a ?? null, settings: parseSettings(row?.settings) }
}
function saveState(ws: string, active: string | null, settings: TableSettings) {
  db.prepare(
    `INSERT INTO table_state(workspace_id,active_scene_id,settings) VALUES(?,?,?)
     ON CONFLICT(workspace_id) DO UPDATE SET active_scene_id = excluded.active_scene_id, settings = excluded.settings`,
  ).run(ws, active, JSON.stringify(settings))
}

const send = (c: Conn, msg: unknown) => {
  if (c.socket.readyState !== WebSocket.OPEN) return
  c.socket.send(JSON.stringify(msg), (err) => { if (err) c.socket.terminate() })
}
const inWorld = (ws: string) => [...conns].filter((c) => c.ws === ws)

function onlineIn(ws: string) {
  const seen = new Map<string, { id: string; username: string; role: TableRole }>()
  for (const c of inWorld(ws)) seen.set(c.user.id, { id: c.user.id, username: c.user.username, role: c.role })
  return [...seen.values()]
}
const announce = (ws: string) => { for (const c of inWorld(ws)) send(c, { t: 'online', users: onlineIn(ws) }) }

/** The scene this connection is looking at: players follow the table's active scene, the GM may look anywhere. */
function viewFor(c: Conn, wanted?: string | null) {
  const { active } = stateOf(c.ws)
  const pick = c.role === 'gm' && wanted && sceneRow(wanted, c.ws) ? wanted : active
  const scene = pick && sceneRow(pick, c.ws) ? pick : scenesOf(c.ws)[0]?.id ?? null
  c.scene = scene
  return scene
}

const tokensFor = (c: Conn, scene: string | null) => scene
  ? (db.prepare('SELECT * FROM tokens WHERE scene_id = ? AND workspace_id = ? ORDER BY z, created_at').all(scene, c.ws) as TokenDb[]).map(tokenJson).filter((t) => canSeeToken(c.role, c.user.id, t))
  : []

function sendView(c: Conn) {
  send(c, { t: 'view', sceneId: c.scene, tokens: tokensFor(c, c.scene) })
}

/** Everyone who may open the world, so the GM can hand out tokens to people who are not online. */
const membersOf = (ws: string) => db.prepare(
  `SELECT u.id, u.username, u.role FROM users u WHERE u.role = 'owner' OR u.id IN (SELECT user_id FROM workspace_members WHERE workspace_id = ?) ORDER BY u.username`,
).all(ws) as { id: string; username: string; role: string }[]

function sendSnapshot(c: Conn) {
  const { active, settings } = stateOf(c.ws)
  viewFor(c, c.scene)
  send(c, {
    t: 'snapshot', you: { id: c.user.id, username: c.user.username, role: c.role }, settings, scenes: scenesOf(c.ws), active,
    sceneId: c.scene, tokens: tokensFor(c, c.scene), online: onlineIn(c.ws), members: membersOf(c.ws),
  })
}

/** After a token changed (or appeared, or went away) tell each viewer of its scene what they are entitled to know. */
function emitToken(ws: string, before: TokenRow | null, after: TokenRow | null) {
  const sceneId = (after ?? before)!.sceneId
  for (const c of inWorld(ws)) {
    if (c.scene !== sceneId) continue
    const sawBefore = !!before && canSeeToken(c.role, c.user.id, before)
    const seesAfter = !!after && canSeeToken(c.role, c.user.id, after)
    if (seesAfter) send(c, { t: 'token', token: after })
    else if (sawBefore) send(c, { t: 'token.remove', ids: [before!.id] })
  }
}

async function sizeOfUpload(url: string, ws: string) {
  const id = /^\/api\/uploads\/([A-Za-z0-9-]+)$/.exec(url)?.[1]
  const row = id ? db.prepare('SELECT mime FROM uploads WHERE id = ? AND workspace_id = ?').get(id, ws) as { mime: string } | undefined : undefined
  if (!id || !row || !ALLOWED[row.mime]) return null
  const file = path.join(config.dataDir, 'uploads', id + ALLOWED[row.mime])
  if (!fs.existsSync(file)) return null
  const meta = await sharp(file).metadata()
  return meta.width && meta.height ? { width: meta.width, height: meta.height } : null
}

const realUsers = (ids: string[]) => ids.filter((i) => db.prepare('SELECT 1 FROM users WHERE id = ?').get(i))

const nack = (c: Conn, m: ClientMessage, error: string) => send(c, { t: 'nack', op: m.op ?? null, error })

async function handle(c: Conn, m: ClientMessage) {
  const ws = c.ws
  const { settings } = stateOf(ws)
  c.role = roleAt(c.user, c.wr, settings)
  const gm = c.role === 'gm'

  switch (m.t) {
    case 'view': {
      if (!gm) return
      if (!sceneRow(m.sceneId, ws)) return nack(c, m, 'no such scene')
      c.scene = m.sceneId
      return sendView(c)
    }
    case 'scene.create': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const t = now()
      const id = uid()
      const sort = ((db.prepare('SELECT MAX(sort) AS s FROM scenes WHERE workspace_id = ?').get(ws) as { s: number | null }).s ?? 0) + 1
      db.prepare('INSERT INTO scenes(id,workspace_id,name,sort,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, ws, m.name ?? m.patch?.name ?? `Scene ${sort}`, sort, t, t)
      if (m.patch) await applyScenePatch(c, m, id, m.patch)
      const st = stateOf(ws)
      if (!st.active) saveState(ws, id, st.settings)
      const row = sceneRow(id, ws)!
      for (const x of inWorld(ws)) send(x, { t: 'scene', scene: sceneJson(row), ...(!st.active ? { active: id } : {}) })
      for (const x of inWorld(ws)) if (!st.active && !x.scene) { x.scene = id; sendView(x) }
      return
    }
    case 'scene.update': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (!sceneRow(m.id, ws)) return nack(c, m, 'no such scene')
      if (!(await applyScenePatch(c, m, m.id, m.patch))) return
      for (const x of inWorld(ws)) send(x, { t: 'scene', scene: sceneJson(sceneRow(m.id, ws)!) })
      return
    }
    case 'scene.delete': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (!sceneRow(m.id, ws)) return nack(c, m, 'no such scene')
      db.prepare('DELETE FROM scenes WHERE id = ?').run(m.id)
      const st = stateOf(ws)
      const next = st.active === m.id ? scenesOf(ws)[0]?.id ?? null : st.active
      if (next !== st.active) saveState(ws, next, st.settings)
      for (const x of inWorld(ws)) {
        send(x, { t: 'scene.remove', id: m.id, active: next })
        if (x.scene === m.id) { viewFor(x, null); sendView(x) }
      }
      return
    }
    case 'scene.activate': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (!sceneRow(m.id, ws)) return nack(c, m, 'no such scene')
      saveState(ws, m.id, settings)
      for (const x of inWorld(ws)) {
        send(x, { t: 'active', id: m.id })
        // the players move with the table; the GM who pressed the button comes along, other GMs keep their own view
        if (x.role !== 'gm' || x === c) { x.scene = m.id; sendView(x) }
      }
      return
    }
    case 'token.add': {
      if (!canCreateToken(c.role, settings)) return nack(c, m, 'not allowed')
      if (!sceneRow(m.sceneId, ws)) return nack(c, m, 'no such scene')
      const p = { ...m.token }
      if (!gm) { p.hidden = false; p.locked = false; p.owners = [c.user.id]; p.pageId = null }
      else if (p.owners) p.owners = realUsers(p.owners)
      if (p.pageId && !db.prepare('SELECT 1 FROM pages WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(p.pageId, ws)) return nack(c, m, 'no such page')
      const z = ((db.prepare('SELECT MAX(z) AS z FROM tokens WHERE scene_id = ?').get(m.sceneId) as { z: number | null }).z ?? 0) + 1
      const id = uid()
      const t = now()
      db.prepare(
        `INSERT INTO tokens(id,scene_id,workspace_id,name,x,y,size,rotation,image,color,page_id,hidden,locked,owners,z,data,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(id, m.sceneId, ws, p.name ?? '', p.x ?? 0, p.y ?? 0, p.size ?? 1, p.rotation ?? 0, p.image ?? '', p.color ?? '', p.pageId ?? null,
        p.hidden ? 1 : 0, p.locked ? 1 : 0, JSON.stringify(p.owners ?? []), p.z ?? z, JSON.stringify(p.data ?? {}), t, t)
      return emitToken(ws, null, tokenRow(id, ws)!)
    }
    case 'token.update': {
      const before = tokenRow(m.id, ws)
      if (!before) return nack(c, m, 'no such token')
      const patch = { ...m.patch }
      // players may only turn their own token; everything else (name, owners, visibility...) is the GM's
      if (!gm) {
        const keys = Object.keys(patch)
        if (!keys.length || keys.some((k) => k !== 'rotation') || !canMoveToken(c.role, c.user.id, before, settings)) return nack(c, m, 'not allowed')
      }
      if (patch.owners) patch.owners = realUsers(patch.owners)
      if (patch.pageId && !db.prepare('SELECT 1 FROM pages WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(patch.pageId, ws)) return nack(c, m, 'no such page')
      const cols = Object.keys(patch).filter((k) => k in TOKEN_COLUMNS)
      if (!cols.length) return
      const val = (k: string) => {
        const v = (patch as Record<string, unknown>)[k]
        return k === 'owners' || k === 'data' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v
      }
      db.prepare(`UPDATE tokens SET ${cols.map((k) => `${TOKEN_COLUMNS[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...cols.map(val), now(), m.id)
      return emitToken(ws, before, tokenRow(m.id, ws)!)
    }
    case 'token.move': {
      const upd = db.prepare('UPDATE tokens SET x = ?, y = ?, rotation = ?, updated_at = ? WHERE id = ?')
      for (const mv of m.moves) {
        const before = tokenRow(mv.id, ws)
        if (!before) continue
        if (!canMoveToken(c.role, c.user.id, before, settings)) { send(c, { t: 'token', token: before }); continue }
        upd.run(mv.x, mv.y, mv.rotation ?? before.rotation, now(), mv.id)
        emitToken(ws, before, tokenRow(mv.id, ws)!)
      }
      return
    }
    case 'token.delete': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      for (const id of m.ids) {
        const before = tokenRow(id, ws)
        if (!before) continue
        db.prepare('DELETE FROM tokens WHERE id = ?').run(id)
        emitToken(ws, before, null)
      }
      return
    }
    case 'settings.set': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const next = settingsSchema.parse({ ...settings, ...m.patch })
      saveState(ws, stateOf(ws).active, next)
      for (const x of inWorld(ws)) {
        x.role = roleAt(x.user, x.wr, next)
        send(x, { t: 'settings', settings: next, you: { id: x.user.id, username: x.user.username, role: x.role } })
        // someone who stopped running the table goes back to the table's scene
        if (x.role !== 'gm' && x.scene !== stateOf(ws).active) { viewFor(x, null); sendView(x) }
      }
      return announce(ws)
    }
    case 'cursor': {
      if (!gm && !(c.role === 'player' && settings.showCursors)) return
      return sameScene(c, (x) => x !== c && (gm || settings.showCursors || x.role === 'gm'), { t: 'cursor', user: c.user.id, name: c.user.username, x: m.x, y: m.y })
    }
    case 'ping': {
      if (!canPing(c.role, settings)) return
      return sameScene(c, () => true, { t: 'ping', user: c.user.id, name: c.user.username, x: m.x, y: m.y })
    }
    case 'ruler': {
      if (!canRuler(c.role, settings)) return
      return sameScene(c, (x) => x !== c, { t: 'ruler', user: c.user.id, name: c.user.username, points: m.points })
    }
  }
}

const sameScene = (c: Conn, who: (x: Conn) => boolean, msg: unknown) => {
  for (const x of inWorld(c.ws)) if (x.scene === c.scene && who(x)) send(x, msg)
}

async function applyScenePatch(c: Conn, m: ClientMessage, id: string, patch: Record<string, unknown>) {
  const p = { ...patch } as Record<string, unknown>
  if (typeof p.bg === 'string' && p.bg) {
    const dims = await sizeOfUpload(p.bg, c.ws)
    if (!dims) { nack(c, m, 'that image is not in this world'); return false }
    // a new background sets the scene to its size unless the GM gave one
    p.width ??= Math.max(100, dims.width)
    p.height ??= Math.max(100, dims.height)
  }
  const cols = Object.keys(p).filter((k) => k in SCENE_COLUMNS)
  if (!cols.length) return true
  db.prepare(`UPDATE scenes SET ${cols.map((k) => `${SCENE_COLUMNS[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...cols.map((k) => p[k] as string | number), now(), id)
  return true
}

function refuse(socket: import('node:stream').Duplex, status: string) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

export function attachTable(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
  server.on('upgrade', (req, socket, head) => {
    const m = /^\/api\/table\/([^/]+)$/.exec((req.url ?? '').split('?')[0])
    if (!m) return
    const origin = req.headers.origin
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) return refuse(socket, '403 Forbidden') } catch { return refuse(socket, '403 Forbidden') }
    }
    const user = userFromCookieHeader(req.headers.cookie)
    if (!user) return refuse(socket, '401 Unauthorized')
    const role = worldRole(user, m[1])
    if (!role) return refuse(socket, '404 Not Found')
    wss.handleUpgrade(req, socket, head, (socket) => {
      const c: Conn = {
        socket, user, ws: m[1], wr: role, role: roleAt(user, role, stateOf(m[1]).settings), scene: null, alive: true,
        limit: makeLimiter(90, 180), queue: Promise.resolve(),
      }
      conns.add(c)
      presenceChanged()
      sendSnapshot(c)
      announce(c.ws)
      socket.on('message', (raw: RawData) => {
        // chatty messages (cursor, ruler, drag) are dropped when a client floods; the rest are never dropped
        const text = raw.toString()
        let json: unknown
        try { json = JSON.parse(text) } catch { return socket.close(1003, 'bad message') }
        const r = clientMessage.safeParse(json)
        if (!r.success) return send(c, { t: 'nack', op: (json as { op?: string } | null)?.op ?? null, error: 'bad message' })
        if (!c.limit() && ['cursor', 'ruler', 'token.move'].includes(r.data.t)) return
        c.queue = c.queue.then(() => handle(c, r.data)).catch(() => nack(c, r.data, 'failed'))
      })
      socket.on('pong', () => { c.alive = true })
      socket.on('close', () => { conns.delete(c); presenceChanged(); announce(c.ws); sameScene(c, () => true, { t: 'cursor.gone', user: c.user.id }) })
      socket.on('error', () => socket.terminate())
    })
  })

  const beat = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) { c.socket.terminate(); continue }
      c.alive = false
      c.socket.ping()
    }
  }, 30_000)
  beat.unref()
}

/** After access changed: drop people who lost the world, and recompute who is a player, a spectator or a GM. */
export function revalidateTable(changedUsers?: string[]) {
  const worlds = new Set<string>()
  for (const c of [...conns]) {
    if (changedUsers && !changedUsers.includes(c.user.id)) continue
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(c.user.id) as AuthUser | undefined
    const role = user ? worldRole(user, c.ws) : null
    if (!user || !role) { c.socket.close(CLOSE_DENIED, 'no access'); continue }
    c.user = user
    c.wr = role
    c.role = roleAt(user, role, stateOf(c.ws).settings)
    worlds.add(c.ws)
    sendSnapshot(c)
  }
  for (const ws of worlds) announce(ws)
  presenceChanged()
}

/** Who sits at a table right now, for the admin dashboard. */
export const tableSnapshot = () => [...conns].map((c) => ({ userId: c.user.id, username: c.user.username, worldId: c.ws, role: c.role }))

export function closeAllTable() {
  for (const c of conns) c.socket.close(1001, 'server stopping')
  conns.clear()
}

/** After a backup was restored the stored tables are different: send everyone fresh state. */
export function resetTable() {
  for (const c of conns) sendSnapshot(c)
}
