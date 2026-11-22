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
import { ALLOWED, AUDIO, VIDEO } from './routes/uploads.js'
import { darknessAt } from './daylight.js'
import { parseChat, readable, withInline, type Kind, type Part } from './chat.js'
import { buildSight, canSee, type Sight, type SightToken } from './sight.js'
import { advance, delay as delayTurn, marker as lairMarker, emptyCombat, end as endCombat, start as startCombat, visible as visibleCombat, withList, type Combat } from './combat.js'
import { cryptoRng, parseRoll } from './dice.js'
import { DAMAGE_TYPES_PF2E, firstAttack, leftReach, adjustDamage, concentrationDc, deathSave, longRest, modOf, saveBonusOf, shortRest, type Effect } from './rules5e.js'
import { parseSheet, type Sheet } from './sheet.js'
import { cardsText, discardFromHand, drawCards, entriesText, freshDeck, handOf, parseCards, parseEntries, pick, toDiscard, toHand, type DeckState } from './tables.js'
import { activePack } from './routes/packs.js'
import { packDamageTypes } from './pack.js'
import { effectsOf, MAX_EFFECTS, modsOf, tick } from './effects.js'
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
  /** What this player's tokens see on the scene they are on (null when nothing is hidden from them), and which tokens they were told about. */
  sight: Sight | null; shown: Set<string>
}
const conns = new Set<Conn>()

interface SceneRow {
  id: string; workspace_id: string; name: string; sort: number; bg: string; width: number; height: number
  grid: string; grid_size: number; unit: string; dist: number; diagonal: string; fog: number; darkness: number; weather: string
  folder: string; notes: string; grid_color: string; grid_opacity: number; ambient: string; layers?: string
}
interface SceneLayer { id: string; name: string; players: boolean; locked: boolean }
const layersOf = (r: Pick<SceneRow, 'layers'> | undefined): SceneLayer[] => parse<SceneLayer[]>(r?.layers ?? '[]', [])
const sceneJson = (r: SceneRow) => ({
  id: r.id, name: r.name, sort: r.sort, bg: r.bg, width: r.width, height: r.height,
  grid: r.grid, gridSize: r.grid_size, unit: r.unit, dist: r.dist, diagonal: r.diagonal, fog: !!r.fog, darkness: r.darkness, weather: r.weather ?? 'none',
  folder: r.folder ?? '', gridColor: r.grid_color ?? '#ffffff', gridOpacity: r.grid_opacity ?? 0.28, ambient: r.ambient ?? '', layers: layersOf(r),
})
/** What one person is sent of a scene: the notes are the GM's. */
const sceneFor = (c: Conn, r: SceneRow) => ({ ...sceneJson(r), ...(c.role === 'gm' ? { notes: r.notes ?? '' } : {}) })
const SCENE_COLUMNS: Record<string, string> = { name: 'name', bg: 'bg', width: 'width', height: 'height', grid: 'grid', gridSize: 'grid_size', unit: 'unit', dist: 'dist', diagonal: 'diagonal', fog: 'fog', darkness: 'darkness', weather: 'weather', folder: 'folder', notes: 'notes', gridColor: 'grid_color', gridOpacity: 'grid_opacity', ambient: 'ambient', layers: 'layers' }

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

const scenesOf = (ws: string, c?: Conn) => (db.prepare('SELECT * FROM scenes WHERE workspace_id = ? ORDER BY sort, created_at').all(ws) as SceneRow[]).map((r) => (c ? sceneFor(c, r) : sceneJson(r)))
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

/** What a player's tokens can see on a scene, from the walls, lights and tokens as they are stored now. Null for everyone but players, and where there is no fog. */
function sightFor(c: Conn, sceneId: string | null): Sight | null {
  if (c.role !== 'player' || !sceneId) return null
  const sc = sceneRow(sceneId, c.ws)
  if (!sc || !(sc.fog || sc.darkness > 0)) return null
  const walls = (db.prepare('SELECT x1, y1, x2, y2, kind, open FROM scene_walls WHERE scene_id = ?').all(sceneId) as WallDb[])
    .filter((w) => w.kind === 'wall' || w.kind === 'secret' || w.kind === 'oneway' || w.kind === 'terrain' || (w.kind === 'door' && !w.open))
    .map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, ...(w.kind === 'oneway' ? { oneway: true } : {}), ...(w.kind === 'terrain' ? { limited: true } : {}) }))
  const reveals = revealsOf(c.ws, sceneId)
  const tokens = (db.prepare('SELECT id, x, y, owners, data FROM tokens WHERE scene_id = ?').all(sceneId) as { id: string; x: number; y: number; owners: string; data: string }[])
    .map((t): SightToken => ({ id: t.id, x: t.x, y: t.y, owners: parse<string[]>(t.owners, []), data: parse<SightToken['data']>(t.data, {}) }))
  return buildSight({ width: sc.width, height: sc.height, gridSize: sc.grid_size, dist: sc.dist, fog: !!sc.fog, darkness: sc.darkness }, walls, tokens, c.user.id, stateOf(c.ws).settings.sharedVision, reveals)
}

/** May this connection be told about the token: allowed to see it at all (hidden ones), and in sight where there is fog. */
const tellable = (c: Conn, t: TokenRow) => canSeeToken(c.role, c.user.id, t) && canSee(c.sight, t)

function tokensFor(c: Conn, scene: string | null) {
  if (!scene) { c.sight = null; c.shown = new Set(); return [] }
  c.sight = sightFor(c, scene)
  const list = (db.prepare('SELECT * FROM tokens WHERE scene_id = ? AND workspace_id = ? ORDER BY z, created_at').all(scene, c.ws) as TokenDb[]).map(tokenJson).filter((t) => tellable(c, t))
  c.shown = new Set(list.map((t) => t.id))
  return list.map((t) => redact(c.role, c.user.id, t))
}

interface WallDb { id: string; x1: number; y1: number; x2: number; y2: number; kind: string; open: number; locked?: number }
/** Areas of a scene the GM has shown to the players. */
const revealsOf = (ws: string, scene: string | null) => (scene ? (db.prepare('SELECT id, x, y, w, h FROM scene_reveals WHERE scene_id = ? AND workspace_id = ?').all(scene, ws) as { id: string; x: number; y: number; w: number; h: number }[]) : [])
const sendReveals = (ws: string, sceneId: string) => { const reveals = revealsOf(ws, sceneId); for (const c of inWorld(ws)) if (c.scene === sceneId) send(c, { t: 'reveals', sceneId, reveals }); scheduleSight(ws, sceneId) }
/** Everyone gets the walls (their screen needs them to work out what is hidden); a secret door looks like any other wall until the GM changes it. */
function wallsFor(c: Conn, scene: string | null) {
  if (!scene) return []
  return (db.prepare('SELECT id, x1, y1, x2, y2, kind, open, locked FROM scene_walls WHERE scene_id = ? AND workspace_id = ?').all(scene, c.ws) as WallDb[])
    .map((w) => ({ id: w.id, locked: !!w.locked, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, kind: w.kind === 'secret' && c.role !== 'gm' ? 'wall' : w.kind, open: !!w.open && !(w.kind === 'secret' && c.role !== 'gm') }))
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
/** In combat, how far the token whose turn it is has moved this turn, in the scene's units (the longer way across the cells). */
function trackMove(ws: string, before: TokenRow, after: TokenRow) {
  const combat = combatOf(ws)
  if (!combat.active || !combat.turn) return
  const who = combat.list.find((x) => x.id === combat.turn)
  if (!who || who.tokenId !== after.id) return
  const sc = sceneRow(after.sceneId, ws)
  if (!sc) return
  const cells = Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y)) / sc.grid_size
  const moved = Math.round(((who.moved ?? 0) + cells * sc.dist) * 10) / 10
  saveCombat(ws, withList(combat, combat.list.map((x) => (x.id === who.id ? { ...x, moved } : x))))
  // stepping away from someone who could hit back: whoever has their reaction ready may make an opportunity attack
  if (after.hidden || ((after.data.conditions as string[] | undefined) ?? []).includes('Disengaged')) return
  const mine = after.owners.length > 0
  const foes = combat.list.filter((x) => x.tokenId && x.tokenId !== after.id && !x.done && !x.reaction && x.id !== who.id)
    .map((x) => ({ x, t: tokenRow(x.tokenId!, ws) })).filter((p): p is { x: typeof p.x; t: TokenRow } => !!p.t && p.t.sceneId === after.sceneId && !p.t.hidden && (p.t.owners.length > 0) !== mine)
  for (const id of leftReach({ id: after.id, x: before.x, y: before.y }, after, foes.map((p) => ({ id: p.t.id, x: p.t.x, y: p.t.y })), sc.grid_size)) {
    const foe = foes.find((p) => p.t.id === id)!.t
    postChat(ws, '', foe.name, 'emote', [], [{ t: 'text', text: `can make an opportunity attack against ${after.name}` }])
    for (const c of inWorld(ws)) if (c.role === 'gm' || foe.owners.includes(c.user.id)) send(c, { t: 'threat', from: foe.id, fromName: foe.name, target: after.id, targetName: after.name })
  }
}

