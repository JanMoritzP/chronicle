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
import { publishWorld } from './live.js'
import { presenceChanged } from './presence.js'
import { ALLOWED } from './routes/uploads.js'
import { parseChat, readable, type Kind, type Part } from './chat.js'
import { advance, emptyCombat, end as endCombat, start as startCombat, visible as visibleCombat, withList, type Combat } from './combat.js'
import { parseRoll } from './dice.js'
import { encounterRow } from './routes/encounters.js'
import {
  canCreateToken, canEditStats, canMoveToken, canPing, canRuler, canSeeToken, clientMessage, makeLimiter, parseSettings, redact, roleAt, settingsSchema,
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
  grid: string; grid_size: number; unit: string; dist: number; diagonal: string; fog: number; darkness: number
}
const sceneJson = (r: SceneRow) => ({
  id: r.id, name: r.name, sort: r.sort, bg: r.bg, width: r.width, height: r.height,
  grid: r.grid, gridSize: r.grid_size, unit: r.unit, dist: r.dist, diagonal: r.diagonal, fog: !!r.fog, darkness: r.darkness,
})
const SCENE_COLUMNS: Record<string, string> = { name: 'name', bg: 'bg', width: 'width', height: 'height', grid: 'grid', gridSize: 'grid_size', unit: 'unit', dist: 'dist', diagonal: 'diagonal', fog: 'fog', darkness: 'darkness' }

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
  ? (db.prepare('SELECT * FROM tokens WHERE scene_id = ? AND workspace_id = ? ORDER BY z, created_at').all(scene, c.ws) as TokenDb[]).map(tokenJson).filter((t) => canSeeToken(c.role, c.user.id, t)).map((t) => redact(c.role, c.user.id, t))
  : []

