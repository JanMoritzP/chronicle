import { columnLines, columnsOf, multiclassNeed, open5eColumns, givesAsi, givesEpicBoon, subclassLevel, needsSubclass, allSlots, pactSlots, attunedCount, capacityOf, carriedWeight, classFeaturesAt, hitDieOf, levelUp, loadOf, slotsFor } from '../web/src/lib/levelup'
import { lightItems, lightOf } from '../web/src/lib/lightitems'
import { emptyCharacter, patchSheetLocal } from '../web/src/lib/sheet'

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
check('a rolled number is used, at least 1 hit point is gained', rolled.patch['hp.max'] === 28 + 5 && (levelUp(ch({ classes: [{ name: 'Wizard', level: 1 }], abilities: { str: 10, dex: 10, con: 1, int: 10, wis: 10, cha: 10 } }) as any, 'Wizard', { hit: 1 }) as any).patch['hp.max'] === 11)
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
check('a fighter chooses a subclass at 3', needsSubclass('Fighter', 3) && !needsSubclass('Fighter', 3, 'Champion') && needsSubclass('Cleric', 1) && !needsSubclass('Fighter', 2) && !needsSubclass('Fighter', 4, 'Champion'))
const sc = levelUp(f2 as any, 'Fighter', { subclass: 'Eldritch Knight' }) as any
check('the subclass is kept on the class', sc.patch.classes[0].subclass === 'Eldritch Knight' && sc.lines.includes('Subclass: Eldritch Knight'))
check('and an Eldritch Knight gets spell slots at 3', sc.patch['spellcasting.slots']?.[0]?.total === 2)
check('a second subclass is refused', 'error' in (levelUp(ch({ classes: [{ name: 'Fighter', level: 4, subclass: 'Champion' }] }) as any, 'Fighter', { subclass: 'Battle Master' }) as any))
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
check('and chooses its subclass when it says', needsSubclass('Storm knight', 2, '', '5e', infos['storm knight']) && !needsSubclass('Storm knight', 1, '', '5e', infos['storm knight']) && subclassLevel('Unknown', '5e') === 3)
const hx = levelUp(ch({ classes: [{ name: 'Hexblade', level: 2 }] }) as any, 'Hexblade', { infos }) as any
check('a homebrew pact caster gets pact magic', hx.lines.some((l: string) => l.startsWith('Pact Magic: 2 slots of level 2')))
check('a name of the rules keeps its own tables over homebrew of the same name', hitDieOf('Wizard', { die: 12 }) === 6)

// ---------- whole careers by the 2014 rules: a Champion fighter and an evocation wizard from level 1 to 20, and the class tables of others ----------
type Pick = { subclass?: string; asi?: Record<string, number>; feat?: { name: string } }
function career(cls: string, abilities: Record<string, number>, picks: Record<number, Pick>, ruleset: '5e' | '5e-2024' = '5e') {
  let s: any = { ...emptyCharacter(ruleset), abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...abilities } }
  const steps: { level: number; lines: string[]; warnings: string[]; sheet: any }[] = []
  for (let l = 1; l <= 20; l++) {
    const r = levelUp(s, cls, picks[l] ?? {}) as any
    if ('error' in r) { steps.push({ level: l, lines: [r.error], warnings: [], sheet: s }); break }
    s = patchSheetLocal(s, r.patch)
    steps.push({ level: l, lines: r.lines, warnings: r.warnings, sheet: s })
  }
  return steps
}
const has = (lines: string[], text: string) => lines.some((l) => l.includes(text))
const slotsOf = (s: any) => (s.spellcasting?.slots ?? []).map((x: any) => x.total).join()
const PHB_FULL = ['2', '3', '4,2', '4,3', '4,3,2', '4,3,3', '4,3,3,1', '4,3,3,2', '4,3,3,3,1', '4,3,3,3,2', '4,3,3,3,2,1', '4,3,3,3,2,1', '4,3,3,3,2,1,1', '4,3,3,3,2,1,1', '4,3,3,3,2,1,1,1', '4,3,3,3,2,1,1,1', '4,3,3,3,2,1,1,1,1', '4,3,3,3,3,1,1,1,1', '4,3,3,3,3,2,1,1,1', '4,3,3,3,3,2,2,1,1']

