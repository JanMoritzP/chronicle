import { creatureToStatBlock, importPlan } from '../web/src/lib/open5e'
import { emptyPf2eCharacter, pfAc, pfClassDc, pfDerived, pfPerception, pfRestPatch, pfSave, pfSkill, pfSpellAttack, pfSpellDc, pfStrike, rankBonus, emptyPf2eCreature, multipleAttack, emptyCharacter, longRestPatch, proficiency, skillBonus, spellAttack, spellDC, characterLevel, isCharacter, rollsIn, abilityMod, sheetOf, wholeSheetPatch, crFromText, crText, initiativeBonus, passivePerception, profBonus, saveBonus, sheetFromCreature, sheetFromLegacy, speedText } from '../web/src/lib/sheet'
import type { LibraryEntry } from '../web/src/types'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const dragon: LibraryEntry = {
  key: 'creature:test-drake', category: 'creature', name: 'Test Drake', source: 'srd', sourceName: 'SRD', license: '', permalink: '',
  data: {
    ruleset: '5e', size: { name: 'Large' }, type: { name: 'Dragon' }, alignment: 'chaotic evil',
    ability_scores: { strength: 19, dexterity: 12, constitution: 17, intelligence: 8, wisdom: 11, charisma: 10 },
    armor_class: 17, armor_detail: 'natural armor', hit_points: 110, hit_dice: '13d10 + 39',
    speed: { unit: 'feet', walk: 40, fly: 80 }, speed_all: { hover: true },
    saving_throws: { dexterity: 4, wisdom: 3 }, skill_bonuses: { perception: 6, stealth: 4, sleight_of_hand: 4 },
    darkvision_range: 60, blindsight_range: 10, passive_perception: 16,
    resistances_and_immunities: { damage_immunities_display: 'fire', damage_resistances: [{ name: 'Cold' }], condition_immunities: [] },
    languages: { as_string: 'Common, Draconic' }, challenge_rating: '5', experience_points: 1800,
    traits: [{ name: 'Keen Senses', desc: 'It has advantage on Perception checks.' }],
    actions: [
      { name: 'Bite', desc: 'Melee Weapon Attack: +7 to hit.', action_type: 'ACTION', order_in_statblock: 1 },
      { name: 'Fire Breath', desc: 'Exhales fire.', action_type: 'ACTION', order_in_statblock: 2, usage_limits: { type: 'RECHARGE_ON_ROLL', param: 5 } },
      { name: 'Tail', desc: 'Swipes.', action_type: 'LEGENDARY_ACTION', legendary_action_cost: 2 },
    ],
  },
}

const s = sheetFromCreature(dragon)
check('name, size, type', s.name === 'Test Drake' && s.size === 'Large' && s.type === 'dragon' && s.alignment === 'chaotic evil')
check('abilities are numbers', s.abilities.str === 19 && abilityMod(s.abilities.str) === 4 && abilityMod(9) === -1)
check('ac and hp', s.ac.value === 17 && s.ac.note === 'natural armor' && s.hp.max === 110 && s.hp.formula === '13d10 + 39')
check('speed uses printed values and hover', s.speed.walk === 40 && s.speed.fly === 80 && s.speed.hover === true && speedText(s) === '40 ft., fly 80 ft. (hover)')
check('saves: explicit and fallback', saveBonus(s, 'dex') === 4 && saveBonus(s, 'str') === 4 && saveBonus(s, 'int') === -1)
check('skills keep spaces', s.skills['sleight of hand'] === 4 && s.skills.perception === 6)
check('senses and passive', s.senses.darkvision === 60 && s.senses.blindsight === 10 && passivePerception(s) === 16)
check('initiative falls back to dex', initiativeBonus(s) === 1)
check('damage text', s.immunities === 'fire' && s.resistances === 'cold' && s.conditionImmunities === '')
check('cr and xp', s.cr === 5 && s.xp === 1800 && profBonus(5) === 3 && profBonus(0.25) === 2 && profBonus(17) === 6 && profBonus(21) === 7)
check('features by group', s.features.traits.length === 1 && s.features.actions.map((f) => f.name).join() === 'Bite,Fire Breath' && s.features.legendary[0].cost === 2)
check('recharge usage', s.features.actions[1].usage?.type === 'recharge' && (s.features.actions[1].usage as { min: number }).min === 5)

