import { firstAttack, leftReach, adjustDamage, concentrationDc, deathSave, longRest, proficiencyOf, saveBonusOf, shortRest, typesIn } from '../server/src/rules5e'
import type { Sheet } from '../server/src/sheet'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const lists = { resistances: 'fire, cold; bludgeoning, piercing, and slashing from nonmagical attacks', vulnerabilities: 'radiant', immunities: 'poison' }
check('a list names its types', [...typesIn('Fire, Cold; poison')].sort().join() === 'cold,fire,poison')
check('an entry with a condition is left to the GM', !typesIn(lists.resistances).has('slashing') && typesIn(lists.resistances).has('fire'))
check('resistance halves and rounds down', adjustDamage(7, 'fire', lists).amount === 3 && adjustDamage(7, 'fire', lists).effect === 'resistant')
check('vulnerability doubles', adjustDamage(7, 'radiant', lists).amount === 14)
check('immunity stops it', adjustDamage(7, 'poison', lists).amount === 0 && adjustDamage(7, 'poison', lists).effect === 'immune')
check('no type or an unlisted type changes nothing', adjustDamage(7, undefined, lists).amount === 7 && adjustDamage(7, 'acid', lists).effect === null)
check('resistance and vulnerability to one type cancel', adjustDamage(7, 'fire', { resistances: 'fire', vulnerabilities: 'fire', immunities: '' }).amount === 7)
check('healing is never adjusted', adjustDamage(-5, 'fire', lists).amount === -5)

check('concentration is half the damage, at least 10', concentrationDc(4) === 10 && concentrationDc(20) === 10 && concentrationDc(31) === 15)

check('a 10 is a success', deathSave(10).outcome === 'success' && deathSave(10).saves.ok === 1)
check('a 9 is a failure', deathSave(9).outcome === 'failure' && deathSave(9).saves.fail === 1)
check('a natural 1 counts twice', deathSave(1).saves.fail === 2 && deathSave(1).outcome === 'critical failure')
check('a natural 20 revives and clears the count', deathSave(20, { ok: 2, fail: 2 }).outcome === 'revived' && deathSave(20, { ok: 2, fail: 2 }).saves.fail === 0)
check('three successes make them stable', deathSave(12, { ok: 2, fail: 1 }).outcome === 'stable')
check('three failures kill', deathSave(3, { ok: 0, fail: 2 }).outcome === 'dead' && deathSave(1, { ok: 0, fail: 2 }).outcome === 'dead')

const base = {
  v: 1, ruleset: '5e', kind: 'character', name: 'Aria', hp: { max: 30, formula: '', current: 5, temp: 3 },
  abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
  hitDice: [{ sides: 8, total: 4, used: 3 }, { sides: 10, total: 2, used: 0 }],
  spellcasting: { ability: 'int', slots: [{ total: 4, used: 3 }, { total: 2, used: 1 }] },
  deathSaves: { ok: 1, fail: 2 },
  features: { traits: [{ name: 'Rage', text: '', usage: { type: 'perDay', times: 2 }, used: 2 }, { name: 'Surge', text: '', usage: { type: 'rest' }, used: 1 }], actions: [], bonus: [], reactions: [], legendary: [] },
} as unknown as Sheet

const long = longRest(base)
check('a long rest fills hit points and clears temporary ones', long.sheet.hp.current === 30 && long.sheet.hp.temp === 0)
check('a long rest brings every slot and use back', long.sheet.spellcasting!.slots.every((s) => s.used === 0) && long.sheet.features.traits.every((f) => f.used === 0))
check('a long rest returns half the hit dice (at least one)', long.sheet.hitDice!.reduce((n, d) => n + d.used, 0) === 0 && base.hitDice![0].used === 3)
check('a long rest clears death saves', long.sheet.deathSaves!.ok === 0 && long.sheet.deathSaves!.fail === 0)
check('the sheet that went in is not changed', base.hp.current === 5 && base.spellcasting!.slots[0].used === 3)

