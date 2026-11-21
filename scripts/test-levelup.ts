import { allSlots, pactSlots, attunedCount, capacityOf, carriedWeight, classFeaturesAt, hitDieOf, levelUp, loadOf, slotsFor } from '../web/src/lib/levelup'
import { emptyCharacter } from '../web/src/lib/sheet'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const ch = (over: Record<string, unknown> = {}) => ({ ...emptyCharacter('5e'), abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 }, ...over })

check('known hit dice', hitDieOf('Fighter') === 10 && hitDieOf(' wizard ') === 6 && hitDieOf('Homebrew') === null)
check('a full caster of level 5 has 4/3/2', slotsFor([{ name: 'Wizard', level: 5 }])!.join() === '4,3,2')
check('a paladin has its own table', slotsFor([{ name: 'Paladin', level: 1 }]) === null && slotsFor([{ name: 'Paladin', level: 5 }])!.join() === '4,2')
check('a fighter without magic has no slots', slotsFor([{ name: 'Fighter', level: 8 }]) === null && slotsFor([{ name: 'Fighter', level: 7, subclass: 'Eldritch Knight' }])!.join() === '4,2')
check('multiclass slots add up the caster levels', slotsFor([{ name: 'Wizard', level: 3 }, { name: 'Cleric', level: 2 }])!.join() === '4,3,2')
check('warlock pact magic is not counted as ordinary slots', slotsFor([{ name: 'Warlock', level: 5 }]) === null)
check('pact magic by warlock level', JSON.stringify(pactSlots(1)) === '{"count":1,"slotLevel":1}' && pactSlots(5)!.slotLevel === 3 && pactSlots(11)!.count === 3 && pactSlots(17)!.count === 4 && pactSlots(9)!.slotLevel === 5 && pactSlots(0) === null)
check('a warlock has its pact slots as slots', allSlots([{ name: 'Warlock', level: 5 }])!.join() === '0,0,2')
check('a warlock and a wizard add up', allSlots([{ name: 'Wizard', level: 3 }, { name: 'Warlock', level: 3 }])!.join() === '4,4' && allSlots([{ name: 'Fighter', level: 3 }]) === null)

const hero = ch({ classes: [{ name: 'Fighter', level: 3 }], hp: { max: 28, formula: '', current: 20, temp: 0 }, hitDice: [{ sides: 10, total: 3, used: 1 }] })
const up = levelUp(hero as any, 'Fighter') as any
check('a level adds the average hit die plus Constitution', up.patch['hp.max'] === 28 + 6 + 2 && up.patch['hp.current'] === 20 + 8)
check('the class level and the hit dice go up', up.patch.classes[0].level === 4 && up.patch.hitDice[0].total === 4 && up.patch.hitDice[0].used === 1)
check('level 4 offers an ability score improvement', up.lines.some((l: string) => l.includes('ability score improvement')))
const rolled = levelUp(hero as any, 'Fighter', { hit: 3 }) as any
check('a rolled number is used, at least 1 hit point is gained', rolled.patch['hp.max'] === 28 + 5 && (levelUp(ch({ abilities: { str: 10, dex: 10, con: 1, int: 10, wis: 10, cha: 10 } }) as any, 'Wizard', { hit: 1 }) as any).patch['hp.max'] === 11)
const multi = levelUp(hero as any, 'Wizard') as any
check('a new class starts at level 1 with its own die', multi.patch.classes.length === 2 && multi.patch.classes[1].level === 1 && multi.patch.hitDice.some((d: any) => d.sides === 6) && multi.patch['spellcasting.slots'][0].total === 2)
const caster = ch({ classes: [{ name: 'Wizard', level: 2 }], spellcasting: { ability: 'int', slots: [{ total: 3, used: 2 }] } })
const cu = levelUp(caster as any, 'Wizard') as any
check('slots are recalculated and spent ones stay spent', cu.patch['spellcasting.slots'][0].total === 4 && cu.patch['spellcasting.slots'][0].used === 2 && cu.patch['spellcasting.slots'][1].total === 2)
check('an unknown class needs its die', 'error' in (levelUp(hero as any, 'Homebrew') as any) && !('error' in (levelUp(hero as any, 'Homebrew', { die: 8 }) as any)))
check('level 20 is the end', 'error' in (levelUp(ch({ classes: [{ name: 'Fighter', level: 20 }] }) as any, 'Fighter') as any))
check('an empty class name is refused', 'error' in (levelUp(hero as any, '  ') as any))

const items = [{ name: 'Sword', qty: 1, equipped: true, weight: 3, attuned: true }, { name: 'Rope', qty: 2, equipped: false, weight: 5 }, { name: 'Gem', qty: 3, equipped: false }]
check('weights add up by quantity', carriedWeight(items) === 13 && carriedWeight(undefined) === 0)
check('capacity is 15 per point of Strength', capacityOf(10) === 150)
check('load steps', loadOf(40, 10) === 'light' && loadOf(60, 10) === 'encumbered' && loadOf(120, 10) === 'heavily encumbered' && loadOf(200, 10) === 'over capacity')
check('attuned items are counted', attunedCount(items) === 1)

const doc = { type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'A fighter.' }] },
  { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Second Wind (level 1)' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Regain hit points.' }] },
  { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Extra Attack (level 5, 11)' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Attack twice.' }] },
  { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Fighting Styles' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Options.' }] },
] }
check('a class page gives the features of a level', classFeaturesAt(doc, 5).map((f) => f.name).join() === 'Extra Attack' && classFeaturesAt(doc, 5)[0].text === 'Attack twice.' && classFeaturesAt(doc, 11).length === 1)
check('and none for a level without any', classFeaturesAt(doc, 3).length === 0 && classFeaturesAt(null, 1).length === 0)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
