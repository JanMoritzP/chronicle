import { lastSession, recapLines, sessionStart, type ChatRow } from '../server/src/recap'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const H = 3600_000
const t0 = Date.UTC(2026, 10, 14, 18)
const row = (ts: number, name: string, kind: string, text: string, roll?: ChatRow['parts'][number]['roll']): ChatRow => ({ ts, name, kind, parts: roll ? [{ t: 'roll', roll }] : [{ t: 'text', text }] })
const rows: ChatRow[] = [
  row(t0, 'Old', 'say', 'last week'),
  row(t0 + 7 * 24 * H, 'Aria', 'say', 'We open the door.'),
  row(t0 + 7 * 24 * H + 600_000, 'Aria', 'roll', '', { label: 'Perception', total: 17 }),
  row(t0 + 7 * 24 * H + 700_000, 'GM', 'whisper', 'secret'),
  row(t0 + 7 * 24 * H + 800_000, 'GM', 'gmroll', '', { label: 'Trap', total: 3 }),
  row(t0 + 7 * 24 * H + 900_000, 'Bram', 'emote', 'draws his axe'),
  row(t0 + 7 * 24 * H + 1000_000, 'Orc', 'roll', '', { label: 'attack on Bram dc 15', total: 18, degree: 'success' }),
]
check('the latest session starts after the last long gap', lastSession(rows).length === 4 && lastSession(rows)[0].name === 'Aria')
check('whispers and GM rolls are not in it', !lastSession(rows).some((r) => r.kind === 'whisper' || r.kind === 'gmroll'))
const lines = recapLines(rows)
check('the first line is the date', /2026/.test(lines[0]) && lines.length === 5)
check('talk, rolls and emotes read as lines', lines[1] === 'Aria: We open the door.' && lines[2] === 'Aria rolled Perception 17' && lines[3] === 'Bram draws his axe' && lines[4] === 'Orc rolled attack on Bram dc 15 18 (success)')
check('a quiet table has no recap', recapLines([]).length === 0 && recapLines([row(t0, 'GM', 'whisper', 'x')]).length === 0)
check('one long session is kept whole', lastSession([row(t0, 'a', 'say', '1'), row(t0 + 5 * H, 'a', 'say', '2'), row(t0 + 10 * H, 'a', 'say', '3')]).length === 3)

const H2 = 3600_000
check('the latest session starts after the last long gap', sessionStart([0, H2, 2 * H2, 20 * H2, 21 * H2, 22 * H2]) === 3 && sessionStart([0, H2, 2 * H2]) === 0 && sessionStart([]) === 0 && sessionStart([5]) === 0)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
