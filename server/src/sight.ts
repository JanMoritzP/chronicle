import { pointInPolygon, visibility, type Pt, type Seg } from './visibility.js'

// Who may be told where a token is. On a scene with fog or darkness a player is only sent the tokens their own tokens can see:
// in the line of sight (walls block it) and lit (by the sky, a light, or darkvision). It mirrors what their screen draws
// (web/src/tabletop/fog.ts), so what is hidden is no longer sent at all and cannot be read from the browser.

export interface SightScene { width: number; height: number; gridSize: number; dist: number; fog: boolean; darkness: number }
export interface SightToken {
  id: string; x: number; y: number; owners: string[]
  data: { vision?: { sight?: number | null; dark?: number }; light?: { bright?: number; dim?: number } }
}

/** What one player's tokens see right now: the outlines of the areas in view and in light. Cheap to ask about any point. */
export interface Sight { mine: Set<string>; seen: Pt[][]; lit: Pt[][]; dark: boolean }

/** Is the scene one where players only see part of the map? */
export const foggy = (s: Pick<SightScene, 'fog' | 'darkness'>) => s.fog || s.darkness > 0

/** The view of the person with this account, or null when nothing needs hiding (no fog and no darkness). */
export function buildSight(scene: SightScene, walls: Seg[], tokens: SightToken[], userId: string, shared = false): Sight | null {
  if (!foggy(scene)) return null
  const px = (units: number) => (units / scene.dist) * scene.gridSize
  const bounds = { x: 0, y: 0, w: scene.width, h: scene.height }
  // with shared vision the party sees through every token that belongs to a player
  const mine = tokens.filter((t) => (shared ? t.owners.length > 0 : t.owners.includes(userId)))
  const seen = mine.map((t) => visibility(t, walls, bounds, t.data.vision?.sight == null ? Infinity : px(t.data.vision.sight)))
  const lit: Pt[][] = []
  const dark = scene.darkness > 0.02
  if (dark) {
    const carve = (o: Pt, radius: number) => { const poly = visibility(o, walls, bounds, radius); if (poly.length > 2) lit.push(poly) }
    // a light shines whoever carries it, hidden tokens included
    for (const t of tokens) {
      const l = t.data.light
      if (!l) continue
      const dim = px(Math.max(l.dim ?? 0, l.bright ?? 0))
      if (dim > 0) carve(t, dim)
    }
    for (const t of mine) { const d = t.data.vision?.dark ?? 0; if (d > 0) carve(t, px(d)) }
  }
  return { mine: new Set(mine.map((t) => t.id)), seen, lit, dark }
}

/** May this player be told about the token? Their own always; others only when in view and, in the dark, in light. */
export function canSee(sight: Sight | null, t: Pick<SightToken, 'id' | 'x' | 'y'>): boolean {
  if (!sight || sight.mine.has(t.id)) return true
  if (!sight.seen.some((poly) => pointInPolygon(t, poly))) return false
  return !sight.dark || sight.lit.some((poly) => pointInPolygon(t, poly))
}

/** The ids of the tokens a player may be told about, or null when everything may be sent. */
export function visibleTokens(scene: SightScene, walls: Seg[], tokens: SightToken[], userId: string, shared = false): Set<string> | null {
  const sight = buildSight(scene, walls, tokens, userId, shared)
  return sight ? new Set(tokens.filter((t) => canSee(sight, t)).map((t) => t.id)) : null
}
