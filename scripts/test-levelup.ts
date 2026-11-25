import { givesAsi, givesEpicBoon, subclassLevel, needsSubclass, allSlots, pactSlots, attunedCount, capacityOf, carriedWeight, classFeaturesAt, hitDieOf, levelUp, loadOf, slotsFor } from '../web/src/lib/levelup'
import { lightItems, lightOf } from '../web/src/lib/lightitems'
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

const f2 = ch({ classes: [{ name: 'Fighter', level: 2 }], hp: { max: 20, formula: '', current: 20, temp: 0 } })
check('a fighter chooses a subclass at 3', needsSubclass('Fighter', 3) && !needsSubclass('Fighter', 3, 'Champion') && needsSubclass('Cleric', 1) && !needsSubclass('Fighter', 4))
const sc = levelUp(f2 as any, 'Fighter', { subclass: 'Eldritch Knight' }) as any
check('the subclass is kept on the class', sc.patch.classes[0].subclass === 'Eldritch Knight' && sc.lines.includes('Subclass: Eldritch Knight'))
check('and an Eldritch Knight gets spell slots at 3', sc.patch['spellcasting.slots']?.[0]?.total === 2)
check('a subclass at the wrong level is refused', 'error' in (levelUp(ch({ classes: [{ name: 'Fighter', level: 4 }] }) as any, 'Fighter', { subclass: 'Champion' }) as any))
check('fighters get more improvements', givesAsi('Fighter', 6) && givesAsi('Fighter', 14) && givesAsi('Rogue', 10) && !givesAsi('Wizard', 6) && givesAsi('Wizard', 4))
const f3 = ch({ classes: [{ name: 'Fighter', level: 3 }], abilities: { str: 15, dex: 10, con: 13, int: 10, wis: 10, cha: 10 }, hp: { max: 28, formula: '', current: 28, temp: 0 } })
const a1 = levelUp(f3 as any, 'Fighter', { asi: { str: 1, con: 1 } }) as any
check('points go on the scores', a1.patch['abilities.str'] === 16 && a1.patch['abilities.con'] === 14)
check('a higher Constitution modifier adds hit points for every level', a1.patch['hp.max'] === 28 + (6 + 1) + 4 && a1.lines.some((l: string) => l.includes('from Constitution')))
check('no score goes past 20', (levelUp(ch({ classes: [{ name: 'Fighter', level: 3 }], abilities: { str: 19, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } }) as any, 'Fighter', { asi: { str: 2 } }) as any).patch['abilities.str'] === 20)
check('three points are refused', 'error' in (levelUp(f3 as any, 'Fighter', { asi: { str: 2, dex: 1 } }) as any))
const ft = levelUp(f3 as any, 'Fighter', { feat: { name: 'Alert', text: '+5 to initiative' } }) as any
check('a feat is added as a trait', ft.patch['features.traits'].some((x: any) => x.name === 'Alert' && x.text.includes('initiative')) && ft.lines.includes('Feat: Alert'))
check('points and a feat together are refused', 'error' in (levelUp(f3 as any, 'Fighter', { asi: { str: 1 }, feat: { name: 'Alert' } }) as any))
check('a torch gives light', lightOf('Torch (lit at dusk)')?.light.bright === 20 && lightOf('Candle')?.light.dim === 10)
check('a bullseye lantern is a cone and a hooded one is not', lightOf('Bullseye lantern')?.light.angle === 60 && lightOf('Hooded lantern')?.light.angle === undefined)
check('a rope gives none', lightOf('Hempen rope') === null)
check('only carried items that glow are listed', lightItems([{ name: 'Torch', qty: 3 }, { name: 'Rope', qty: 1 }, { name: 'Candle', qty: 0 }]).map((x) => x.name).join() === 'Torch')
check('what is in a bag of holding is not carried weight', carriedWeight([{ name: 'Bag of holding', qty: 1, equipped: false, weight: 15, weightless: true }, { name: 'Plate', qty: 1, equipped: false, weight: 65, in: 'bag of holding' }, { name: 'Rope', qty: 1, equipped: false, weight: 10 }]) === 25)
check('a plain bag does not lighten what is in it', carriedWeight([{ name: 'Backpack', qty: 1, equipped: false, weight: 5 }, { name: 'Plate', qty: 1, equipped: false, weight: 65, in: 'Backpack' }]) === 70)
// the 2024 rules
const modern = (over: Record<string, unknown> = {}) => ({ ...emptyCharacter('5e-2024'), abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 }, ...over })
check('2024: every class chooses its subclass at 3', subclassLevel('Cleric', '5e-2024') === 3 && subclassLevel('Wizard', '5e-2024') === 3 && subclassLevel('Cleric', '5e') === 1 && subclassLevel('Druid', '5e') === 2)
check('2024: a cleric is not asked for a subclass at 1, but at 3', !needsSubclass('Cleric', 1, '', '5e-2024') && needsSubclass('Cleric', 3, '', '5e-2024') && needsSubclass('Cleric', 1, '', '5e'))
check('2024: a paladin casts from level 1, in 2014 from 2', slotsFor([{ name: 'Paladin', level: 1 }], '5e-2024')!.join() === '2' && slotsFor([{ name: 'Paladin', level: 1 }], '5e') === null && slotsFor([{ name: 'Ranger', level: 3 }], '5e-2024')!.join() === '3')
check('2024: half casters round up when multiclassing, 2014 down', slotsFor([{ name: 'Paladin', level: 3 }, { name: 'Wizard', level: 1 }], '5e-2024')!.join() === '4,2' && slotsFor([{ name: 'Paladin', level: 3 }, { name: 'Wizard', level: 1 }], '5e')!.join() === '3')
check('2024: level 19 is an Epic Boon', givesEpicBoon(19, '5e-2024') && !givesEpicBoon(19, '5e') && !givesEpicBoon(16, '5e-2024'))
const p0 = levelUp(modern({ classes: [{ name: 'Fighter', level: 1 }] }) as any, 'Paladin') as any
check('2024: a level of paladin gives slots at once', p0.patch['spellcasting.slots']?.[0]?.total === 2, JSON.stringify(p0.patch['spellcasting.slots']))
check('2024: a subclass for a cleric at 1 is refused', 'error' in (levelUp(modern() as any, 'Cleric', { subclass: 'Life Domain' }) as any))
const boon = levelUp(modern({ classes: [{ name: 'Wizard', level: 18 }] }) as any, 'Wizard', { feat: { name: 'Boon of Fate' } }) as any
check('2024: the feat at 19 is an Epic Boon', boon.lines.includes('Epic Boon: Boon of Fate'))