const fighter = career('Fighter', { str: 15, dex: 13, con: 14 }, {
  3: { subclass: 'Champion' }, 4: { asi: { str: 1, con: 1 } }, 6: { asi: { str: 2 } }, 8: { asi: { con: 1 } }, 12: { asi: { str: 2 } }, 14: { feat: { name: 'Tough' } }, 16: { asi: { con: 2 } }, 19: { asi: { con: 2 } },
})
const fEnd = fighter[19]?.sheet
check('fighter: reaches level 20 with no refusal', fighter.length === 20 && fEnd.classes.length === 1 && fEnd.classes[0].level === 20, fighter.at(-1)!.lines[0])
check('fighter: the first level gives the whole d10 and replaces the empty class row of a new sheet', fighter[0].sheet.hp.max === 12 && fighter[0].sheet.classes.length === 1 && has(fighter[0].lines, 'the whole d10'))
check('fighter: 20 d10 hit dice', fEnd.hitDice.length === 1 && fEnd.hitDice[0].sides === 10 && fEnd.hitDice[0].total === 20)
// with Constitution raised for every earlier level: d10 + 19 x 6 + 20 x the final modifier (+5)
check('fighter: hit points at 20 are 10 + 19 x 6 + 20 x 5', fEnd.hp.max === 224 && fEnd.hp.current === 224, String(fEnd.hp.max))
check('fighter: improvements at 4, 6, 8, 12, 14, 16 and 19 only', fighter.filter((st) => has(st.lines, 'STR ') || has(st.lines, 'CON ') || has(st.lines, 'Feat:')).map((st) => st.level).join() === '4,6,8,12,14,16,19')
check('fighter: scores end at Strength 20 and Constitution 20, with the feat', fEnd.abilities.str === 20 && fEnd.abilities.con === 20 && fEnd.features.traits.some((t: any) => t.name === 'Tough'))
check('fighter: the subclass is asked at 3 and kept, no warnings', has(fighter[2].lines, 'Subclass: Champion') && fEnd.classes[0].subclass === 'Champion' && fighter.every((st) => st.warnings.length === 0), JSON.stringify(fighter.map((st) => st.warnings)))
check('fighter: proficiency bonus is named at 1 and steps at 5, 9, 13 and 17', fighter.filter((st) => has(st.lines, 'Proficiency bonus')).map((st) => st.level).join() === '1,5,9,13,17')
check('fighter: a Champion never gets spell slots', fighter.every((st) => !has(st.lines, 'Spell slots')) && slotsOf(fEnd) === '')