function initiativeBonus(ws: string, pageId: string | null) {
  if (!pageId) return 0
  const row = db.prepare('SELECT props FROM pages WHERE id = ? AND workspace_id = ?').get(pageId, ws) as { props: string } | undefined
  const sheet = parse<{ sheet?: { initiative?: number; ruleset?: string; pf2e?: { perception?: number }; abilities?: { dex?: number } } }>(row?.props ?? '{}', {}).sheet
  if (!sheet) return 0
  if (typeof sheet.initiative === 'number') return sheet.initiative
  // Pathfinder 2e rolls initiative with Perception
  if (sheet.ruleset === 'pf2e' && typeof sheet.pf2e?.perception === 'number') return sheet.pf2e.perception
  return Math.floor(((sheet.abilities?.dex ?? 10) - 10) / 2)
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

/** The structured sheet of the page a token stands for, with the props it lives in. */
function readSheet(ws: string, pageId: string | null) {
  if (!pageId) return null
  const row = db.prepare('SELECT props FROM pages WHERE id = ? AND workspace_id = ?').get(pageId, ws) as { props: string } | undefined
  if (!row) return null
  const props = parse<Record<string, unknown>>(row.props, {})
  const sheet = parseSheet(props.sheet)
  return sheet ? { props, sheet } : null
}
function writeSheet(ws: string, pageId: string, props: Record<string, unknown>, sheet: Sheet) {
  db.prepare('UPDATE pages SET props = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...props, sheet }), now(), pageId)
  publishWorld(ws, { k: 'refresh', area: 'pages', pageId })
}

/** The rules the world plays by, which decides how a roll against a difficulty class is read. */
function worldSystem(ws: string): string {
  const row = db.prepare('SELECT settings FROM workspaces WHERE id = ?').get(ws) as { settings: string } | undefined
  return parse<{ system?: string }>(row?.settings ?? '{}', {}).system ?? '5e'
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
interface PinDb { id: string; x: number; y: number; label: string; page_id: string | null; gm_only: number }
/** Pins on a scene; the GM's own are left out for everyone else. */
const pinsFor = (c: Conn, scene: string | null) => !scene ? [] : (db.prepare('SELECT id, x, y, label, page_id, gm_only FROM scene_pins WHERE scene_id = ? AND workspace_id = ?').all(scene, c.ws) as PinDb[]).filter((p) => c.role === 'gm' || !p.gm_only).map((p) => ({ id: p.id, x: p.x, y: p.y, label: p.label, pageId: p.page_id, gmOnly: !!p.gm_only }))
const sendPins = (ws: string, sceneId: string) => { for (const c of inWorld(ws)) if (c.scene === sceneId) send(c, { t: 'pins', sceneId, pins: pinsFor(c, sceneId) }) }
const drawingRow = (id: string) => { const r = db.prepare('SELECT * FROM drawings WHERE id = ?').get(id) as DrawingDb | undefined; return r ? drawingJson(r) : undefined }
/** Drawings the GM keeps to themselves are left out for everyone else. */
const drawingsFor = (c: Conn, scene: string | null) => !scene ? [] : (db.prepare('SELECT * FROM drawings WHERE scene_id = ? AND workspace_id = ? ORDER BY created_at').all(scene, c.ws) as DrawingDb[]).filter((r) => c.role === 'gm' || !r.gm_only).map(drawingJson)

interface TileDb { id: string; scene_id: string; image: string; x: number; y: number; w: number; h: number; rotation: number; layer: string; layer_id: string | null; locked: number; hidden: number; z: number }
/** Props and overlays. What the GM keeps hidden, or on the GM layer, is left out for everyone else. */
function tilesFor(c: Conn, scene: string | null) {
  if (!scene) return []
  const named = new Map(layersOf(sceneRow(scene, c.ws)).map((l) => [l.id, l]))
  return (db.prepare('SELECT * FROM scene_tiles WHERE scene_id = ? AND workspace_id = ? ORDER BY z').all(scene, c.ws) as TileDb[])
    .filter((t) => c.role === 'gm' || (!t.hidden && t.layer !== 'gm' && named.get(t.layer_id ?? '')?.players !== false))
    .map((t) => ({ id: t.id, sceneId: t.scene_id, image: t.image, x: t.x, y: t.y, w: t.w, h: t.h, rotation: t.rotation, layer: t.layer, layerId: t.layer_id && named.has(t.layer_id) ? t.layer_id : null, locked: !!t.locked || !!named.get(t.layer_id ?? '')?.locked, hidden: !!t.hidden, z: t.z, flip: !!(t as { flip?: number }).flip }))
}
const sendTiles = (ws: string, sceneId: string) => { for (const c of inWorld(ws)) if (c.scene === sceneId) send(c, { t: 'tiles', sceneId, tiles: tilesFor(c, sceneId) }) }

const sceneState = (c: Conn) => ({ pins: pinsFor(c, c.scene), walls: wallsFor(c, c.scene), reveals: revealsOf(c.ws, c.scene), lights: lightsOf(c.ws, c.scene), fog: fogOf(c, c.scene), drawings: drawingsFor(c, c.scene), tiles: tilesFor(c, c.scene) })

function sendView(c: Conn) {
  send(c, { t: 'view', sceneId: c.scene, tokens: tokensFor(c, c.scene), ...sceneState(c) })
}
const sendWalls = (ws: string, sceneId: string) => { for (const c of inWorld(ws)) if (c.scene === sceneId) send(c, { t: 'walls', sceneId, walls: wallsFor(c, sceneId) }); scheduleSight(ws, sceneId) }
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

interface HandoutDb { id: string; title: string; text: string; image: string; revealed: string; updated_at: number }
const revealedOf = (h: HandoutDb): 'all' | string[] => { const r = parse<'all' | string[]>(h.revealed, []); return r === 'all' ? 'all' : Array.isArray(r) ? r : [] }
const mayRead = (h: HandoutDb, userId: string) => { const r = revealedOf(h); return r === 'all' || r.includes(userId) }
/** What a person is shown of the handouts: the GM sees all and who can read each, the others only what was revealed to them. */
function handoutsFor(c: Conn) {
  const rows = db.prepare('SELECT id, title, text, image, revealed, updated_at FROM handouts WHERE workspace_id = ? ORDER BY created_at').all(c.ws) as HandoutDb[]
  return rows
    .filter((h) => c.role === 'gm' || mayRead(h, c.user.id))
    .map((h) => ({ id: h.id, title: h.title, text: h.text, image: h.image, ...(c.role === 'gm' ? { revealed: revealedOf(h) } : {}) }))
}
function sendHandouts(ws: string) { for (const c of inWorld(ws)) send(c, { t: 'handouts', handouts: handoutsFor(c) }) }
function showHandout(ws: string, h: HandoutDb, only?: (c: Conn) => boolean) {
  for (const c of inWorld(ws)) if (c.role !== 'gm' && mayRead(h, c.user.id) && (!only || only(c))) send(c, { t: 'handout.show', handout: { id: h.id, title: h.title, text: h.text, image: h.image } })
}

// ---------- roll tables and decks ----------

interface RollTableDb { id: string; name: string; entries: string; secret: number; updated_at: number }
const rollTableRows = (ws: string) => db.prepare('SELECT id, name, entries, secret, updated_at FROM roll_tables WHERE workspace_id = ? ORDER BY name COLLATE NOCASE').all(ws) as RollTableDb[]
/** The tables a person can see: the GM all of them with their entries, the others the names of the ones that are not secret. */
function rollTablesFor(c: Conn) {
  return rollTableRows(c.ws).filter((t) => c.role === 'gm' || !t.secret).map((t) => ({ id: t.id, name: t.name, secret: !!t.secret, size: parseEntries(t.entries).length, ...(c.role === 'gm' ? { entries: t.entries } : {}) }))
}
function sendRollTables(ws: string) { for (const c of inWorld(ws)) send(c, { t: 'rolltables', tables: rollTablesFor(c) }) }

interface DeckDb { id: string; name: string; cards: string; state: string }
const deckRows = (ws: string) => db.prepare('SELECT id, name, cards, state FROM decks WHERE workspace_id = ? ORDER BY name COLLATE NOCASE').all(ws) as DeckDb[]
const deckState = (d: DeckDb): DeckState => {
  const st = parse<Partial<DeckState>>(d.state, {})
  return { draw: st.draw ?? [], discard: st.discard ?? [], hands: st.hands ?? {} }
}
const saveDeck = (id: string, st: DeckState) => db.prepare('UPDATE decks SET state = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(st), now(), id)
/** Everyone sees the decks, the face-up discard pile and how many cards each person holds; a person sees only their own cards. */
function decksFor(c: Conn) {
  return deckRows(c.ws).map((d) => {
    const cards = parseCards(d.cards), st = deckState(d)
    const view = (i: number) => ({ id: i, name: cards[i]?.name ?? '?', text: cards[i]?.text ?? '' })
    return {
      id: d.id, name: d.name, size: cards.length, remaining: st.draw.length, discard: st.discard.map(view),
      hand: handOf(st, c.user.id).map(view), held: Object.fromEntries(Object.entries(st.hands).filter(([u]) => u !== c.user.id).map(([u, h]) => [u, h.length])),
      ...(c.role === 'gm' ? { cardsText: d.cards } : {}),
    }
  })
}
function sendDecks(ws: string) { for (const c of inWorld(ws)) send(c, { t: 'decks', decks: decksFor(c) }) }

/** Rolls on a table and says what came up. A secret table, or a GM roll of one, is for the GMs and the roller only. */
function rollOnTable(ws: string, c: Conn, t: RollTableDb) {
  const entries = parseEntries(t.entries)
  const hit = pick(entries, cryptoRng)
  if (!hit) return false
  const roll = { expr: `1d${hit.total}`, label: t.name, total: hit.roll, terms: [{ kind: 'dice' as const, sign: 1 as const, count: 1, sides: hit.total, dice: [{ v: hit.roll }], subtotal: hit.roll, text: `1d${hit.total}` }], crit: null }
  postChat(ws, c.user.id, c.user.username, t.secret ? 'gmroll' : 'roll', [], [{ t: 'roll', roll }, { t: 'text', text: ' → ' }, ...withInline(entries[hit.index].text, cryptoRng)])
  return true
}

// ---------- the jukebox ----------

/** What plays in each world right now. It is not kept: a restart is silence. */
const playing = new Map<string, Set<string>>()
// ---------- voice and video ----------

/** Who is in the call in each world, and whether they send video. Not kept. */
const calls = new Map<string, Map<string, { video: boolean }>>()
const callMembers = (ws: string) => [...(calls.get(ws) ?? [])].map(([id, v]) => ({ id, video: v.video }))
function sendCall(ws: string) { const members = callMembers(ws); for (const c of inWorld(ws)) send(c, { t: 'call', members, ice: config.iceServers }) }
function leaveCall(ws: string, userId: string) { if (calls.get(ws)?.delete(userId)) sendCall(ws) }

// ---------- who is at the table, and a ready check ----------

/** A ready check in each world: who has answered, and how. Not kept. */
const readyChecks = new Map<string, Map<string, boolean>>()
const readyState = (ws: string) => { const r = readyChecks.get(ws); return r ? { answers: Object.fromEntries(r) } : null }
function sendReady(ws: string) { const check = readyState(ws); for (const c of inWorld(ws)) send(c, { t: 'ready', check }) }

/** The tracks of a playlist in the order they were added: a track named "Tavern/Fiddle" is in the playlist Tavern. */
function playlistOf(ws: string, name: string) {
  return (db.prepare('SELECT id, name FROM tracks WHERE workspace_id = ? ORDER BY created_at').all(ws) as { id: string; name: string }[]).filter((t) => t.name.includes('/') && t.name.split('/')[0].trim().toLowerCase() === name.trim().toLowerCase())
}
interface TrackDb { id: string; name: string; upload_id: string; loop: number; scene_id: string | null }
function jukeboxFor(ws: string) {
  const rows = db.prepare('SELECT id, name, upload_id, loop, scene_id FROM tracks WHERE workspace_id = ? ORDER BY created_at').all(ws) as TrackDb[]
  const on = playing.get(ws) ?? new Set<string>()
  return { tracks: rows.map((t) => ({ id: t.id, name: t.name, url: t.upload_id.startsWith('https://') ? t.upload_id : `/api/uploads/${t.upload_id}`, loop: !!t.loop, scene: t.scene_id })), playing: rows.filter((t) => on.has(t.id)).map((t) => t.id) }
}
function sendJukebox(ws: string) { const j = jukeboxFor(ws); for (const c of inWorld(ws)) send(c, { t: 'jukebox', ...j }) }

// ---------- time of day ----------

/** Sets the darkness of the scenes that follow the time of day to what the hour says, and tells everyone. */
function applyDaylight(ws: string, s: TableSettings) {
  const dark = darknessAt(s.hour)
  for (const id of s.daylight) {
    const row = sceneRow(id, ws)
    if (!row || row.darkness === dark) continue
    db.prepare('UPDATE scenes SET darkness = ?, updated_at = ? WHERE id = ?').run(dark, now(), id)
    const fresh = sceneRow(id, ws)!
    for (const x of inWorld(ws)) send(x, { t: 'scene', scene: sceneFor(x, fresh) })
    scheduleSight(ws, id)
  }
}

// ---------- triggers ----------

interface TriggerDb { id: string; scene_id: string | null; name: string; event: string; x: number; y: number; radius: number; action: string; arg: string; once: number; fired: number }
const triggerRows = (ws: string) => db.prepare('SELECT id, scene_id, name, event, x, y, radius, action, arg, once, fired FROM triggers WHERE workspace_id = ? ORDER BY created_at').all(ws) as TriggerDb[]
const triggerJson = (t: TriggerDb) => ({ id: t.id, name: t.name, scene: t.scene_id, event: t.event, x: t.x, y: t.y, radius: t.radius, action: t.action, arg: t.arg, once: !!t.once, fired: !!t.fired })
/** Only the GM is told about triggers: a player must not learn where the traps are. */
function sendTriggers(ws: string) { const triggers = triggerRows(ws).map(triggerJson); for (const c of inWorld(ws)) if (c.role === 'gm') send(c, { t: 'triggers', triggers }) }

/** The scene, column and row a travel trigger sends a token to, from its text "sceneId|column|row". */
const travelArg = (arg: string) => { const m = /^([A-Za-z0-9-]{1,60})\|(\d{1,4})\|(\d{1,4})$/.exec(arg); return m ? { scene: m[1], col: Number(m[2]), row: Number(m[3]) } : null }

/** Takes a token to another scene (stairs, a trapdoor, a gate to another floor). Its owners come along to look at that scene. */
function travelToken(ws: string, who: TokenRow, dest: { scene: string; col: number; row: number }) {
  const sc = sceneRow(dest.scene, ws)
  if (!sc || sc.id === who.sceneId) return
  const x = Math.min(sc.width, (dest.col + 0.5) * sc.grid_size), y = Math.min(sc.height, (dest.row + 0.5) * sc.grid_size)
  emitToken(ws, who, null)
  db.prepare('UPDATE tokens SET scene_id = ?, x = ?, y = ?, updated_at = ? WHERE id = ?').run(sc.id, x, y, now(), who.id)
  const after = tokenRow(who.id, ws)!
  emitToken(ws, null, after)
  for (const c of inWorld(ws)) if (c.role === 'player' && after.owners.includes(c.user.id)) { c.scene = sc.id; sendView(c) }
}

/** What a trigger does: says its text at the table, shows a handout to everyone, starts a track, or takes the token that set it off to another scene. */
function fireTrigger(ws: string, userId: string, t: TriggerDb, who?: TokenRow) {
  if (t.once) db.prepare('UPDATE triggers SET fired = 1 WHERE id = ?').run(t.id)
  if (t.action === 'say') {
    postChat(ws, userId, t.name, 'say', [], [{ t: 'text', text: t.arg.replace(/\{name\}/g, who?.name ?? 'Someone') }])
  } else if (t.action === 'handout') {
    const h = db.prepare('SELECT id, title, text, image, revealed, updated_at FROM handouts WHERE id = ? AND workspace_id = ?').get(t.arg, ws) as HandoutDb | undefined
    if (h) {
      db.prepare("UPDATE handouts SET revealed = '\"all\"', updated_at = ? WHERE id = ?").run(now(), h.id)
      sendHandouts(ws)
      showHandout(ws, { ...h, revealed: '"all"' }, (x) => !mayRead(h, x.user.id))
    }
  } else if (t.action === 'travel') {
    const dest = travelArg(t.arg)
    if (who && dest) travelToken(ws, who, dest)
  } else if (t.action === 'play') {
    if (db.prepare('SELECT 1 FROM tracks WHERE id = ? AND workspace_id = ?').get(t.arg, ws)) {
      if (!playing.has(ws)) playing.set(ws, new Set())
      playing.get(ws)!.add(t.arg)
      sendJukebox(ws)
    }
  }
  sendTriggers(ws)
}

/** Fires the triggers of an event (a round begins, a token goes down) that have not been used up. */
function fireEvent(ws: string, userId: string, event: 'round' | 'down', who?: TokenRow) {
  for (const t of triggerRows(ws)) {
    if (t.event !== event || (t.once && t.fired)) continue
    if (t.scene_id && who && t.scene_id !== who.sceneId) continue
    fireTrigger(ws, userId, t, who)
  }
}

/** A player's token moved: the places it came into fire their triggers. */
function fireEnter(ws: string, userId: string, before: TokenRow, after: TokenRow) {
  if (!after.owners.length) return
  const sc = sceneRow(after.sceneId, ws)
  if (!sc) return
  for (const t of triggerRows(ws)) {
    if (t.event !== 'enter' || (t.once && t.fired) || (t.scene_id && t.scene_id !== after.sceneId)) continue
    const inside = (p: { x: number; y: number }) => Math.hypot(p.x - t.x, p.y - t.y) <= t.radius * sc.grid_size
    if (!inside(before) && inside(after)) fireTrigger(ws, userId, t, after)
  }
}

function sendSnapshot(c: Conn) {
  const { active, settings } = stateOf(c.ws)
  send(c, { t: 'call', members: callMembers(c.ws), ice: config.iceServers })
  viewFor(c, c.scene)
  send(c, {
    t: 'snapshot', you: { id: c.user.id, username: c.user.username, role: c.role }, settings, scenes: scenesOf(c.ws, c), active,
    sceneId: c.scene, tokens: tokensFor(c, c.scene), online: onlineIn(c.ws), members: membersOf(c.ws), chat: historyFor(c), combat: visibleCombat(combatOf(c.ws), c.role === 'gm'), handouts: handoutsFor(c), rolltables: rollTablesFor(c), decks: decksFor(c), jukebox: jukeboxFor(c.ws), ready: readyState(c.ws), ...(c.role === 'gm' ? { triggers: triggerRows(c.ws).map(triggerJson) } : {}), ...sceneState(c),
  })
}

/** After a token changed (or appeared, or went away) tell each viewer of its scene what they are entitled to know. */
/** Writes down what happened at the table, so a session can be played back. Old entries go after a month. */
function logEvent(ws: string, kind: string, sceneId: string | null, data: Record<string, unknown>) {
  try {
    db.prepare('INSERT INTO session_events(workspace_id,ts,kind,scene_id,data) VALUES(?,?,?,?,?)').run(ws, now(), kind, sceneId, JSON.stringify(data))
    if (Math.random() < 0.01) db.prepare('DELETE FROM session_events WHERE workspace_id = ? AND ts < ?').run(ws, now() - 30 * 24 * 3600 * 1000)
  } catch { /* the replay is a nicety: a failed note must not stop play */ }
}

function emitToken(ws: string, before: TokenRow | null, after: TokenRow | null) {
  const sceneId = (after ?? before)!.sceneId
  if (!before && after) logEvent(ws, 'add', sceneId, { id: after.id, name: after.name, x: after.x, y: after.y, hidden: after.hidden })
  else if (before && !after) logEvent(ws, 'remove', sceneId, { id: before.id, name: before.name })
  else if (before && after) {
    if (before.x !== after.x || before.y !== after.y) logEvent(ws, 'move', sceneId, { id: after.id, name: after.name, x: after.x, y: after.y, fx: before.x, fy: before.y, hidden: after.hidden })
    const hp = (t: TokenRow) => (t.data.hp as { value?: number; max?: number } | undefined)
    if (hp(before)?.value !== hp(after)?.value) logEvent(ws, 'hp', sceneId, { id: after.id, name: after.name, value: hp(after)?.value ?? null, max: hp(after)?.max ?? null })
  }
  const glows = (t: TokenRow | null) => { const l = t?.data.light as { bright?: number; dim?: number } | undefined; return !!l && ((l.bright ?? 0) > 0 || (l.dim ?? 0) > 0) }
  if (glows(before) || glows(after)) sendLights(ws, sceneId)
  for (const c of inWorld(ws)) {
    if (c.scene !== sceneId) continue
    const id = (after ?? before)!.id
    if (after && tellable(c, after)) { c.shown.add(id); send(c, { t: 'token', token: redact(c.role, c.user.id, after) }) }
    else if (c.shown.delete(id)) send(c, { t: 'token.remove', ids: [id] })
  }
  // whatever this changed about who can see what is worked out a moment later, once, however many changes came together
  scheduleSight(ws, sceneId)
}

const sightTimers = new Map<string, NodeJS.Timeout>()
function scheduleSight(ws: string, sceneId: string) {
  const key = ws + ':' + sceneId
  if (sightTimers.has(key)) return
  sightTimers.set(key, setTimeout(() => { sightTimers.delete(key); refreshSight(ws, sceneId) }, 50))
}

/** Players are told about the tokens that came into view and told to forget the ones that left it. */
function refreshSight(ws: string, sceneId: string) {
  const watchers = inWorld(ws).filter((c) => c.scene === sceneId && c.role === 'player')
  if (!watchers.length) return
  const rows = (db.prepare('SELECT * FROM tokens WHERE scene_id = ? AND workspace_id = ?').all(sceneId, ws) as TokenDb[]).map(tokenJson)
  for (const c of watchers) {
    c.sight = sightFor(c, sceneId)
    for (const t of rows) {
      if (tellable(c, t)) { if (!c.shown.has(t.id)) { c.shown.add(t.id); send(c, { t: 'token', token: redact(c.role, c.user.id, t) }) } }
      else if (c.shown.delete(t.id)) send(c, { t: 'token.remove', ids: [t.id] })
    }
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

/**
 * Applies a change to a token's numbers and, when the GM switched the rules on, what follows from a hit: resistance, a spell kept going,
 * falling unconscious. `say` is false when the caller reports the hit itself.
 */
function applyStat(ws: string, userId: string, before: TokenRow, stat: Record<string, any> | undefined, damage: number, type: string | undefined, settings: TableSettings, say = true): { error?: string; dealt?: number; effect?: Effect } {
  const data: Record<string, any> = { ...before.data }
  const st = stat ?? {}
  if (st.hp) data.hp = { ...(data.hp ?? {}), ...st.hp }
  if (st.ac !== undefined) { if (st.ac === null) delete data.ac; else data.ac = st.ac }
  if (st.speed !== undefined) { if (st.speed === null) delete data.speed; else data.speed = st.speed }
  if (st.conditions) data.conditions = [...new Set(st.conditions)]
  if (st.hpPrivate !== undefined) data.hpPrivate = st.hpPrivate
  // rules the GM switched on: resistances, a spell kept going after a hit, falling unconscious
  const auto = settings.automation
  const pg = damage ? readSheet(ws, before.pageId) : null
  const isChar = pg?.sheet.kind === 'character'
  const notes: string[] = []
  const rolls: Part[] = []
  let dmg = damage
  let effect: Effect = null
  if (dmg > 0 && auto.damage) {
    const adj = adjustDamage(dmg, type, pg?.sheet, packDamageTypes(activePack(ws)) ?? (worldSystem(ws) === 'pf2e' ? DAMAGE_TYPES_PF2E : undefined))
    dmg = adj.amount
    if (say) notes.push(`takes ${dmg} ${type?.trim().toLowerCase() ?? ''} damage${adj.effect ? ` (${adj.effect})` : ''}`.replace(/  +/g, ' '))
  }
  const wasHp = (data.hp as { value?: number } | undefined)?.value ?? 0
  if (dmg) {
    // damage wears down temporary hit points first; healing stops at the maximum
    const hp = { value: 0, max: 0, temp: 0, ...(data.hp ?? {}) }
    if (dmg > 0) {
      const soak = Math.min(hp.temp, dmg)
      hp.temp -= soak
      hp.value = Math.max(0, hp.value - (dmg - soak))
    } else hp.value = hp.max > 0 ? Math.min(hp.max, hp.value - dmg) : hp.value - dmg
    data.hp = hp
  }
  const hpNow = (data.hp as { value?: number } | undefined)?.value ?? 0
  let conditions = (data.conditions as string[] | undefined) ?? []
  let resetSaves = false
  // damage to someone who is already down is a failed death save; as much as their maximum kills outright
  let failsToAdd = 0
  if (dmg > 0 && auto.deathSaves && isChar && wasHp === 0) {
    failsToAdd = dmg >= (pg?.sheet.hp.max ?? Infinity) ? 3 : 1
    notes.push(failsToAdd >= 3 ? 'is struck down and dies' : 'is hurt while down and fails a death save')
  }
  if (dmg > 0 && auto.deathSaves && isChar && wasHp > 0 && hpNow === 0) { conditions = [...new Set([...conditions, 'Unconscious'])]; resetSaves = true; notes.push('falls unconscious') }
  if (dmg < 0 && auto.deathSaves && isChar && wasHp === 0 && hpNow > 0) { conditions = conditions.filter((x) => x !== 'Unconscious'); resetSaves = true; notes.push('is back on their feet') }
  if (dmg > 0 && auto.concentration && conditions.includes('Concentrating')) {
    if (hpNow === 0 && wasHp > 0) { conditions = conditions.filter((x) => x !== 'Concentrating'); notes.push('loses concentration') }
    else if (hpNow > 0) {
      const dc = concentrationDc(dmg)
      const bonus = pg ? pg.sheet.saves.con ?? modOf(pg.sheet.abilities.con) : 0
      const parsed = parseChat(`/r 1d20${bonus < 0 ? '-' : '+'}${Math.abs(bonus)}${modsOf(effectsOf(before.data)).save} Concentration save dc ${dc}`, undefined, worldSystem(ws))
      if (!('error' in parsed)) {
        rolls.push(...parsed.parts)
        const roll = parsed.parts[0]
        if (roll.t === 'roll' && (roll.roll.degree === 'failure' || roll.roll.degree === 'critical failure')) { conditions = conditions.filter((x) => x !== 'Concentrating'); notes.push('loses concentration') }
      }
    }
  }
  if (conditions.length || data.conditions) data.conditions = conditions
  if (JSON.stringify(data).length > 8000) return { error: 'too much data' }
  db.prepare('UPDATE tokens SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), now(), before.id)
  if (st.hp || dmg) followHp(ws, before.pageId, data.hp)
  if (failsToAdd && before.pageId) {
    const again = readSheet(ws, before.pageId)
    if (again) { const ds = again.sheet.deathSaves ?? { ok: 0, fail: 0 }; writeSheet(ws, before.pageId, again.props, { ...again.sheet, deathSaves: { ...ds, fail: Math.min(3, ds.fail + failsToAdd) } }) }
  }
  if (resetSaves && before.pageId) { const again = readSheet(ws, before.pageId); if (again?.sheet.deathSaves) writeSheet(ws, before.pageId, again.props, { ...again.sheet, deathSaves: { ok: 0, fail: 0 } }) }
  // what happened is said at the table, but quietly (to the GM) when the token itself is a secret
  const quiet = before.hidden || !!before.data.hpPrivate
  if (notes.length) postChat(ws, userId, before.name, quiet ? 'gmroll' : 'emote', [], [{ t: 'text', text: notes.join(' and ') }])
  if (rolls.length) postChat(ws, userId, before.name, quiet ? 'gmroll' : 'roll', [], rolls)
  emitToken(ws, before, tokenRow(before.id, ws)!)
  if (dmg > 0 && wasHp > 0 && hpNow === 0) fireEvent(ws, userId, 'down', before)
  if (((before.data.conditions as string[] | undefined) ?? []).includes('Concentrating') && !conditions.includes('Concentrating')) endConcentration(ws, userId, before)
  return { dealt: dmg, effect }
}

/** Effects that were kept up by concentrating end when the caster stops. */
function endConcentration(ws: string, userId: string, caster: TokenRow) {
  const rows = db.prepare('SELECT id FROM tokens WHERE workspace_id = ?').all(ws) as { id: string }[]
  for (const { id } of rows) {
    const t = tokenRow(id, ws)
    if (!t) continue
    const all = effectsOf(t.data)
    const gone = all.filter((e) => e.concentration && e.from === caster.id)
    if (!gone.length) continue
    const data = { ...t.data, effects: all.filter((e) => !gone.includes(e)) }
    db.prepare('UPDATE tokens SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), now(), id)
    postChat(ws, userId, t.name, t.hidden || t.data.hpPrivate ? 'gmroll' : 'emote', [], [{ t: 'text', text: `${gone.map((e) => e.name).join(', ')} ends: ${caster.name} stopped concentrating` }])
    emitToken(ws, t, tokenRow(id, ws)!)
  }
}

/** A round of combat is over: effects with a duration lose a round on every token, and the ones that run out are said to end. */
function tickEffects(ws: string, userId: string) {
  const rows = db.prepare('SELECT id FROM tokens WHERE workspace_id = ?').all(ws) as { id: string }[]
  for (const { id } of rows) {
    const t = tokenRow(id, ws)
    const all = t ? effectsOf(t.data) : []
    if (!t || !all.some((e) => e.rounds != null)) continue
    const { kept, ended } = tick(all)
    db.prepare('UPDATE tokens SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...t.data, effects: kept }), now(), id)
    if (ended.length) postChat(ws, userId, t.name, t.hidden || t.data.hpPrivate ? 'gmroll' : 'emote', [], [{ t: 'text', text: `${ended.map((e) => e.name).join(', ')} ${ended.length === 1 ? 'ends' : 'end'}` }])
    emitToken(ws, t, tokenRow(id, ws)!)
  }
}

/** The turn of this combatant just ended: effects that last until then are over. */
function endTurnEffects(ws: string, userId: string, combat: Combat) {
  const who = combat.list.find((x) => x.id === combat.turn)
  const t = who?.tokenId ? tokenRow(who.tokenId, ws) : undefined
  if (!t) return
  const all = effectsOf(t.data)
  const over = all.filter((e) => e.until === 'turn' && e.armed)
  if (!over.length) return
  db.prepare('UPDATE tokens SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...t.data, effects: all.filter((e) => !over.includes(e)) }), now(), t.id)
  postChat(ws, userId, t.name, t.hidden || t.data.hpPrivate ? 'gmroll' : 'emote', [], [{ t: 'text', text: `${over.map((e) => e.name).join(', ')} ${over.length === 1 ? 'ends' : 'end'}` }])
  emitToken(ws, t, tokenRow(t.id, ws)!)
}

/** A turn begins: its effects that wait for it start counting, and its reminder is said. */
function announceTurn(ws: string, userId: string, combat: Combat) {
  const who = combat.list.find((x) => x.id === combat.turn)
  if (!who || !combat.active) return
  const t = who.tokenId ? tokenRow(who.tokenId, ws) : undefined
  if (t) {
    const all = effectsOf(t.data)
    if (all.some((e) => e.until === 'turn' && !e.armed)) {
      db.prepare('UPDATE tokens SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...t.data, effects: all.map((e) => (e.until === 'turn' && !e.armed ? { ...e, armed: true } : e)) }), now(), t.id)
      emitToken(ws, t, tokenRow(t.id, ws)!)
    }
  }
  if (who.note) postChat(ws, userId, who.name, who.hidden || t?.hidden ? 'gmroll' : 'emote', [], [{ t: 'text', text: `${who.name}: ${who.note}` }])
}

/** When a fight ends: who was put out of it and what that is worth in experience, said to the GM. */
function combatSummary(ws: string, userId: string, combat: Combat) {
  if (!combat.active) return
  const beaten: { name: string; xp: number }[] = []
  for (const x of combat.list) {
    if (!x.done || !x.tokenId) continue
    const t = tokenRow(x.tokenId, ws)
    const sheet = t ? readSheet(ws, t.pageId)?.sheet : undefined
    if (sheet && sheet.kind !== 'character' && typeof sheet.xp === 'number') beaten.push({ name: x.name, xp: sheet.xp })
  }
  const total = beaten.reduce((n, b) => n + b.xp, 0)
  postChat(ws, userId, 'Combat', 'gmroll', [], [{ t: 'text', text: `The fight ended in round ${combat.round}.${beaten.length ? ` Beaten: ${beaten.map((b) => `${b.name} (${b.xp} XP)`).join(', ')}. ${total} XP in all.` : ' Nothing with an experience value was beaten.'}` }])
}

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
      // a new scene starts with the grid of the world's pack, if it has one
      const gridOf = activePack(ws)?.grid
      if (m.patch || gridOf) await applyScenePatch(c, m, id, { ...(gridOf ? { unit: gridOf.unit, dist: gridOf.dist, grid: gridOf.type } : {}), ...(m.patch ?? {}) })
      const st = stateOf(ws)
      if (!st.active) saveState(ws, id, st.settings)
      const row = sceneRow(id, ws)!
      for (const x of inWorld(ws)) send(x, { t: 'scene', scene: sceneFor(x, row), ...(!st.active ? { active: id } : {}) })
      for (const x of inWorld(ws)) if (!st.active && !x.scene) { x.scene = id; sendView(x) }
      return
    }
    case 'scene.update': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (!sceneRow(m.id, ws)) return nack(c, m, 'no such scene')
      if (!(await applyScenePatch(c, m, m.id, m.patch))) return
      { const row = sceneRow(m.id, ws)!; for (const x of inWorld(ws)) send(x, { t: 'scene', scene: sceneFor(x, row) }) }
      scheduleSight(ws, m.id)
      return
    }
    case 'scene.duplicate': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const src = sceneRow(m.id, ws)
      if (!src) return nack(c, m, 'no such scene')
      if (scenesOf(ws).length >= 200) return nack(c, m, 'That is as many scenes as a world can keep.')
      const id = uid(), t = now()
      const sort = ((db.prepare('SELECT MAX(sort) AS s FROM scenes WHERE workspace_id = ?').get(ws) as { s: number | null }).s ?? 0) + 1
      db.transaction(() => {
        db.prepare(`INSERT INTO scenes(id,workspace_id,name,sort,bg,width,height,grid,grid_size,unit,dist,diagonal,fog,darkness,weather,folder,notes,grid_color,grid_opacity,ambient,layers,created_at,updated_at)
          SELECT ?,workspace_id,?,?,bg,width,height,grid,grid_size,unit,dist,diagonal,fog,darkness,weather,folder,notes,grid_color,grid_opacity,ambient,layers,?,? FROM scenes WHERE id = ?`).run(id, `${src.name} copy`.slice(0, 120), sort, t, t, src.id)
        for (const w of db.prepare('SELECT x1,y1,x2,y2,kind,open,locked FROM scene_walls WHERE scene_id = ?').all(src.id) as { x1: number; y1: number; x2: number; y2: number; kind: string; open: number; locked: number }[])
          db.prepare('INSERT INTO scene_walls(id,scene_id,workspace_id,x1,y1,x2,y2,kind,open,locked) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid(), id, ws, w.x1, w.y1, w.x2, w.y2, w.kind, w.open, w.locked)
        for (const tl of db.prepare('SELECT image,x,y,w,h,rotation,layer,locked,hidden,z,flip,layer_id FROM scene_tiles WHERE scene_id = ?').all(src.id) as Record<string, any>[])
          db.prepare('INSERT INTO scene_tiles(id,scene_id,workspace_id,image,x,y,w,h,rotation,layer,locked,hidden,z,flip,layer_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(uid(), id, ws, tl.image, tl.x, tl.y, tl.w, tl.h, tl.rotation, tl.layer, tl.locked, tl.hidden, tl.z, tl.flip, tl.layer_id)
        for (const tk of db.prepare('SELECT name,x,y,size,rotation,image,color,page_id,hidden,locked,owners,z,data FROM tokens WHERE scene_id = ?').all(src.id) as Record<string, any>[])
          db.prepare('INSERT INTO tokens(id,scene_id,workspace_id,name,x,y,size,rotation,image,color,page_id,hidden,locked,owners,z,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(uid(), id, ws, tk.name, tk.x, tk.y, tk.size, tk.rotation, tk.image, tk.color, tk.page_id, tk.hidden, tk.locked, tk.owners, tk.z, tk.data, t, t)
        const md = db.prepare('SELECT doc FROM map_docs WHERE scene_id = ?').get(src.id) as { doc: string } | undefined
        if (md) db.prepare('INSERT INTO map_docs(scene_id,workspace_id,doc,updated_at) VALUES(?,?,?,?)').run(id, ws, md.doc, t)
      })()
      const row = sceneRow(id, ws)!
      for (const x of inWorld(ws)) send(x, { t: 'scene', scene: sceneFor(x, row) })
      return
    }
    case 'scene.send': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (!sceneRow(m.id, ws)) return nack(c, m, 'no such scene')
      // some of the players look at another scene for now (the party splits); they come back to the table's scene when they reconnect
      for (const x of inWorld(ws)) if (x.role !== 'gm' && m.to.includes(x.user.id)) { x.scene = m.id; sendView(x) }
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
      logEvent(ws, 'scene', m.id, { name: sceneRow(m.id, ws)?.name ?? '' })
      // sound that belongs to a scene starts with it, and sound that belongs to another scene stops
      { const tracks = db.prepare('SELECT id, scene_id FROM tracks WHERE workspace_id = ?').all(ws) as { id: string; scene_id: string | null }[]
        if (tracks.some((t) => t.scene_id)) {
          const on = playing.get(ws) ?? new Set<string>()
          for (const t of tracks) { if (t.scene_id === m.id) on.add(t.id); else if (t.scene_id) on.delete(t.id) }
          playing.set(ws, on)
          sendJukebox(ws)
        } }
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
    case 'token.light': {
      const before = tokenRow(m.id, ws)
      if (!before) return nack(c, m, 'no such token')
      if (!gm && !(c.role === 'player' && before.owners.includes(c.user.id))) return nack(c, m, 'not allowed')
      const data: Record<string, unknown> = { ...before.data }
      if (m.light) { data.light = { ...(before.data.light as object | undefined), ...m.light }; data.litItem = m.item ?? '' } else { delete data.light; delete data.litItem }
      db.prepare('UPDATE tokens SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), now(), m.id)
      return emitToken(ws, before, tokenRow(m.id, ws)!)
    }
    case 'token.move': {
      const upd = db.prepare('UPDATE tokens SET x = ?, y = ?, rotation = ?, updated_at = ? WHERE id = ?')
      for (const mv of m.moves) {
        const before = tokenRow(mv.id, ws)
        if (!before) continue
        if (!canMoveToken(c.role, c.user.id, before, settings)) { if (c.shown.has(before.id)) send(c, { t: 'token', token: redact(c.role, c.user.id, before) }); continue }
        upd.run(mv.x, mv.y, mv.rotation ?? before.rotation, now(), mv.id)
        const after = tokenRow(mv.id, ws)!
        emitToken(ws, before, after)
        fireEnter(ws, c.user.id, before, after)
        trackMove(ws, before, after)
      }
      return
    }
    case 'token.stat': {
      const before = tokenRow(m.id, ws)
      if (!before) return nack(c, m, 'no such token')
      if (!canEditStats(c.role, c.user.id, before, settings)) return nack(c, m, 'not allowed')
      if (m.stat?.hpPrivate !== undefined && !gm) return nack(c, m, 'only the GM can do that')
      const r = applyStat(ws, c.user.id, before, m.stat, m.damage ?? 0, m.type, settings)
      if (r.error) return nack(c, m, r.error)
      return
    }
    case 'attack': {
      if (!settings.automation.attacks) return nack(c, m, 'Attacks are not automated at this table. The GM can switch that on.')
      const from = tokenRow(m.from, ws)
      if (!from) return nack(c, m, 'no such token')
      if (!canEditStats(c.role, c.user.id, from, settings)) return nack(c, m, 'not allowed')
      if (!m.attack && !m.save) return nack(c, m, 'Nothing to roll.')
      const system = worldSystem(ws)
      const bonusText = (n: number) => `${n < 0 ? '-' : '+'}${Math.abs(n)}`
      for (const id of [...new Set(m.targets)]) {
        const target = tokenRow(id, ws)
        if (!target || target.sceneId !== from.sceneId || !canSeeToken(c.role, c.user.id, target)) continue
        // a secret target keeps its numbers secret: the report goes to the GMs and the person who attacked
        const quiet = target.hidden || !!target.data.hpPrivate
        const kind: Kind = quiet ? 'gmroll' : 'roll'
        const tsheet = readSheet(ws, target.pageId)?.sheet
        const parts: Part[] = []
        let multiplier = 1
        let crit = false
        let verdict = ''
        if (m.attack) {
          const tm = modsOf(effectsOf(target.data))
          const ac = typeof target.data.ac === 'number' ? target.data.ac + tm.ac : undefined
          const line = `/r 1d20${bonusText(m.attack.bonus)}${modsOf(effectsOf(from.data)).attack}${m.attack.mode ? ' ' + m.attack.mode : ''} ${m.label}, attack on ${target.name}${ac != null ? ` dc ${ac}` : ''}`
          const parsed = parseChat(line, undefined, system)
          if ('error' in parsed || parsed.parts[0].t !== 'roll') continue
          const roll = parsed.parts[0].roll
          parts.push(parsed.parts[0])
          crit = roll.crit === 'hit'
          if (ac == null) { multiplier = 0; verdict = `${target.name} has no armor class set, so the GM decides` }
          else if (roll.crit === 'miss' || (roll.crit !== 'hit' && roll.total < ac)) { multiplier = 0; verdict = `misses ${target.name}` }
          else verdict = `${crit ? 'critically hits' : 'hits'} ${target.name}`
        }
        if (m.save) {
          const line = `/r 1d20${bonusText(saveBonusOf(tsheet, m.save.ability))}${modsOf(effectsOf(target.data)).save} ${target.name}, ${m.save.ability.toUpperCase()} save dc ${m.save.dc}`
          const parsed = parseChat(line, undefined, system)
          if ('error' in parsed || parsed.parts[0].t !== 'roll') continue
          const roll = parsed.parts[0].roll
          parts.push(parsed.parts[0])
          const saved = roll.degree === 'success' || roll.degree === 'critical success'
          multiplier = saved ? (m.save.half ? 0.5 : 0) : 1
          verdict = saved ? `${target.name} saves${m.save.half ? ' and takes half' : ''}` : `${target.name} fails the save`
        }
        // damage: dice are rolled again on a critical hit, and the total goes through the target's resistances
        const dealt: string[] = []
        if (multiplier > 0 && m.damage?.length) {
          for (const d of m.damage) {
            const roll = parseRoll(d.expr)
            if (!roll) continue
            let total = roll.total
            if (crit) for (const t of parseRoll(d.expr)!.terms) if (t.kind === 'dice') total += t.sign * t.subtotal
            const amount = Math.max(0, Math.floor(total * multiplier))
            parts.push({ t: 'roll', roll: { ...roll, label: `${d.type ? d.type + ' ' : ''}damage${crit ? ' (critical)' : ''}`, total } })
            const fresh = tokenRow(id, ws)
            if (!fresh || amount <= 0) continue
            const r = applyStat(ws, c.user.id, fresh, undefined, amount, d.type, settings, false)
            if (!r.error) dealt.push(`${r.dealt} ${d.type?.trim().toLowerCase() ?? ''}${r.effect ? ` (${r.effect})` : ''}`.replace(/  +/g, ' ').trim())
          }
        }
        postChat(ws, c.user.id, from.name, kind, [], parts)
        postChat(ws, c.user.id, from.name, quiet ? 'gmroll' : 'emote', [], [{ t: 'text', text: `${verdict}${dealt.length ? ` for ${dealt.join(' and ')}` : ''}` }])
      }
      return
    }
    case 'effect.add': {
      const before = tokenRow(m.id, ws)
      if (!before) return nack(c, m, 'no such token')
      if (!canEditStats(c.role, c.user.id, before, settings)) return nack(c, m, 'not allowed')
      const all = effectsOf(before.data)
      if (all.length >= MAX_EFFECTS) return nack(c, m, 'That token has as many effects as it can carry.')
      if (m.effect.from && !tokenRow(m.effect.from, ws)) return nack(c, m, 'no such token')
      const data = { ...before.data, effects: [...all, { id: uid(), ...m.effect }] }
      db.prepare('UPDATE tokens SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), now(), m.id)
      const quiet = before.hidden || !!before.data.hpPrivate
      postChat(ws, c.user.id, before.name, quiet ? 'gmroll' : 'emote', [], [{ t: 'text', text: `is under ${m.effect.name}${m.effect.rounds ? ` for ${m.effect.rounds} ${m.effect.rounds === 1 ? 'round' : 'rounds'}` : ''}` }])
      return emitToken(ws, before, tokenRow(m.id, ws)!)
    }
    case 'effect.remove': {
      const before = tokenRow(m.id, ws)
      if (!before) return nack(c, m, 'no such token')
      if (!canEditStats(c.role, c.user.id, before, settings)) return nack(c, m, 'not allowed')
      const all = effectsOf(before.data)
      if (!all.some((e) => e.id === m.effectId)) return nack(c, m, 'no such effect')
      const data = { ...before.data, effects: all.filter((e) => e.id !== m.effectId) }
      db.prepare('UPDATE tokens SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), now(), m.id)
      return emitToken(ws, before, tokenRow(m.id, ws)!)
    }
    case 'token.rollhp': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      let n = 0
      for (const id of new Set(m.ids)) {
        const t = tokenRow(id, ws)
        const pg = t ? readSheet(ws, t.pageId) : null
        const formula = pg?.sheet.hp.formula?.replace(/\s+/g, '')
        const roll = formula ? parseRoll(formula) : null
        if (!t || !roll || roll.total < 1) continue
        const hp = { ...(t.data.hp as Record<string, number> | undefined), value: roll.total, max: roll.total, temp: 0 }
        db.prepare('UPDATE tokens SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...t.data, hp }), now(), id)
        emitToken(ws, t, tokenRow(id, ws)!)
        n++
      }
      if (!n) return nack(c, m, 'None of those tokens has a hit point formula on its sheet.')
      return
    }
    case 'token.rest': {
      const before = tokenRow(m.id, ws)
      if (!before) return nack(c, m, 'no such token')
      if (!canEditStats(c.role, c.user.id, before, settings)) return nack(c, m, 'not allowed')
      const pg = readSheet(ws, before.pageId)
      if (!pg || pg.sheet.kind !== 'character') return nack(c, m, 'Only a token with a character sheet can rest.')
      const out = m.kind === 'long' ? longRest(pg.sheet) : shortRest(pg.sheet, m.dice ?? 0, cryptoRng)
      writeSheet(ws, before.pageId!, pg.props, out.sheet)
      const data: Record<string, any> = { ...before.data }
      if (data.hp) data.hp = { ...data.hp, value: out.sheet.hp.current ?? out.sheet.hp.max, ...(m.kind === 'long' ? { temp: 0 } : {}) }
      if (m.kind === 'long' && Array.isArray(data.conditions)) data.conditions = data.conditions.filter((x: string) => x !== 'Unconscious')
      db.prepare('UPDATE tokens SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), now(), m.id)
      postChat(ws, c.user.id, before.name, 'emote', [], [{ t: 'text', text: out.lines.join(', ') }])
      return emitToken(ws, before, tokenRow(m.id, ws)!)
    }
    case 'token.deathsave': {
      const before = tokenRow(m.id, ws)
      if (!before) return nack(c, m, 'no such token')
      if (!canEditStats(c.role, c.user.id, before, settings)) return nack(c, m, 'not allowed')
      const pg = readSheet(ws, before.pageId)
      if (!pg || pg.sheet.kind !== 'character') return nack(c, m, 'Only a token with a character sheet makes death saves.')
      if ((pg.sheet.hp.current ?? pg.sheet.hp.max) > 0) return nack(c, m, 'Death saves are for someone at 0 hit points.')
      const roll = parseRoll('1d20 Death saving throw')!
      const first = roll.terms[0]
      const d20 = first.kind === 'dice' ? first.dice[0].v : roll.total
      const res = deathSave(d20, pg.sheet.deathSaves)
      const sheet: Sheet = { ...pg.sheet, deathSaves: res.saves }
      const data: Record<string, any> = { ...before.data }
      let conditions = (data.conditions as string[] | undefined) ?? []
      if (res.outcome === 'revived') {
        sheet.hp = { ...sheet.hp, current: 1 }
        data.hp = { ...(data.hp ?? {}), value: 1 }
        conditions = conditions.filter((x) => x !== 'Unconscious')
      }
      if (conditions.length || data.conditions) data.conditions = conditions
      writeSheet(ws, before.pageId!, pg.props, sheet)
      db.prepare('UPDATE tokens SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), now(), m.id)
      const said = { revived: 'rolls a natural 20 and is back with 1 hit point', stable: 'is stable', dead: 'has died', success: 'succeeds', failure: 'fails', 'critical failure': 'fails twice' }[res.outcome]
      postChat(ws, c.user.id, before.name, 'roll', [], [{ t: 'roll', roll }])
      postChat(ws, c.user.id, before.name, 'emote', [], [{ t: 'text', text: `${said} (${res.saves.ok} successes, ${res.saves.fail} failures)` }])
      return emitToken(ws, before, tokenRow(m.id, ws)!)
    }
    case 'rolltable.save': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const t = now()
      if (m.id) {
        if (!db.prepare('SELECT 1 FROM roll_tables WHERE id = ? AND workspace_id = ?').get(m.id, ws)) return nack(c, m, 'no such table')
        db.prepare('UPDATE roll_tables SET name = ?, entries = ?, secret = ?, updated_at = ? WHERE id = ?').run(m.name, entriesText(parseEntries(m.entries)), m.secret ? 1 : 0, t, m.id)
      } else {
        if (rollTableRows(ws).length >= 100) return nack(c, m, 'That is as many tables as a world can keep.')
        db.prepare('INSERT INTO roll_tables(id,workspace_id,name,entries,secret,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(uid(), ws, m.name, entriesText(parseEntries(m.entries)), m.secret ? 1 : 0, t, t)
      }
      return sendRollTables(ws)
    }
    case 'rolltable.delete': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      db.prepare('DELETE FROM roll_tables WHERE id = ? AND workspace_id = ?').run(m.id, ws)
      return sendRollTables(ws)
    }
    case 'rolltable.roll': {
      if (c.role === 'spectator') return nack(c, m, 'Spectators can watch but not roll.')
      const t = rollTableRows(ws).find((x) => x.id === m.id)
      if (!t || (t.secret && !gm)) return nack(c, m, 'no such table')
      if (!rollOnTable(ws, c, t)) return nack(c, m, 'That table has no entries.')
      return
    }
    case 'user.kick':
    case 'user.ban':
    case 'user.mute': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (m.user === c.user.id) return nack(c, m, 'You cannot do that to yourself.')
      const target = inWorld(ws).find((x) => x.user.id === m.user)
      if (target?.role === 'gm') return nack(c, m, 'You cannot do that to another GM.')
      if (m.t === 'user.kick') { if (target) target.socket.close(CLOSE_DENIED, 'sent away'); return }
      const key = m.t === 'user.ban' ? 'banned' : 'muted', on = m.t === 'user.ban' ? m.banned : m.muted
      const list = new Set(settings[key])
      if (on) list.add(m.user); else list.delete(m.user)
      await handle(c, { t: 'settings.set', patch: { [key]: [...list] } } as ClientMessage)
      if (m.t === 'user.ban' && m.banned) for (const x of inWorld(ws)) if (x.user.id === m.user) x.socket.close(CLOSE_DENIED, 'banned')
      return
    }
    case 'call.join': {
      if (!calls.has(ws)) calls.set(ws, new Map())
      const room = calls.get(ws)!
      if (!room.has(c.user.id) && room.size >= 8) return nack(c, m, 'The call is full: eight people can be in it at once.')
      room.set(c.user.id, { video: m.video })
      return sendCall(ws)
    }
    case 'call.leave': return leaveCall(ws, c.user.id)
    case 'rtc': {
      const room = calls.get(ws)
      if (!room?.has(c.user.id) || !room.has(m.to) || m.to === c.user.id) return
      for (const x of inWorld(ws)) if (x.user.id === m.to) send(x, { t: 'rtc', from: c.user.id, data: m.data })
      return
    }
    case 'ready.start': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      readyChecks.set(ws, new Map())
      return sendReady(ws)
    }
    case 'ready.answer': {
      if (c.role === 'spectator') return
      const r = readyChecks.get(ws)
      if (!r) return
      r.set(c.user.id, m.yes)
      return sendReady(ws)
    }
    case 'ready.end': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      readyChecks.delete(ws)
      return sendReady(ws)
    }
    case 'jukebox.add': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      // a sound file of this world, or a stream at an address (https only)
      const uploadId = m.url.startsWith('https://') ? m.url : m.url.slice('/api/uploads/'.length)
      if (!m.url.startsWith('https://')) {
        const up = db.prepare('SELECT mime FROM uploads WHERE id = ? AND workspace_id = ?').get(uploadId, ws) as { mime: string } | undefined
        if (!up || !AUDIO[up.mime]) return nack(c, m, 'That is not a sound file of this world.')
      }
      if ((db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE workspace_id = ?').get(ws) as { n: number }).n >= 100) return nack(c, m, 'That is as many tracks as a world can keep.')
      db.prepare('INSERT INTO tracks(id,workspace_id,name,upload_id,loop,created_at) VALUES(?,?,?,?,?,?)').run(uid(), ws, m.name, uploadId, m.loop ? 1 : 0, now())
      return sendJukebox(ws)
    }
    case 'jukebox.scene': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (m.scene && !sceneRow(m.scene, ws)) return nack(c, m, 'no such scene')
      if (!db.prepare('UPDATE tracks SET scene_id = ? WHERE id = ? AND workspace_id = ?').run(m.scene, m.id, ws).changes) return nack(c, m, 'no such track')
      return sendJukebox(ws)
    }
    case 'jukebox.remove': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      db.prepare('DELETE FROM tracks WHERE id = ? AND workspace_id = ?').run(m.id, ws)
      playing.get(ws)?.delete(m.id)
      return sendJukebox(ws)
    }
    case 'jukebox.play': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (!db.prepare('SELECT 1 FROM tracks WHERE id = ? AND workspace_id = ?').get(m.id, ws)) return nack(c, m, 'no such track')
      if (!playing.has(ws)) playing.set(ws, new Set())
      playing.get(ws)!.add(m.id)
      return sendJukebox(ws)
    }
    case 'jukebox.playlist': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const list = playlistOf(ws, m.name)
      if (!list.length) return nack(c, m, 'no such playlist')
      const on = playing.get(ws) ?? new Set<string>()
      for (const t of list) on.delete(t.id)
      on.add(list[0].id)
      playing.set(ws, on)
      return sendJukebox(ws)
    }
    case 'jukebox.next': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const t = db.prepare('SELECT name FROM tracks WHERE id = ? AND workspace_id = ?').get(m.id, ws) as { name: string } | undefined
      if (!t || !t.name.includes('/')) return
      const list = playlistOf(ws, t.name.split('/')[0].trim())
      const at = list.findIndex((x) => x.id === m.id)
      const on = playing.get(ws)
      // the next track of the playlist plays when one ends, and the first comes round again after the last; only while that track was playing
      if (!on?.has(m.id) || list.length < 2) return
      on.delete(m.id)
      on.add(list[(at + 1) % list.length].id)
      return sendJukebox(ws)
    }
    case 'jukebox.stop': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (m.id === 'all') playing.delete(ws); else playing.get(ws)?.delete(m.id)
      return sendJukebox(ws)
    }
    case 'trigger.save': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (m.scene && !sceneRow(m.scene, ws)) return nack(c, m, 'no such scene')
      if (m.action === 'handout' && !db.prepare('SELECT 1 FROM handouts WHERE id = ? AND workspace_id = ?').get(m.arg, ws)) return nack(c, m, 'Choose a handout of this world.')
      if (m.action === 'play' && !db.prepare('SELECT 1 FROM tracks WHERE id = ? AND workspace_id = ?').get(m.arg, ws)) return nack(c, m, 'Choose a track of this world.')
      if (m.action === 'say' && !m.arg.trim()) return nack(c, m, 'Write what is said.')
      if (m.action === 'travel') { const d = travelArg(m.arg); if (!d || !sceneRow(d.scene, ws)) return nack(c, m, 'Choose a scene of this world to go to.') }
      if (m.id) {
        if (!db.prepare('SELECT 1 FROM triggers WHERE id = ? AND workspace_id = ?').get(m.id, ws)) return nack(c, m, 'no such trigger')
        db.prepare('UPDATE triggers SET name = ?, scene_id = ?, event = ?, x = ?, y = ?, radius = ?, action = ?, arg = ?, once = ?, fired = 0 WHERE id = ?').run(m.name, m.scene, m.event, m.x, m.y, m.radius, m.action, m.arg, m.once ? 1 : 0, m.id)
      } else {
        if (triggerRows(ws).length >= 100) return nack(c, m, 'That is as many triggers as a world can keep.')
        db.prepare('INSERT INTO triggers(id,workspace_id,scene_id,name,event,x,y,radius,action,arg,once,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(uid(), ws, m.scene, m.name, m.event, m.x, m.y, m.radius, m.action, m.arg, m.once ? 1 : 0, now())
      }
      return sendTriggers(ws)
    }
    case 'trigger.delete': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      db.prepare('DELETE FROM triggers WHERE id = ? AND workspace_id = ?').run(m.id, ws)
      return sendTriggers(ws)
    }
    case 'trigger.reset': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      db.prepare('UPDATE triggers SET fired = 0 WHERE id = ? AND workspace_id = ?').run(m.id, ws)
      return sendTriggers(ws)
    }
    case 'deck.save': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const cards = cardsText(parseCards(m.cards)), t = now()
      const fresh = JSON.stringify(freshDeck(parseCards(cards).length, cryptoRng))
      if (m.id) {
        const old = db.prepare('SELECT cards FROM decks WHERE id = ? AND workspace_id = ?').get(m.id, ws) as { cards: string } | undefined
        if (!old) return nack(c, m, 'no such deck')
        // changing the cards deals them out again; changing only the name keeps the game as it is
        if (old.cards !== cards) db.prepare('UPDATE decks SET name = ?, cards = ?, state = ?, updated_at = ? WHERE id = ?').run(m.name, cards, fresh, t, m.id)
        else db.prepare('UPDATE decks SET name = ?, updated_at = ? WHERE id = ?').run(m.name, t, m.id)
      } else {
        if (deckRows(ws).length >= 50) return nack(c, m, 'That is as many decks as a world can keep.')
        db.prepare('INSERT INTO decks(id,workspace_id,name,cards,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(uid(), ws, m.name, cards, fresh, t, t)
      }
      return sendDecks(ws)
    }
    case 'deck.delete': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      db.prepare('DELETE FROM decks WHERE id = ? AND workspace_id = ?').run(m.id, ws)
      return sendDecks(ws)
    }
    case 'deck.shuffle': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const d = deckRows(ws).find((x) => x.id === m.id)
      if (!d) return nack(c, m, 'no such deck')
      saveDeck(d.id, freshDeck(parseCards(d.cards).length, cryptoRng))
      postChat(ws, c.user.id, c.user.username, 'emote', [], [{ t: 'text', text: `shuffles the ${d.name} deck` }])
      return sendDecks(ws)
    }
    case 'deck.draw': {
      if (c.role === 'spectator') return nack(c, m, 'Spectators can watch but not draw.')
      const d = deckRows(ws).find((x) => x.id === m.id)
      if (!d) return nack(c, m, 'no such deck')
      const cards = parseCards(d.cards)
      const out = drawCards(deckState(d), m.count, cryptoRng)
      if (!out.drawn.length) return nack(c, m, `The ${d.name} deck is empty. The GM can shuffle it.`)
      const st = m.to === 'hand' ? toHand(out.state, c.user.id, out.drawn) : toDiscard(out.state, out.drawn)
      saveDeck(d.id, st)
      const named = out.drawn.map((i) => `${cards[i]?.name ?? '?'}${cards[i]?.text ? ` (${cards[i].text})` : ''}`).join(', ')
      postChat(ws, c.user.id, c.user.username, 'emote', [], [{ t: 'text', text: m.to === 'hand' ? `draws ${out.drawn.length} ${out.drawn.length === 1 ? 'card' : 'cards'} from the ${d.name} deck` : `draws ${named} from the ${d.name} deck` }])
      return sendDecks(ws)
    }
    case 'deck.play': {
      if (c.role === 'spectator') return nack(c, m, 'Spectators can watch but not play cards.')
      const d = deckRows(ws).find((x) => x.id === m.id)
      if (!d) return nack(c, m, 'no such deck')
      const st = discardFromHand(deckState(d), c.user.id, m.card)
      if (!st) return nack(c, m, 'That card is not in your hand.')
      const card = parseCards(d.cards)[m.card]
      saveDeck(d.id, st)
      postChat(ws, c.user.id, c.user.username, 'emote', [], [{ t: 'text', text: `plays ${card?.name ?? 'a card'}${card?.text ? ` (${card.text})` : ''} from the ${d.name} deck` }])
      return sendDecks(ws)
    }
    case 'chat': {
      const cmd = /^\/(?:table|tbl)\s+(.+)$/i.exec(m.text.trim())
      if (cmd) {
        if (c.role === 'spectator') return nack(c, m, 'Spectators can talk but not roll.')
        const want = cmd[1].trim().toLowerCase()
        const rows = rollTableRows(ws).filter((t) => gm || !t.secret)
        const t = rows.find((x) => x.name.toLowerCase() === want) ?? rows.find((x) => x.name.toLowerCase().startsWith(want))
        if (!t) return nack(c, m, `There is no table called “${cmd[1].trim()}”. The tables are in the Tables tab.`)
        if (!rollOnTable(ws, c, t)) return nack(c, m, 'That table has no entries.')
        return
      }
      const parsed = parseChat(m.text, undefined, worldSystem(ws))
      if ('error' in parsed) return nack(c, m, parsed.error)
      if (c.role === 'spectator' && parsed.kind !== 'say' && parsed.kind !== 'ooc') return nack(c, m, 'Spectators can talk but not roll or whisper.')
      if (!gm && settings.muted.includes(c.user.id)) return nack(c, m, 'The GM has muted you at this table.')
      let to: string[] = []
      if (parsed.kind === 'whisper') {
        const target = membersOf(ws).find((u) => u.username.toLowerCase() === parsed.to!.toLowerCase())
        if (!target) return nack(c, m, `Nobody called “${parsed.to}” can be reached at this table.`)
        to = [target.id]
      }
      if (parsed.as && !gm) return nack(c, m, 'Only the GM can speak as someone else.')
      const name = parsed.as ?? (gm && m.as ? m.as.trim() || c.user.username : c.user.username)
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
      if (!gm && db.prepare('SELECT locked FROM scene_walls WHERE id = ?').get(m.id) && (db.prepare('SELECT locked FROM scene_walls WHERE id = ?').get(m.id) as { locked: number }).locked) return nack(c, m, 'The door is locked.')
      db.prepare('UPDATE scene_walls SET open = ? WHERE id = ?').run(w.open ? 0 : 1, m.id)
      return sendWalls(ws, w.s)
    }
    case 'door.lock': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const w = db.prepare('SELECT scene_id AS s, kind FROM scene_walls WHERE id = ? AND workspace_id = ?').get(m.id, ws) as { s: string; kind: string } | undefined
      if (!w || (w.kind !== 'door' && w.kind !== 'secret')) return nack(c, m, 'that is not a door')
      db.prepare('UPDATE scene_walls SET locked = ?' + (m.locked ? ', open = 0' : '') + ' WHERE id = ?').run(m.locked ? 1 : 0, m.id)
      return sendWalls(ws, w.s)
    }
    case 'fog.reveal': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (!sceneRow(m.sceneId, ws)) return nack(c, m, 'no such scene')
      if (revealsOf(ws, m.sceneId).length >= 200) return nack(c, m, 'That is as many shown areas as a scene can keep.')
      db.prepare('INSERT INTO scene_reveals(id,scene_id,workspace_id,x,y,w,h) VALUES(?,?,?,?,?,?,?)').run(uid(), m.sceneId, ws, m.x, m.y, m.w, m.h)
      return sendReveals(ws, m.sceneId)
    }
    case 'fog.unreveal': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const r = db.prepare('SELECT scene_id AS s FROM scene_reveals WHERE id = ? AND workspace_id = ?').get(m.id, ws) as { s: string } | undefined
      if (!r) return nack(c, m, 'no such area')
      db.prepare('DELETE FROM scene_reveals WHERE id = ?').run(m.id)
      return sendReveals(ws, r.s)
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
        const props = parse<{ sheet?: { size?: string; hp?: { max?: number }; ac?: { value?: number }; speed?: { walk?: number } }; portrait?: string }>(page.props, {})
        const sheet = props.sheet
        const size = SIZE[String(sheet?.size ?? '').toLowerCase()] ?? 1
        const image = typeof props.portrait === 'string' && /^\/api\/uploads\/[A-Za-z0-9-]+$/.test(props.portrait) ? props.portrait : ''
        const data: Record<string, unknown> = { hpPrivate: true, group: page.title }
        if (sheet?.hp?.max) data.hp = { value: sheet.hp.max, max: sheet.hp.max }
        if (sheet?.ac?.value != null) data.ac = sheet.ac.value
        if (sheet?.speed?.walk) data.speed = sheet.speed.walk
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
      // a temporary drawing goes by itself
      if (m.temp) setTimeout(() => {
        if (!db.prepare('DELETE FROM drawings WHERE id = ?').run(id).changes) return
        for (const x of inWorld(ws)) if (x.scene === m.sceneId) send(x, { t: 'draw.remove', ids: [id] })
      }, 9000)
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
    case 'draw.move': {
      const d = drawingRow(m.id)
      if (!d || !sceneRow(d.sceneId, ws)) return nack(c, m, 'no such drawing')
      if (!gm && d.userId !== c.user.id) return nack(c, m, 'not allowed')
      const points = d.points.map((p: { x: number; y: number }) => ({ x: p.x + m.dx, y: p.y + m.dy }))
      db.prepare('UPDATE drawings SET points = ? WHERE id = ?').run(JSON.stringify(points), m.id)
      const moved = drawingRow(m.id)!
      for (const x of inWorld(ws)) if (x.scene === d.sceneId && (x.role === 'gm' || !moved.gmOnly)) send(x, { t: 'draw', drawing: moved })
      return
    }
    case 'pin.add': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (!sceneRow(m.sceneId, ws)) return nack(c, m, 'no such scene')
      if (m.pageId && !db.prepare('SELECT 1 FROM pages WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(m.pageId, ws)) return nack(c, m, 'no such page')
      if ((db.prepare('SELECT COUNT(*) AS n FROM scene_pins WHERE scene_id = ?').get(m.sceneId) as { n: number }).n >= 300) return nack(c, m, 'That is as many pins as a scene can keep.')
      db.prepare('INSERT INTO scene_pins(id,scene_id,workspace_id,x,y,label,page_id,gm_only) VALUES(?,?,?,?,?,?,?,?)').run(uid(), m.sceneId, ws, m.x, m.y, m.label, m.pageId, m.gmOnly ? 1 : 0)
      return sendPins(ws, m.sceneId)
    }
    case 'pin.delete': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const p = db.prepare('SELECT scene_id AS s FROM scene_pins WHERE id = ? AND workspace_id = ?').get(m.id, ws) as { s: string } | undefined
      if (!p) return nack(c, m, 'no such pin')
      db.prepare('DELETE FROM scene_pins WHERE id = ?').run(m.id)
      return sendPins(ws, p.s)
    }
    case 'draw.clear': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      if (!sceneRow(m.sceneId, ws)) return nack(c, m, 'no such scene')
      db.prepare('DELETE FROM drawings WHERE scene_id = ? AND workspace_id = ?').run(m.sceneId, ws)
      for (const x of inWorld(ws)) if (x.scene === m.sceneId) send(x, { t: 'draw.cleared', sceneId: m.sceneId })
      return
    }
    case 'tile.add': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const scene = sceneRow(m.sceneId, ws)
      if (!scene) return nack(c, m, 'no such scene')
      const dims = await sizeOfUpload(m.image, ws)
      if (!dims) return nack(c, m, 'that image is not in this world')
      // a new prop is about three cells across unless the GM gave a size
      const k = Math.min(1, (scene.grid_size * 3) / Math.max(dims.width, dims.height))
      const w = m.w ?? Math.max(8, Math.round(dims.width * k)), h = m.h ?? Math.max(8, Math.round(dims.height * k))
      const z = ((db.prepare('SELECT MAX(z) AS z FROM scene_tiles WHERE scene_id = ?').get(m.sceneId) as { z: number | null }).z ?? 0) + 1
      db.prepare('INSERT INTO scene_tiles(id,scene_id,workspace_id,image,x,y,w,h,rotation,layer,locked,hidden,z,layer_id) VALUES(?,?,?,?,?,?,?,?,0,?,0,0,?,?)').run(uid(), m.sceneId, ws, m.image, m.x, m.y, w, h, m.layer ?? 'bg', z, m.layerId ?? null)
      return sendTiles(ws, m.sceneId)
    }
    case 'tile.update': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const t = db.prepare('SELECT scene_id AS s FROM scene_tiles WHERE id = ? AND workspace_id = ?').get(m.id, ws) as { s: string } | undefined
      if (!t) return nack(c, m, 'no such tile')
      const cols = Object.keys(m.patch)
      if (!cols.length) return
      db.prepare(`UPDATE scene_tiles SET ${cols.map((k) => `${k === 'layerId' ? 'layer_id' : k} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((k) => { const v = (m.patch as Record<string, unknown>)[k]; return typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number) }), m.id)
      return sendTiles(ws, t.s)
    }
    case 'tile.delete': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const scenes = new Set<string>()
      for (const id of m.ids) {
        const t = db.prepare('SELECT scene_id AS s FROM scene_tiles WHERE id = ? AND workspace_id = ?').get(id, ws) as { s: string } | undefined
        if (!t) continue
        scenes.add(t.s)
        db.prepare('DELETE FROM scene_tiles WHERE id = ?').run(id)
      }
      for (const s of scenes) sendTiles(ws, s)
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
        const die = activePack(ws)?.initiative?.replace(/^d/i, '1d') ?? '1d20'
        const roll = parseRoll(`${die}${b >= 0 ? '+' : '-'}${Math.abs(b)} Initiative: ${x.name}`)
        if (!roll) continue
        rolled.set(x.id, roll.total)
        // a hidden combatant rolls where only the GM sees it
        postChat(ws, c.user.id, c.user.username, x.hidden ? 'gmroll' : 'roll', [], [{ t: 'roll', roll }])
      }
      return saveCombat(ws, withList(combat, combat.list.map((x) => (rolled.has(x.id) ? { ...x, init: rolled.get(x.id)! } : x))))
    }
    case 'handout.save': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const t = now()
      if (m.id) {
        if (!db.prepare('SELECT 1 FROM handouts WHERE id = ? AND workspace_id = ?').get(m.id, ws)) return nack(c, m, 'no such handout')
        db.prepare('UPDATE handouts SET title = ?, text = ?, image = ?, updated_at = ? WHERE id = ?').run(m.title, m.text, m.image, t, m.id)
      } else {
        if ((db.prepare('SELECT COUNT(*) AS n FROM handouts WHERE workspace_id = ?').get(ws) as { n: number }).n >= 200) return nack(c, m, 'That is as many handouts as a world can keep.')
        db.prepare('INSERT INTO handouts(id,workspace_id,title,text,image,revealed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(uid(), ws, m.title, m.text, m.image, '[]', t, t)
      }
      return sendHandouts(ws)
    }
    case 'handout.delete': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      db.prepare('DELETE FROM handouts WHERE id = ? AND workspace_id = ?').run(m.id, ws)
      return sendHandouts(ws)
    }
    case 'handout.reveal': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const before = db.prepare('SELECT id, title, text, image, revealed, updated_at FROM handouts WHERE id = ? AND workspace_id = ?').get(m.id, ws) as HandoutDb | undefined
      if (!before) return nack(c, m, 'no such handout')
      const members = new Set(membersOf(ws).map((u) => u.id))
      const to = m.to === 'all' ? 'all' : m.to === 'none' ? [] : [...new Set(m.to)].filter((u) => members.has(u))
      db.prepare('UPDATE handouts SET revealed = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(to), now(), m.id)
      const after = { ...before, revealed: JSON.stringify(to) }
      sendHandouts(ws)
      // whoever could not read it before is shown it now
      return showHandout(ws, after, (x) => !mayRead(before, x.user.id))
    }
    case 'handout.show': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const h = db.prepare('SELECT id, title, text, image, revealed, updated_at FROM handouts WHERE id = ? AND workspace_id = ?').get(m.id, ws) as HandoutDb | undefined
      if (!h) return nack(c, m, 'no such handout')
      return showHandout(ws, h)
    }
    case 'reaction.attack': {
      if (!settings.automation.attacks) return nack(c, m, 'Attacks are not automated at this table. The GM can switch that on.')
      const foe = tokenRow(m.from, ws), target = tokenRow(m.target, ws)
      if (!foe || !target) return nack(c, m, 'no such token')
      if (!canEditStats(c.role, c.user.id, foe, settings)) return nack(c, m, 'not allowed')
      const combat = combatOf(ws)
      const entry = combat.list.find((x) => x.tokenId === foe.id)
      if (!combat.active || !entry || entry.reaction) return nack(c, m, 'Their reaction is not ready.')
      const sheet = readSheet(ws, foe.pageId)?.sheet
      const atk = sheet ? firstAttack(sheet) : null
      if (!atk) return nack(c, m, 'That creature has no attack written on its sheet to make.')
      saveCombat(ws, withList(combat, combat.list.map((x) => (x.id === entry.id ? { ...x, reaction: true } : x))))
      return handle(c, { t: 'attack', from: foe.id, targets: [target.id], label: `${atk.label} (opportunity attack)`, attack: { bonus: atk.bonus }, damage: atk.damage } as ClientMessage)
    }
    case 'combat.delay': {
      const combat = combatOf(ws)
      const who = combat.list.find((x) => x.id === m.id)
      if (!who) return nack(c, m, 'no such combatant')
      const tok = who.tokenId ? tokenRow(who.tokenId, ws) : undefined
      if (!gm && !(c.role === 'player' && !!tok && tok.owners.includes(c.user.id))) return nack(c, m, 'not allowed')
      const next = delayTurn(combat, m.id)
      if (!next) return nack(c, m, 'Only the one whose turn it is can wait, and not the last in the order.')
      postChat(ws, c.user.id, who.name, who.hidden ? 'gmroll' : 'emote', [], [{ t: 'text', text: 'waits and acts later in the round' }])
      saveCombat(ws, next)
      announceTurn(ws, c.user.id, next)
      return
    }
    case 'combat.marker': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      return saveCombat(ws, lairMarker(combatOf(ws), uid(), m.name, m.init))
    }
    case 'combat.legendary': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const combat = combatOf(ws)
      if (!combat.list.some((x) => x.id === m.id)) return nack(c, m, 'no such combatant')
      return saveCombat(ws, withList(combat, combat.list.map((x) => { if (x.id !== m.id) return x; const { legendary: _l, ...rest } = x; return m.used === null ? rest : { ...rest, legendary: m.used } })))
    }
    case 'combat.reminder': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      const combat = combatOf(ws)
      if (!combat.list.some((x) => x.id === m.id)) return nack(c, m, 'no such combatant')
      return saveCombat(ws, withList(combat, combat.list.map((x) => { if (x.id !== m.id) return x; const { note: _n, ...rest } = x; return m.text.trim() ? { ...rest, note: m.text.trim() } : rest })))
    }
    case 'combat.actions': {
      const combat = combatOf(ws)
      const who = combat.list.find((x) => x.id === m.id)
      if (!who) return nack(c, m, 'no such combatant')
      const tok = who.tokenId ? tokenRow(who.tokenId, ws) : undefined
      if (!gm && !(c.role === 'player' && !!tok && tok.owners.includes(c.user.id))) return nack(c, m, 'not allowed')
      return saveCombat(ws, withList(combat, combat.list.map((x) => (x.id === m.id ? { ...x, actions: m.left } : x))))
    }
    case 'combat.reaction': {
      const combat = combatOf(ws)
      const who = combat.list.find((x) => x.id === m.id)
      if (!who) return nack(c, m, 'no such combatant')
      const tok = who.tokenId ? tokenRow(who.tokenId, ws) : undefined
      if (!gm && !(c.role === 'player' && !!tok && tok.owners.includes(c.user.id))) return nack(c, m, 'not allowed')
      return saveCombat(ws, withList(combat, combat.list.map((x) => (x.id === m.id ? { ...x, reaction: m.used } : x))))
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
      if (m.action === 'start') { const started = startCombat(combat); saveCombat(ws, started); announceTurn(ws, c.user.id, started); return }
      if (m.action === 'next') {
        endTurnEffects(ws, c.user.id, combat)
        const next = advance(combat, 1)
        saveCombat(ws, next)
        if (combat.active && next.round > combat.round) { tickEffects(ws, c.user.id); fireEvent(ws, c.user.id, 'round') }
        announceTurn(ws, c.user.id, next)
        return
      }
      if (m.action === 'prev') return saveCombat(ws, advance(combat, -1))
      if (m.action === 'end') { combatSummary(ws, c.user.id, combat); return saveCombat(ws, endCombat(combat)) }
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
      if (m.patch.hour !== undefined || m.patch.daylight !== undefined) applyDaylight(ws, next)
      for (const x of inWorld(ws)) {
        const was = x.role
        x.role = roleAt(x.user, x.wr, next)
        send(x, { t: 'settings', settings: next, you: { id: x.user.id, username: x.user.username, role: x.role } })
        // someone who stopped running the table goes back to the table's scene
        if (x.role !== 'gm' && x.scene !== stateOf(ws).active) { viewFor(x, null); sendView(x) }
        // what people see may have changed with shared vision
        if (x.role === 'player' && x.scene) scheduleSight(ws, x.scene)
        // a person who became a player (or stopped being one) is told again what they may see
        else if (x.role !== was) sendView(x)
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
    case 'camera.pull': {
      if (!gm) return nack(c, m, 'only the GM can do that')
      return sameScene(c, (x) => x !== c, { t: 'camera', x: m.x, y: m.y, w: m.w, h: m.h })
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
  // a looping video is a background too; its size is given by the browser that chose it
  const isVideo = typeof p.bg === 'string' && /^\/api\/uploads\/[A-Za-z0-9-]+$/.test(p.bg) && ((db.prepare('SELECT mime FROM uploads WHERE id = ? AND workspace_id = ?').get(p.bg.slice('/api/uploads/'.length), c.ws) as { mime: string } | undefined)?.mime ?? '') in VIDEO
  if (typeof p.bg === 'string' && p.bg && !isVideo) {
    const dims = await sizeOfUpload(p.bg, c.ws)
    if (!dims) { nack(c, m, 'that image is not in this world'); return false }
    // a new background sets the scene to its size unless the GM gave one
    p.width ??= Math.max(100, dims.width)
    p.height ??= Math.max(100, dims.height)
  }
  const cols = Object.keys(p).filter((k) => k in SCENE_COLUMNS)
  if (!cols.length) return true
  db.prepare(`UPDATE scenes SET ${cols.map((k) => `${SCENE_COLUMNS[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...cols.map((k) => (typeof p[k] === 'boolean' ? (p[k] ? 1 : 0) : Array.isArray(p[k]) ? JSON.stringify(p[k]) : (p[k] as string | number))), now(), id)
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
    // someone the GM banned cannot sit at the table (the GMs themselves cannot be banned)
    if (stateOf(m[1]).settings.banned.includes(user.id) && roleAt(user, role, stateOf(m[1]).settings) !== 'gm') return refuse(socket, '403 Forbidden')
    wss.handleUpgrade(req, socket, head, (socket) => {
      const c: Conn = {
        socket, user, ws: m[1], wr: role, role: roleAt(user, role, stateOf(m[1]).settings), scene: null, alive: true,
        limit: makeLimiter(90, 180), queue: Promise.resolve(), sight: null, shown: new Set(),
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
        c.queue = c.queue.then(() => handle(c, r.data)).catch((e) => { console.error('table message failed:', r.data.t, e); nack(c, r.data, 'The table could not do that. Reload the page and try again.') })
      })
      socket.on('pong', () => { c.alive = true })
      socket.on('close', () => { conns.delete(c); if (!inWorld(c.ws).some((x) => x.user.id === c.user.id)) leaveCall(c.ws, c.user.id); presenceChanged(); announce(c.ws); sameScene(c, () => true, { t: 'cursor.gone', user: c.user.id }) })
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
    const before = `${c.wr}:${c.role}`
    c.user = user
    c.wr = role
    c.role = roleAt(user, role, stateOf(c.ws).settings)
    // an admin changing someone else's access must not reset everyone's screen: only a table whose own role changed starts over
    if (`${c.wr}:${c.role}` === before) continue
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
