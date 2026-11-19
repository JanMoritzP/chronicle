import type { Pt } from './grid'

// What can be seen from a point when walls are in the way: the outline of the lit-up area ("visibility polygon").
// A ray is cast at every wall end (and a hair to either side of it), the nearest wall hit by each ray gives one corner, and the corners sorted by angle make the outline.

export interface Seg { x1: number; y1: number; x2: number; y2: number }
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
 * with a finite `radius` the area is also cut to a circle of that radius.
 */
export function visibility(origin: Pt, walls: Seg[], bounds: Bounds, radius = Infinity): Pt[] {
  const limited = Number.isFinite(radius)
  const near = limited
    ? walls.filter((w) => Math.max(w.x1, w.x2) >= origin.x - radius && Math.min(w.x1, w.x2) <= origin.x + radius && Math.max(w.y1, w.y2) >= origin.y - radius && Math.min(w.y1, w.y2) <= origin.y + radius)
    : walls
  const blockers = [...near, ...rectSegs(bounds), ...(limited ? ring(origin, radius) : [])]
  const angles: number[] = []
  for (const s of blockers) {
    for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) {
      const a = Math.atan2(y - origin.y, x - origin.x)
      angles.push(a - EPS, a, a + EPS)
    }
  }
  angles.sort((a, b) => a - b)
  const out: Pt[] = []
  let last = NaN
  for (const a of angles) {
    if (a - last < 1e-9) continue
    last = a
    const dx = Math.cos(a), dy = Math.sin(a)
    let best = Infinity
    for (const s of blockers) { const t = hit(origin, dx, dy, s); if (t < best) best = t }
    if (best !== Infinity) out.push({ x: origin.x + dx * best, y: origin.y + dy * best })
  }
  return out
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
