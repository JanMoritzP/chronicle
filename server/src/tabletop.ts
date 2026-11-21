import { z } from 'zod'
import { effectSchema } from './effects.js'

// Rules of the tabletop that need no database: who is what at the table, who may do what to a token, and the shape of every message.
// The table channel (table.ts) calls these for every message, so the rules live in one place and are tested without a server.

export type TableRole = 'gm' | 'player' | 'spectator'

export const settingsSchema = z.object({
  /** Accounts that may run the table besides the owner. */
  gms: z.array(z.string().max(64)).max(20).default([]),
  /** What players may do. Spectators can do none of it. */
  playersMoveOwn: z.boolean().default(true),
  playersCreateTokens: z.boolean().default(false),
  playersEditOwnStats: z.boolean().default(true),
  playersOpenDoors: z.boolean().default(false),
  playersDraw: z.boolean().default(true),
  playersPing: z.boolean().default(true),
  playersRuler: z.boolean().default(true),
  /** Players see each other's cursors. */
  showCursors: z.boolean().default(true),
  /** Players see through each other's tokens (a party that looks out for each other). */
  sharedVision: z.boolean().default(false),
  /** Accounts that may not sit at this table, and accounts that may not talk. */
  banned: z.array(z.string().max(64)).max(50).default([]),
  muted: z.array(z.string().max(64)).max(50).default([]),
  /** Rules the table applies for the GM. All off until switched on, so a table plays fully by hand out of the box. */
  automation: z.object({ damage: z.boolean().default(false), concentration: z.boolean().default(false), deathSaves: z.boolean().default(false), attacks: z.boolean().default(false) }).default({ damage: false, concentration: false, deathSaves: false, attacks: false }),
})
/** A change to the settings: only the keys that are present (a partial of the schema above would fill the defaults back in). */
export const settingsPatch = z.object({
  gms: z.array(z.string().max(64)).max(20),
  playersMoveOwn: z.boolean(), playersCreateTokens: z.boolean(), playersEditOwnStats: z.boolean(), playersOpenDoors: z.boolean(), playersDraw: z.boolean(), playersPing: z.boolean(), playersRuler: z.boolean(), showCursors: z.boolean(), sharedVision: z.boolean(), banned: z.array(z.string().max(64)).max(50), muted: z.array(z.string().max(64)).max(50),
  automation: z.object({ damage: z.boolean(), concentration: z.boolean(), deathSaves: z.boolean(), attacks: z.boolean() }),
}).partial().strict()
export type TableSettings = z.infer<typeof settingsSchema>
export const DEFAULT_SETTINGS: TableSettings = settingsSchema.parse({})

export function parseSettings(raw: string | null | undefined): TableSettings {
  try { return settingsSchema.parse(JSON.parse(raw ?? '{}')) } catch { return DEFAULT_SETTINGS }
}

/** The owner account and anyone named in the settings run the table; viewers of the world only watch. */
export function roleAt(user: { id: string; role: string }, worldRole: 'editor' | 'viewer', settings: TableSettings): TableRole {
  if (user.role === 'owner' || settings.gms.includes(user.id)) return 'gm'
  return worldRole === 'viewer' ? 'spectator' : 'player'
}

export interface TokenRow {
  id: string; sceneId: string; name: string; x: number; y: number; size: number; rotation: number
  image: string; color: string; pageId: string | null; hidden: boolean; locked: boolean
  owners: string[]; z: number; data: Record<string, unknown>
}

export const ownsToken = (userId: string, t: Pick<TokenRow, 'owners'>) => t.owners.includes(userId)

/** Hidden tokens exist only for the table's runners and the people who own them. */
export const canSeeToken = (role: TableRole, userId: string, t: Pick<TokenRow, 'hidden' | 'owners'>) =>
  role === 'gm' || !t.hidden || ownsToken(userId, t)

export function canMoveToken(role: TableRole, userId: string, t: Pick<TokenRow, 'owners' | 'locked'>, s: TableSettings) {
  if (role === 'gm') return true
  return role === 'player' && s.playersMoveOwn && ownsToken(userId, t) && !t.locked
}

export const canEditStats = (role: TableRole, userId: string, t: Pick<TokenRow, 'owners'>, s: TableSettings) =>
  role === 'gm' || (role === 'player' && s.playersEditOwnStats && ownsToken(userId, t))