const short = shortRest(base, 2, () => 6)
// the d10 is spent first: 6 + 2, then the d8: 6 + 2
check('a short rest spends the largest dice first and heals', short.spent === 2 && short.healed === 16 && short.sheet.hp.current === 21)
check('a short rest only readies features that come back on a rest', short.sheet.features.traits[1].used === 0 && short.sheet.features.traits[0].used === 2)
check('a short rest cannot spend more dice than are left', shortRest(base, 9, () => 1).spent === 3)
const counted = { ...base, spent: { 'barbarian.rage': { used: 2, rest: 'one' }, 'fighter.surge': { used: 1, rest: 'short' }, 'fighter.indomitable': { used: 1, rest: 'long' } }, counters: [{ name: 'Lucky', max: 3, used: 3, rest: 'long' }, { name: 'Focus', max: 2, used: 1, rest: 'short' }] } as unknown as Sheet
const countedShort = shortRest(counted, 0, () => 1).sheet
check('a short rest at the table gives back class resources and counters as they say', countedShort.spent!['barbarian.rage'].used === 1 && !countedShort.spent!['fighter.surge'] && countedShort.spent!['fighter.indomitable'].used === 1 && countedShort.counters![0].used === 3 && countedShort.counters![1].used === 0)
const countedLong = longRest(counted).sheet
check('a long rest at the table gives every class resource and counter back', Object.keys(countedLong.spent!).length === 0 && countedLong.counters!.every((c) => c.used === 0))
check('a short rest never heals beyond the maximum', shortRest(base, 3, () => 10).sheet.hp.current === 30)

check('proficiency follows total level', proficiencyOf({ classes: [{ name: 'Fighter', level: 1 }] }) === 2 && proficiencyOf({ classes: [{ name: 'Fighter', level: 5 }] }) === 3 && proficiencyOf({ classes: [{ name: 'A', level: 10 }, { name: 'B', level: 7 }] }) === 6)
check('a creature saves with its own number or its modifier', saveBonusOf({ ...base, saves: { dex: 5 } } as Sheet, 'dex') === 5 && saveBonusOf({ ...base, saves: {} } as Sheet, 'con') === 2 && saveBonusOf(undefined, 'con') === 0)
check('a character adds proficiency to saves they are proficient in', saveBonusOf({ ...base, classes: [{ name: 'Cleric', level: 5 }], profs: { saves: ['wis'], skills: {} }, saves: {} } as Sheet, 'wis') === 3 && saveBonusOf({ ...base, classes: [{ name: 'Cleric', level: 5 }], profs: { saves: ['wis'], skills: {} }, saves: {} } as Sheet, 'con') === 2)

const o = [{ id: 'orc', x: 100, y: 100 }, { id: 'far', x: 500, y: 500 }, { id: 'diag', x: 170, y: 170 }]
check('stepping away from someone next to you leaves their reach', leftReach({ id: 'me', x: 170, y: 100 }, { id: 'me', x: 380, y: 100 }, o, 70).join() === 'orc,diag')
check('moving along beside them does not', leftReach({ id: 'me', x: 170, y: 100 }, { id: 'me', x: 170, y: 170 }, [o[0]], 70).length === 0)
check('someone who was never close is not asked', !leftReach({ id: 'me', x: 170, y: 100 }, { id: 'me', x: 400, y: 100 }, o, 70).includes('far'))
const orc = { features: { traits: [], bonus: [], reactions: [], legendary: [], actions: [{ name: 'Javelin', text: 'Ranged Weapon Attack: +5 to hit, range 30/120 ft. Hit: 6 (1d6 + 3) piercing damage.' }, { name: 'Greataxe', text: 'Melee Weapon Attack: +5 to hit, reach 5 ft. Hit: 9 (1d12 + 3) slashing damage.' }] } } as unknown as Sheet
const fa = firstAttack(orc)!
check('the first melee attack of a creature is read from its text', fa.label === 'Greataxe' && fa.bonus === 5 && fa.damage[0].expr === '1d12+3' && fa.damage[0].type === 'slashing')
check('with no melee attack the first of any kind, and none when there is none', firstAttack({ features: { ...orc.features, actions: [orc.features.actions[0]] } } as unknown as Sheet)!.label === 'Javelin' && firstAttack({ features: { ...orc.features, actions: [{ name: 'Roar', text: 'It roars.' }] } } as unknown as Sheet) === null)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
