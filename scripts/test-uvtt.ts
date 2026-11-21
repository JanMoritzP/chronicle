import { buildUvtt, mimeOf, parseUvtt } from '../web/src/tabletop/uvtt'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const file = {
  format: 0.3,
  resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 20, y: 10 }, pixels_per_grid: 100 },
  line_of_sight: [[{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 4 }], [{ x: 8, y: 2 }, { x: 8, y: 6 }]],
  portals: [{ position: { x: 3, y: 1 }, bounds: [{ x: 2.5, y: 1 }, { x: 3.5, y: 1 }], rotation: 0, closed: true, freestanding: false }],
  lights: [{ position: { x: 2, y: 3 }, range: 6, intensity: 1, color: 'ffffcc88', shadows: true }, { position: { x: 1, y: 1 }, range: 0 }],
  image: 'iVBORw0KGgo=',
}
const r = parseUvtt(file, 'Crypt.dd2vtt') as any
check('the map size is cells times pixels per cell', r.width === 2000 && r.height === 1000 && r.gridSize === 100 && r.name === 'Crypt')
check('lines become walls, one per step', r.walls.filter((w: any) => w.kind === 'wall').length === 3 && r.walls[0].x2 === 500 && r.walls[1].y2 === 400)
check('portals become doors', r.walls.filter((w: any) => w.kind === 'door').length === 1 && r.walls.at(-1).x1 === 250)
check('a light range in cells becomes bright and dim radius, and a useless one is dropped', r.lights.length === 1 && r.lights[0].dim === 30 && r.lights[0].bright === 15 && r.lights[0].x === 200)
check('its colour is read without the alpha', r.lights[0].color === '#ffcc88')
check('the picture is found', r.image.mime === 'image/png' && mimeOf('/9j/4AAQ') === 'image/jpeg' && mimeOf('UklGRg') === 'image/webp' && mimeOf('R0lGOD') === null)
check('a file without a size is refused', 'error' in (parseUvtt({ resolution: {} }) as any) && 'error' in (parseUvtt(null) as any) && 'error' in (parseUvtt('x') as any))
check('a huge map is refused', 'error' in (parseUvtt({ ...file, resolution: { map_size: { x: 5000, y: 5000 }, pixels_per_grid: 100 } }) as any))
check('a picture of a kind that cannot be shown is refused', 'error' in (parseUvtt({ ...file, image: 'R0lGODlh' }) as any))
check('a file with no picture still gives a map', (parseUvtt({ ...file, image: undefined }) as any).image === null)
check('a light at a different cell size', (parseUvtt(file, 'x', 10) as any).lights[0].dim === 60)

const out = buildUvtt({ width: 2000, height: 1000, gridSize: 100, dist: 5 }, [
  { x1: 100, y1: 100, x2: 500, y2: 100, kind: 'wall' }, { x1: 250, y1: 100, x2: 350, y2: 100, kind: 'door', open: false },
  { x1: 0, y1: 0, x2: 0, y2: 100, kind: 'secret' }, { x1: 0, y1: 0, x2: 50, y2: 0, kind: 'window' },
], [{ x: 200, y: 300, bright: 15, dim: 30, color: '#ffcc88' }], 'iVBORw0KGgo=') as any
check('an export keeps the size and the grid', out.resolution.map_size.x === 20 && out.resolution.pixels_per_grid === 100)
check('walls and secret doors are lines, windows are left out', out.line_of_sight.length === 2 && out.portals.length === 1 && out.portals[0].closed === true)
check('a light is a range in cells with its colour', out.lights[0].range === 6 && out.lights[0].color === 'ffffcc88' && out.lights[0].position.x === 2)
const back = parseUvtt(out, 'again.uvtt') as any
check('what is exported can be imported again', back.walls.length === 3 && back.lights.length === 1 && back.width === 2000 && back.lights[0].dim === 30)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