const wizard = career('Wizard', { int: 15, con: 14, dex: 14 }, {
  2: { subclass: 'School of Evocation' }, 4: { asi: { int: 2 } }, 8: { asi: { int: 2 } }, 12: { asi: { int: 1, con: 1 } }, 16: { asi: { con: 1 } }, 19: { feat: { name: 'War Caster' } },
})
const wEnd = wizard[19]?.sheet
check('wizard: reaches level 20', wizard.length === 20 && wEnd.classes[0].level === 20 && wEnd.classes[0].subclass === 'School of Evocation')
check('wizard: hit points at 20 are 6 + 19 x 4 + 20 x 3', wEnd.hp.max === 142, String(wEnd.hp.max))
check("wizard: spell slots match the Player's Handbook at every level", wizard.every((st, i) => slotsOf(st.sheet) === PHB_FULL[i]), wizard.map((st) => slotsOf(st.sheet)).join(' / '))
check('wizard: improvements at 4, 8, 12, 16 and 19 only', wizard.filter((st) => has(st.lines, 'INT ') || has(st.lines, 'CON ') || has(st.lines, 'Feat:')).map((st) => st.level).join() === '4,8,12,16,19')
check('wizard: the subclass comes at 2', has(wizard[1].lines, 'Subclass: School of Evocation') && wizard.every((st) => st.warnings.length === 0))
check('wizard: cantrips go to 4 at level 4 and 5 at level 10', has(wizard[3].lines, 'Cantrips known: 3 to 4 (learn 1 more)') && has(wizard[9].lines, 'Cantrips known: 4 to 5') && wizard.filter((st) => has(st.lines, 'Cantrips known')).length === 3)
check('wizard: each level copies two spells into the spellbook', has(wizard[0].lines, 'six wizard spells') && wizard.slice(1).every((st) => has(st.lines, 'Copy two wizard spells')) && has(wizard[16].lines, 'up to level 9'))
// Intelligence 15 (+2), 17 at level 4 (+3), 19 at 8 (+4), 20 at 12 (+5): prepared spells are the modifier + the wizard level
check('wizard: prepared spells are Intelligence modifier + level', has(wizard[0].lines, 'Prepare up to 3 wizard') && has(wizard[3].lines, 'Prepare up to 7 wizard') && has(wizard[19].lines, 'Prepare up to 25 wizard'), wizard[3].lines.join(' | '))
check('wizard: new spell levels at 1, 3, 5, 7, 9, 11, 13, 15 and 17', wizard.filter((st) => has(st.lines, 'can now be learned')).map((st) => st.level).join() === '1,3,5,7,9,11,13,15,17')
check('wizard: spent slots stay spent across a level', (() => {
  const s = { ...wizard[4].sheet, spellcasting: { ...wizard[4].sheet.spellcasting, slots: [{ total: 4, used: 4 }, { total: 3, used: 1 }, { total: 2, used: 0 }] } }
  return (levelUp(s, 'Wizard') as any).patch['spellcasting.slots'].map((x: any) => x.used).join() === '4,1,0'
})())

// the class table columns of the 2014 rules
const rogue = career('Rogue', { dex: 15 }, { 3: { subclass: 'Thief' } })
check('rogue: Sneak Attack goes up every odd level', rogue.filter((st) => has(st.lines, 'Sneak Attack')).map((st) => st.level).join() === '1,3,5,7,9,11,13,15,17,19' && has(rogue[18].lines, 'Sneak Attack: 9d6 to 10d6'))
check('rogue: improvements include level 10', rogue.filter((st) => has(st.lines, 'ability score improvement')).map((st) => st.level).join() === '4,8,10,12,16,19')
const barb = career('Barbarian', { str: 15 }, { 3: { subclass: 'Path of the Berserker' } })
check('barbarian: rages and rage damage', has(barb[2].lines, 'Rages: 2 to 3') && has(barb[8].lines, 'Rage damage: +2 to +3') && has(barb[19].lines, 'Rages: 6 to unlimited'))
const lock = career('Warlock', { cha: 15 }, { 1: { subclass: 'The Fiend' } })
check('warlock: invocations from 2, pact magic up to 4 slots of level 5', has(lock[1].lines, 'Eldritch Invocations known: 2') && has(lock[16].lines, 'Pact Magic: 4 slots of level 5') && slotsOf(lock[19].sheet) === '0,0,0,0,4')
check('warlock: pact magic is only listed when it changes', !has(lock[3].lines, 'Pact Magic') && has(lock[2].lines, 'Pact Magic: 2 slots of level 2'))
check('warlock: spells known with a swap after the first level', has(lock[1].lines, 'Spells known: 2 to 3 (learn 1 more)') && has(lock[1].lines, 'swap one spell') && !has(lock[0].lines, 'swap'))
const ek = career('Fighter', { str: 15, int: 13 }, { 3: { subclass: 'Eldritch Knight' } })
check('eldritch knight: cantrips and spells known from 3', has(ek[2].lines, 'Cantrips known: 2') && has(ek[2].lines, 'Spells known: 3') && has(ek[18].lines, 'Spells known: 11 to 12') && slotsOf(ek[19].sheet) === '4,3,3,1')
const pal = career('Paladin', { str: 15, cha: 14 }, { 3: { subclass: 'Oath of Devotion' } })
check('paladin: slots from 2 and prepares Charisma modifier + half the level', !has(pal[0].lines, 'Spell slots') && has(pal[1].lines, 'Spell slots: 2') && has(pal[1].lines, 'Prepare up to 3 paladin') && slotsOf(pal[19].sheet) === '4,3,3,3,2')