// the old string data and the structured sheet must agree
const legacy = creatureToStatBlock(dragon)
const l = sheetFromLegacy(legacy.data, legacy.template)
check('legacy: identity', l.name === s.name && l.size === s.size && l.type === s.type && l.alignment === s.alignment)
check('legacy: abilities', JSON.stringify(l.abilities) === JSON.stringify(s.abilities))
check('legacy: ac and hp', l.ac.value === 17 && l.ac.note === 'natural armor' && l.hp.max === 110 && l.hp.formula === '13d10 + 39')
check('legacy: speed', JSON.stringify(l.speed) === JSON.stringify(s.speed))
check('legacy: saves and skills', JSON.stringify(l.saves) === JSON.stringify(s.saves) && JSON.stringify(l.skills) === JSON.stringify(s.skills))
check('legacy: senses', JSON.stringify(l.senses) === JSON.stringify(s.senses) && l.passivePerception === 16)
check('legacy: cr and xp', l.cr === 5 && l.xp === 1800)
check('legacy: features', l.features.actions.map((f) => f.name).join() === 'Bite,Fire Breath' && l.features.actions[1].usage?.type === 'recharge' && l.features.legendary[0].cost === 2)

// 2024 layout: saves are per ability and initiative is printed
const modern = creatureToStatBlock({ ...dragon, data: { ...dragon.data, ruleset: '5e-2024', initiative_bonus: 3 } })
const m = sheetFromLegacy(modern.data, modern.template)
check('legacy 2024: ruleset, saves, initiative', m.ruleset === '5e-2024' && m.saves.dex === 4 && m.saves.wis === 3 && m.initiative === 3)

check('cr text round trip', crText(0.125) === '1/8' && crFromText('1/4 (50 XP)') === 0.25 && crFromText('13 (10,000 XP)') === 13)
check('hand typed speed', JSON.stringify(sheetFromLegacy({ speed: '30 ft., swim 40 ft.' }).speed) === JSON.stringify({ walk: 30, swim: 40 }))
check('empty data does not throw', sheetFromLegacy({}).hp.max === 1)

const ro = rollsIn('Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6 + 2) slashing damage plus 3 (1d6) fire damage.')
check('attack and damage are found in the text', ro.attack === 4 && ro.damage.length === 2 && ro.damage[0].expr === '1d6+2' && ro.damage[0].type === 'slashing' && ro.damage[1].type === 'fire')
check('a saving throw is found', rollsIn('Each creature must succeed on a DC 13 Dexterity saving throw').save?.dc === 13 && rollsIn('nothing here').attack === null)
check('a minus sign in the bonus', rollsIn('−1 to hit').attack === -1 || rollsIn('-1 to hit').attack === -1)

const ch = emptyCharacter()
ch.abilities = { str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 10 }
ch.classes = [{ name: 'Wizard', level: 5 }]
ch.profs = { saves: ['int', 'wis'], skills: { arcana: 'e', stealth: 'p' } }
ch.spellcasting = { ability: 'int', slots: [{ total: 4, used: 3 }, { total: 3, used: 3 }, { total: 2, used: 0 }] }
ch.hitDice = [{ sides: 6, total: 5, used: 4 }]
ch.hp = { max: 28, formula: '', current: 3, temp: 2 }
check('a character is told apart and has a level', isCharacter(ch) && !isCharacter(sheetFromLegacy({})) && characterLevel(ch) === 5)
check('proficiency follows the level', proficiency(ch) === 3 && proficiency({ ...ch, classes: [{ name: 'a', level: 1 }] }) === 2 && proficiency({ ...ch, classes: [{ name: 'a', level: 9 }] }) === 4 && proficiency({ ...ch, classes: [{ name: 'a', level: 17 }] }) === 6)
check('multiclass levels add up', characterLevel({ ...ch, classes: [{ name: 'a', level: 3 }, { name: 'b', level: 2 }] }) === 5)
check('saves add proficiency when proficient', saveBonus(ch, 'int') === 7 && saveBonus(ch, 'dex') === 2 && saveBonus(ch, 'wis') === 4)
check('skills: expertise doubles, proficient adds, others are the modifier', skillBonus(ch, 'arcana') === 10 && skillBonus(ch, 'stealth') === 5 && skillBonus(ch, 'history') === 4 && skillBonus(ch, 'athletics') === -1)
check('passive Perception uses the skill', passivePerception(ch) === 11)
check('spell save DC and attack bonus', spellDC(ch) === 15 && spellAttack(ch) === 7 && spellDC(emptyCharacter()) === null)
const geared = { ...ch, inventory: [{ name: 'Cloak of protection', qty: 1, equipped: true, note: '', saveBonus: 1 }, { name: 'Wand', qty: 1, equipped: true, note: '', spellBonus: 2 }, { name: 'Spare cloak', qty: 1, equipped: false, note: '', saveBonus: 1 }] }
check('an equipped item adds to every saving throw', saveBonus(geared as any, 'int') === 8 && saveBonus(geared as any, 'dex') === 3)
check('and one that is not equipped does not', saveBonus({ ...geared, inventory: geared.inventory.slice(2) } as any, 'int') === 7)
check('a wand adds to the spell save DC and the spell attack', spellDC(geared as any) === 17 && spellAttack(geared as any) === 9)
const rest = longRestPatch(ch) as any
check('a long rest restores hit points, slots and half the hit dice', rest['hp.current'] === 28 && rest['hp.temp'] === 0 && rest['spellcasting.slots'].every((s: any) => s.used === 0) && rest.hitDice[0].used === 2 && rest.deathSaves.fail === 0)
check('creatures are unchanged', saveBonus(s, 'dex') === 4 && skillBonus(s, 'stealth') === 4 && skillBonus(s, 'athletics') === 4)

