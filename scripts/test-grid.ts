import { formatDistance, inTemplate, measure, snap, type GridSpec } from '../web/src/tabletop/grid'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const sq = (diagonal: GridSpec['diagonal'] = '5-10-5'): GridSpec => ({ grid: 'square', gridSize: 70, dist: 5, unit: 'ft', diagonal })
const line = (...cells: [number, number][]) => cells.map(([x, y]) => ({ x: x * 70 + 35, y: y * 70 + 35 }))

// snapping
check('a one-cell token snaps to the cell centre', JSON.stringify(snap({ x: 100, y: 10 }, 1, sq())) === JSON.stringify({ x: 105, y: 35 }))
check('a two-cell token snaps to a corner', JSON.stringify(snap({ x: 100, y: 10 }, 2, sq())) === JSON.stringify({ x: 70, y: 0 }))
check('a three-cell token centres on a cell', snap({ x: 0, y: 0 }, 3, sq()).x === 35)
check('no grid does not snap', snap({ x: 12.3, y: 45.6 }, 1, { ...sq(), grid: 'none' }).x === 12.3)

// square distances
check('straight line of 6 cells is 30 ft', measure(line([0, 0], [6, 0]), sq()).distance === 30)
check('5-5-5: a diagonal costs one cell', measure(line([0, 0], [3, 3]), sq('5-5-5')).distance === 15)
check('5-10-5: two diagonals cost three cells', measure(line([0, 0], [2, 2]), sq()).distance === 15)
check('5-10-5: three diagonals cost four cells', measure(line([0, 0], [3, 3]), sq()).distance === 20)
check('5-10-5: the count carries over a corner', measure(line([0, 0], [1, 1], [2, 2]), sq()).distance === 15)
check('5-10-5: 4 across and 2 down is 5 cells', measure(line([0, 0], [4, 2]), sq()).cells === 5)
check('manhattan counts both axes', measure(line([0, 0], [3, 3]), sq('manhattan')).cells === 6)
check('euclid uses the straight length', Math.abs(measure(line([0, 0], [3, 4]), sq('euclid')).cells - 5) < 1e-9)
check('a single point has no length', measure(line([0, 0]), sq()).distance === 0)
check('format', formatDistance(15, 'ft') === '15 ft' && formatDistance(7.5, 'm') === '7.5 m')

// hexes
const hex = (grid: 'hex-row' | 'hex-col'): GridSpec => ({ grid, gridSize: 100, dist: 5, unit: 'mi', diagonal: '5-5-5' })
const h0 = snap({ x: 3, y: 4 }, 1, hex('hex-row'))
check('hex snap lands on a centre', h0.x === 0 && h0.y === 0)
const h1 = snap({ x: 110, y: 5 }, 1, hex('hex-row'))
check('hex rows: the next centre is one grid size to the right', h1.x === 100 && h1.y === 0)
const h2 = snap({ x: 50, y: 90 }, 1, hex('hex-row'))
check('hex rows: odd rows shift half a cell', Math.abs(h2.x - 50) < 1e-9 && Math.abs(h2.y - 86.60254) < 1e-3)
check('hex distance between neighbours is one step', measure([h0, h1], hex('hex-row')).cells === 1 && measure([h0, h2], hex('hex-row')).cells === 1)
check('hex distance of three steps in a line', measure([{ x: 0, y: 0 }, { x: 300, y: 0 }], hex('hex-row')).cells === 3)
const f1 = snap({ x: 90, y: 40 }, 1, hex('hex-col'))
check('hex columns: flat-top spacing', Math.abs(f1.x - 86.60254) < 1e-3 && f1.y === 50)
check('hex columns: three steps down', measure([{ x: 0, y: 0 }, { x: 0, y: 300 }], hex('hex-col')).cells === 3)

const O = { x: 0, y: 0 }
check('a burst reaches its radius all round', inTemplate('blast', O, { x: 100, y: 0 }, { x: -90, y: 0 }, 50) && !inTemplate('blast', O, { x: 100, y: 0 }, { x: 0, y: 101 }, 50))
check('a cone widens to half its length each side', inTemplate('cone', O, { x: 100, y: 0 }, { x: 100, y: 49 }, 50) && !inTemplate('cone', O, { x: 100, y: 0 }, { x: 100, y: 51 }, 50) && !inTemplate('cone', O, { x: 100, y: 0 }, { x: -1, y: 0 }, 50))
check('a cone has no width at its point', !inTemplate('cone', O, { x: 100, y: 0 }, { x: 10, y: 20 }, 50) && inTemplate('cone', O, { x: 100, y: 0 }, { x: 10, y: 4 }, 50))
check('a ray is one cell wide', inTemplate('beam', O, { x: 200, y: 0 }, { x: 150, y: 25 }, 50) && !inTemplate('beam', O, { x: 200, y: 0 }, { x: 150, y: 26 }, 50) && !inTemplate('beam', O, { x: 200, y: 0 }, { x: 201, y: 0 }, 50))
check('a cube is as wide as it is long', inTemplate('cube', O, { x: 0, y: 100 }, { x: 50, y: 50 }, 50) && !inTemplate('cube', O, { x: 0, y: 100 }, { x: 51, y: 50 }, 50))
check('it works at an angle', inTemplate('cone', O, { x: 0, y: -100 }, { x: 0, y: -80 }, 50) && !inTemplate('cone', O, { x: 0, y: -100 }, { x: 80, y: 0 }, 50))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
