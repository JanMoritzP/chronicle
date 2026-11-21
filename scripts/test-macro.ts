import { docText } from '../web/src/lib/docText'
import { macroLineOf, fillQueries, linesOf, queriesIn, refValue, resolveRefs } from '../web/src/lib/macro'
import { emptyCharacter } from '../web/src/lib/sheet'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const q = queriesIn('/roll 1d20+?{Bonus|0} attack\n/roll ?{Damage|1d8}+?{Bonus|0}\n/me ?{Stance|Careful|Bold|Wild}s')
check('questions are found once each, in order', q.map((x) => x.prompt).join() === 'Bonus,Damage,Stance')
check('a question with options lists them', q[2].options.join() === 'Careful,Bold,Wild' && q[0].options.join() === '0')
check('answers are put in place', fillQueries('1d20+?{Bonus|0} and ?{Bonus|0}', { '?{Bonus|0}': '5' }) === '1d20+5 and 5')
check('an unanswered question is left blank', fillQueries('x?{Why|}y', {}) === 'xy')
check('text without questions has none', queriesIn('/roll 1d20').length === 0)

const sheet = { ...emptyCharacter('5e'), abilities: { str: 16, dex: 14, con: 12, int: 8, wis: 10, cha: 10 }, classes: [{ name: 'Fighter', level: 5 }] }
const sel = { name: 'Aria', hp: 12, maxhp: 30, ac: 16, sheet }
check('the selected token can be read', refValue('name', sel) === 'Aria' && refValue('hp', sel) === '12' && refValue('maxhp', sel) === '30' && refValue('ac', sel) === '16')
check('and its sheet', refValue('str_mod', sel) === '3' && refValue('int_mod', sel) === '-1' && refValue('dex', sel) === '14' && refValue('level', sel) === '5' && refValue('prof', sel) === '3')
check('an unknown key gives nothing', refValue('luck', sel) === null && refValue('str_mod', { name: 'x' }) === null)
const r = resolveRefs('/roll 1d20+@{selected|str_mod}+@{selected|prof} @{selected|name}', sel)
check('references are replaced', r.text === '/roll 1d20+3+3 Aria' && r.missing.length === 0)
const r2 = resolveRefs('@{selected|name} @{selected|luck}', sel)
check('what cannot be filled is reported and left', r2.missing.join() === '@{selected|luck}' && r2.text.includes('@{selected|luck}'))
check('with nothing selected every reference is missing', resolveRefs('@{selected|name}', null).missing.length === 1)
check('lines are trimmed, blank ones dropped and the number capped', linesOf(' /roll 1d20 \n\n/me hits\r\n') .join('|') === '/roll 1d20|/me hits' && linesOf('a\n'.repeat(30)).length === 10)

const page = { type: 'doc', content: [
  { type: 'heading', content: [{ type: 'text', text: 'The vault' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Under the ' }, { type: 'text', text: 'chapel', marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: 'second line' }] },
  { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a key' }] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a coin' }] }] }] },
] }
check('a page becomes plain text, a line to each block', docText(page) === 'The vault\nUnder the chapel\nsecond line\n• a key\n• a coin')
check('nothing gives nothing, and the length is capped', docText(null) === '' && docText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(50) }] }] }, 10).length === 10)

const roll = (expr: string, label = '') => ({ t: 'roll', roll: { expr, label } })
check('a roll message becomes a /roll line', macroLineOf({ kind: 'roll', parts: [roll('1d20+5', 'stealth')] }) === '/roll 1d20+5 stealth' && macroLineOf({ kind: 'gmroll', parts: [roll('1d20')] }) === '/gmroll 1d20')
check('talk with rolls inside keeps them in double brackets', macroLineOf({ kind: 'say', parts: [{ t: 'text', text: 'I hit for ' }, roll('1d8+3', 'slashing'), { t: 'text', text: ' damage' }] }) === 'I hit for [[1d8+3 slashing]] damage')
check('an emote and an out of character line keep their command', macroLineOf({ kind: 'emote', parts: [{ t: 'text', text: 'draws a sword' }] }) === '/me draws a sword' && macroLineOf({ kind: 'ooc', parts: [{ t: 'text', text: 'brb' }] }) === '/ooc brb')
check('a card becomes a /card line again', macroLineOf({ kind: 'say', parts: [{ t: 'card', title: 'Longsword', rows: [{ label: 'Attack', parts: [roll('1d20+5')] }, { label: '', parts: [{ t: 'text', text: 'Pommel strike' }] }] }] }) === '/card Longsword | Attack: [[1d20+5]] | Pommel strike')
check('a whisper or an empty message has no line', macroLineOf({ kind: 'whisper', parts: [{ t: 'text', text: 'psst' }] }) === null && macroLineOf({ kind: 'say', parts: [] }) === null)
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