// a subclass that was not chosen is asked for again, and the level up says so
const late = levelUp(ch({ classes: [{ name: 'Fighter', level: 3 }] }) as any, 'Fighter') as any
check('a missed subclass is asked for at the next level', needsSubclass('Fighter', 4) && late.warnings.some((w: string) => w.includes('should have a subclass since level 3')))
check('and it can be chosen then', (levelUp(ch({ classes: [{ name: 'Fighter', level: 3 }] }) as any, 'Fighter', { subclass: 'Champion' }) as any).patch.classes[0].subclass === 'Champion')
check('a subclass below its level is still refused', (levelUp(ch({ classes: [{ name: 'Fighter', level: 1 }] }) as any, 'Fighter', { subclass: 'Champion' }) as any).error === 'Fighter chooses a subclass at level 3.')

// multiclassing
const mc = levelUp(ch({ classes: [{ name: 'Fighter', level: 5, subclass: 'Champion' }], abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 10 } }) as any, 'Wizard') as any
check('multiclassing without the scores is warned about, not refused', mc.warnings.join() === 'Multiclassing into Wizard needs Intelligence 13.' && mc.patch.classes.length === 2)
check('and says what the new class gives as a second class', has(mc.lines, 'Proficiencies from Wizard as a second class: none'))
check('a monk needs both Dexterity and Wisdom, a fighter either', multiclassNeed('Monk', { str: 10, dex: 13, con: 10, int: 10, wis: 12, cha: 10 }) === 'Dexterity 13 and Wisdom 13' && multiclassNeed('Fighter', { str: 10, dex: 13, con: 10, int: 10, wis: 10, cha: 10 }) === null)
const mcOk = levelUp(ch({ classes: [{ name: 'Fighter', level: 5 }], abilities: { str: 16, dex: 10, con: 14, int: 13, wis: 10, cha: 10 } }) as any, 'Wizard') as any
check('with the scores there is no warning', mcOk.warnings.length === 0)

// classes the 2014 tables do not have bring their class table from Open5e
const o5 = open5eColumns({ features: [
  { feature_type: 'CLASS_TABLE_DATA', name: 'Focus Points', data_for_class_table: [{ level: 2, column_value: '2' }, { level: 3, column_value: '3' }] },
  { feature_type: 'CLASS_TABLE_DATA', name: 'Spell Slots', data_for_class_table: [{ level: 1, column_value: '1' }] },
  { feature_type: 'CLASS_TABLE_DATA', name: 'Odd', data_for_class_table: [{ level: 4, column_value: '2' }, { level: 4, column_value: '3' }] },
] })
check('open5e columns leave out slots and levels listed twice', o5.map((c) => c.name).join() === 'Focus Points,Odd' && o5[1].at(4) === null && columnLines(o5, 2, 3).join() === 'Focus Points: 2 to 3')
check('2024 sheets use the columns the class brings, 2014 sheets the book', columnsOf('Monk', '', '5e-2024', o5) === o5 && columnsOf('Monk', '', '5e', o5) !== o5 && columnsOf('Marshal', '', '5e', o5) === o5)
const m24 = career('Wizard', { int: 15, con: 14 }, { 3: { subclass: 'Evoker' } }, '5e-2024')
check('2024: a wizard to 20 chooses the subclass at 3 and gets an Epic Boon at 19', m24.length === 20 && has(m24[2].lines, 'Subclass: Evoker') && has(m24[18].lines, 'Epic Boon') && !has(m24[0].lines, 'Prepare up to'))
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
