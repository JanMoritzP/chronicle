import { darknessAt, partOfDay } from '../server/src/daylight'
import { darknessAt as webDarkness, partOfDay as webPart } from '../web/src/lib/daylight'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

check('noon is bright and midnight is dark', darknessAt(12) === 0 && darknessAt(0) === 0.85 && darknessAt(23) === 0.85)
check('dawn and dusk fade', darknessAt(5) > darknessAt(6) && darknessAt(6) > darknessAt(7) && darknessAt(7) > darknessAt(8) && darknessAt(18) < darknessAt(19) && darknessAt(19) < darknessAt(20))
check('every hour is between 0 and 0.85', Array.from({ length: 24 }, (_, h) => darknessAt(h)).every((d) => d >= 0 && d <= 0.85))
check('an hour out of range counts as day', darknessAt(30) === 0 && darknessAt(-1) === 0)
check('the hours have names', partOfDay(2) === 'Night' && partOfDay(5) === 'Dawn' && partOfDay(9) === 'Morning' && partOfDay(12) === 'Midday' && partOfDay(16) === 'Afternoon' && partOfDay(19) === 'Dusk' && partOfDay(21) === 'Evening' && partOfDay(23) === 'Night')
check('the browser and the server agree', Array.from({ length: 24 }, (_, h) => h).every((h) => darknessAt(h) === webDarkness(h) && partOfDay(h) === webPart(h)))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
