import { multiplier, partyBudget, partyThresholds, pf2eBudget, pf2eCreatureXp, rate, xpOfCr } from '../web/src/tabletop/encounter'

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

// 2024: no multiplier, a budget per character
const b4 = partyBudget([3, 3, 3, 3])
check('the 2024 budget adds up per character', b4.low === 600 && b4.moderate === 900 && b4.high === 1600)
check('the 2024 budget at the checked levels', JSON.stringify(partyBudget([1])) === '{"low":50,"moderate":75,"high":100}' && JSON.stringify(partyBudget([5])) === '{"low":500,"moderate":750,"high":1100}' && JSON.stringify(partyBudget([10])) === '{"low":1600,"moderate":2300,"high":3100}' && JSON.stringify(partyBudget([20])) === '{"low":6400,"moderate":13200,"high":22000}')
let q = rate([{ xp: 50, count: 4 }], [3, 3, 3, 3], '5e-2024')
check('2024: four goblins are not multiplied and stay within the low budget', q.method === '5e-2024' && q.adjusted === 200 && q.difficulty === 'low')
q = rate([{ xp: 700, count: 1 }], [3, 3, 3, 3], '5e-2024')
check('2024: 700 XP is above the low budget of 600 and within moderate', q.difficulty === 'moderate')
q = rate([{ xp: 450, count: 2 }], [3, 3, 3, 3], '5e-2024')
check('2024: 900 XP is the top of moderate, 1,350 would be high', q.difficulty === 'moderate' && rate([{ xp: 450, count: 3 }], [3, 3, 3, 3], '5e-2024').difficulty === 'high')
check('2024: past the high budget is flagged', rate([{ xp: 700, count: 3 }], [3, 3, 3, 3], '5e-2024').difficulty === 'over')
check('2024: the same fight in 2014 is rated with the multiplier', rate([{ xp: 450, count: 2 }], [3, 3, 3, 3], '5e').difficulty === 'hard' && rate([{ xp: 450, count: 2 }], [3, 3, 3, 3]).method === '5e')
check('2024: no party, no rating', rate([{ xp: 50, count: 2 }], [], '5e-2024').difficulty === 'trivial')

// Pathfinder 2e: creature XP by level against the party, budgets for four characters, adjusted per character
check('pf2e creature XP by level difference', pf2eCreatureXp(1, 5) === 10 && pf2eCreatureXp(3, 5) === 20 && pf2eCreatureXp(5, 5) === 40 && pf2eCreatureXp(6, 5) === 60 && pf2eCreatureXp(9, 5) === 160 && pf2eCreatureXp(0, 5) === 0)
check('pf2e budget for four, and per character more or fewer', JSON.stringify(pf2eBudget(4)) === '{"trivial":40,"low":60,"moderate":80,"severe":120,"extreme":160}' && pf2eBudget(5).moderate === 100 && pf2eBudget(3).severe === 90 && pf2eBudget(5).extreme === 200)
let pf = rate([{ xp: 0, count: 2, level: 3 }], [3, 3, 3, 3], 'pf2e')
check('pf2e: two creatures of the party level are a moderate threat', pf.method === 'pf2e' && pf.total === 80 && pf.difficulty === 'moderate' && pf.partyLevel === 3)
check('pf2e: one creature of the party level is low, three are severe', rate([{ xp: 0, count: 1, level: 3 }], [3, 3, 3, 3], 'pf2e').difficulty === 'trivial' && rate([{ xp: 0, count: 3, level: 3 }], [3, 3, 3, 3], 'pf2e').difficulty === 'severe')
check('pf2e: a boss four levels up is extreme', rate([{ xp: 0, count: 1, level: 7 }], [3, 3, 3, 3], 'pf2e').difficulty === 'extreme')
check('pf2e: the party level is the rounded average', rate([{ xp: 0, count: 1, level: 4 }], [3, 3, 4, 4], 'pf2e').partyLevel === 4)
check('pf2e: a bigger party can take more: three creatures are severe for four but only moderate for six', rate([{ xp: 0, count: 3, level: 3 }], [3, 3, 3, 3, 3, 3], 'pf2e').difficulty === 'moderate')
check('pf2e: without a party there is no rating', rate([{ xp: 0, count: 2, level: 3 }], [], 'pf2e').difficulty === 'trivial')

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
