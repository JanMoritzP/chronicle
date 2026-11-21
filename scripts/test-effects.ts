import { effectSchema, effectsOf, modsOf, tick, type ActiveEffect } from '../server/src/effects'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const bless: ActiveEffect = { id: 'a', name: 'Bless', rounds: 10, attack: '+1d4', save: '+1d4', concentration: true, from: 't1' }
const shield: ActiveEffect = { id: 'b', name: 'Shield of Faith', rounds: 100, ac: 2 }
const bane: ActiveEffect = { id: 'c', name: 'Bane', rounds: 2, attack: '-1d4' }

check('bonuses add up', modsOf([bless, shield, bane]).ac === 2 && modsOf([bless, shield, bane]).attack === '+1d4-1d4' && modsOf([bless]).save === '+1d4')
check('no effects change nothing', modsOf([]).ac === 0 && modsOf([]).attack === '')

const t1 = tick([bless, bane, { id: 'd', name: 'Mark', rounds: null }])
check('a round takes one off', t1.kept.find((e) => e.id === 'a')!.rounds === 9)
check('one that reaches 0 is over', tick(t1.kept).ended.map((e) => e.name).join() === 'Bane')
check('one with no end stays', t1.kept.some((e) => e.id === 'd') && tick(t1.kept).kept.some((e) => e.id === 'd'))
check('ticking does not change what went in', bless.rounds === 10)

check('a bonus must be a signed number or die', effectSchema.safeParse({ name: 'x', attack: '+1d4' }).success && !effectSchema.safeParse({ name: 'x', attack: '1d4' }).success && !effectSchema.safeParse({ name: 'x', attack: '+1d4; drop table' }).success)
check('a name is needed', !effectSchema.safeParse({ name: '  ' }).success)
check('stored effects are read back, and junk is ignored', effectsOf({ effects: [{ id: 'z', name: 'Bless', rounds: 3 }, { name: 'no id' }, 'junk', { id: 'y', name: 'x', attack: 'bad' }] }).map((e) => e.id).join() === 'z' && effectsOf({}).length === 0)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
