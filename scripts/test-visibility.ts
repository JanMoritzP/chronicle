import { pointInPolygon, polygonArea, visibility, type Seg } from '../web/src/tabletop/visibility'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const room = { x: 0, y: 0, w: 100, h: 100 }
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol

let poly = visibility({ x: 50, y: 50 }, [], room)
check('an empty room is seen whole', near(polygonArea(poly), 10000))

const divider: Seg = { x1: 50, y1: 0, x2: 50, y2: 100 }
poly = visibility({ x: 25, y: 50 }, [divider], room)
check('a wall across the room hides the other half', near(polygonArea(poly), 5000) && pointInPolygon({ x: 10, y: 10 }, poly) && !pointInPolygon({ x: 75, y: 50 }, poly))

const half: Seg = { x1: 50, y1: 0, x2: 50, y2: 50 }
poly = visibility({ x: 25, y: 25 }, [half], room)
check('a wall with a gap lets the light round the end', pointInPolygon({ x: 75, y: 90 }, poly) && !pointInPolygon({ x: 75, y: 10 }, poly) && polygonArea(poly) > 5000 && polygonArea(poly) < 10000)

poly = visibility({ x: 50, y: 50 }, [], room, 20)
check('a radius cuts the view to a circle', near(polygonArea(poly), Math.PI * 400, 20), String(polygonArea(poly)))
check('nothing beyond the radius is seen', !pointInPolygon({ x: 80, y: 50 }, poly) && pointInPolygon({ x: 60, y: 50 }, poly))

// a pillar: a small box in the middle of the room casts a shadow
const pillar: Seg[] = [
  { x1: 45, y1: 45, x2: 55, y2: 45 }, { x1: 55, y1: 45, x2: 55, y2: 55 }, { x1: 55, y1: 55, x2: 45, y2: 55 }, { x1: 45, y1: 55, x2: 45, y2: 45 },
]
poly = visibility({ x: 10, y: 50 }, pillar, room)
check('a pillar casts a shadow behind it', !pointInPolygon({ x: 80, y: 50 }, poly) && pointInPolygon({ x: 80, y: 20 }, poly) && pointInPolygon({ x: 40, y: 50 }, poly))

// closed room: the outside stays dark
const box: Seg[] = [
  { x1: 20, y1: 20, x2: 60, y2: 20 }, { x1: 60, y1: 20, x2: 60, y2: 60 }, { x1: 60, y1: 60, x2: 20, y2: 60 }, { x1: 20, y1: 60, x2: 20, y2: 20 },
]
poly = visibility({ x: 40, y: 40 }, box, room)
check('inside a closed room only the room is seen', near(polygonArea(poly), 1600) && !pointInPolygon({ x: 80, y: 80 }, poly))

// many walls stay fast
const lots: Seg[] = Array.from({ length: 400 }, (_, i) => ({ x1: (i * 37) % 1900, y1: (i * 91) % 1900, x2: ((i * 37) % 1900) + 30, y2: ((i * 91) % 1900) + 12 }))
const t0 = performance.now()
for (let i = 0; i < 5; i++) visibility({ x: 1000 + i, y: 1000 }, lots, { x: 0, y: 0, w: 2000, h: 2000 })
const ms = (performance.now() - t0) / 5
check('400 walls take well under 50 ms', ms < 50, `${ms.toFixed(1)} ms`)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
