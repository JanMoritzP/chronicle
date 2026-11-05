import { formatDate, fromParts, toParts, yearLength, type Calendar } from '../web/src/lib/calendar'
import { itemStateAt, journeyAt, journeyTimes } from '../web/src/lib/mapTime'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const seasons: Calendar = {
  yearLabel: 'Year', startYear: 1, levels: 2, level1Label: 'Season', level2Label: 'Month', dayLabel: 'Day', yearDays: 0,
  units: [
    { name: 'Winter', children: [{ name: 'Frost', days: 30 }, { name: 'Deep', days: 28 }] },
    { name: 'Summer', children: [{ name: 'Glorsh', days: 20 }, { name: 'Brun', days: 25 }] },
  ],
}
check('year length sums all sub-levels', yearLength(seasons) === 103)
const t = fromParts(seasons, { year: 4, l1: 1, l2: 0, day: 5 })
check('Year 4 Season Summer Month Glorsh Day 5', formatDate(seasons, t) === 'Year 4 Season Summer Month Glorsh Day 5', formatDate(seasons, t))
check('round trip for every day of 3 years', Array.from({ length: 103 * 3 }, (_, i) => i).every((i) => fromParts(seasons, toParts(seasons, i)) === i))
check('negative days (before year 1) round trip', [-1, -50, -103, -104].every((i) => fromParts(seasons, toParts(seasons, i)) === i))
check('day 0 is first day of start year', formatDate(seasons, 0) === 'Year 1 Season Winter Month Frost Day 1')
check('day beyond month length is clamped', toParts(seasons, fromParts(seasons, { year: 1, l1: 1, l2: 0, day: 99 })).day === 20)

const sept: Calendar = {
  yearLabel: 'Year', startYear: 1, levels: 1, level1Label: 'Month', level2Label: '', dayLabel: 'Day', yearDays: 0,
  units: ['August', 'September'].map((name) => ({ name, days: 30 })),
}
check('Year 299 Month September Day 30', formatDate(sept, fromParts(sept, { year: 299, l1: 1, l2: 0, day: 30 })) === 'Year 299 Month September Day 30')
check('day after Sept 30 rolls to next year', formatDate(sept, fromParts(sept, { year: 299, l1: 1, l2: 0, day: 30 }) + 1) === 'Year 300 Month August Day 1')

const plain: Calendar = { yearLabel: 'Cycle', startYear: 0, levels: 0, level1Label: '', level2Label: '', dayLabel: 'Sun', yearDays: 400, units: [] }
check('zero sub-levels', formatDate(plain, 401) === 'Cycle 1 Sun 2', formatDate(plain, 401))

// timed items
const base = { id: 'a', mapId: 'm', layerId: null, kind: 'point' as const, title: '', pageId: null, targetMapId: null }
const timed = { ...base, geometry: [0, 0] as [number, number], style: { glide: true }, timeMode: 'timed' as const, journey: null,
  keyframes: [{ t: 10, geometry: [0, 0] as [number, number] }, { t: 20, geometry: [100, 50] as [number, number] }, { t: 30, hidden: true }] }
check('timed item absent before first keyframe', !itemStateAt(timed, 5).visible)
check('timed item glides', JSON.stringify(itemStateAt(timed, 15).geometry) === '[50,25]')
check('timed item disappears at hidden keyframe', !itemStateAt(timed, 31).visible)
check('static view ignores time', itemStateAt(timed, null).visible)
const jump = { ...timed, style: {} }
check('without glide it jumps', JSON.stringify(itemStateAt(jump, 19).geometry) === '[0,0]')

// journeys
const geom: [number, number][] = [[0, 0], [100, 0], [300, 0]]
const jt = journeyTimes(geom, [{ arrive: null, depart: 10 }, { arrive: null, depart: null }, { arrive: 40, depart: null }])!
check('middle stop time is spread by distance', jt.arr[1] === 20, String(jt.arr[1]))
check('before departure: not started', !journeyAt(geom, jt, 5).started)
const mid = journeyAt(geom, jt, 15)
check('halfway to stop 2', mid.pos[0] === 50 && mid.travelled.length === 2)
check('after arrival: finished', journeyAt(geom, jt, 99).finished)
const rest = journeyTimes(geom, [{ arrive: null, depart: 10 }, { arrive: 20, depart: 25 }, { arrive: 40, depart: null }])!
check('resting at a stop holds position', journeyAt(geom, rest, 22).pos[0] === 100)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
