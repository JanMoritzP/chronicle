import { multiplier, partyThresholds, rate, xpOfCr } from '../web/src/tabletop/encounter'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

check('XP by challenge rating', xpOfCr(0.25) === 50 && xpOfCr(1) === 200 && xpOfCr(5) === 1800 && xpOfCr(30) === 155000 && xpOfCr(undefined) === 0)
const party = partyThresholds([3, 3, 3, 3])
check('thresholds add up per character', party.easy === 300 && party.medium === 600 && party.hard === 900 && party.deadly === 1600)
check('levels are kept between 1 and 20', partyThresholds([0]).easy === 25 && partyThresholds([99]).deadly === 12700)

check('multipliers by number of monsters', multiplier(1, 4) === 1 && multiplier(2, 4) === 1.5 && multiplier(3, 4) === 2 && multiplier(6, 4) === 2 && multiplier(7, 4) === 2.5 && multiplier(11, 4) === 3 && multiplier(15, 4) === 4)
check('a small party feels a crowd more', multiplier(1, 2) === 1.5 && multiplier(3, 2) === 2.5)
check('a large party feels it less', multiplier(2, 6) === 1 && multiplier(1, 6) === 0.5)
check('no monsters, no multiplier', multiplier(0, 4) === 0)

// four level 3 characters against four goblins (CR 1/4, 50 XP each): 200 XP x2 = 400 is easy
let r = rate([{ xp: 50, count: 4 }], [3, 3, 3, 3])
check('four goblins are an easy fight for four level 3s', r.total === 200 && r.adjusted === 400 && r.difficulty === 'easy' && r.perCharacter === 50)
// one ogre (CR 2, 450 XP): medium needs 600 -> easy
r = rate([{ xp: 450, count: 1 }], [3, 3, 3, 3])
check('one ogre is easy', r.adjusted === 450 && r.difficulty === 'easy')
r = rate([{ xp: 450, count: 2 }], [3, 3, 3, 3])
check('two ogres: 900 x1.5 = 1350 is hard', r.adjusted === 1350 && r.difficulty === 'hard')
r = rate([{ xp: 700, count: 2 }], [3, 3, 3, 3])
check('two CR 3 monsters are deadly', r.adjusted === 2100 && r.difficulty === 'deadly')
r = rate([{ xp: 10, count: 1 }], [10, 10, 10, 10])
check('a fight far below easy is trivial', r.difficulty === 'trivial')
check('without a party it cannot be rated', rate([{ xp: 50, count: 2 }], []).difficulty === 'trivial')

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