const pf = emptyPf2eCreature()
pf.pf2e!.perception = 9
check('a Pathfinder 2e creature rolls initiative with Perception', initiativeBonus(pf) === 9 && pf.ruleset === 'pf2e' && initiativeBonus({ ...pf, initiative: 3 }) === 3)
check('multiple attack penalty: -5 and -10, agile -4 and -8', JSON.stringify(multipleAttack(15)) === '[15,10,5]' && JSON.stringify(multipleAttack(15, true)) === '[15,11,7]')

const pc = emptyPf2eCharacter()
pc.pf2e!.level = 5
pc.pf2e!.mods = { str: 4, dex: 2, con: 1, int: 0, wis: 3, cha: 1 }
const cc = pc.pf2e!.char!
cc.keyAbility = 'str'
cc.ranks = { perception: 2, fort: 2, ref: 1, will: 2, classDc: 1, spell: 1, armor: 1, skills: { athletics: 3, stealth: 1 } }
cc.armor = { name: 'Breastplate', bonus: 4, dexCap: 1 }
cc.acExtra = 1
cc.strikes = [{ name: 'Longsword', ability: 'str', rank: 2, item: 1, damage: '1d8+4 slashing', agile: false, note: '' }]
cc.spellAbility = 'wis'
check('proficiency is level plus two per rank, nothing untrained', rankBonus(5, 0) === 0 && rankBonus(5, 1) === 7 && rankBonus(5, 2) === 9 && rankBonus(5, 4) === 13)
check('Perception and saves from modifiers and ranks', pfPerception(pc) === 12 && pfSave(pc, 'fort') === 10 && pfSave(pc, 'ref') === 9 && pfSave(pc, 'will') === 12)
check('skills: master Athletics, trained Stealth, untrained Arcana', pfSkill(pc, 'athletics') === 15 && pfSkill(pc, 'stealth') === 9 && pfSkill(pc, 'arcana') === 0)
check('armor class caps Dexterity at what the armor allows', pfAc(pc) === 10 + 1 + 4 + 7 + 1)
check('a strike adds the ability, the rank and the item', pfStrike(pc, cc.strikes[0]) === 4 + 9 + 1)
check('class DC and spell numbers', pfClassDc(pc) === 10 + 4 + 7 && pfSpellAttack(pc) === 3 + 7 && pfSpellDc(pc) === 20 && pfClassDc(emptyPf2eCharacter()) === null)
const dv = pfDerived(pc) as any
check('the numbers other parts read are written back', dv['pf2e.perception'] === 12 && dv['pf2e.will'] === 12 && dv['ac.value'] === 23)
pc.hp = { max: 60, formula: '', current: 10, temp: 0 }
pc.spellcasting = { ability: '', slots: [{ total: 3, used: 3 }] }
const prest = pfRestPatch(pc) as any
check('a night of rest heals Constitution times level and returns spells', prest['hp.current'] === 15 && prest['spellcasting.slots'][0].used === 0 && (pfRestPatch({ ...pc, hp: { max: 8, formula: '', current: 5 } }) as any)['hp.current'] === 8)

const plan = importPlan(dragon, null as any)
check('import writes the sheet and the old stat block', plan.props.sheet?.hp.max === 110 && plan.props.data.main.data.hp === '110 (13d10 + 39)')
check('sheetOf prefers the stored sheet', sheetOf(plan.props)?.name === 'Test Drake' && sheetOf({ data: { main: { template: '5e-monster', data: { name: 'Old', hp: '9 (2d8)' } } } })?.hp.max === 9 && sheetOf({}) === null)
check('whole patch has every top-level key', Object.keys(wholeSheetPatch(s)).length === Object.keys(s).length)

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nall passed')
