import type { Pt } from './grid'

// What can be seen from a point when walls are in the way: the outline of the lit-up area ("visibility polygon").
// A ray is cast at every wall end (and a hair to either side of it), the nearest wall hit by each ray gives one corner, and the corners sorted by angle make the outline.

/** `limited` marks a terrain wall: sight passes the first one on its way, a second one stops it. */
export interface Seg { x1: number; y1: number; x2: number; y2: number; limited?: boolean }
/** A wedge of view: the middle direction and the whole width, both in radians (0 points right). */
export interface Cone { dir: number; width: number }
export interface Bounds { x: number; y: number; w: number; h: number }

const EPS = 1e-4
const CIRCLE_SIDES = 64

const rectSegs = (b: Bounds): Seg[] => [
  { x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y }, { x1: b.x + b.w, y1: b.y, x2: b.x + b.w, y2: b.y + b.h },
  { x1: b.x + b.w, y1: b.y + b.h, x2: b.x, y2: b.y + b.h }, { x1: b.x, y1: b.y + b.h, x2: b.x, y2: b.y },
]

/** A ring of walls around the origin, so that sight and light stop at a distance. */
function ring(o: Pt, r: number): Seg[] {
  const out: Seg[] = []
  for (let i = 0; i < CIRCLE_SIDES; i++) {
    const a = (i / CIRCLE_SIDES) * Math.PI * 2, b = ((i + 1) / CIRCLE_SIDES) * Math.PI * 2
    out.push({ x1: o.x + r * Math.cos(a), y1: o.y + r * Math.sin(a), x2: o.x + r * Math.cos(b), y2: o.y + r * Math.sin(b) })
  }
  return out
}

/** Distance along the ray (origin o, direction d) to a segment, or Infinity. */
function hit(o: Pt, dx: number, dy: number, s: Seg): number {
  const sx = s.x2 - s.x1, sy = s.y2 - s.y1
  const denom = dx * sy - dy * sx
  if (Math.abs(denom) < 1e-12) return Infinity
  const t = ((s.x1 - o.x) * sy - (s.y1 - o.y) * sx) / denom
  const u = ((s.x1 - o.x) * dy - (s.y1 - o.y) * dx) / denom
  return t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity
}

/**
 * The area visible from `origin`. `walls` block sight (leave out open doors and windows); `bounds` is the edge of the scene;
 * with a finite `radius` the area is also cut to a circle of that radius, and with a `cone` to a wedge of it (the outline then starts at the origin).
 */
export function visibility(origin: Pt, walls: Seg[], bounds: Bounds, radius = Infinity, cone?: Cone): Pt[] {
  const limited = Number.isFinite(radius)
  const near = limited
    ? walls.filter((w) => Math.max(w.x1, w.x2) >= origin.x - radius && Math.min(w.x1, w.x2) <= origin.x + radius && Math.max(w.y1, w.y2) >= origin.y - radius && Math.min(w.y1, w.y2) <= origin.y + radius)
    : walls
  const blockers = [...near, ...rectSegs(bounds), ...(limited ? ring(origin, radius) : [])]
  const TAU = Math.PI * 2
  const wedge = cone && cone.width < TAU - 1e-6 ? cone : undefined
  const start = wedge ? wedge.dir - wedge.width / 2 : 0
  const rel = (a: number) => { let r = (a - start) % TAU; if (r < 0) r += TAU; return r }
  const angles: number[] = []
  const add = (a: number) => { if (!wedge) { angles.push(a); return } const r = rel(a); if (r <= wedge.width + 1e-9) angles.push(r) }
  for (const s of blockers) {
    for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) {
      const a = Math.atan2(y - origin.y, x - origin.x)
      add(a - EPS); add(a); add(a + EPS)
    }
  }
  if (wedge) { angles.push(0, wedge.width) }
  angles.sort((a, b) => a - b)
  const out: Pt[] = wedge ? [{ x: origin.x, y: origin.y }] : []
  let last = NaN
  for (const a of angles) {
    if (a - last < 1e-9) continue
    last = a
    const ang = wedge ? start + a : a
    const dx = Math.cos(ang), dy = Math.sin(ang)
    let best = Infinity
    let firstTerrain = Infinity
    for (const s of blockers) {
      const t = hit(origin, dx, dy, s)
      if (t === Infinity) continue
      if (s.limited) {
        // the first terrain wall is seen past, the second ends the view
        if (t < firstTerrain) { if (firstTerrain < best) best = firstTerrain; firstTerrain = t } else if (t < best) best = t
      } else if (t < best) best = t
    }
    if (best !== Infinity) out.push({ x: origin.x + dx * best, y: origin.y + dy * best })
  }
  return out
}

/** The wedge a light with an `angle` (degrees across) shines in, facing `dir` degrees clockwise from the top; a full circle has none. */
export function coneOf(l: { angle?: number; dir?: number }): Cone | undefined {
  if (!l.angle || l.angle >= 360) return undefined
  return { dir: (((l.dir ?? 0) - 90) * Math.PI) / 180, width: (l.angle * Math.PI) / 180 }
}

export const polygonArea = (p: Pt[]) => {
  let a = 0
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y }
  return Math.abs(a) / 2
}

export function pointInPolygon(pt: Pt, poly: Pt[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** A cloud of fog or a sphere of magical darkness on the map (centre and radius in pixels). Sight does not pass into it or through it. */
export interface Obscure { x: number; y: number; r: number; kind: 'darkness' | 'fog' }
/** How far a viewer sees, in pixels: by eye (Infinity for as far as walls allow), by blindsight and by truesight (0 for none). */
export interface Senses { sight: number; blind: number; truesight: number }

const AREA_SIDES = 32
const areaWalls = (areas: Obscure[]): Seg[] => areas.flatMap((a) => Array.from({ length: AREA_SIDES }, (_, i) => {
  const p = (i / AREA_SIDES) * Math.PI * 2, q = ((i + 1) / AREA_SIDES) * Math.PI * 2
  return { x1: a.x + a.r * Math.cos(p), y1: a.y + a.r * Math.sin(p), x2: a.x + a.r * Math.cos(q), y2: a.y + a.r * Math.sin(q) }
}))
const within = (o: Pt, areas: Obscure[]) => areas.some((a) => Math.hypot(o.x - a.x, o.y - a.y) < a.r)

/**
 * What a viewer sees when fog or magical darkness is on the map, as outlines to join: the eye stops at the edge of every area
 * (from inside one it reaches one `cell`), blindsight passes all of them, truesight passes magical darkness but not fog.
 * With no areas it is the plain view.
 */
export function sightWithAreas(o: Pt, walls: Seg[], bounds: Bounds, s: Senses, areas: Obscure[], cell: number): Pt[][] {
  if (!areas.length) return [visibility(o, walls, bounds, s.sight)]
  const out = [visibility(o, [...walls, ...areaWalls(areas)], bounds, within(o, areas) ? Math.min(s.sight, cell) : s.sight)]
  if (s.blind > 0) out.push(visibility(o, walls, bounds, s.blind))
  if (s.truesight > 0) {
    const fog = areas.filter((a) => a.kind === 'fog')
    out.push(visibility(o, [...walls, ...areaWalls(fog)], bounds, within(o, fog) ? Math.min(s.truesight, cell) : s.truesight))
  }
  return out.filter((p) => p.length > 2)
}
