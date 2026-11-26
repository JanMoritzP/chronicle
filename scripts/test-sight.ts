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

// one-way walls, areas the GM showed, and the other ways of seeing in the dark
const oneWay = [{ x1: 500, y1: 0, x2: 500, y2: 600, oneway: true }]
const pair = [tok('a', 200, 300, ['p1']), tok('beyond', 800, 300), tok('b', 800, 100, ['p2'])]
check('a one-way wall blocks the view from one side', names(visibleTokens(scene(), oneWay, pair, 'p1')) === 'a')
check('and not from the other', names(visibleTokens(scene(), oneWay, pair, 'p2')).includes('a'))
check('an area the GM showed is seen whatever the walls', names(visibleTokens(scene(), wallBetween, [tok('hero', 200, 300, ['p1']), tok('far', 800, 300)], 'p1', false, [{ x: 700, y: 200, w: 200, h: 200 }])) === 'far,hero')
check('but not a token outside it', !names(visibleTokens(scene(), wallBetween, [tok('hero', 200, 300, ['p1']), tok('far', 800, 300)], 'p1', false, [{ x: 0, y: 0, w: 100, h: 100 }])).includes('far'))
const sensed = [tok('hero', 200, 300, ['p1'], { vision: { blind: 30 } }), tok('near', 300, 300), tok('far', 900, 300)]
check('blindsight sees in the dark within its reach', names(visibleTokens(dim, [], sensed, 'p1')) === 'hero,near')
check('so does truesight', names(visibleTokens(dim, [], [tok('hero', 200, 300, ['p1'], { vision: { true: 30 } }), tok('near', 300, 300)], 'p1')) === 'hero,near')

// fog clouds and magical darkness placed with the light tool (100 px is 5 ft here)
const cloud = (kind: 'fog' | 'darkness', x = 500, radius = 10, y = 300) => tok('c', x, y, [], { obscure: { kind, radius } })
const lane = (data: SightToken['data'] = {}) => [tok('hero', 200, 300, ['p1'], data), tok('inside', 500, 300), tok('behind', 800, 300), tok('aside', 200, 80)]
check('a fog cloud hides what is in it and behind it', names(visibleTokens(scene(), [], [...lane(), cloud('fog')], 'p1')) === 'aside,hero')
check('so does magical darkness', names(visibleTokens(scene(), [], [...lane(), cloud('darkness')], 'p1')) === 'aside,hero')
check('darkvision does not see into magical darkness', names(visibleTokens(dim, [], [...lane({ vision: { dark: 120 } }), cloud('darkness')], 'p1')) === 'aside,hero')
check('truesight does', names(visibleTokens(dim, [], [...lane({ vision: { true: 120 } }), cloud('darkness')], 'p1')) === 'aside,behind,c,hero,inside')
check('but not into fog', names(visibleTokens(scene(), [], [...lane({ vision: { true: 120 } }), cloud('fog')], 'p1')) === 'aside,hero')
check('blindsight senses into fog within its reach', names(visibleTokens(scene(), [], [...lane({ vision: { blind: 20 } }), cloud('fog')], 'p1')) === 'aside,c,hero,inside')
check('a cloud that was lifted hides nothing', names(visibleTokens(scene(), [], [...lane(), tok('c', 500, 300, [], { obscure: { kind: 'fog', radius: 10, off: true } })], 'p1')) === 'aside,behind,c,hero,inside')
check('from inside a cloud a token sees only what is next to it', names(visibleTokens(scene(), [], [tok('hero', 500, 300, ['p1']), tok('next', 560, 300), tok('far', 700, 300), cloud('fog', 500, 30, 500)], 'p1')) === 'hero,next')

// the server copy of the maths matches the one the screen uses
const walls = [wall(100, 100, 400, 120), wall(400, 120, 420, 400), wall(50, 300, 300, 350)]
const a = serverVisibility({ x: 250, y: 220 }, walls, { x: 0, y: 0, w: 600, h: 500 }, 180)
const b = webVisibility({ x: 250, y: 220 }, walls, { x: 0, y: 0, w: 600, h: 500 }, 180)
check('the server and the browser compute the same view', a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-9 && Math.abs(p.y - b[i].y) < 1e-9))

// a cone of light and terrain walls
const lamp = [tok('hero', 200, 300, ['p1'], { vision: { sight: 5 } }), tok('ahead', 520, 300), tok('behind', 280, 300)]
const spot = [...lamp, tok('spot', 400, 300, [], { light: { bright: 20, dim: 30, angle: 60, dir: 90 } })]
const coneSeen = names(visibleTokens(scene({ darkness: 0.8 }), [], [...spot.slice(0, 3).map((t) => t.id === 'hero' ? tok('hero', 200, 300, ['p1'], { vision: { sight: null } }) : t), spot[3]], 'p1'))
check('a cone of light reaches ahead but not behind', coneSeen.includes('ahead') && !coneSeen.includes('behind'), coneSeen)
const hills = [{ x1: 400, y1: 0, x2: 400, y2: 600, limited: true }, { x1: 600, y1: 0, x2: 600, y2: 600, limited: true }]
const hero2 = tok('hero', 200, 300, ['p1'])
check('one terrain wall is seen past, a second one is not', names(visibleTokens(scene(), hills, [hero2, tok('past1', 500, 300), tok('past2', 800, 300)], 'p1')) === 'hero,past1')
// a token the whole party sees through
const lookout = tok('lookout', 700, 300, [], { sharedSight: true })
check('a token that shares its sight shows the party what it sees', names(visibleTokens(scene(), [], [tok('hero', 200, 300, ['p1']), lookout, tok('farther', 800, 300)], 'p1')) === 'farther,hero,lookout' && names(visibleTokens(scene(), [wall(500, 0, 500, 600)], [tok('hero', 200, 300, ['p1']), lookout, tok('farther', 800, 300)], 'p1')) === 'farther,hero,lookout')
check('without it the same token is just another creature behind a wall', names(visibleTokens(scene(), [wall(500, 0, 500, 600)], [tok('hero', 200, 300, ['p1']), tok('lookout', 700, 300), tok('farther', 800, 300)], 'p1')) === 'hero')
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
