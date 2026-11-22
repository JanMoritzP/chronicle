// The map editor's document: a grid of floor cells with doors on their edges, props and lights. The walls are never drawn by hand: they are
// worked out from where the floor ends, so a map cannot have a gap that the picture does not show. Pure functions, tested without a browser.

export const MIN_SIDE = 5
export const MAX_SIDE = 100
export const PROPS = ['table', 'pillar', 'chest', 'altar', 'statue', 'bed', 'barrel', 'stairs', 'rug', 'fire'] as const
export type PropKind = (typeof PROPS)[number]
export const PROP_NAMES: Record<PropKind, string> = { table: 'Table', pillar: 'Pillar', chest: 'Chest', altar: 'Altar', statue: 'Statue', bed: 'Bed', barrel: 'Barrel', stairs: 'Stairs', rug: 'Rug', fire: 'Fire pit' }

/** A door, a secret door (a wall to the players) or a window (sight and light pass, walking does not), on the edge above (n) or to the left of (w) a cell. */
export type Opening = 'door' | 'secret' | 'window'
export interface DocDoor { x: number; y: number; side: 'n' | 'w'; kind?: Opening }
/** A prop is one of the drawn kinds, or a picture of the world's own (`kind` is "picture" and `image` an upload), `size` cells across. */
export interface DocProp { x: number; y: number; kind: PropKind | 'picture'; /** quarter turns */ turn: number; image?: string; size?: number }
/** A wall at any angle, between two corners of the grid (whole numbers of cells from the top left). */
export interface DocDiagonal { x1: number; y1: number; x2: number; y2: number }
export interface DocLight { x: number; y: number; /** cells of bright light; dim light reaches as far again */ radius: number; color: string }
export interface MapDoc {
  v: 1
  cols: number; rows: number
  /** one string per row, "1" for floor and "0" for nothing */
  floor: string[]
  doors: DocDoor[]
  /** walls at any angle, drawn corner to corner */
  diag?: DocDiagonal[]
  props: DocProp[]
  lights: DocLight[]
  theme: 'stone' | 'cave' | 'wood' | 'ice'
}

export const THEMES: Record<MapDoc['theme'], { name: string; bg: string; floor: string; line: string; wall: string }> = {
  stone: { name: 'Stone dungeon', bg: '#15131a', floor: '#8f8a80', line: '#7a756c', wall: '#2b2833' },
  cave: { name: 'Cave', bg: '#141210', floor: '#6f5f4c', line: '#5f503f', wall: '#2a211a' },
  wood: { name: 'Wooden hall', bg: '#18110c', floor: '#a47a4a', line: '#8d6739', wall: '#3a2615' },
  ice: { name: 'Ice cavern', bg: '#0f1620', floor: '#a9c7d8', line: '#8fb1c5', wall: '#2b4256' },
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function emptyDoc(cols = 30, rows = 20, theme: MapDoc['theme'] = 'stone'): MapDoc {
  const c = clamp(Math.round(cols), MIN_SIDE, MAX_SIDE), r = clamp(Math.round(rows), MIN_SIDE, MAX_SIDE)
  return { v: 1, cols: c, rows: r, floor: Array.from({ length: r }, () => '0'.repeat(c)), doors: [], props: [], lights: [], theme }
}

export const isFloor = (d: MapDoc, x: number, y: number) => x >= 0 && y >= 0 && x < d.cols && y < d.rows && d.floor[y][x] === '1'

/** Paints (or clears) the rectangle between two cells, corners included. Doors, props and lights that end up off the floor are kept: they may be put back. */
export function paintRect(d: MapDoc, x0: number, y0: number, x1: number, y1: number, on: boolean): MapDoc {
  const [a, b] = [clamp(Math.min(x0, x1), 0, d.cols - 1), clamp(Math.max(x0, x1), 0, d.cols - 1)]
  const [c, e] = [clamp(Math.min(y0, y1), 0, d.rows - 1), clamp(Math.max(y0, y1), 0, d.rows - 1)]
  const floor = d.floor.map((row, y) => (y < c || y > e ? row : row.slice(0, a) + (on ? '1' : '0').repeat(b - a + 1) + row.slice(b + 1)))
  return { ...d, floor }
}

/** A line of cells (a corridor) between two cells, `width` cells wide, drawn along the longer direction first. */
export function paintCorridor(d: MapDoc, x0: number, y0: number, x1: number, y1: number, width = 1): MapDoc {
  const half = Math.floor((width - 1) / 2)
  const span = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)]
  let out = d
  const [xa, xb] = span(x0, x1), [ya, yb] = span(y0, y1)
  out = paintRect(out, xa, y0 - half, xb, y0 - half + width - 1, true)
  out = paintRect(out, x1 - half, ya, x1 - half + width - 1, yb, true)
  return out
}

