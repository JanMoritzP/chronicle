import { z } from 'zod'

// Rules of the tabletop that need no database: who is what at the table, who may do what to a token, and the shape of every message.
// The table channel (table.ts) calls these for every message, so the rules live in one place and are tested without a server.

export type TableRole = 'gm' | 'player' | 'spectator'

export const settingsSchema = z.object({
  /** Accounts that may run the table besides the owner. */
  gms: z.array(z.string().max(64)).max(20).default([]),
  /** What players may do. Spectators can do none of it. */
  playersMoveOwn: z.boolean().default(true),
  playersCreateTokens: z.boolean().default(false),
  playersPing: z.boolean().default(true),
  playersRuler: z.boolean().default(true),
  /** Players see each other's cursors. */
  showCursors: z.boolean().default(true),
})
/** A change to the settings: only the keys that are present (a partial of the schema above would fill the defaults back in). */
export const settingsPatch = z.object({
  gms: z.array(z.string().max(64)).max(20),
  playersMoveOwn: z.boolean(), playersCreateTokens: z.boolean(), playersPing: z.boolean(), playersRuler: z.boolean(), showCursors: z.boolean(),
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

export const canCreateToken = (role: TableRole, s: TableSettings) => role === 'gm' || (role === 'player' && s.playersCreateTokens)
export const canPing = (role: TableRole, s: TableSettings) => role === 'gm' || (role === 'player' && s.playersPing)
export const canRuler = (role: TableRole, s: TableSettings) => role === 'gm' || (role === 'player' && s.playersRuler)

// ---------- messages from a client ----------

const id = z.string().min(1).max(64)
const coord = z.number().finite().min(-100000).max(100000)
const color = z.string().max(20).regex(/^(#[0-9a-fA-F]{3,8}|)$/)
const imageUrl = z.string().max(300).regex(/^(\/api\/uploads\/[A-Za-z0-9-]+|)$/)

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
  data: z.record(z.string().max(40), z.unknown()).refine((d) => JSON.stringify(d).length <= 8000, 'data too large'),
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
}).partial().strict()

const point = z.object({ x: coord, y: coord })

export const clientMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('view'), sceneId: id }),
  z.object({ t: z.literal('scene.create'), name: z.string().min(1).max(120).optional(), patch: scenePatch.optional() }),
  z.object({ t: z.literal('scene.update'), id, patch: scenePatch }),
  z.object({ t: z.literal('scene.delete'), id }),
  z.object({ t: z.literal('scene.activate'), id }),
  z.object({ t: z.literal('token.add'), sceneId: id, token: tokenPatch }),
  z.object({ t: z.literal('token.update'), id, patch: tokenPatch }),
  z.object({ t: z.literal('token.move'), moves: z.array(z.object({ id, x: coord, y: coord, rotation: z.number().finite().min(-3600).max(3600).optional() })).min(1).max(100) }),
  z.object({ t: z.literal('token.delete'), ids: z.array(id).min(1).max(100) }),
  z.object({ t: z.literal('settings.set'), patch: settingsPatch }),
  z.object({ t: z.literal('cursor'), x: coord, y: coord }),
  z.object({ t: z.literal('ping'), x: coord, y: coord }),
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
