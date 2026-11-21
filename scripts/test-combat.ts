import { advance, emptyCombat, end, ordered, start, visible, withList, type Combat, type Combatant } from '../server/src/combat'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const c = (id: string, init: number | null, over: Partial<Combatant> = {}): Combatant => ({ id, tokenId: null, name: id, init, hidden: false, done: false, ...over })
const names = (x: Combat) => x.list.map((y) => y.id).join()

check('highest first, unrolled last, ties in the order added', ordered([c('a', 10), c('b', null), c('c', 15), c('d', 10)]).map((x) => x.id).join() === 'c,a,d,b')

let k = withList(emptyCombat(), [c('a', 10), c('b', 18), c('c', 14)])
check('the list is sorted', names(k) === 'b,c,a')
k = start(k)
check('starting begins round 1 with the highest', k.active && k.round === 1 && k.turn === 'b')
k = advance(k, 1)
check('next moves down the order', k.turn === 'c' && k.round === 1)
k = advance(advance(k, 1), 1)
check('after the last it wraps and the round counts up', k.turn === 'b' && k.round === 2)
k = advance(k, -1)
check('previous goes back across the round', k.turn === 'a' && k.round === 1)
k = advance(advance(advance(k, -1), -1), -1)
check('it never goes before round 1', k.round === 1 && k.turn === 'b')

check('starting with nobody rolled does nothing', !start(withList(emptyCombat(), [c('a', null)])).active)
k = start(withList(emptyCombat(), [c('a', 10), c('b', 18), c('c', 14)]))
k = withList(k, k.list.map((x) => (x.id === 'c' ? { ...x, done: true } : x)))
k = advance(k, 1)
check('defeated combatants are skipped', k.turn === 'a')
k = start(withList(emptyCombat(), [c('a', 10), c('b', 18)]))
k = withList(k, k.list.filter((x) => x.id !== 'b'))
check('removing the one whose turn it is passes play on', k.turn === 'a')
k = withList(k, [c('a', 10), c('z', 25)])
check('a new highest does not steal the turn', k.turn === 'a' && names(k) === 'z,a')
check('ending resets', !end(k).active && end(k).round === 0 && end(k).turn === null && end(k).list.length === 2)
check('advancing when not started does nothing', advance(emptyCombat(), 1).turn === null)

const h = withList(emptyCombat(), [c('a', 10), c('ogre', 20, { hidden: true }), c('b', 5)])
const started = start(h)
check('the GM sees everyone', visible(started, true).list.length === 3 && visible(started, true).turn === 'ogre')
check('players do not see hidden combatants, nor a hidden turn', visible(started, false).list.length === 2 && visible(started, false).turn === null)

const r0 = withList(emptyCombat(), [c('a', 20), c('b', 10)])
const r1 = start(r0)
const spent = { ...r1, list: r1.list.map((x) => ({ ...x, reaction: true })) }
const r2 = advance(spent, 1)
check('a combatant whose turn begins has their reaction back', r2.list.find((x) => x.id === 'b')!.reaction === false && r2.list.find((x) => x.id === 'a')!.reaction === true)
check('going back a turn leaves reactions as they were', advance(r2, -1).list.every((x) => x.reaction === r2.list.find((y) => y.id === x.id)!.reaction))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
