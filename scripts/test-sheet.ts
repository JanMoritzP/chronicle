import { creatureToStatBlock, importPlan } from '../web/src/lib/open5e'
import { abilityMod, sheetOf, wholeSheetPatch, crFromText, crText, initiativeBonus, passivePerception, profBonus, saveBonus, sheetFromCreature, sheetFromLegacy, speedText } from '../web/src/lib/sheet'
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

const plan = importPlan(dragon, null as any)
check('import writes the sheet and the old stat block', plan.props.sheet?.hp.max === 110 && plan.props.data.main.data.hp === '110 (13d10 + 39)')
check('sheetOf prefers the stored sheet', sheetOf(plan.props)?.name === 'Test Drake' && sheetOf({ data: { main: { template: '5e-monster', data: { name: 'Old', hp: '9 (2d8)' } } } })?.hp.max === 9 && sheetOf({}) === null)
check('whole patch has every top-level key', Object.keys(wholeSheetPatch(s)).length === Object.keys(s).length)

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nall passed')