const sameDoor = (a: DocDoor, b: DocDoor) => a.x === b.x && a.y === b.y && a.side === b.side

/** Puts a door on an edge, or takes it away when there already is one of the same kind (one of another kind is changed to this kind). An edge with floor on neither side cannot have one. */
export function toggleDoor(d: MapDoc, door: DocDoor): MapDoc {
  const same = d.doors.find((x) => sameDoor(x, door))
  if (same) {
    if ((same.kind ?? 'door') !== (door.kind ?? 'door')) return { ...d, doors: d.doors.map((x) => (x === same ? { ...x, kind: door.kind ?? 'door' } : x)) }
    return { ...d, doors: d.doors.filter((x) => !sameDoor(x, door)) }
  }
  const other = door.side === 'n' ? { x: door.x, y: door.y - 1 } : { x: door.x - 1, y: door.y }
  if (!isFloor(d, door.x, door.y) && !isFloor(d, other.x, other.y)) return d
  if (d.doors.length >= 400) return d
  return { ...d, doors: [...d.doors, door] }
}

export interface DocWall { x1: number; y1: number; x2: number; y2: number; kind: 'wall' | Opening }

/**
 * The walls a map makes, in pixels for a cell `px` wide: a wall along every edge where floor meets nothing, runs of walls joined into single lines,
 * and a door where one was put on an edge (also between two floor cells, in a doorway).
 */
export function wallSegments(d: MapDoc, px: number): DocWall[] {
  const doorAt = new Map(d.doors.map((x) => [`${x.side}:${x.x},${x.y}`, x.kind ?? 'door'] as const))
  const out: DocWall[] = []
  const hasDoor = (side: 'n' | 'w', x: number, y: number) => doorAt.has(`${side}:${x},${y}`)
  const kindAt = (side: 'n' | 'w', x: number, y: number): Opening => doorAt.get(`${side}:${x},${y}`) ?? 'door'
  // horizontal edges: the line above row y (y from 0 to rows), joined across columns
  for (let y = 0; y <= d.rows; y++) {
    let run = -1
    const flush = (end: number) => { if (run >= 0) out.push({ x1: run * px, y1: y * px, x2: end * px, y2: y * px, kind: 'wall' }); run = -1 }
    for (let x = 0; x < d.cols; x++) {
      const above = isFloor(d, x, y - 1), below = isFloor(d, x, y)
      if (hasDoor('n', x, y) && (above || below)) { flush(x); out.push({ x1: x * px, y1: y * px, x2: (x + 1) * px, y2: y * px, kind: kindAt('n', x, y) }); continue }
      if (above !== below) { if (run < 0) run = x } else flush(x)
    }
    flush(d.cols)
  }
  for (let x = 0; x <= d.cols; x++) {
    let run = -1
    const flush = (end: number) => { if (run >= 0) out.push({ x1: x * px, y1: run * px, x2: x * px, y2: end * px, kind: 'wall' }); run = -1 }
    for (let y = 0; y < d.rows; y++) {
      const left = isFloor(d, x - 1, y), right = isFloor(d, x, y)
      if (hasDoor('w', x, y) && (left || right)) { flush(y); out.push({ x1: x * px, y1: y * px, x2: x * px, y2: (y + 1) * px, kind: kindAt('w', x, y) }); continue }
      if (left !== right) { if (run < 0) run = y } else flush(y)
    }
    flush(d.rows)
  }
  for (const g of d.diag ?? []) out.push({ x1: g.x1 * px, y1: g.y1 * px, x2: g.x2 * px, y2: g.y2 * px, kind: 'wall' })
  return out
}