// classes the tables do not know bring their own hit die, slots and subclass level
const infos = { 'storm knight': { die: 12, caster: 'half' as const, subclassLevel: 2 }, hexblade: { die: 8, caster: 'pact' as const } }
check('a homebrew class has its hit die', hitDieOf('Storm knight', infos['storm knight']) === 12)
const sk = levelUp(ch({ classes: [{ name: 'Storm knight', level: 1 }] }) as any, 'Storm knight', { infos }) as any
check('a homebrew half caster gets slots at 2', sk.patch.hitDice[0].sides === 12 && sk.patch['spellcasting.slots']?.[0]?.total === 2 && sk.lines.some((l: string) => l.startsWith('Spell slots')))
check('and chooses its subclass when it says', needsSubclass('Storm knight', 2, '', '5e', infos['storm knight']) && !needsSubclass('Storm knight', 3, '', '5e', infos['storm knight']) && subclassLevel('Unknown', '5e') === 3)
const hx = levelUp(ch({ classes: [{ name: 'Hexblade', level: 2 }] }) as any, 'Hexblade', { infos }) as any
check('a homebrew pact caster gets pact magic', hx.lines.some((l: string) => l.startsWith('Pact Magic: 2 slots of level 2')))
check('a name of the rules keeps its own tables over homebrew of the same name', hitDieOf('Wizard', { die: 12 }) === 6)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
