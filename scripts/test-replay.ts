import { describe, mainScene, standingAt, type ReplayEvent } from '../web/src/tabletop/replay'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const ev: ReplayEvent[] = [
  { ts: 1, kind: 'scene', scene: 'A', name: 'Crypt' },
  { ts: 2, kind: 'move', scene: 'A', id: 't1', name: 'Aria', x: 200, y: 100, fx: 100, fy: 100 },
  { ts: 3, kind: 'add', scene: 'A', id: 't2', name: 'Orc', x: 400, y: 300, hidden: true },
  { ts: 4, kind: 'move', scene: 'A', id: 't1', name: 'Aria', x: 300, y: 100, fx: 200, fy: 100 },
  { ts: 5, kind: 'hp', scene: 'A', id: 't2', name: 'Orc', value: 4, max: 15 },
  { ts: 6, kind: 'move', scene: 'B', id: 't9', name: 'Elsewhere', x: 5, y: 5, fx: 1, fy: 1 },
  { ts: 7, kind: 'remove', scene: 'A', id: 't2', name: 'Orc' },
]
const at = (n: number) => standingAt(ev, n, 'A')
check('nothing stands anywhere before the first event', at(0).length === 0 && at(1).length === 0)
check('a token that was already there first stands where its first move left from', standingAt([{ ts: 1, kind: 'move', scene: 'A', id: 'q', name: 'Q', x: 50, y: 60, fx: 10, fy: 20 }], 0, 'A').length === 0 && standingAt([{ ts: 1, kind: 'move', scene: 'A', id: 'q', name: 'Q', x: 50, y: 60, fx: 10, fy: 20 }], 1, 'A')[0].x === 50)
check('after its first move it stands at the new place', at(2).find((t) => t.id === 't1')?.x === 200)
check('a token put down appears where it was put, hidden or not', at(3).find((t) => t.id === 't2')?.hidden === true && at(3).find((t) => t.id === 't2')?.x === 400)
check('later moves take it further', at(4).find((t) => t.id === 't1')?.x === 300)
check('hit points follow the token', at(5).find((t) => t.id === 't2')?.hp === 4 && at(5).find((t) => t.id === 't2')?.hpMax === 15)
check('only the scene asked for is shown', at(6).every((t) => t.id !== 't9') && standingAt(ev, 6, 'B').map((t) => t.id).join() === 't9')
check('a token taken away is gone', at(7).every((t) => t.id !== 't2') && at(7).length === 1)
check('playing back from the middle gives the same as playing from the start', JSON.stringify(standingAt(ev, 4, 'A')) === JSON.stringify(standingAt(ev.slice(0), 4, 'A')))
check('the scene where most happened is the one to show', mainScene(ev) === 'A' && mainScene([{ ts: 1, kind: 'scene', scene: 'Z', name: 'Z' }]) === 'Z' && mainScene([]) === null)
check('events are told in words', describe(ev[1]) === 'Aria moves' && describe(ev[4]) === 'Orc is at 4 of 15 hit points' && describe(ev[0]) === 'The table moves to Crypt' && describe({ ts: 1, kind: 'add', scene: null }) === 'A token is put on the map')

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