/** What a person is allowed to read of a token: hit points and armor class can be kept to the GM and the owners. */
export function redact(role: TableRole, userId: string, t: TokenRow): TokenRow {
  if (role === 'gm' || !t.data.hpPrivate || ownsToken(userId, t)) return t
  const { hp: _hp, ac: _ac, ...data } = t.data
  // an effect that moves armor class would give the number away
  if (Array.isArray(data.effects)) data.effects = data.effects.map((e: Record<string, unknown>) => { const { ac: _a, ...rest } = e; return rest })
  return { ...t, data }
}

export const canCreateToken = (role: TableRole, s: TableSettings) => role === 'gm' || (role === 'player' && s.playersCreateTokens)
export const canPing = (role: TableRole, s: TableSettings) => role === 'gm' || (role === 'player' && s.playersPing)
export const canRuler = (role: TableRole, s: TableSettings) => role === 'gm' || (role === 'player' && s.playersRuler)

// ---------- messages from a client ----------

const id = z.string().min(1).max(64)
const coord = z.number().finite().min(-100000).max(100000)
const color = z.string().max(20).regex(/^(#[0-9a-fA-F]{3,8}|)$/)
const imageUrl = z.string().max(300).regex(/^(\/api\/uploads\/[A-Za-z0-9-]+|)$/)

const num = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max
/** Light a token gives off and how far it sees, in game units. */
function validLightVision(d: Record<string, unknown>) {
  const l = d.light as Record<string, unknown> | undefined
  const v = d.vision as Record<string, unknown> | undefined
  if (l !== undefined && !(l && typeof l === 'object' && num(l.bright ?? 0, 2000) && num(l.dim ?? 0, 2000) && (l.color === undefined || (typeof l.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(l.color))))) return false
  if (v !== undefined && !(v && typeof v === 'object' && (v.sight === null || v.sight === undefined || num(v.sight, 20000)) && num(v.dark ?? 0, 2000))) return false
  return true
}

const hex6 = (v: unknown) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
/** How a token looks (shape, border, tint, flip, aura, elevation), its extra bars and its action buttons. */
function validTokenLook(d: Record<string, unknown>) {
  if (d.shape !== undefined && !['round', 'square', 'hex'].includes(d.shape as string)) return false
  if (d.border !== undefined && !hex6(d.border)) return false
  if (d.tint !== undefined && !hex6(d.tint)) return false
  if (d.flip !== undefined && typeof d.flip !== 'boolean') return false
  if (d.nameplate !== undefined && typeof d.nameplate !== 'boolean') return false
  if (d.elevation !== undefined && !(typeof d.elevation === 'number' && Number.isFinite(d.elevation) && Math.abs(d.elevation) <= 99999)) return false
  const a = d.aura as Record<string, unknown> | undefined
  if (a !== undefined && !(a && typeof a === 'object' && num(a.radius, 2000) && hex6(a.color))) return false
  const bars = d.bars
  if (bars !== undefined && !(Array.isArray(bars) && bars.length <= 3 && bars.every((b) => b && typeof b.name === 'string' && b.name.length <= 20 && Number.isInteger(b.value) && Number.isInteger(b.max) && b.max >= 0 && b.max <= 99999 && Math.abs(b.value) <= 99999 && hex6(b.color)))) return false
  const vars = d.variants
  if (vars !== undefined && !(Array.isArray(vars) && vars.length <= 8 && vars.every((v) => typeof v === 'string' && /^\/api\/uploads\/[A-Za-z0-9-]+$/.test(v)))) return false
  const acts = d.actions
  if (acts !== undefined && !(Array.isArray(acts) && acts.length <= 8 && acts.every((x) => x && typeof x.name === 'string' && x.name.length >= 1 && x.name.length <= 30 && typeof x.text === 'string' && x.text.length >= 1 && x.text.length <= 600))) return false
  return true
}

export const tokenPatch = z.object({
  name: z.string().max(100),
  x: coord, y: coord,
  size: z.number().min(0.25).max(20),
  rotation: z.number().finite().min(-3600).max(3600),
  image: imageUrl,
  color,
  pageId: id.nullable(),
  hidden: z.boolean(),
  locked: z.boolean(),
  owners: z.array(id).max(50),
  z: z.number().int().min(-1000).max(1000),
  data: z.record(z.string().max(40), z.unknown()).refine((d) => JSON.stringify(d).length <= 8000, 'data too large').refine(validLightVision, 'bad light or vision').refine(validTokenLook, 'bad token look'),
}).partial().strict()

export const scenePatch = z.object({
  name: z.string().min(1).max(120),
  bg: imageUrl,
  width: z.number().int().min(100).max(40000),
  height: z.number().int().min(100).max(40000),
  grid: z.enum(['square', 'hex-row', 'hex-col', 'none']),
  gridSize: z.number().min(10).max(1000),
  unit: z.string().min(1).max(8),
  dist: z.number().min(0.1).max(1000),
  diagonal: z.enum(['5-5-5', '5-10-5', 'euclid', 'manhattan']),
  /** Players see only what their tokens see, and remember what they saw. */
  fog: z.boolean(),
  /** 0 is daylight, 1 is pitch dark; light sources push it back. */
  darkness: z.number().min(0).max(1),
  /** Where the scene sits in the GM's list of scenes, and what the GM noted about it. */
  folder: z.string().max(60),
  notes: z.string().max(5000),
  gridColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  gridOpacity: z.number().min(0).max(1),
  /** A colour laid over the whole scene (candle light, dusk), or none. */
  ambient: z.string().regex(/^(#[0-9a-fA-F]{6})?$/),
  /** Rain or snow falling over the scene, for everyone. */
  weather: z.enum(['none', 'rain', 'snow']),
}).partial().strict()

const point = z.object({ x: coord, y: coord })
const wall = z.object({ x1: coord, y1: coord, x2: coord, y2: coord, kind: z.enum(['wall', 'door', 'secret', 'window', 'oneway']).default('wall') })
const tileImage = imageUrl.refine((v) => v.length > 0, 'a tile needs an image')
export const tilePatch = z.object({
  x: coord, y: coord, w: z.number().min(8).max(20000), h: z.number().min(8).max(20000), rotation: z.number().finite().min(-3600).max(3600),
  layer: z.enum(['bg', 'overhead', 'gm']), locked: z.boolean(), hidden: z.boolean(), flip: z.boolean(), z: z.number().int().min(-1000).max(1000),
}).partial().strict()
export const wallPatch = z.object({ x1: coord, y1: coord, x2: coord, y2: coord, kind: z.enum(['wall', 'door', 'secret', 'window', 'oneway']), open: z.boolean() }).partial().strict()
const hpValue = z.number().int().min(-9999).max(99999)
export const statPatch = z.object({
  hp: z.object({ value: hpValue, max: z.number().int().min(0).max(99999), temp: z.number().int().min(0).max(99999) }).partial().strict(),
  ac: z.number().int().min(0).max(99).nullable(),
  conditions: z.array(z.string().min(1).max(30)).max(30),
  hpPrivate: z.boolean(),
}).partial().strict()

export const clientMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('view'), sceneId: id }),
  z.object({ t: z.literal('scene.create'), name: z.string().min(1).max(120).optional(), patch: scenePatch.optional() }),
  z.object({ t: z.literal('scene.update'), id, patch: scenePatch }),
  z.object({ t: z.literal('scene.delete'), id }),
  z.object({ t: z.literal('scene.duplicate'), id }),
  /** some players look at this scene while the rest stay at the table's */
  z.object({ t: z.literal('scene.send'), id, to: z.array(id).max(50) }),
  z.object({ t: z.literal('scene.activate'), id }),
  z.object({ t: z.literal('token.add'), sceneId: id, token: tokenPatch }),
  z.object({ t: z.literal('token.update'), id, patch: tokenPatch }),
  z.object({ t: z.literal('token.move'), moves: z.array(z.object({ id, x: coord, y: coord, rotation: z.number().finite().min(-3600).max(3600).optional() })).min(1).max(100) }),
  z.object({ t: z.literal('token.stat'), id, stat: statPatch.optional(), /** positive hurts, negative heals */ damage: z.number().int().min(-99999).max(99999).optional(), /** acid, fire, ... : lets resistances apply when automation is on */ type: z.string().max(30).optional() }),
  /** the GM rolls the hit points of tokens from the dice on their sheets (a mob of goblins that are not all the same) */
  z.object({ t: z.literal('token.rollhp'), ids: z.array(id).min(1).max(100) }),
  z.object({ t: z.literal('token.rest'), id, kind: z.enum(['short', 'long']), /** hit dice to spend on a short rest */ dice: z.number().int().min(0).max(40).optional() }),
  z.object({ t: z.literal('token.deathsave'), id }),
  z.object({ t: z.literal('effect.add'), id, effect: effectSchema }),
  z.object({ t: z.literal('effect.remove'), id, effectId: id }),
  z.object({
    t: z.literal('attack'), from: id, targets: z.array(id).min(1).max(20), label: z.string().max(80),
    attack: z.object({ bonus: z.number().int().min(-30).max(60), mode: z.enum(['adv', 'dis']).optional() }).optional(),
    damage: z.array(z.object({ expr: z.string().min(1).max(40), type: z.string().max(30).optional() })).max(4).optional(),
    save: z.object({ ability: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']), dc: z.number().int().min(1).max(40), half: z.boolean() }).optional(),
  }),
  z.object({ t: z.literal('token.delete'), ids: z.array(id).min(1).max(100) }),
  z.object({ t: z.literal('settings.set'), patch: settingsPatch }),
  z.object({ t: z.literal('chat'), text: z.string().min(1).max(600), as: z.string().max(60).optional() }),
  z.object({ t: z.literal('wall.add'), sceneId: id, walls: z.array(wall).min(1).max(200) }),
  z.object({ t: z.literal('wall.update'), id, patch: wallPatch }),
  z.object({ t: z.literal('wall.delete'), ids: z.array(id).min(1).max(200) }),
  z.object({ t: z.literal('door.toggle'), id }),
  /** a locked door stays shut for the players until the GM unlocks it */
  z.object({ t: z.literal('door.lock'), id, locked: z.boolean() }),
  /** the GM shows the players an area, as if their tokens had seen it */
  z.object({ t: z.literal('fog.reveal'), sceneId: id, x: coord, y: coord, w: z.number().min(5).max(40000), h: z.number().min(5).max(40000) }),
  z.object({ t: z.literal('fog.unreveal'), id }),
  z.object({ t: z.literal('fog.save'), sceneId: id, mask: z.string().max(400_000) }),
  z.object({ t: z.literal('fog.reset'), sceneId: id }),
  z.object({ t: z.literal('combat.add'), tokenIds: z.array(id).min(1).max(100) }),
  z.object({ t: z.literal('combat.remove'), ids: z.array(id).min(1).max(100) }),
  z.object({ t: z.literal('combat.init'), id, value: z.number().int().min(-99).max(999).nullable() }),
  z.object({ t: z.literal('combat.roll'), ids: z.array(id).max(100).optional() }),
  z.object({ t: z.literal('combat.flag'), id, hidden: z.boolean().optional(), done: z.boolean().optional() }),
  z.object({ t: z.literal('combat.reaction'), id, used: z.boolean() }),
  z.object({ t: z.literal('combat.delay'), id }),
  /** a creature uses its reaction to hit someone who walked away from it */
  z.object({ t: z.literal('reaction.attack'), from: id, target: id }),
  z.object({ t: z.literal('combat.marker'), name: z.string().trim().min(1).max(60), init: z.number().int().min(-99).max(999) }),
  z.object({ t: z.literal('combat.legendary'), id, used: z.number().int().min(0).max(5).nullable() }),
  z.object({ t: z.literal('combat.reminder'), id, text: z.string().max(300) }),
  z.object({ t: z.literal('combat.actions'), id, left: z.number().int().min(0).max(3) }),
  /** the GM sends someone away from the table (they have to open it again), bans them from it, or stops them talking */
  z.object({ t: z.literal('user.kick'), user: id }),
  z.object({ t: z.literal('user.ban'), user: id, banned: z.boolean() }),
  z.object({ t: z.literal('user.mute'), user: id, muted: z.boolean() }),
  z.object({ t: z.literal('ready.start') }),
  z.object({ t: z.literal('ready.answer'), yes: z.boolean() }),
  z.object({ t: z.literal('ready.end') }),
  z.object({ t: z.literal('handout.save'), id: id.optional(), title: z.string().trim().min(1).max(120), text: z.string().max(20000), image: imageUrl }),
  z.object({ t: z.literal('handout.delete'), id }),
  /** who may read it: everyone, nobody, or the people with these accounts */
  z.object({ t: z.literal('handout.reveal'), id, to: z.union([z.literal('all'), z.literal('none'), z.array(id).max(50)]) }),
  /** open it again on the screens of everyone who may read it */
  z.object({ t: z.literal('handout.show'), id }),
  z.object({ t: z.literal('rolltable.save'), id: id.optional(), name: z.string().trim().min(1).max(60), entries: z.string().max(20000), secret: z.boolean() }),
  z.object({ t: z.literal('rolltable.delete'), id }),
  z.object({ t: z.literal('rolltable.roll'), id }),
  z.object({ t: z.literal('jukebox.add'), name: z.string().trim().min(1).max(60), url: z.string().max(300).regex(/^(\/api\/uploads\/[A-Za-z0-9-]+|https:\/\/[^\s"'<>]{4,280})$/), loop: z.boolean() }),
  /** the track starts by itself when this scene is shown to the table (and stops when another scene is), or null for none */
  z.object({ t: z.literal('jukebox.scene'), id, scene: id.nullable() }),
  z.object({ t: z.literal('jukebox.remove'), id }),
  z.object({ t: z.literal('jukebox.play'), id }),
  z.object({ t: z.literal('jukebox.stop'), id: z.union([id, z.literal('all')]) }),
  z.object({
    t: z.literal('trigger.save'), id: id.optional(), name: z.string().trim().min(1).max(60), scene: id.nullable(),
    event: z.enum(['enter', 'round', 'down']), x: coord, y: coord, radius: z.number().min(0.5).max(50),
    action: z.enum(['say', 'handout', 'play']), arg: z.string().max(300), once: z.boolean(),
  }),
  z.object({ t: z.literal('trigger.delete'), id }),
  /** lets a trigger that fires once fire again */
  z.object({ t: z.literal('trigger.reset'), id }),
  z.object({ t: z.literal('deck.save'), id: id.optional(), name: z.string().trim().min(1).max(60), cards: z.string().max(20000) }),
  z.object({ t: z.literal('deck.delete'), id }),
  z.object({ t: z.literal('deck.shuffle'), id }),
  /** to a hand nobody else sees, or face up on the table (and then onto the discard pile) */
  z.object({ t: z.literal('deck.draw'), id, count: z.number().int().min(1).max(10), to: z.enum(['hand', 'table']) }),
  z.object({ t: z.literal('deck.play'), id, card: z.number().int().min(0).max(1000) }),
  z.object({ t: z.literal('combat.control'), action: z.enum(['start', 'next', 'prev', 'end', 'clear']) }),
  z.object({ t: z.literal('encounter.stage'), id, sceneId: id, x: coord, y: coord, hidden: z.boolean().default(true), combat: z.boolean().default(false) }),
  z.object({
    t: z.literal('draw.add'), sceneId: id, kind: z.enum(['free', 'line', 'arrow', 'polygon', 'rect', 'ellipse', 'text', 'cone', 'beam', 'blast', 'cube']), points: z.array(point).min(1).max(600),
    color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/), width: z.number().min(1).max(40), fill: z.string().regex(/^(#[0-9a-fA-F]{3,8}|)$/).optional(),
    text: z.string().max(200).optional(), gmOnly: z.boolean().optional(),
    /** fades away by itself after a few seconds (pointing something out) */
    temp: z.boolean().optional(),
  }),
  z.object({ t: z.literal('draw.delete'), ids: z.array(id).min(1).max(100) }),
  /** moves a drawing by this much */
  z.object({ t: z.literal('draw.move'), id, dx: coord, dy: coord }),
  z.object({ t: z.literal('pin.add'), sceneId: id, x: coord, y: coord, label: z.string().trim().min(1).max(60), pageId: id.nullable(), gmOnly: z.boolean() }),
  z.object({ t: z.literal('pin.delete'), id }),
  z.object({ t: z.literal('draw.clear'), sceneId: id }),
  z.object({ t: z.literal('tile.add'), sceneId: id, image: tileImage, x: coord, y: coord, w: z.number().min(8).max(20000).optional(), h: z.number().min(8).max(20000).optional(), layer: z.enum(['bg', 'overhead', 'gm']).optional() }),
  z.object({ t: z.literal('tile.update'), id, patch: tilePatch }),
  z.object({ t: z.literal('tile.delete'), ids: z.array(id).min(1).max(100) }),
  z.object({ t: z.literal('cursor'), x: coord, y: coord }),
  z.object({ t: z.literal('ping'), x: coord, y: coord }),
  /** the GM brings everyone on the scene to look at this part of it */
  z.object({ t: z.literal('camera.pull'), x: coord, y: coord, w: z.number().min(1).max(100000), h: z.number().min(1).max(100000) }),
  z.object({ t: z.literal('ruler'), points: z.array(point).max(50).nullable() }),
]).and(z.object({ op: id.optional() }))
export type ClientMessage = z.infer<typeof clientMessage>

/** A token-bucket limit for the messages that arrive many times a second (cursor, ruler, drag). */
export function makeLimiter(perSecond: number, burst = perSecond, clock: () => number = Date.now) {
  let tokens = burst, last = clock()
  return () => {
    const t = clock()
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * perSecond)
    last = t
    if (tokens < 1) return false
    tokens -= 1
    return true
  }
}
