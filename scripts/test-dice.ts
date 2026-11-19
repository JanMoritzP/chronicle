import { describe, parseRoll, type Rng } from '../server/src/dice'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

/** A die that returns the given values in order, then repeats the last. */
const fixed = (...values: number[]): Rng => { let i = 0; return () => values[Math.min(i++, values.length - 1)] }

let r = parseRoll('1d20+5', fixed(14))!
check('a plain roll', r.total === 19 && r.expr === '1d20+5' && r.label === '')
r = parseRoll('d20', fixed(7))!
check('the count defaults to one', r.total === 7)
r = parseRoll('2d6 + 1d4 - 2', fixed(3, 4, 2))!
check('several terms and a minus', r.total === 7 && r.terms.length === 3)
r = parseRoll('3', fixed(1))!
check('a bare number', r.total === 3)
r = parseRoll('1d20+4 stealth check', fixed(10))!
check('the rest is the label', r.total === 14 && r.label === 'stealth check' && r.expr === '1d20+4')
check('not a roll', parseRoll('hello there') === null && parseRoll('') === null && parseRoll('+') === null)
r = parseRoll('4d6dl1', fixed(6, 5, 1, 4))!
check('drop lowest', r.total === 15 && r.terms[0].kind === 'dice' && r.terms[0].dice.filter((d) => d.dropped).length === 1)
r = parseRoll('4d6kh3', fixed(6, 5, 1, 4))!
check('keep highest', r.total === 15)
r = parseRoll('2d20kl1', fixed(12, 3))!
check('keep lowest', r.total === 3)
r = parseRoll('3d6dh1', fixed(6, 2, 4))!
check('drop highest', r.total === 6)
r = parseRoll('1d6!', fixed(6, 6, 2))!
check('exploding dice roll again on the highest face', r.total === 14 && r.terms[0].kind === 'dice' && r.terms[0].dice.length === 3 && r.terms[0].dice[1].extra === true)
r = parseRoll('d%', fixed(42))!
check('percentile', r.total === 42 && r.terms[0].kind === 'dice' && r.terms[0].sides === 100)
r = parseRoll('1d20+3 adv', fixed(4, 17))!
check('advantage keeps the best of two', r.total === 20 && r.expr === '1d20+3 adv')
r = parseRoll('1d20+3 dis fire', fixed(4, 17))!
check('disadvantage keeps the worst, label follows', r.total === 7 && r.label === 'fire')
r = parseRoll('1d20', fixed(20))!
check('a natural 20 is a hit', r.crit === 'hit')
r = parseRoll('1d20+9', fixed(1))!
check('a natural 1 is a miss', r.crit === 'miss')
r = parseRoll('2d20kh1', fixed(1, 20))!
check('crit looks at the kept die', r.crit === 'hit')
r = parseRoll('2d6', fixed(6, 6))!
check('other dice are never crits', r.crit === null)
check('too many dice are refused', parseRoll('101d6') === null && parseRoll('1d1001') === null && parseRoll('1d1') === null && parseRoll('100d6+100d6+100d6+100d6+100d6+100d6') === null)
r = parseRoll('2d20kh1+5', fixed(17, 4))!
check('describe shows dropped dice', describe(r) === '2d20kh1+5 = [17, ~4~] + 5 = 22', describe(r))

// the real random source stays inside the faces
let ok = true
for (let i = 0; i < 500; i++) { const x = parseRoll('1d20')!; if (x.total < 1 || x.total > 20) ok = false }
check('real dice stay between 1 and 20', ok)
const seen = new Set<number>()
for (let i = 0; i < 400; i++) seen.add(parseRoll('1d6')!.total)
check('real dice show every face', seen.size === 6)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
