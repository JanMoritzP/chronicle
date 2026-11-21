// Universal VTT (.dd2vtt, .uvtt): the map file Dungeondraft, DungeonAlchemist and others export, and Foundry and Roll20 read.
// One JSON file: the map picture, the walls as lines in grid units, doors as portals and lights. Pure conversion, tested without a browser.

export interface UvttWall { x1: number; y1: number; x2: number; y2: number; kind: 'wall' | 'door' }
export interface UvttLight { x: number; y: number; bright: number; dim: number; color?: string }
export interface UvttScene {
  name: string; width: number; height: number; gridSize: number
  walls: UvttWall[]; lights: UvttLight[]
  image: { mime: string; base64: string } | null
}

const MAX_WALLS = 5000
const MAX_LIGHTS = 200
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const pt = (v: any): { x: number; y: number } | null => (v && isNum(v.x) && isNum(v.y) ? { x: v.x, y: v.y } : null)
const r2 = (n: number) => Math.round(n * 100) / 100

/** The kind of picture, from the first bytes of its base64 text. */
export function mimeOf(base64: string): string | null {
  if (base64.startsWith('iVBOR')) return 'image/png'
  if (base64.startsWith('/9j/')) return 'image/jpeg'
  if (base64.startsWith('UklGR')) return 'image/webp'
  return null
}

/**
 * Reads the contents of a Universal VTT file. A cell is `dist` units of the scene (5 feet by default), which turns a light's range in cells
 * into the bright and dim radius the table uses (bright is half the range). Returns an error sentence for a file that cannot be used.
 */
export function parseUvtt(raw: unknown, fileName = '', dist = 5): UvttScene | { error: string } {
  const d = raw as any
  if (!d || typeof d !== 'object') return { error: 'That is not a Universal VTT file.' }
  const ppg = d.resolution?.pixels_per_grid, size = pt(d.resolution?.map_size)
  if (!isNum(ppg) || ppg < 10 || ppg > 1000 || !size || size.x <= 0 || size.y <= 0) return { error: 'The file does not say how large the map is.' }
  const width = Math.round(size.x * ppg), height = Math.round(size.y * ppg)
  if (width < 100 || height < 100 || width > 40000 || height > 40000) return { error: 'The map is too small or too large (up to 40000 pixels on a side).' }
  const walls: UvttWall[] = []
  for (const line of Array.isArray(d.line_of_sight) ? d.line_of_sight : []) {
    if (!Array.isArray(line)) continue
    const pts = line.map(pt)
    for (let i = 0; i + 1 < pts.length && walls.length < MAX_WALLS; i++) {
      const a = pts[i], b = pts[i + 1]
      if (a && b) walls.push({ x1: r2(a.x * ppg), y1: r2(a.y * ppg), x2: r2(b.x * ppg), y2: r2(b.y * ppg), kind: 'wall' })
    }
  }
  for (const p of Array.isArray(d.portals) ? d.portals : []) {
    const a = pt(p?.bounds?.[0]), b = pt(p?.bounds?.[1])
    if (a && b && walls.length < MAX_WALLS) walls.push({ x1: r2(a.x * ppg), y1: r2(a.y * ppg), x2: r2(b.x * ppg), y2: r2(b.y * ppg), kind: 'door' })
  }
  const lights: UvttLight[] = []
  for (const l of Array.isArray(d.lights) ? d.lights : []) {
    const at = pt(l?.position)
    if (!at || !isNum(l.range) || l.range <= 0 || lights.length >= MAX_LIGHTS) continue
    const hex = typeof l.color === 'string' ? l.color.replace(/^#/, '') : ''
    const rgb = hex.length === 8 ? hex.slice(2) : hex.length === 6 ? hex : ''
    lights.push({ x: Math.round(at.x * ppg), y: Math.round(at.y * ppg), bright: Math.round((l.range * dist) / 2), dim: Math.round(l.range * dist), ...(/^[0-9a-fA-F]{6}$/.test(rgb) ? { color: `#${rgb.toLowerCase()}` } : {}) })
  }
  let image: UvttScene['image'] = null
  if (typeof d.image === 'string' && d.image) {
    const mime = mimeOf(d.image)
    if (!mime) return { error: 'The picture in the file is not a PNG, JPEG or WebP.' }
    image = { mime, base64: d.image }
  }
  const name = fileName.replace(/\.(dd2vtt|uvtt|json)$/i, '').trim() || 'Imported map'
  return { name, width, height, gridSize: ppg, walls, lights, image }
}

/** The file for a scene: what Foundry, Roll20 and the map tools read. Walls and secret doors are lines, doors are portals, lights are by range in cells. */
export function buildUvtt(
  scene: { width: number; height: number; gridSize: number; dist: number },
  walls: { x1: number; y1: number; x2: number; y2: number; kind: string; open?: boolean }[],
  lights: { x: number; y: number; bright?: number; dim?: number; color?: string }[],
  imageBase64: string,
) {
  const g = scene.gridSize
  const cell = (n: number) => Math.round((n / g) * 1000) / 1000
  const p = (x: number, y: number) => ({ x: cell(x), y: cell(y) })
  return {
    format: 0.3,
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: cell(scene.width), y: cell(scene.height) }, pixels_per_grid: g },
    line_of_sight: walls.filter((w) => w.kind === 'wall' || w.kind === 'secret').map((w) => [p(w.x1, w.y1), p(w.x2, w.y2)]),
    objects_line_of_sight: [],
    portals: walls.filter((w) => w.kind === 'door').map((w) => ({
      position: p((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2), bounds: [p(w.x1, w.y1), p(w.x2, w.y2)],
      rotation: Math.atan2(w.y2 - w.y1, w.x2 - w.x1), closed: !w.open, freestanding: false,
    })),
    lights: lights.map((l) => ({
      position: p(l.x, l.y), range: Math.round((Math.max(l.dim ?? 0, l.bright ?? 0) / scene.dist) * 100) / 100, intensity: 1,
      color: `ff${(l.color ?? '#ffffff').replace('#', '').padEnd(6, 'f').slice(0, 6)}`, shadows: true,
    })),
    environment: { baked_lighting: false, ambient_light: 'ffffffff' },
    image: imageBase64,
    software: 'Chronicle',
  }
}
