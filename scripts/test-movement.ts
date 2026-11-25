import { blockedPath as serverBlocked } from '../server/src/movement'
import { blockedPath, reach } from '../web/src/tabletop/movement'
import type { Wall } from '../web/src/tabletop/fog'
import type { GridSpec } from '../web/src/tabletop/grid'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const g: GridSpec = { grid: 'square', gridSize: 100, dist: 5, unit: 'ft', diagonal: '5-10-5' }
const wall = (kind: Wall['kind'], open = false): Wall => ({ id: kind, x1: 500, y1: 0, x2: 500, y2: 600, kind, open })
const a = { x: 250, y: 250 }, b = { x: 750, y: 250 }

check('a wall stops a token', blockedPath(a, b, [wall('wall')]))
check('a closed door stops a token, an open one does not', blockedPath(a, b, [wall('door')]) && !blockedPath(a, b, [wall('door', true)]))
check('a window stops a token although it lets light through', blockedPath(a, b, [wall('window')]))
check('a terrain wall lets a token walk past', !blockedPath(a, b, [wall('terrain')]))
check('a closed secret door is a wall, an open one is a way through', blockedPath(a, b, [wall('secret')]) && !blockedPath(a, b, [wall('secret', true)]))
check('a one-way wall stops a token from both sides', blockedPath(a, b, [wall('oneway')]) && blockedPath(b, a, [wall('oneway')]))
check('walking alongside a wall is not crossing it', !blockedPath({ x: 450, y: 50 }, { x: 450, y: 550 }, [wall('wall')]))
check('walking past the end of a wall is not crossing it', !blockedPath({ x: 250, y: 650 }, { x: 750, y: 650 }, [wall('wall')]))
check('staying put is never blocked', !blockedPath(a, a, [wall('wall')]))
check('the server and the browser agree', [a, { x: 450, y: 50 }, { x: 250, y: 650 }].every((p) => ['wall', 'door', 'window', 'terrain', 'secret', 'oneway'].every((k) => serverBlocked(p, b, [wall(k as Wall['kind'])]) === blockedPath(p, b, [wall(k as Wall['kind'])]))))

const stop = reach(a, b, 1, [wall('wall')], g)
check('a dragged token stops in the last cell before the wall', stop.x === 450 && stop.y === 250, JSON.stringify(stop))
check('with nothing in the way a dragged token goes all the way', JSON.stringify(reach(a, b, 1, [], g)) === JSON.stringify(b))
check('right up against a wall a token stays where it is', JSON.stringify(reach({ x: 450, y: 250 }, b, 1, [wall('wall')], g)) === JSON.stringify({ x: 450, y: 250 }))

if (failed) { console.log(`${failed} failed`); process.exit(1) }
console.log('all passed')
