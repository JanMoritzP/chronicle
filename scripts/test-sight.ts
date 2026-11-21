import { foggy, visibleTokens, type SightScene, type SightToken } from '../server/src/sight'
import { visibility as serverVisibility } from '../server/src/visibility'
import { visibility as webVisibility } from '../web/src/tabletop/visibility'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const scene = (over: Partial<SightScene> = {}): SightScene => ({ width: 1000, height: 600, gridSize: 100, dist: 5, fog: true, darkness: 0, ...over })
const tok = (id: string, x: number, y: number, owners: string[] = [], data: SightToken['data'] = {}): SightToken => ({ id, x, y, owners, data })
const wall = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 })
const names = (s: Set<string> | null) => (s ? [...s].sort().join() : 'all')

const wallBetween = [wall(500, 0, 500, 600)]
const tokens = [tok('hero', 200, 300, ['p1']), tok('near', 350, 300), tok('far', 800, 300), tok('mine2', 100, 500, ['p1'])]

check('a scene without fog or darkness filters nothing', visibleTokens(scene({ fog: false }), wallBetween, tokens, 'p1') === null && !foggy(scene({ fog: false })) && foggy(scene({ fog: false, darkness: 0.5 })))
check('a token in view is sent and one behind a wall is not', names(visibleTokens(scene(), wallBetween, tokens, 'p1')) === 'hero,mine2,near')
check('with no wall everything in daylight is in view', names(visibleTokens(scene(), [], tokens, 'p1')) === 'far,hero,mine2,near')
check('a person with no token of their own sees no other token', names(visibleTokens(scene(), [], tokens, 'nobody')) === '')
check("a player's own tokens are always sent, even where they cannot see themselves", names(visibleTokens(scene(), [], [tok('x', 5, 5, ['p1'], { vision: { sight: 0.001 } })], 'p1')) === 'x')

// sight range
const short = [tok('hero', 200, 300, ['p1'], { vision: { sight: 25 } }), tok('close', 300, 300), tok('distant', 800, 300)]
check('a limited sight range cuts the view', names(visibleTokens(scene(), [], short, 'p1')) === 'close,hero')

// darkness: nothing is seen without light
const dim = scene({ darkness: 0.8 })
check('in the dark an unlit token is not sent', names(visibleTokens(dim, [], tokens, 'p1')) === 'hero,mine2')
const torch = [...tokens, tok('torch', 380, 300, [], { light: { bright: 5, dim: 10 } })]
check('a light makes what it reaches visible', names(visibleTokens(dim, [], torch, 'p1')) === 'hero,mine2,near,torch')
check('but not through a wall', names(visibleTokens(dim, [wall(330, 0, 330, 600)], torch, 'p1')) === 'hero,mine2')
const dv = [tok('hero', 200, 300, ['p1'], { vision: { dark: 30 } }), tok('near', 300, 300), tok('far', 900, 300)]
check('darkvision sees in the dark, but only so far', names(visibleTokens(dim, [], dv, 'p1')) === 'hero,near')
check('a hidden torch still gives light', names(visibleTokens(dim, [], torch.map((t) => (t.id === 'torch' ? { ...t, owners: [] } : t)), 'p1')).includes('near'))
check("someone else's light does not light a token that their own wall hides", names(visibleTokens(dim, [wall(360, 0, 360, 600)], torch, 'p1')) === 'hero,mine2')

// shared vision: the party sees through every player's token
const party = [tok('a', 100, 300, ['p1']), tok('b', 800, 300, ['p2']), tok('foe', 850, 300), tok('near', 150, 300)]
const wallMid = [wall(500, 0, 500, 600)]
check('without shared vision a player only sees through their own tokens', names(visibleTokens(scene(), wallMid, party, 'p1')) === 'a,near')
check('with it they also see what a friend sees', names(visibleTokens(scene(), wallMid, party, 'p1', true)) === 'a,b,foe,near')
check('a person with no token sees through the tokens of the party', names(visibleTokens(scene(), wallMid, party, 'nobody', true)) === 'a,b,foe,near')

// the server copy of the maths matches the one the screen uses
const walls = [wall(100, 100, 400, 120), wall(400, 120, 420, 400), wall(50, 300, 300, 350)]
const a = serverVisibility({ x: 250, y: 220 }, walls, { x: 0, y: 0, w: 600, h: 500 }, 180)
const b = webVisibility({ x: 250, y: 220 }, walls, { x: 0, y: 0, w: 600, h: 500 }, 180)
check('the server and the browser compute the same view', a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-9 && Math.abs(p.y - b[i].y) < 1e-9))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
