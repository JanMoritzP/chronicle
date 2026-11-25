// Bundle with esbuild and run with node:
//   npx esbuild scripts/test-open5erules.ts --bundle --platform=node --format=esm --outfile=$env:TEMP\t.mjs; node $env:TEMP\t.mjs
// Open5e's classes, species and backgrounds read as rules for the character builder. The fixtures are cut from the real data.
import { homebrewCatalog, open5eOptions, rulesFromFields } from '../web/src/lib/homebrew'
import { buildCharacter, type Choices } from '../web/src/lib/builder'
import { backgroundRulesFromOpen5e, classRulesFromOpen5e, sameAsBuiltin, speciesRulesFromOpen5e, startingKit } from '../web/src/lib/open5eRules'
import type { BuilderEntry } from '../web/src/types'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

// 2024: the table of core traits. Its structured saving throws are wrong (Dexterity and Strength); the table is right.
const fighter2024 = {
  system: '5e-2024', hit_dice: 'D10', saving_throws: [{ name: 'Dexterity' }, { name: 'Strength' }], primary_abilities: [],
  features: [
    { name: 'Core Fighter Traits', feature_type: 'CORE_TRAITS_TABLE', desc: "|||\n|---|---|\n|Primary Ability|Strength or Dexterity|\n|Hit Point Die|D10 per Fighter level|\n|Saving Throw Proficiencies|Strength and Constitution|\n|Skill Proficiencies|Choose 2: Acrobatics, Animal Handling, Athletics, History, Insight, Intimidation, Persuasion, Perception, or Survival|\n|Armor Training|Light, Medium, and Heavy armor and Shields|\n|Starting Equipment|Choose A, B, or C: (A) Chain Mail, Greatsword, Flail, 8 Javelins, Dungeoneer's Pack, and 4 GP; (B) Studded Leather Armor, Scimitar; or (C) 155 GP|" },
    { name: 'Second Wind', feature_type: 'CLASS_LEVEL_FEATURE', gained_at: [{ level: 1 }], desc: 'You have a limited well of physical and mental stamina that you can draw on. As a Bonus Action, you can use it to regain Hit Points equal to 1d10 plus your Fighter level.\n\nYou can use this feature twice.' },
    { name: 'Action Surge', feature_type: 'CLASS_LEVEL_FEATURE', gained_at: [{ level: 2 }], desc: 'One more action.' },
  ],
}
const f = classRulesFromOpen5e(fighter2024)
check('2024: hit die from the data', f.die === 10)
check('2024: saving throws from the table, not the wrong field', f.saves.join() === 'str,con', f.saves.join())
check('2024: main abilities from the table', f.primary.join() === 'str,dex')
check('2024: choose 2 of 9 skills', f.skills.count === 2 && Array.isArray(f.skills.from) && f.skills.from.length === 9)
check('2024: heavy armor and shields give chain mail and a shield', f.armor.base === 16 && f.armor.dex === 'none' && !!f.armor.shield)
check('2024: the gear of choice A, gold left out', f.kit.map((k) => `${k.qty ?? 1} ${k.name}`).join(', ') === "1 Chain Mail, 1 Greatsword, 1 Flail, 8 Javelins, 1 Dungeoneer's Pack", f.kit.map((k) => k.name).join(', '))
check('only level 1 features', f.features.map((x) => x.name).join() === 'Second Wind')
check('a feature keeps its first paragraph', f.features[0].text.endsWith('Fighter level.'))

