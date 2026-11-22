import { cellsBetween, cleanDoc, emptyDoc, generateDungeon, paintBrush, isFloor, paintCorridor, paintRect, resizeDoc, tableLights, toggleDoor, wallSegments, type MapDoc } from '../web/src/tabletop/mapdoc'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const empty = emptyDoc(10, 8)
check('an empty map is the size asked, with no floor', empty.cols === 10 && empty.rows === 8 && empty.floor.every((r) => r === '0000000000') && emptyDoc(1, 1000).cols === 5 && emptyDoc(1, 1000).rows === 100)
const room = paintRect(empty, 2, 2, 4, 3, true)
check('a rectangle of floor is painted, corners included', isFloor(room, 2, 2) && isFloor(room, 4, 3) && !isFloor(room, 5, 3) && !isFloor(room, 1, 2) && room.floor.join('').split('1').length - 1 === 6)
check('painting does not change the map it started from', empty.floor.every((r) => !r.includes('1')))
check('a rectangle is clamped to the map and can be dragged either way', paintRect(empty, 20, 20, 8, 6, true).floor[7].endsWith('11') && paintRect(empty, 4, 3, 2, 2, true).floor[2] === '0011100000')
check('floor can be cleared again', paintRect(room, 3, 2, 3, 3, false).floor[2] === '0010100000')

const w = wallSegments(room, 50)
check('a room has four walls, each joined into one line', w.length === 4 && w.every((s) => s.kind === 'wall'))
check('they run along the edge of the floor', w.some((s) => s.y1 === 100 && s.y2 === 100 && s.x1 === 100 && s.x2 === 250) && w.some((s) => s.x1 === 250 && s.y1 === 100 && s.y2 === 200) && w.some((s) => s.y1 === 200 && s.x2 === 250) && w.some((s) => s.x1 === 100 && s.y2 === 200))
check('an empty map has no walls', wallSegments(empty, 50).length === 0)
const ell = paintRect(paintRect(empty, 1, 1, 4, 1, true), 1, 1, 1, 4, true)
check('an L shaped room has six walls', wallSegments(ell, 10).length === 6)
const two = paintRect(paintRect(empty, 1, 1, 2, 2, true), 4, 1, 5, 2, true)
check('two rooms apart make eight', wallSegments(two, 10).length === 8)
const joined = paintRect(two, 3, 1, 3, 2, true)
check('joined into one hall they make four', wallSegments(joined, 10).length === 4)

const door = toggleDoor(room, { x: 3, y: 2, side: 'n' })
const dw = wallSegments(door, 50)
check('a door on the wall splits it: a door and the wall on each side', dw.filter((s) => s.kind === 'door').length === 1 && dw.filter((s) => s.kind === 'wall').length === 5 && dw.find((s) => s.kind === 'door')!.x1 === 150)
check('a door in the middle of two rooms is a doorway', (() => { const j = toggleDoor(joined, { x: 3, y: 1, side: 'w' }); const s = wallSegments(j, 10); return s.filter((x) => x.kind === 'door').length === 1 && s.some((x) => x.kind === 'door' && x.x1 === 30) })())
check('a door where there is no floor on either side is refused', toggleDoor(room, { x: 8, y: 6, side: 'n' }) === room)
check('a second click takes the door away', toggleDoor(door, { x: 3, y: 2, side: 'n' }).doors.length === 0)

const hall = paintCorridor(empty, 1, 1, 7, 5, 1)
check('a corridor goes along then across', isFloor(hall, 1, 1) && isFloor(hall, 7, 1) && isFloor(hall, 7, 5) && !isFloor(hall, 1, 5) && !isFloor(hall, 3, 3))
check('a wide corridor has width', isFloor(paintCorridor(empty, 1, 4, 8, 4, 3), 4, 3) && isFloor(paintCorridor(empty, 1, 4, 8, 4, 3), 4, 5))

const lit: MapDoc = { ...room, lights: [{ x: 3, y: 2, radius: 4, color: '#ffaa00' }] }
check('lights become bright and dim radius at the middle of their cell', JSON.stringify(tableLights(lit, 70, 5)) === JSON.stringify([{ x: 245, y: 175, bright: 20, dim: 40, color: '#ffaa00' }]))

