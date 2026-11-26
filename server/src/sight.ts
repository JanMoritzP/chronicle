import { coneOf, pointInPolygon, sightWithAreas, visibility, type Obscure, type Pt, type Seg } from './visibility.js'

// Who may be told where a token is. On a scene with fog or darkness a player is only sent the tokens their own tokens can see:
// in the line of sight (walls block it) and lit (by the sky, a light, or darkvision). It mirrors what their screen draws
// (web/src/tabletop/fog.ts), so what is hidden is no longer sent at all and cannot be read from the browser.

export interface SightScene { width: number; height: number; gridSize: number; dist: number; fog: boolean; darkness: number }
/** A wall for sight: a one-way wall blocks the view of whoever is on its far side only. */
export type SightWall = Seg & { oneway?: boolean }
export interface SightToken {
  id: string; x: number; y: number; owners: string[]
  data: { /** the whole party sees through this token */ sharedSight?: boolean; vision?: { sight?: number | null; dark?: number; blind?: number; true?: number }; light?: { bright?: number; dim?: number; angle?: number; dir?: number }; /** a placed area of fog or magical darkness */ obscure?: ObscureData }
}

/** A cloud of fog or a sphere of magical darkness placed with the light tool, its radius in the scene's unit. */
export interface ObscureData { kind?: 'darkness' | 'fog'; radius?: number; off?: boolean }
/** The fog and darkness areas among the tokens, in pixels. The browser has the same rule (web/src/tabletop/fog.ts, `obscuresOf`). */
export function obscuresOf(tokens: { x: number; y: number; data: { obscure?: ObscureData } }[], px: (units: number) => number): Obscure[] {
  return tokens.flatMap((t) => {
    const o = t.data.obscure
    if (!o || o.off || !((o.radius ?? 0) > 0)) return []
    return [{ x: t.x, y: t.y, r: px(o.radius!), kind: o.kind === 'fog' ? 'fog' as const : 'darkness' as const }]
  })
}

/** What one player's tokens see right now: the outlines of the areas in view and in light. Cheap to ask about any point. */
export interface Rect { x: number; y: number; w: number; h: number }
export interface Sight { mine: Set<string>; seen: Pt[][]; lit: Pt[][]; dark: boolean; /** areas the GM showed the players */ reveals: Rect[] }

/** Is the scene one where players only see part of the map? */
export const foggy = (s: Pick<SightScene, 'fog' | 'darkness'>) => s.fog || s.darkness > 0

/** The view of the person with this account, or null when nothing needs hiding (no fog and no darkness). */
export function buildSight(scene: SightScene, walls: SightWall[], tokens: SightToken[], userId: string, shared = false, reveals: Rect[] = []): Sight | null {
  if (!foggy(scene)) return null
  const px = (units: number) => (units / scene.dist) * scene.gridSize
  const bounds = { x: 0, y: 0, w: scene.width, h: scene.height }
  // with shared vision the party sees through every token that belongs to a player
  const mine = tokens.filter((t) => t.data.sharedSight === true || (shared ? t.owners.length > 0 : t.owners.includes(userId)))
  // a one-way wall can be seen through from one side: the side its direction points away from
  const seeThrough = (w: SightWall, p: Pt) => w.oneway === true && (w.x2 - w.x1) * (p.y - w.y1) - (w.y2 - w.y1) * (p.x - w.x1) < 0
  const sightFor = (p: Pt) => walls.filter((w) => !seeThrough(w, p))
  const areas = obscuresOf(tokens, px)
  const seen = mine.flatMap((t) => {
    const v = t.data.vision
    return sightWithAreas(t, sightFor(t), bounds, { sight: v?.sight == null ? Infinity : px(v.sight), blind: px(v?.blind ?? 0), truesight: px(v?.true ?? 0) }, areas, scene.gridSize)
  })
  const lit: Pt[][] = []
  const dark = scene.darkness > 0.02
  if (dark) {
    const carve = (o: Pt, radius: number, cone?: ReturnType<typeof coneOf>) => { const poly = visibility(o, walls, bounds, radius, cone); if (poly.length > 2) lit.push(poly) }
    // a light shines whoever carries it, hidden tokens included
    for (const t of tokens) {
      const l = t.data.light
      if (!l || (l as { off?: boolean }).off) continue
      const dim = px(Math.max(l.dim ?? 0, l.bright ?? 0))
      if (dim > 0) carve(t, dim, coneOf(l))
    }
    // darkvision, blindsight and truesight all see in the dark within their reach
    for (const t of mine) { const v = t.data.vision; const d = Math.max(v?.dark ?? 0, v?.blind ?? 0, v?.true ?? 0); if (d > 0) carve(t, px(d)) }
  }
  return { mine: new Set(mine.map((t) => t.id)), seen, lit, dark, reveals }
}

/** May this player be told about the token? Their own always; others only when in view and, in the dark, in light. */
export function canSee(sight: Sight | null, t: Pick<SightToken, 'id' | 'x' | 'y'>): boolean {
  if (!sight || sight.mine.has(t.id)) return true
  if (sight.reveals.some((r) => t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h)) return true
  if (!sight.seen.some((poly) => pointInPolygon(t, poly))) return false
  return !sight.dark || sight.lit.some((poly) => pointInPolygon(t, poly))
}

/** The ids of the tokens a player may be told about, or null when everything may be sent. */
export function visibleTokens(scene: SightScene, walls: SightWall[], tokens: SightToken[], userId: string, shared = false, reveals: Rect[] = []): Set<string> | null {
  const sight = buildSight(scene, walls, tokens, userId, shared, reveals)
  return sight ? new Set(tokens.filter((t) => canSee(sight, t)).map((t) => t.id)) : null
}