// 2014: proficiencies in bold labels, Windows line ends, gear as (a)/(b) bullets
const rogue2014 = {
  system: '5e-2014', hit_dice: 'D8', saving_throws: [{ name: 'Dexterity' }, { name: 'Intelligence' }], primary_abilities: [],
  features: [
    { name: 'Proficiencies', feature_type: 'PROFICIENCIES', desc: "**Armor:** Light armor\r\n**Weapons:** Simple weapons, hand crossbows\r\n**Tools:** Thieves' tools\r\n**Saving Throws:** Dexterity, Intelligence\r\n**Skills:** Choose four from Acrobatics, Athletics, Deception, Insight, Intimidation, Investigation, Perception, Performance, Persuasion, Sleight of Hand, and Stealth" },
    { name: 'Starting Equipment', feature_type: 'STARTING_EQUIPMENT', desc: 'You start with the following equipment, in addition to the equipment granted by your background:\r\n* (*a*) a rapier or (*b*) a shortsword\r\n* (*a*) a shortbow and quiver of 20 arrows or (*b*) a shortsword\r\n* (*a*) a burglar’s pack, (*b*) a dungeoneer’s pack, or (*c*) an explorer’s pack\r\n* (*a*) Leather armor, two daggers, and thieves’ tools' },
    { name: 'Sneak Attack', feature_type: 'CLASS_LEVEL_FEATURE', gained_at: [{ level: 1 }], desc: 'Once per turn, extra damage.' },
  ],
}
const r = classRulesFromOpen5e(rogue2014)
check('2014: saves from the proficiencies', r.saves.join() === 'dex,int')
check('2014: four of eleven skills', r.skills.count === 4 && Array.isArray(r.skills.from) && r.skills.from.length === 11)
check('2014: light armor is leather', r.armor.base === 11 && r.armor.dex === 'full' && !r.armor.shield)
check('2014: no main ability named: the first Strength or Dexterity save', r.primary.join() === 'dex')
check('2014: the (a) of every line, never the (b) or (c)', r.kit.map((k) => k.name).join(', ') === 'Rapier, Shortbow, Quiver of 20 arrows, Burglar’s pack, Leather armor, Daggers, Thieves’ tools' && r.kit.find((k) => k.name === 'Daggers')?.qty === 2, r.kit.map((k) => k.name).join(', '))
check('a package list takes the first package only', startingKit('You begin the game with 200 gp.\n\n- **Skirmisher’s Set (Cost 193 gp):** 6 javelins, longsword, hauberk\n- **Soldier\'s Set (Cost 111 gp):** Battleaxe, scimitar').map((k) => k.name).join() === 'Javelins,Longsword,Hauberk')

const marshal = classRulesFromOpen5e({ hit_dice: 'D10', features: [{ name: 'Proficiencies', feature_type: 'PROFICIENCIES', desc: '**Armor:** Light armor, medium armor, heavy armor, shields\n**Saving Throws:** Wisdom, Charisma' }] })
check('no main ability, no Strength or Dexterity save: heavy armor means Strength', marshal.primary.join() === 'str' && marshal.saves.join() === 'wis,cha')
const monk = classRulesFromOpen5e({ hit_dice: 'D8', features: [{ name: 'Unarmored Defense', feature_type: 'CLASS_LEVEL_FEATURE', gained_at: [{ level: 1 }], desc: 'Beginning at 1st level, while you are wearing no armor and not wielding a shield, your AC equals 10 + your Dexterity modifier + your Wisdom modifier.' }] })
check('Unarmored Defense adds the ability it names', monk.armor.base === 10 && monk.armor.plus === 'wis' && !monk.armor.shield)
const wizard = classRulesFromOpen5e({ hit_dice: 'D6', features: [{ name: 'Spellcasting', feature_type: 'CLASS_LEVEL_FEATURE', gained_at: [{ level: 1 }], desc: 'Intelligence is your spellcasting ability for your wizard spells.' }] })
check('the spellcasting ability is read, and is the main one when none is named', wizard.spell === 'int' && wizard.primary.join() === 'int')

// species: 2014 traits, a subspecies with its parent
const catfolk = { traits: [
  { name: 'Ability Score Increase', desc: 'Your Dexterity score increases by 2.' },
  { name: 'Speed', desc: 'Your base walking speed is 30 feet.' },
  { name: 'Darkvision', desc: 'You can see in dim light within 60 feet of you as if it were bright light.' },
  { name: 'Size', desc: 'Catfolk have a similar stature to humans. Your size is Medium' },
  { name: 'Languages', desc: 'You can speak, read, and write Common.' },
  { name: "Hunter's Senses", desc: 'You have proficiency in the Perception and Stealth skills.' },
] }
const malkin = { subspecies_of: 'toh_catfolk', traits: [
  { name: 'Ability Score Increase', desc: 'Your Intelligence score increases by 1.' },
  { name: 'Curiously Clever', desc: 'You have proficiency in the Investigation skill.' },
] }
const m = speciesRulesFromOpen5e(malkin, catfolk)
check('a subspecies adds to its parent', m.asi?.dex === 2 && m.asi?.int === 1 && m.speed === 30 && m.darkvision === 60 && m.size === 'Medium', JSON.stringify(m.asi))
check('skills from both', m.skills?.join() === 'perception,stealth,investigation', m.skills?.join())
check('numbers are not traits', m.traits.map((t) => t.name).join() === "Hunter's Senses,Curiously Clever", m.traits.map((t) => t.name).join())
check('languages read', m.languages === 'Common')
const halfElf = speciesRulesFromOpen5e({ traits: [{ name: 'Ability Score Increase', desc: 'Your Charisma score increases by 2, and two other ability scores of your choice increase by 1.' }] })
check('two scores of the player\'s choice', halfElf.asi?.cha === 2 && halfElf.freeAsi === 2)
const elf2024 = speciesRulesFromOpen5e({ traits: [{ name: 'Size', type: 'SIZE', desc: 'Medium (about 4–7 feet tall)' }, { name: 'Speed', type: 'SPEED', desc: '30 feet' }, { name: 'Keen Senses', desc: 'You have proficiency in the Insight, Perception, or Survival skill.' }, { name: 'Dwarven Toughness', desc: 'Your Hit Point maximum increases by 1, and it increases by 1 again whenever you gain a level.' }] })
check('2024: size and speed of their own kind', elf2024.size === 'Medium' && elf2024.speed === 30)
check('a choice of skills is not three skills', !elf2024.skills?.length)
check('toughness becomes hit points per level', elf2024.hpPerLevel === 1)