check('a document is cleaned: bad items drop, numbers are bounded', (() => {
  const c = cleanDoc({ ...room, doors: [{ x: 3, y: 2, side: 'n' }, { x: 99, y: 2, side: 'n' }, { x: 1, y: 1, side: 'x' }], props: [{ x: 1, y: 1, kind: 'chest', turn: 5 }, { x: 1, y: 1, kind: 'bomb', turn: 0 }], lights: [{ x: 2, y: 2, radius: 900, color: 'red' }], theme: 'lava' })!
  return c.doors.length === 1 && c.props.length === 1 && c.props[0].turn === 1 && c.lights[0].radius === 30 && c.lights[0].color === '#ffd9a0' && c.theme === 'stone'
})())
check('a document that does not fit is refused', cleanDoc(null) === null && cleanDoc({ ...room, floor: ['0'] }) === null && cleanDoc({ ...room, floor: room.floor.map((r) => r + 'x') }) === null && cleanDoc({ ...room, v: 2 }) === null)
const small = resizeDoc({ ...room, doors: [{ x: 3, y: 2, side: 'n' }], lights: [{ x: 8, y: 6, radius: 3, color: '#ffffff' }] }, 6, 5)
check('resizing keeps what fits and drops what does not', small.cols === 6 && small.rows === 5 && isFloor(small, 4, 3) && small.doors.length === 1 && small.lights.length === 0 && small.floor.every((r) => r.length === 6) && resizeDoc(room, 20, 12).floor[11].length === 20)

// windows and secret doors
const hall2 = paintRect(emptyDoc(10, 8), 2, 2, 5, 4, true)
const win = toggleDoor(hall2, { x: 3, y: 2, side: 'n', kind: 'window' })
check('a window is a piece of wall that is a window', wallSegments(win, 10).filter((x) => x.kind === 'window').length === 1 && wallSegments(win, 10).filter((x) => x.kind === 'door').length === 0)
const sec = toggleDoor(win, { x: 3, y: 2, side: 'n', kind: 'secret' })
check('putting another kind on the same edge changes it', wallSegments(sec, 10).filter((x) => x.kind === 'secret').length === 1 && sec.doors.length === 1)
check('the same kind again takes it away', toggleDoor(sec, { x: 3, y: 2, side: 'n', kind: 'secret' }).doors.length === 0)
check('a door without a kind is a door, and kinds survive cleaning', wallSegments(toggleDoor(hall2, { x: 3, y: 2, side: 'n' }), 10).some((x) => x.kind === 'door') && cleanDoc(JSON.parse(JSON.stringify(sec)))!.doors[0].kind === 'secret' && cleanDoc(JSON.parse(JSON.stringify({ ...sec, doors: [{ x: 3, y: 2, side: 'n', kind: 'lava' }] })))!.doors[0].kind === undefined)

// freehand caves
const cave = paintBrush(emptyDoc(12, 12), 6, 6, 3, true)
check('a brush of one is one cell', paintBrush(emptyDoc(12, 12), 4, 4, 1, true).floor.join('').split('1').length - 1 === 1)
check('a round brush paints a blob around the cell', isFloor(cave, 6, 6) && isFloor(cave, 5, 6) && isFloor(cave, 6, 7) && !isFloor(cave, 9, 6) && cave.floor.join('').split('1').length - 1 >= 5)
check('and clears one', !isFloor(paintBrush(cave, 6, 6, 3, false), 6, 6))
check('a brush at the edge stays inside the map', paintBrush(emptyDoc(12, 12), 0, 0, 5, true).floor.every((r) => r.length === 12))
check('a stroke has no gaps', cellsBetween(0, 0, 5, 2).length === 6 && cellsBetween(2, 2, 2, 2).length === 1 && cellsBetween(5, 5, 0, 5).length === 6)

// a dungeon made by itself
const a = generateDungeon(7), b = generateDungeon(7), c = generateDungeon(8)
check('the same seed makes the same dungeon and another seed another', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c))
check('it has rooms, doors and lights, all inside the map', a.floor.join('').split('1').length - 1 > 60 && a.doors.length > 0 && a.lights.length > 0 && a.doors.every((d) => d.x >= 0 && d.y >= 0 && d.x < a.cols && d.y < a.rows) && cleanDoc(JSON.parse(JSON.stringify(a))) !== null)
check('a small map still works', cleanDoc(generateDungeon(3, 12, 10, 3)) !== null && generateDungeon(3, 5, 5, 20).floor.length === 5)
check('it can be turned into walls', wallSegments(a, 70).length > 10)
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