interface WallDb { id: string; x1: number; y1: number; x2: number; y2: number; kind: string; open: number }
/** Everyone gets the walls (their screen needs them to work out what is hidden); a secret door looks like any other wall until the GM changes it. */
function wallsFor(c: Conn, scene: string | null) {
  if (!scene) return []
  return (db.prepare('SELECT id, x1, y1, x2, y2, kind, open FROM scene_walls WHERE scene_id = ? AND workspace_id = ?').all(scene, c.ws) as WallDb[])
    .map((w) => ({ id: w.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, kind: w.kind === 'secret' && c.role !== 'gm' ? 'wall' : w.kind, open: !!w.open && !(w.kind === 'secret' && c.role !== 'gm') }))
}
/** Light given off by tokens, hidden ones too: a torch in the dark is seen whoever carries it. */
function lightsOf(ws: string, scene: string | null) {
  if (!scene) return []
  return (db.prepare("SELECT id, x, y, data FROM tokens WHERE scene_id = ? AND workspace_id = ? AND data LIKE '%\"light\"%'").all(scene, ws) as { id: string; x: number; y: number; data: string }[])
    .map((r) => ({ id: r.id, x: r.x, y: r.y, ...(parse<Record<string, any>>(r.data, {}).light ?? {}) }))
    .filter((l) => (l.bright ?? 0) > 0 || (l.dim ?? 0) > 0)
}
const fogOf = (c: Conn, scene: string | null) => {
  if (!scene) return null
  const r = db.prepare('SELECT mask FROM scene_fog WHERE scene_id = ? AND user_id = ?').get(scene, c.user.id) as { mask: Buffer } | undefined
  return r ? r.mask.toString('base64') : null
}
function combatOf(ws: string): Combat {
  const row = db.prepare('SELECT combat FROM table_state WHERE workspace_id = ?').get(ws) as { combat: string } | undefined
  const c = parse<Partial<Combat>>(row?.combat ?? '{}', {})
  return { ...emptyCombat(), ...c, list: Array.isArray(c.list) ? c.list : [] }
}
function saveCombat(ws: string, combat: Combat) {
  const st = stateOf(ws)
  saveState(ws, st.active, st.settings)
  db.prepare('UPDATE table_state SET combat = ? WHERE workspace_id = ?').run(JSON.stringify(combat), ws)
  for (const x of inWorld(ws)) send(x, { t: 'combat', combat: visibleCombat(combat, x.role === 'gm') })
}
/** The initiative bonus of a creature, from the sheet on its page: its printed bonus, else its Dexterity modifier. */
function initiativeBonus(ws: string, pageId: string | null) {
  if (!pageId) return 0
  const row = db.prepare('SELECT props FROM pages WHERE id = ? AND workspace_id = ?').get(pageId, ws) as { props: string } | undefined
  const sheet = parse<{ sheet?: { initiative?: number; abilities?: { dex?: number } } }>(row?.props ?? '{}', {}).sheet
  if (!sheet) return 0
  return typeof sheet.initiative === 'number' ? sheet.initiative : Math.floor(((sheet.abilities?.dex ?? 10) - 10) / 2)
}
/** A character's hit points on the table are the hit points on their sheet: the page follows the token. */
function followHp(ws: string, pageId: string | null, hp: { value?: number; max?: number; temp?: number } | undefined) {
  if (!pageId || !hp) return
  const row = db.prepare('SELECT props FROM pages WHERE id = ? AND workspace_id = ?').get(pageId, ws) as { props: string } | undefined
  const props = parse<{ sheet?: { kind?: string; hp?: { max?: number; current?: number; temp?: number } } }>(row?.props ?? '{}', {})
  if (props.sheet?.kind !== 'character' || !props.sheet.hp) return
  const h = props.sheet.hp
  if (typeof hp.value === 'number') h.current = Math.max(-9999, Math.min(100000, Math.round(hp.value)))
  if (typeof hp.temp === 'number') h.temp = Math.max(0, Math.min(100000, Math.round(hp.temp)))
  if (typeof hp.max === 'number') h.max = Math.max(0, Math.min(100000, Math.round(hp.max)))
  db.prepare('UPDATE pages SET props = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(props), now(), pageId)
  publishWorld(ws, { k: 'refresh', area: 'pages', pageId })
}

function postChat(ws: string, userId: string, name: string, kind: Kind, to: string[], parts: Part[]) {
  const msg = { id: uid(), ts: now(), userId, name, kind, to, parts }
  db.prepare('INSERT INTO chat_messages(id,workspace_id,user_id,name,ts,kind,to_ids,parts) VALUES(?,?,?,?,?,?,?,?)').run(msg.id, ws, userId, name, msg.ts, kind, JSON.stringify(to), JSON.stringify(parts))
  for (const x of inWorld(ws)) if (readable(msg, x.user.id, x.role === 'gm')) send(x, { t: 'chat.msg', msg: { ...msg } })
}

interface DrawingDb { id: string; scene_id: string; user_id: string; kind: string; points: string; color: string; width: number; fill: string; text: string; gm_only: number }
const drawingJson = (r: DrawingDb) => ({
  id: r.id, sceneId: r.scene_id, userId: r.user_id, kind: r.kind, points: parse<{ x: number; y: number }[]>(r.points, []), color: r.color, width: r.width, fill: r.fill, text: r.text, gmOnly: !!r.gm_only,
})
const drawingRow = (id: string) => { const r = db.prepare('SELECT * FROM drawings WHERE id = ?').get(id) as DrawingDb | undefined; return r ? drawingJson(r) : undefined }
/** Drawings the GM keeps to themselves are left out for everyone else. */
const drawingsFor = (c: Conn, scene: string | null) => !scene ? [] : (db.prepare('SELECT * FROM drawings WHERE scene_id = ? AND workspace_id = ? ORDER BY created_at').all(scene, c.ws) as DrawingDb[]).filter((r) => c.role === 'gm' || !r.gm_only).map(drawingJson)

const sceneState = (c: Conn) => ({ walls: wallsFor(c, c.scene), lights: lightsOf(c.ws, c.scene), fog: fogOf(c, c.scene), drawings: drawingsFor(c, c.scene) })

function sendView(c: Conn) {
  send(c, { t: 'view', sceneId: c.scene, tokens: tokensFor(c, c.scene), ...sceneState(c) })
}
const sendWalls = (ws: string, sceneId: string) => { for (const c of inWorld(ws)) if (c.scene === sceneId) send(c, { t: 'walls', sceneId, walls: wallsFor(c, sceneId) }) }
const sendLights = (ws: string, sceneId: string) => { const lights = lightsOf(ws, sceneId); for (const c of inWorld(ws)) if (c.scene === sceneId) send(c, { t: 'lights', sceneId, lights }) }

/** Everyone who may open the world, so the GM can hand out tokens to people who are not online. */
const membersOf = (ws: string) => db.prepare(
  `SELECT u.id, u.username, u.role FROM users u WHERE u.role = 'owner' OR u.id IN (SELECT user_id FROM workspace_members WHERE workspace_id = ?) ORDER BY u.username`,
).all(ws) as { id: string; username: string; role: string }[]

interface ChatOut { id: string; ts: number; userId: string; name: string; kind: Kind; to: string[]; parts: Part[] }
/** A message as a reader sees it: a whisper also says who it was for. */
const chatJson = (m: ChatOut, _reader: string) => ({ id: m.id, ts: m.ts, userId: m.userId, name: m.name, kind: m.kind, to: m.to, parts: m.parts })

function historyFor(c: Conn) {
  const rows = db.prepare('SELECT id, user_id, name, ts, kind, to_ids, parts FROM chat_messages WHERE workspace_id = ? ORDER BY ts DESC LIMIT 200').all(c.ws) as { id: string; user_id: string; name: string; ts: number; kind: Kind; to_ids: string; parts: string }[]
  return rows
    .map((r): ChatOut => ({ id: r.id, ts: r.ts, userId: r.user_id, name: r.name, kind: r.kind, to: parse<string[]>(r.to_ids, []), parts: parse<Part[]>(r.parts, []) }))
    .filter((m) => readable(m, c.user.id, c.role === 'gm'))
    .slice(0, 100)
    .reverse()
    .map((m) => chatJson(m, c.user.id))
}

function sendSnapshot(c: Conn) {
  const { active, settings } = stateOf(c.ws)
  viewFor(c, c.scene)
  send(c, {
    t: 'snapshot', you: { id: c.user.id, username: c.user.username, role: c.role }, settings, scenes: scenesOf(c.ws), active,
    sceneId: c.scene, tokens: tokensFor(c, c.scene), online: onlineIn(c.ws), members: membersOf(c.ws), chat: historyFor(c), combat: visibleCombat(combatOf(c.ws), c.role === 'gm'), ...sceneState(c),
  })
}

/** After a token changed (or appeared, or went away) tell each viewer of its scene what they are entitled to know. */
function emitToken(ws: string, before: TokenRow | null, after: TokenRow | null) {
  const sceneId = (after ?? before)!.sceneId
  const glows = (t: TokenRow | null) => { const l = t?.data.light as { bright?: number; dim?: number } | undefined; return !!l && ((l.bright ?? 0) > 0 || (l.dim ?? 0) > 0) }
  if (glows(before) || glows(after)) sendLights(ws, sceneId)
  for (const c of inWorld(ws)) {
    if (c.scene !== sceneId) continue
    const sawBefore = !!before && canSeeToken(c.role, c.user.id, before)
    const seesAfter = !!after && canSeeToken(c.role, c.user.id, after)
    if (seesAfter) send(c, { t: 'token', token: redact(c.role, c.user.id, after!) })
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
        if (!canMoveToken(c.role, c.user.id, before, settings)) { send(c, { t: 'token', token: redact(c.role, c.user.id, before) }); continue }
        upd.run(mv.x, mv.y, mv.rotation ?? before.rotation, now(), mv.id)
        emitToken(ws, before, tokenRow(mv.id, ws)!)
      }
      return
    }
    case 'token.stat': {
      const before = tokenRow(m.id, ws)
      if (!before) return nack(c, m, 'no such token')
      if (!canEditStats(c.role, c.user.id, before, settings)) return nack(c, m, 'not allowed')
      if (m.stat?.hpPrivate !== undefined && !gm) return nack(c, m, 'only the GM can do that')
      const data: Record<string, any> = { ...before.data }
      const st = m.stat ?? {}
      if (st.hp) data.hp = { ...(data.hp ?? {}), ...st.hp }
      if (st.ac !== undefined) { if (st.ac === null) delete data.ac; else data.ac = st.ac }
      if (st.conditions) data.conditions = [...new Set(st.conditions)]
      if (st.hpPrivate !== undefined) data.hpPrivate = st.hpPrivate
      if (m.damage) {
        // damage wears down temporary hit points first; healing stops at the maximum
        const hp = { value: 0, max: 0, temp: 0, ...(data.hp ?? {}) }
        if (m.damage > 0) {
          const soak = Math.min(hp.temp, m.damage)
          hp.temp -= soak
          hp.value = Math.max(0, hp.value - (m.damage - soak))
        } else hp.value = hp.max > 0 ? Math.min(hp.max, hp.value - m.damage) : hp.value - m.damage
        data.hp = hp
      }
      if (JSON.stringify(data).length > 8000) return nack(c, m, 'too much data')
      db.prepare('UPDATE tokens SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), now(), m.id)
      if (st.hp || m.damage) followHp(ws, before.pageId, data.hp)
      return emitToken(ws, before, tokenRow(m.id, ws)!)
    }
    case 'chat': {
      const parsed = parseChat(m.text)
      if ('error' in parsed) return nack(c, m, parsed.error)
      if (c.role === 'spectator' && parsed.kind !== 'say') return nack(c, m, 'Spectators can talk but not roll or whisper.')
      let to: string[] = []
      if (parsed.kind === 'whisper') {
        const target = membersOf(ws).find((u) => u.username.toLowerCase() === parsed.to!.toLowerCase())
        if (!target) return nack(c, m, `Nobody called “${parsed.to}” can be reached at this table.`)
        to = [target.id]
      }
      const name = gm && m.as ? m.as.trim() || c.user.username : c.user.username
      const msg = { id: uid(), ts: now(), userId: c.user.id, name, kind: parsed.kind, to, parts: parsed.parts }
      db.prepare('INSERT INTO chat_messages(id,workspace_id,user_id,name,ts,kind,to_ids,parts) VALUES(?,?,?,?,?,?,?,?)').run(msg.id, ws, msg.userId, name, msg.ts, msg.kind, JSON.stringify(to), JSON.stringify(msg.parts))
      db.prepare('DELETE FROM chat_messages WHERE workspace_id = ? AND ts < ?').run(ws, msg.ts - 90 * 24 * 3600 * 1000)
      for (const x of inWorld(ws)) if (readable(msg, x.user.id, x.role === 'gm')) send(x, { t: 'chat.msg', msg: chatJson(msg, x.user.id) })
      return
    }
    case 'wall.add': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (!sceneRow(m.sceneId, ws)) return nack(c, m, 'no such scene')
      const ins = db.prepare('INSERT INTO scene_walls(id,scene_id,workspace_id,x1,y1,x2,y2,kind) VALUES(?,?,?,?,?,?,?,?)')
      db.transaction(() => { for (const w of m.walls) if (w.x1 !== w.x2 || w.y1 !== w.y2) ins.run(uid(), m.sceneId, ws, w.x1, w.y1, w.x2, w.y2, w.kind) })()
      return sendWalls(ws, m.sceneId)
    }
    case 'wall.update': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const w = db.prepare('SELECT scene_id AS s FROM scene_walls WHERE id = ? AND workspace_id = ?').get(m.id, ws) as { s: string } | undefined
      if (!w) return nack(c, m, 'no such wall')
      const cols = Object.keys(m.patch)
      if (!cols.length) return
      db.prepare(`UPDATE scene_walls SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((k) => { const v = (m.patch as Record<string, unknown>)[k]; return typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number) }), m.id)
      return sendWalls(ws, w.s)
    }
    case 'wall.delete': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const scenes = new Set<string>()
      for (const id of m.ids) {
        const w = db.prepare('SELECT scene_id AS s FROM scene_walls WHERE id = ? AND workspace_id = ?').get(id, ws) as { s: string } | undefined
        if (!w) continue
        scenes.add(w.s)
        db.prepare('DELETE FROM scene_walls WHERE id = ?').run(id)
      }
      for (const s of scenes) sendWalls(ws, s)
      return
    }
    case 'door.toggle': {
      if (!gm && !(c.role === 'player' && settings.playersOpenDoors)) return nack(c, m, 'not allowed')
      const w = db.prepare('SELECT scene_id AS s, kind, open FROM scene_walls WHERE id = ? AND workspace_id = ?').get(m.id, ws) as { s: string; kind: string; open: number } | undefined
      if (!w || (w.kind !== 'door' && w.kind !== 'secret')) return nack(c, m, 'that is not a door')
      if (w.kind === 'secret' && !gm) return nack(c, m, 'not allowed')
      db.prepare('UPDATE scene_walls SET open = ? WHERE id = ?').run(w.open ? 0 : 1, m.id)
      return sendWalls(ws, w.s)
    }
    case 'fog.save': {
      if (c.role === 'spectator' || c.scene !== m.sceneId) return
      const mask = Buffer.from(m.mask, 'base64')
      if (!mask.length || mask.length > 300_000) return
      db.prepare('INSERT INTO scene_fog(scene_id,user_id,mask,updated_at) VALUES(?,?,?,?) ON CONFLICT(scene_id,user_id) DO UPDATE SET mask = excluded.mask, updated_at = excluded.updated_at').run(m.sceneId, c.user.id, mask, now())
      return
    }
    case 'fog.reset': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (!sceneRow(m.sceneId, ws)) return nack(c, m, 'no such scene')
      db.prepare('DELETE FROM scene_fog WHERE scene_id = ?').run(m.sceneId)
      for (const x of inWorld(ws)) if (x.scene === m.sceneId) send(x, { t: 'fog.reset', sceneId: m.sceneId })
      return
    }
    case 'encounter.stage': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const enc = encounterRow(m.id, ws)
      const scene = sceneRow(m.sceneId, ws)
      if (!enc || !scene) return nack(c, m, 'no such encounter or scene')
      const SIZE: Record<string, number> = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 }
      const COLORS = ['#c0392b', '#8e44ad', '#d35400', '#16a085', '#7f8c8d', '#2e86c1']
      const created: string[] = []
      let slot = 0, col = 0
      for (const mon of enc.monsters) {
        const page = db.prepare('SELECT title, props FROM pages WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(mon.pageId, ws) as { title: string; props: string } | undefined
        if (!page) continue
        const props = parse<{ sheet?: { size?: string; hp?: { max?: number }; ac?: { value?: number } }; portrait?: string }>(page.props, {})
        const sheet = props.sheet
        const size = SIZE[String(sheet?.size ?? '').toLowerCase()] ?? 1
        const image = typeof props.portrait === 'string' && /^\/api\/uploads\/[A-Za-z0-9-]+$/.test(props.portrait) ? props.portrait : ''
        const data: Record<string, unknown> = { hpPrivate: true }
        if (sheet?.hp?.max) data.hp = { value: sheet.hp.max, max: sheet.hp.max }
        if (sheet?.ac?.value != null) data.ac = sheet.ac.value
        for (let i = 1; i <= mon.count; i++) {
          // a row of tokens that wraps after six, each one cell or more apart
          const x = m.x + (slot % 6) * scene.grid_size * Math.max(1, size)
          const y = m.y + Math.floor(slot / 6) * scene.grid_size * Math.max(1, size)
          slot++
          const id = uid(), t = now()
          const z = ((db.prepare('SELECT MAX(z) AS z FROM tokens WHERE scene_id = ?').get(m.sceneId) as { z: number | null }).z ?? 0) + 1
          db.prepare(
            `INSERT INTO tokens(id,scene_id,workspace_id,name,x,y,size,rotation,image,color,page_id,hidden,locked,owners,z,data,created_at,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).run(id, m.sceneId, ws, mon.count > 1 ? `${page.title} ${i}` : page.title, x, y, size, 0, image, COLORS[col % COLORS.length], mon.pageId, m.hidden ? 1 : 0, 0, '[]', z, JSON.stringify(data), t, t)
          created.push(id)
          emitToken(ws, null, tokenRow(id, ws)!)
        }
        col++
      }
      send(c, { t: 'staged', count: created.length })
      if (m.combat && created.length) {
        await handle(c, { t: 'combat.add', tokenIds: created })
        await handle(c, { t: 'combat.roll' })
      }
      return
    }
    case 'draw.add': {
      if (!(gm || (c.role === 'player' && settings.playersDraw))) return nack(c, m, 'not allowed')
      if (!sceneRow(m.sceneId, ws)) return nack(c, m, 'no such scene')
      const id = uid()
      db.prepare('INSERT INTO drawings(id,scene_id,workspace_id,user_id,kind,points,color,width,fill,text,gm_only,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, m.sceneId, ws, c.user.id, m.kind, JSON.stringify(m.points), m.color, m.width, m.fill ?? '', m.text ?? '', gm && m.gmOnly ? 1 : 0, now())
      const d = drawingRow(id)!
      for (const x of inWorld(ws)) if (x.scene === m.sceneId && (x.role === 'gm' || !d.gmOnly)) send(x, { t: 'draw', drawing: d })
      return
    }
    case 'draw.delete': {
      const gone: Record<string, string[]> = {}
      for (const id of m.ids) {
        const d = drawingRow(id)
        const scene = d ? sceneRow(d.sceneId, ws) : undefined
        if (!d || !scene) continue
        if (!gm && d.userId !== c.user.id) { nack(c, m, 'not allowed'); continue }
        db.prepare('DELETE FROM drawings WHERE id = ?').run(id)
        ;(gone[d.sceneId] ??= []).push(id)
      }
      for (const [sceneId, ids] of Object.entries(gone)) for (const x of inWorld(ws)) if (x.scene === sceneId) send(x, { t: 'draw.remove', ids })
      return
    }
    case 'draw.clear': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (!sceneRow(m.sceneId, ws)) return nack(c, m, 'no such scene')
      db.prepare('DELETE FROM drawings WHERE scene_id = ? AND workspace_id = ?').run(m.sceneId, ws)
      for (const x of inWorld(ws)) if (x.scene === m.sceneId) send(x, { t: 'draw.cleared', sceneId: m.sceneId })
      return
    }
    case 'combat.add': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const combat = combatOf(ws)
      const have = new Set(combat.list.map((x) => x.tokenId))
      const added = m.tokenIds.map((id) => tokenRow(id, ws)).filter((t): t is TokenRow => !!t && !have.has(t.id))
      if (!added.length) return
      return saveCombat(ws, withList(combat, [...combat.list, ...added.map((t) => ({ id: uid(), tokenId: t.id, name: t.name || 'Unnamed', init: null, hidden: t.hidden, done: false }))]))
    }
    case 'combat.remove': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const combat = combatOf(ws)
      return saveCombat(ws, withList(combat, combat.list.filter((x) => !m.ids.includes(x.id))))
    }
    case 'combat.init': {
      const combat = combatOf(ws)
      const who = combat.list.find((x) => x.id === m.id)
      if (!who) return nack(c, m, 'no such combatant')
      const token = who.tokenId ? tokenRow(who.tokenId, ws) : undefined
      if (!gm && !(c.role === 'player' && token && token.owners.includes(c.user.id))) return nack(c, m, 'not allowed')
      return saveCombat(ws, withList(combat, combat.list.map((x) => (x.id === m.id ? { ...x, init: m.value } : x))))
    }
    case 'combat.roll': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const combat = combatOf(ws)
      const targets = combat.list.filter((x) => (m.ids ? m.ids.includes(x.id) : x.init === null))
      if (!targets.length) return
      const rolled = new Map<string, number>()
      for (const x of targets) {
        const token = x.tokenId ? tokenRow(x.tokenId, ws) : undefined
        const b = initiativeBonus(ws, token?.pageId ?? null)
        const roll = parseRoll(`1d20${b >= 0 ? '+' : '-'}${Math.abs(b)} Initiative: ${x.name}`)
        if (!roll) continue
        rolled.set(x.id, roll.total)
        // a hidden combatant rolls where only the GM sees it
        postChat(ws, c.user.id, c.user.username, x.hidden ? 'gmroll' : 'roll', [], [{ t: 'roll', roll }])
      }
      return saveCombat(ws, withList(combat, combat.list.map((x) => (rolled.has(x.id) ? { ...x, init: rolled.get(x.id)! } : x))))
    }
    case 'combat.flag': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const combat = combatOf(ws)
      return saveCombat(ws, withList(combat, combat.list.map((x) => (x.id === m.id ? { ...x, ...(m.hidden !== undefined ? { hidden: m.hidden } : {}), ...(m.done !== undefined ? { done: m.done } : {}) } : x))))
    }
    case 'combat.control': {
      const combat = combatOf(ws)
      // the person whose turn it is may end it
      const turnToken = combat.turn ? tokenRow(combat.list.find((x) => x.id === combat.turn)?.tokenId ?? '', ws) : undefined
      const ownsTurn = c.role === 'player' && !!turnToken && turnToken.owners.includes(c.user.id)
      if (!gm && !(m.action === 'next' && ownsTurn)) return nack(c, m, 'only the GM can do that')
      if (m.action === 'start') return saveCombat(ws, startCombat(combat))
      if (m.action === 'next') return saveCombat(ws, advance(combat, 1))
      if (m.action === 'prev') return saveCombat(ws, advance(combat, -1))
      if (m.action === 'end') return saveCombat(ws, endCombat(combat))
      return saveCombat(ws, emptyCombat())
    }
    case 'token.delete': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      for (const id of m.ids) {
        const before = tokenRow(id, ws)
        if (!before) continue
        db.prepare('DELETE FROM tokens WHERE id = ?').run(id)
        emitToken(ws, before, null)
        const combat = combatOf(ws)
        if (combat.list.some((x) => x.tokenId === id)) saveCombat(ws, withList(combat, combat.list.filter((x) => x.tokenId !== id)))
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
  db.prepare(`UPDATE scenes SET ${cols.map((k) => `${SCENE_COLUMNS[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...cols.map((k) => (typeof p[k] === 'boolean' ? (p[k] ? 1 : 0) : (p[k] as string | number))), now(), id)
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