// backgrounds
const soldier = backgroundRulesFromOpen5e({ benefits: [
  { type: 'ability_score', desc: 'Strength, Dexterity, Constitution' }, { type: 'feat', desc: 'Savage Attacker' },
  { type: 'skill_proficiency', desc: 'Athletics and Intimidation' }, { type: 'tool_proficiency', desc: 'Choose one kind of Gaming Set' },
] })
check('2024 background: skills, scores and feat', soldier.skills.join() === 'athletics,intimidation' && soldier.abilities?.join() === 'str,dex,con' && soldier.feat === 'Savage Attacker')
const acolyte = backgroundRulesFromOpen5e({ benefits: [{ type: 'skill_proficiency', desc: 'Insight, Religion' }, { type: 'language', desc: 'Two of your choice' }] })
check('2014 background: tools and languages', acolyte.skills.join() === 'insight,religion' && acolyte.tools === 'Languages: Two of your choice' && !acolyte.abilities?.length)

// names the builder has itself are left out
check('same name as a built-in', sameAsBuiltin('Hill Dwarf', ['Hill dwarf']) && sameAsBuiltin('Lightfoot', ['Lightfoot halfling']) && !sameAsBuiltin('Malkin', ['Hill dwarf', 'Human']))
const entries: BuilderEntry[] = [
  { key: 'class:srd-2024_fighter', category: 'class', name: 'Fighter', library: '5e 2024 Rules', open5e: fighter2024 },
  { key: 'class:a5e_marshal', category: 'class', name: 'Marshal', library: 'Level Up', open5e: fighter2024 },
  { key: 'species:toh_catfolk', category: 'species', name: 'Catfolk', library: 'Tome of Heroes', open5e: catfolk },
  { key: 'species:toh_malkin', category: 'species', name: 'Malkin', library: 'Tome of Heroes', open5e: { ...malkin, is_subspecies: true } },
  { key: 'background:srd-2024_soldier', category: 'background', name: 'Soldier', library: '5e 2024 Rules', open5e: { benefits: [] } },
  { key: 'class:hb.x.knight', category: 'class', name: 'Knight', library: 'Mine', rules: null, fields: { hit_die: 'd12', saves: [{ name: 'Strength' }, { name: 'Wisdom' }] } },
]
const opts = open5eOptions(entries)
check('Open5e: built-in names and parents of subspecies are left out', opts.map((o) => o.name).join() === 'Malkin (Catfolk),Marshal', opts.map((o) => o.name).join())
check('Open5e options are marked as such', opts.every((o) => o.kind === 'open5e' && o.id.startsWith('lib:')))
const knight = rulesFromFields('class', entries[5].fields) as any
check('homebrew without rules: worked out from its fields', knight.die === 12 && knight.saves.join() === 'str,wis' && knight.skills.from === 'any')

// a character built from them
const cat = homebrewCatalog('5e', opts)
const choices: Choices = { ruleset: '5e', name: 'Mira', classId: 'lib:class:a5e_marshal', speciesId: 'lib:species:toh_malkin', backgroundId: 'acolyte', base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, bonus: {}, skills: ['athletics', 'history'], alignment: '' }
const sheet = buildCharacter(choices, cat)
check('a character of an Open5e class and species', sheet.classes?.[0].name === 'Marshal' && sheet.species === 'Malkin (Catfolk)' && sheet.abilities.dex === 16 && sheet.abilities.int === 13 && sheet.hp.max === 11 && sheet.ac.value === 18, `${sheet.hp.max} hp, ac ${sheet.ac.value}`)

if (failed) { console.log(`${failed} failed`); process.exit(1) }
console.log('all passed')