/** The lights of a map for the table: radius in cells becomes bright and dim light in the scene's units. */
export function tableLights(d: MapDoc, px: number, dist: number): { x: number; y: number; bright: number; dim: number; color: string }[] {
  return d.lights.map((l) => ({ x: Math.round((l.x + 0.5) * px), y: Math.round((l.y + 0.5) * px), bright: Math.round(l.radius * dist), dim: Math.round(l.radius * dist * 2), color: l.color }))
}

/** Checks a document that came from somewhere else (storage, a file) and returns it cleaned, or null when it cannot be used. */
export function cleanDoc(raw: unknown): MapDoc | null {
  const d = raw as Partial<MapDoc> | null
  if (!d || typeof d !== 'object' || d.v !== 1) return null
  const { cols, rows } = d
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols! < MIN_SIDE || rows! < MIN_SIDE || cols! > MAX_SIDE || rows! > MAX_SIDE) return null
  if (!Array.isArray(d.floor) || d.floor.length !== rows || d.floor.some((r) => typeof r !== 'string' || r.length !== cols || /[^01]/.test(r))) return null
  const theme = d.theme && d.theme in THEMES ? d.theme : 'stone'
  const inside = (x: unknown, y: unknown) => Number.isInteger(x) && Number.isInteger(y) && (x as number) >= 0 && (y as number) >= 0 && (x as number) < cols! && (y as number) < rows!
  const doors = (Array.isArray(d.doors) ? d.doors : []).filter((o) => o && inside(o.x, o.y) && (o.side === 'n' || o.side === 'w')).slice(0, 400).map((o): DocDoor => ({ x: o.x, y: o.y, side: o.side, ...(o.kind === 'secret' || o.kind === 'window' ? { kind: o.kind } : {}) }))
  const props = (Array.isArray(d.props) ? d.props : []).filter((o) => o && inside(o.x, o.y) && ((PROPS as readonly string[]).includes(o.kind) || (o.kind === 'picture' && typeof o.image === 'string' && /^\/api\/uploads\/[A-Za-z0-9-]+$/.test(o.image)))).slice(0, 600).map((o): DocProp => ({ x: o.x, y: o.y, kind: o.kind as DocProp['kind'], turn: ((Number(o.turn) || 0) % 4 + 4) % 4, ...(o.kind === 'picture' ? { image: o.image, size: clamp(Number(o.size) || 1, 0.5, 20) } : {}) }))
  const lights = (Array.isArray(d.lights) ? d.lights : []).filter((o) => o && inside(o.x, o.y)).slice(0, 100).map((o) => ({ x: o.x, y: o.y, radius: clamp(Number(o.radius) || 4, 1, 30), color: /^#[0-9a-fA-F]{6}$/.test(String(o.color)) ? String(o.color) : '#ffd9a0' }))
  const corner = (x: unknown, y: unknown) => Number.isInteger(x) && Number.isInteger(y) && (x as number) >= 0 && (y as number) >= 0 && (x as number) <= cols! && (y as number) <= rows!
  const diag = (Array.isArray(d.diag) ? d.diag : []).filter((g) => g && corner(g.x1, g.y1) && corner(g.x2, g.y2) && (g.x1 !== g.x2 || g.y1 !== g.y2)).slice(0, 300).map((g): DocDiagonal => ({ x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 }))
  return { v: 1, cols: cols!, rows: rows!, floor: d.floor, doors, ...(diag.length ? { diag } : {}), props, lights, theme }
}

/** Grows or shrinks the grid, keeping what is inside the new size. */
export function resizeDoc(d: MapDoc, cols: number, rows: number): MapDoc {
  const c = clamp(Math.round(cols), MIN_SIDE, MAX_SIDE), r = clamp(Math.round(rows), MIN_SIDE, MAX_SIDE)
  const floor = Array.from({ length: r }, (_, y) => (d.floor[y] ?? '').slice(0, c).padEnd(c, '0'))
  const inside = (o: { x: number; y: number }) => o.x < c && o.y < r
  const corner = (g: DocDiagonal) => g.x1 <= c && g.x2 <= c && g.y1 <= r && g.y2 <= r
  return { ...d, cols: c, rows: r, floor, ...(d.diag ? { diag: d.diag.filter(corner) } : {}), doors: d.doors.filter(inside), props: d.props.filter(inside), lights: d.lights.filter(inside) }
}

/** Paints (or clears) a round brush of `size` cells across, centred on a cell: the freehand way to draw a cave. */
export function paintBrush(d: MapDoc, cx: number, cy: number, size: number, on: boolean): MapDoc {
  const n = clamp(Math.round(size), 1, 9)
  const r = n / 2
  const floor = d.floor.slice()
  for (let y = Math.max(0, cy - n); y <= Math.min(d.rows - 1, cy + n); y++) {
    let row = floor[y]
    for (let x = Math.max(0, cx - n); x <= Math.min(d.cols - 1, cx + n); x++) {
      // a cell is in the brush when its middle is within the radius; a brush of 1 is the cell itself
      if (n === 1 ? x === cx && y === cy : Math.hypot(x - cx, y - cy) < r) row = row.slice(0, x) + (on ? '1' : '0') + row.slice(x + 1)
    }
    floor[y] = row
  }
  return { ...d, floor }
}

/** The cells on the straight line between two cells, ends included, so a fast stroke leaves no gaps. */
export function cellsBetween(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  for (let i = 0; i <= n; i++) out.push({ x: Math.round(x0 + ((x1 - x0) * i) / (n || 1)), y: Math.round(y0 + ((y1 - y0) * i) / (n || 1)) })
  return out
}

/**
 * A dungeon made by itself: rooms placed so that they do not touch, each joined to the next by a corridor, doors where a corridor meets a room
 * (a few of them secret) and a light in most rooms. The same seed gives the same dungeon. It is an ordinary map, ready to be changed by hand.
 */
export function generateDungeon(seed: number, cols = 40, rows = 28, rooms = 8, theme: MapDoc['theme'] = 'stone'): MapDoc {
  let s = (Math.floor(seed) >>> 0) || 1
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  let d = emptyDoc(cols, rows, theme)
  type Room = { x: number; y: number; w: number; h: number }
  const placed: Room[] = []
  for (let tries = 0; tries < rooms * 30 && placed.length < clamp(rooms, 1, 30); tries++) {
    const w = int(4, 9), h = int(4, 8)
    if (w + 3 > d.cols || h + 3 > d.rows) continue
    const r = { x: int(1, d.cols - w - 1), y: int(1, d.rows - h - 1), w, h }
    if (placed.some((o) => r.x < o.x + o.w + 2 && r.x + r.w + 2 > o.x && r.y < o.y + o.h + 2 && r.y + r.h + 2 > o.y)) continue
    placed.push(r)
    d = paintRect(d, r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, true)
  }
  const roomCells = d.floor.slice()
  const mid = (r: Room) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) })
  for (let i = 1; i < placed.length; i++) { const a = mid(placed[i - 1]), b = mid(placed[i]); d = paintCorridor(d, a.x, a.y, b.x, b.y, 1) }
  const inRoom = (x: number, y: number) => roomCells[y]?.[x] === '1'
  const kind = (): { kind?: Opening } => (rnd() < 0.15 ? { kind: 'secret' } : {})
  const doors: DocDoor[] = []
  for (const r of placed) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (!inRoom(x, r.y - 1) && isFloor(d, x, r.y - 1) && rnd() < 0.7) doors.push({ x, y: r.y, side: 'n', ...kind() })
      if (!inRoom(x, r.y + r.h) && isFloor(d, x, r.y + r.h) && rnd() < 0.7) doors.push({ x, y: r.y + r.h, side: 'n', ...kind() })
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      if (!inRoom(r.x - 1, y) && isFloor(d, r.x - 1, y) && rnd() < 0.7) doors.push({ x: r.x, y, side: 'w' })
      if (!inRoom(r.x + r.w, y) && isFloor(d, r.x + r.w, y) && rnd() < 0.7) doors.push({ x: r.x + r.w, y, side: 'w' })
    }
  }
  return { ...d, doors: doors.slice(0, 400), lights: placed.filter(() => rnd() < 0.7).map((r) => ({ ...mid(r), radius: 5, color: '#ffd9a0' })) }
}
