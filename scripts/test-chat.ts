import { degreeOf, parseChat, readable } from '../server/src/chat'
import type { Rng } from '../server/src/dice'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }
const fixed = (...v: number[]): Rng => { let i = 0; return () => v[Math.min(i++, v.length - 1)] }

let p = parseChat('hello there', fixed(1)) as any
check('plain talk', p.kind === 'say' && p.parts.length === 1 && p.parts[0].text === 'hello there')
p = parseChat('/roll 1d20+5 stealth', fixed(10)) as any
check('/roll', p.kind === 'roll' && p.parts[0].roll.total === 15 && p.parts[0].roll.label === 'stealth')
p = parseChat('/r 2d6', fixed(3, 4)) as any
check('/r is short for /roll', p.kind === 'roll' && p.parts[0].roll.total === 7)
p = parseChat('/gmroll 1d20', fixed(9)) as any
check('/gmroll is for the GM', p.kind === 'gmroll')
p = parseChat('/me draws a sword', fixed(1)) as any
check('/me is an emote', p.kind === 'emote' && p.parts[0].text === 'draws a sword')
p = parseChat('/w Alice psst, the door is trapped', fixed(1)) as any
check('/w names a person and keeps the message', p.kind === 'whisper' && p.to === 'Alice' && p.parts[0].text === 'psst, the door is trapped')
p = parseChat('I attack for [[1d8+3]] damage and [[2d6]] more', fixed(5, 2, 3)) as any
check('rolls inside text', p.kind === 'say' && p.parts.map((x: any) => x.t).join() === 'text,roll,text,roll,text' && p.parts[1].roll.total === 8 && p.parts[3].roll.total === 5)
p = parseChat('see [[not a roll]] ok', fixed(1)) as any
check('inline text that is not a roll stays text', p.parts.length === 1 && p.parts[0].text === 'see [[not a roll]] ok')
check('a bad roll explains itself', 'error' in (parseChat('/roll hello') as any))
check('an unknown command is an error', (parseChat('/dance') as any).error.includes('Unknown'))
check('nothing is an error', 'error' in (parseChat('   ') as any))
check('/w without a message is an error', 'error' in (parseChat('/w Alice') as any))
check('/me alone is an error', 'error' in (parseChat('/me') as any))

const msg = (kind: any, userId = 'a', to: string[] = []) => ({ kind, userId, to })
check('talk is read by everyone', readable(msg('say'), 'z', false) && readable(msg('roll'), 'z', false) && readable(msg('emote'), 'z', false))
check('a whisper is read by its two people only', readable(msg('whisper', 'a', ['b']), 'a', false) && readable(msg('whisper', 'a', ['b']), 'b', false) && !readable(msg('whisper', 'a', ['b']), 'c', false) && !readable(msg('whisper', 'a', ['b']), 'c', true))
check('a GM roll is read by the GMs and the roller', readable(msg('gmroll', 'a'), 'a', false) && readable(msg('gmroll', 'a'), 'g', true) && !readable(msg('gmroll', 'a'), 'p', false))

// degrees of success
check('pf2e: ten over is a critical success, meeting the DC a success', degreeOf(30, 20, null, 'pf2e') === 'critical success' && degreeOf(20, 20, null, 'pf2e') === 'success' && degreeOf(25, 20, null, 'pf2e') === 'success')
check('pf2e: under is a failure, ten under a critical failure', degreeOf(19, 20, null, 'pf2e') === 'failure' && degreeOf(10, 20, null, 'pf2e') === 'critical failure' && degreeOf(11, 20, null, 'pf2e') === 'failure')
check('pf2e: a natural 20 raises a step and a natural 1 lowers one', degreeOf(15, 20, 'hit', 'pf2e') === 'success' && degreeOf(25, 20, 'hit', 'pf2e') === 'critical success' && degreeOf(20, 20, 'miss', 'pf2e') === 'failure' && degreeOf(5, 20, 'miss', 'pf2e') === 'critical failure')
check('5e knows only success and failure', degreeOf(30, 15, null, '5e') === 'success' && degreeOf(14, 15, null, '5e') === 'failure' && degreeOf(15, 15, null, '5e-2024') === 'success')
const dp = parseChat('/roll 1d20+10 Stealth dc 18', fixed(12), 'pf2e') as any
check('a roll with a DC in its label is judged', dp.parts[0].roll.total === 22 && dp.parts[0].roll.dc === 18 && dp.parts[0].roll.degree === 'success')
check('a roll without one is not', (parseChat('/roll 1d20+10 Stealth', fixed(12), 'pf2e') as any).parts[0].roll.degree === undefined)
check('the same roll in 5e', (parseChat('/roll 1d20+4 dc 20', fixed(12), '5e') as any).parts[0].roll.degree === 'failure')

const asNpc = parseChat('/as "Old Mara" Welcome, travellers.') as any
check('the GM can speak as someone, with or without quotes', asNpc.as === 'Old Mara' && asNpc.kind === 'say' && asNpc.parts[0].text === 'Welcome, travellers.' && (parseChat('/as Mara hello') as any).as === 'Mara')
check('speaking as nobody is an error', 'error' in (parseChat('/as') as any) && 'error' in (parseChat('/as Mara') as any))
const ooc = parseChat('/ooc back in two minutes') as any
check('out of character talk has its own kind', ooc.kind === 'ooc' && ooc.parts[0].text === 'back in two minutes' && (parseChat('/o hi') as any).kind === 'ooc' && 'error' in (parseChat('/ooc') as any))
check('everyone can read it', readable({ kind: 'ooc', userId: 'a', to: [] }, 'b', false))

p = parseChat('/card Longsword | Attack: [[1d20+5 dc 14]] | Damage: [[1d8+3]] slashing | Pommel strike', fixed(10, 4)) as any
check('/card makes a titled card of lines', p.kind === 'say' && p.parts.length === 1 && p.parts[0].t === 'card' && p.parts[0].title === 'Longsword' && p.parts[0].rows.length === 3)
check('a line with a label keeps it and its roll', p.parts[0].rows[0].label === 'Attack' && p.parts[0].rows[0].parts[0].roll.total === 15 && p.parts[0].rows[0].parts[0].roll.degree === 'success')
check('text after a roll stays on its line', p.parts[0].rows[1].parts.map((x: any) => x.t).join() === 'roll,text' && p.parts[0].rows[1].parts[1].text.trim() === 'slashing')
check('a line without a label is plain text', p.parts[0].rows[2].label === '' && p.parts[0].rows[2].parts[0].text === 'Pommel strike')
p = parseChat('&{template:default} {{name=Fire bolt}} {{Hit=[[1d20+6]]}} {{Damage=[[1d10]] fire}}', fixed(3, 7)) as any
check('the Roll20 template form works too', p.parts[0].t === 'card' && p.parts[0].title === 'Fire bolt' && p.parts[0].rows.length === 2 && p.parts[0].rows[0].parts[0].roll.total === 9)
check('a card needs a title', 'error' in (parseChat('/card') as any))
check('a card holds at most twelve lines', 'error' in (parseChat('/card Many | ' + Array.from({ length: 13 }, (_, i) => `r${i}: [[1d4]]`).join(' | ')) as any))
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
