import type { Wall } from './fog'
import { snap, type GridSpec, type Pt } from './grid'

// Walking into walls, the browser's half of server/src/movement.ts: a dragged token stops at a wall, a closed door,
// a window or a one-way wall. Terrain walls and open doors let it pass. Keep the two in step.

export const blocksMove = (w: Wall) =>
  w.kind === 'wall' || w.kind === 'window' || w.kind === 'oneway' || ((w.kind === 'door' || w.kind === 'secret') && !w.open)

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx

/** Does the walk from a to b cross this wall? Touching a wall's end or sliding along it does not count. */
export function crosses(a: Pt, b: Pt, w: Pick<Wall, 'x1' | 'y1' | 'x2' | 'y2'>): boolean {
  const rx = b.x - a.x, ry = b.y - a.y, sx = w.x2 - w.x1, sy = w.y2 - w.y1
  const den = cross(rx, ry, sx, sy)
  if (Math.abs(den) < 1e-9) return false
  const qx = w.x1 - a.x, qy = w.y1 - a.y
  const t = cross(qx, qy, sx, sy) / den, u = cross(qx, qy, rx, ry) / den
  const e = 1e-6
  return t > e && t <= 1 + e && u >= -e && u <= 1 + e
}

export const blockedPath = (a: Pt, b: Pt, walls: Wall[]) => (a.x !== b.x || a.y !== b.y) && walls.some((w) => blocksMove(w) && crosses(a, b, w))

/**
 * The furthest place on the way from `from` towards `to` that a token of `size` cells can reach without crossing a wall,
 * snapped to the grid like any drop. `from` itself when not even the next cell is reachable.
 */
export function reach(from: Pt, to: Pt, size: number, walls: Wall[], g: GridSpec): Pt {
  if (!blockedPath(from, to, walls)) return to
  const len = Math.hypot(to.x - from.x, to.y - from.y)
  const steps = Math.max(1, Math.ceil(len / Math.max(4, g.gridSize / 8)))
  for (let i = steps - 1; i > 0; i--) {
    const k = i / steps
    const p = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }
    const s = g.grid === 'none' ? p : snap(p, size, g)
    if (!blockedPath(from, s, walls)) return s
  }
  return from
}
