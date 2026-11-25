// Walking into walls. A token's centre may not cross a wall, a closed door, a window or a one-way wall on its way from
// one place to the next. Terrain walls (a hedge, a low hill) and open doors let it pass. The same test runs in the browser
// (web/src/tabletop/movement.ts) so a dragged token stops at the wall; the server's answer is the one that counts.

export interface MoveWall { x1: number; y1: number; x2: number; y2: number; kind: string; open: boolean | number }
interface Pt { x: number; y: number }

export const blocksMove = (w: MoveWall) =>
  w.kind === 'wall' || w.kind === 'window' || w.kind === 'oneway' || ((w.kind === 'door' || w.kind === 'secret') && !w.open)

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx

/** Does the walk from a to b cross this wall? Touching a wall's end or sliding along it does not count. */
export function crosses(a: Pt, b: Pt, w: MoveWall): boolean {
  const rx = b.x - a.x, ry = b.y - a.y, sx = w.x2 - w.x1, sy = w.y2 - w.y1
  const den = cross(rx, ry, sx, sy)
  if (Math.abs(den) < 1e-9) return false
  const qx = w.x1 - a.x, qy = w.y1 - a.y
  const t = cross(qx, qy, sx, sy) / den, u = cross(qx, qy, rx, ry) / den
  const e = 1e-6
  return t > e && t <= 1 + e && u >= -e && u <= 1 + e
}

export const blockedPath = (a: Pt, b: Pt, walls: MoveWall[]) => (a.x !== b.x || a.y !== b.y) && walls.some((w) => blocksMove(w) && crosses(a, b, w))
