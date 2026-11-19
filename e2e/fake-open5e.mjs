// A tiny stand-in for the Open5e API, so the library tests never need the internet.
// node fake-open5e.mjs <port>
import http from 'node:http'

const doc = 'srd-2014'
const data = {
  documents: [{ key: doc, name: 'SRD 2014', display_name: 'System Reference Document 5.1', publication_date: '2014-01-01', licenses: [{ name: 'Open Gaming License' }], gamesystem: { key: '5e-2014' }, permalink: 'https://example.test/srd' }],
  spells: [
    {
      key: 'srd_fireball', name: 'Fireball', document: doc, level: 3, school: { name: 'Evocation', key: 'evocation' }, casting_time: 'action', range_text: '150 feet', duration: 'instantaneous',
      concentration: false, ritual: false, verbal: true, somatic: true, material: true, material_specified: 'a tiny ball of bat guano and sulfur',
      desc: 'A bright streak flashes to a point you choose. Each creature in a 20-foot-radius sphere takes 8d6 fire damage.',
      higher_level: 'The damage increases by 1d6 for each slot level above 3rd.', classes: [{ name: 'Wizard', key: 'wizard' }],
    },
    {
      key: 'srd_light', name: 'Light', document: doc, level: 0, school: { name: 'Evocation', key: 'evocation' }, casting_time: 'action', range_text: 'Touch', duration: '1 hour',
      concentration: false, ritual: false, verbal: true, somatic: false, material: false, desc: 'You touch one object. It sheds bright light for an hour.', classes: [{ name: 'Wizard', key: 'wizard' }],
    },
  ],
  creatures: [
    {
      key: 'srd_goblin', name: 'Goblin', document: doc, challenge_rating: 0.25, size: { name: 'Small', key: 'small' }, type: { name: 'Humanoid', key: 'humanoid' }, alignment: 'neutral evil',
      armor_class: 15, hit_points: 7, hit_dice: '2d6', speed: { walk: 30 }, ability_scores: { strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8 },
      passive_perception: 9, languages: { as_string: 'Common, Goblin' },
      traits: [{ name: 'Nimble Escape', desc: 'The goblin can take the Disengage or Hide action as a bonus action.' }],
      actions: [{ name: 'Scimitar', desc: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.' }],
    },
    {
      key: 'srd_wolf', name: 'Wolf', document: doc, challenge_rating: 0.25, size: { name: 'Medium', key: 'medium' }, type: { name: 'Beast', key: 'beast' }, alignment: 'unaligned',
      armor_class: 13, hit_points: 11, hit_dice: '2d8', speed: { walk: 40 }, ability_scores: { strength: 12, dexterity: 15, constitution: 12, intelligence: 3, wisdom: 12, charisma: 6 },
      passive_perception: 13, languages: { as_string: '' }, traits: [], actions: [{ name: 'Bite', desc: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) piercing damage.' }],
    },
  ],
  magicitems: [{ key: 'srd_bag-of-holding', name: 'Bag of Holding', document: doc, rarity: { name: 'Uncommon' }, category: { name: 'Wondrous Item' }, requires_attunement: false, desc: 'This bag has an interior space considerably larger than its outside dimensions.' }],
  conditions: [{ key: 'srd_prone', name: 'Prone', document: doc, descriptions: [{ desc: 'A prone creature can only crawl until it stands up.' }] }],
  damagetypes: [{ key: 'srd_fire', name: 'Fire', document: doc, desc: 'Flames and hot gases.' }],
  spellschools: [{ key: 'srd_evocation', name: 'Evocation', document: doc, desc: 'Evocation spells manipulate magical energy.' }],
  classes: [
    {
      key: 'wizard', name: 'Wizard', document: doc, desc: 'A scholarly magic-user.', hit_points: { hit_dice_name: 'D6' }, saving_throws: [{ name: 'Intelligence' }, { name: 'Wisdom' }], primary_abilities: ['Intelligence'],
      features: [
        { name: 'Core Wizard Traits', feature_type: 'CORE_TRAITS_TABLE', desc: '|Trait|Value|\n|---|---|\n|Primary Ability|Intelligence|\n|Hit Point Die|D6 per Wizard level|' },
        { name: 'Proficiencies', feature_type: 'PROFICIENCIES', desc: 'Saving throws: Intelligence and Wisdom. Skills: Arcana and History.' },
        { name: 'Starting Equipment', feature_type: 'STARTING_EQUIPMENT', desc: 'A spellbook and a quarterstaff.' },
        { name: 'Proficiency Bonus', feature_type: 'PROFICIENCY_BONUS', data_for_class_table: [{ level: 1, column_value: '+2' }, { level: 2, column_value: '+2' }, { level: 5, column_value: '+3' }] },
        { name: 'Cantrips', feature_type: 'CLASS_TABLE_DATA', data_for_class_table: [{ level: 1, column_value: '3' }, { level: 2, column_value: '3' }] },
        { name: '1st', feature_type: 'SPELL_SLOTS', data_for_class_table: [{ level: 1, column_value: '2' }, { level: 2, column_value: '3' }] },
        { name: 'Spellcasting', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'You cast Fireball and other spells from your spellbook.', gained_at: [{ level: 1 }] },
        { name: 'Arcane Recovery', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'You regain some spell slots when you finish a short rest.', gained_at: [{ level: 1 }] },
        { name: 'Arcane Tradition', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'Choose a school of magic.', gained_at: [{ level: 2 }] },
      ],
    },
    { key: 'evoker', name: 'Evoker', document: doc, desc: 'A master of destructive magic.', subclass_of: { name: 'Wizard', key: 'wizard' }, features: [{ name: 'Sculpt Spells', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'You shape your spells around allies.', gained_at: [{ level: 2 }] }] },
  ],
  species: [
    { key: 'elf', name: 'Elf', document: doc, desc: 'Graceful and long lived.', is_subspecies: false, traits: [{ name: 'Darkvision', desc: '**_Darkvision._** You can see in dim light within 60 feet.', order: 1 }, { name: 'Fey Ancestry', desc: 'You have advantage against being Charmed.', order: 2 }] },
    { key: 'high-elf', name: 'High Elf', document: doc, desc: 'A scholarly elf.', is_subspecies: true, subspecies_of: 'elf', traits: [] },
  ],
  backgrounds: [{ key: 'sage', name: 'Sage', document: doc, desc: 'You spent years learning the lore of the multiverse.', benefits: [{ name: 'Skill Proficiencies', desc: 'Arcana, History' }, { name: 'Feature: Researcher', desc: 'You know where to find answers.' }] }],
  feats: [{ key: 'alert', name: 'Alert', document: doc, type: 'GENERAL', prerequisite: 'Level 4 or higher', desc: 'You are always on the lookout for danger.', benefits: [{ desc: 'You add your proficiency bonus to initiative.' }, { desc: 'You cannot be surprised while conscious.' }] }],
  items: [
    { key: 'longsword', name: 'Longsword', document: doc, category: { name: 'Weapon' }, cost: '15.00', weight: '3.000', weight_unit: 'lb', desc: 'A versatile blade.', weapon: { damage_dice: '1d8', damage_type: { name: 'Slashing', key: 'slashing' }, properties: [{ property: { name: 'Versatile', key: 'versatile' }, detail: '1d10' }, { property: { name: 'Finesse', key: 'finesse' } }] } },
    { key: 'chain-mail', name: 'Chain Mail', document: doc, category: { name: 'Armor' }, cost: '75.00', weight: '55.000', weight_unit: 'lb', desc: 'Interlocking metal rings.', armor: { ac_display: '16', strength_score_required: 13, grants_stealth_disadvantage: true } },
  ],
  weaponproperties: [{ key: 'finesse', name: 'Finesse', document: doc, type: 'Melee', desc: 'You can use Strength or Dexterity for the attack and damage rolls.' }, { key: 'versatile', name: 'Versatile', document: doc, desc: 'Can be used with one or two hands.' }],
  skills: [{ key: 'srd_stealth', name: 'Stealth', document: doc, ability: 'dexterity', descriptions: [{ desc: 'Moving silently and hiding.', document: doc }] }],
  abilities: [{ key: 'dexterity', name: 'Dexterity', document: doc, short_desc: 'agility, reflexes and balance', skills: [{ key: 'srd_stealth' }], descriptions: [{ desc: 'Dexterity measures agility.', document: doc }] }],
  languages: [{ key: 'elvish', name: 'Elvish', document: doc, script_language: 'elvish', is_exotic: false, desc: 'The language of the elves.' }],
  creaturetypes: [{ key: 'beast', name: 'Beast', document: doc, descriptions: [{ desc: 'Beasts are nonhumanoid creatures.', document: doc }] }],
  alignments: [{ key: 'neutral-evil', document: doc, short_name: 'NE', societal_attitude: 'neutral', morality: 'evil', descriptions: [{ desc: 'Neutral evil does whatever it can get away with.', document: doc }] }],
  sizes: [{ key: 'small', name: 'Small', document: doc, space_diameter: 5, distance_unit: 'feet', suggested_hit_dice: 'd6' }],
  rules: [{ key: 'cover', name: 'Cover', document: doc, ruleset: 'srd-2014_combat', desc: 'Walls and trees provide cover.' }],
}

const port = Number(process.argv[2])
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const m = /^\/v2\/([a-z]+)\/?$/.exec(url.pathname)
  res.setHeader('content-type', 'application/json')
  if (!m) { res.statusCode = 404; res.end('{}'); return }
  const results = data[m[1]] ?? []
  res.end(JSON.stringify({ count: results.length, next: null, results }))
}).listen(port, '127.0.0.1')
