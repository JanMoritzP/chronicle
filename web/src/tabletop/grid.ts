// Grid maths for a scene: where a token snaps and how far apart two points are in game units.
// Coordinates are scene pixels. `gridSize` is the cell width; for hexes it is the distance between neighbouring centres.

export type GridType = 'square' | 'hex-row' | 'hex-col' | 'none'
export type Diagonal = '5-5-5' | '5-10-5' | 'euclid' | 'manhattan'
export interface GridSpec { grid: GridType; gridSize: number; dist: number; unit: string; diagonal: Diagonal }
export interface Pt { x: number; y: number }

const ROOT3_2 = Math.sqrt(3) / 2

// ---------- hexes ----------
// hex-row: pointy-top hexes in rows, odd rows shifted right. hex-col: flat-top hexes in columns, odd columns shifted down.

const hexCenter = (col: number, row: number, g: GridSpec, flat: boolean): Pt => flat
  ? { x: col * g.gridSize * ROOT3_2, y: row * g.gridSize + (col & 1 ? g.gridSize / 2 : 0) }
  : { x: col * g.gridSize + (row & 1 ? g.gridSize / 2 : 0), y: row * g.gridSize * ROOT3_2 }

function nearestHex(p: Pt, g: GridSpec, flat: boolean): { col: number; row: number } {
  const approx = flat
    ? { col: Math.round(p.x / (g.gridSize * ROOT3_2)), row: Math.round(p.y / g.gridSize) }
    : { col: Math.round(p.x / g.gridSize), row: Math.round(p.y / (g.gridSize * ROOT3_2)) }
  let best = approx, bestD = Infinity
  for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
    const c = approx.col + dc, r = approx.row + dr
    const q = hexCenter(c, r, g, flat)
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2
    if (d < bestD) { bestD = d; best = { col: c, row: r } }
  }
  return best
}

/** Offset coordinates to cube coordinates, whose distance is simply the largest difference. */
function cube(col: number, row: number, flat: boolean) {
  if (flat) { const x = col, z = row - (col - (col & 1)) / 2; return { x, y: -x - z, z } }
  const x = col - (row - (row & 1)) / 2, z = row
  return { x, y: -x - z, z }
}

// ---------- snapping ----------

/** The point a token of `size` cells snaps to: odd sizes centre on a cell, even sizes sit on a cell corner. */
export function snap(p: Pt, size: number, g: GridSpec): Pt {
  if (g.grid === 'none') return p
  if (g.grid === 'square') {
    const s = g.gridSize
    const even = Math.round(size) % 2 === 0
    const f = (v: number) => even ? Math.round(v / s) * s : Math.floor(v / s) * s + s / 2
    return { x: f(p.x), y: f(p.y) }
  }
  const flat = g.grid === 'hex-col'
  const h = nearestHex(p, g, flat)
  return hexCenter(h.col, h.row, g, flat)
}

/** Pixel size of a token of `size` cells. */
export const tokenPixels = (size: number, g: GridSpec) => size * g.gridSize

// ---------- measuring ----------

/**
 * The length of a path in game units. Square grids follow the diagonal rule of the scene
 * (5-10-5 counts every second diagonal step double and carries on across the corners of the path).
 */
export function measure(points: Pt[], g: GridSpec): { cells: number; distance: number } {
  if (points.length < 2) return { cells: 0, distance: 0 }
  let cells = 0
  if (g.grid === 'none' || g.diagonal === 'euclid' && g.grid !== 'hex-row' && g.grid !== 'hex-col') {
    for (let i = 1; i < points.length; i++) cells += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) / g.gridSize
  } else if (g.grid === 'square') {
    let diagonals = 0
    for (let i = 1; i < points.length; i++) {
      const dx = Math.abs(Math.round((points[i].x - points[i - 1].x) / g.gridSize))
      const dy = Math.abs(Math.round((points[i].y - points[i - 1].y) / g.gridSize))
      const diag = Math.min(dx, dy), straight = Math.max(dx, dy) - diag
      if (g.diagonal === 'manhattan') cells += dx + dy
      else if (g.diagonal === '5-5-5') cells += straight + diag
      else {
        // the first diagonal costs 1, the second 2, the third 1...
        const doubled = Math.floor((diagonals + diag) / 2) - Math.floor(diagonals / 2)
        cells += straight + diag + doubled
        diagonals += diag
      }
    }
  } else {
    const flat = g.grid === 'hex-col'
    let prev = nearestHex(points[0], g, flat)
    for (let i = 1; i < points.length; i++) {
      const next = nearestHex(points[i], g, flat)
      const a = cube(prev.col, prev.row, flat), b = cube(next.col, next.row, flat)
      cells += Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z))
      prev = next
    }
  }
  return { cells, distance: cells * g.dist }
}

export const formatDistance = (d: number, unit: string) => `${Number.isInteger(d) ? d : d.toFixed(1)} ${unit}`

// ---------- drawing helpers ----------

/** Corners of the hexagon around a centre, for drawing the grid. */
export function hexCorners(c: Pt, g: GridSpec): Pt[] {
  const flat = g.grid === 'hex-col'
  const r = g.gridSize / Math.sqrt(3)
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + (flat ? 0 : Math.PI / 6)
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }
  })
}

/** Centres of every hex that touches a scene of the given size. */
export function hexCentres(w: number, h: number, g: GridSpec): Pt[] {
  const flat = g.grid === 'hex-col'
  const out: Pt[] = []
  const cols = Math.ceil(w / (flat ? g.gridSize * ROOT3_2 : g.gridSize)) + 1
  const rows = Math.ceil(h / (flat ? g.gridSize : g.gridSize * ROOT3_2)) + 1
  for (let col = 0; col <= cols; col++) for (let row = 0; row <= rows; row++) out.push(hexCenter(col, row, g, flat))
  return out
}
