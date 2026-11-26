// A tiny stand-in for the Open5e API, so the library tests never need the internet.
// node fake-open5e.mjs <port>
import http from 'node:http'

const doc = 'srd-2014'
const data = {
  documents: [{ key: doc, name: 'SRD 2014', display_name: 'System Reference Document 5.1', publication_date: '2014-01-01', licenses: [{ name: 'Open Gaming License' }], gamesystem: { key: '5e-2014' }, permalink: 'https://example.test/srd' },
    { key: 'srd-2024', name: 'SRD 2024', display_name: 'System Reference Document 5.2', publication_date: '2025-01-01', licenses: [{ name: 'Creative Commons Attribution 4.0' }], gamesystem: { key: '5e-2024' }, permalink: 'https://example.test/srd-2024' }],
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
    // the fighter of both editions: the library keeps both, and a 2014 sheet levels with the 2014 one
    { key: 'srd_fighter', name: 'Fighter', document: doc, desc: 'A master of martial combat.', hit_points: { hit_dice_name: 'D10' }, features: [
      { name: 'Second Wind', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'Regain hit points as a bonus action.', gained_at: [{ level: 1, detail: null }] },
      { name: 'Action Surge', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'Take one additional action.', gained_at: [{ level: 17, detail: 'two uses' }, { level: 2, detail: 'one use' }] },
      { name: 'Martial Archetype', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'Choose an archetype.', gained_at: [{ level: 3, detail: null }] },
      { name: 'Ability Score Improvement', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'Raise your scores.', gained_at: [4, 6, 8, 12, 14, 16, 19].map((level) => ({ level, detail: null })) },
      { name: 'Extra Attack', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'Attack twice when you take the Attack action.', gained_at: [{ level: 5, detail: '1' }, { level: 11, detail: '2' }, { level: 20, detail: '3' }] },
      { name: 'Indomitable', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'Reroll a failed saving throw.', gained_at: [{ level: 9, detail: 'one use' }, { level: 13, detail: 'two uses' }, { level: 17, detail: 'three uses' }] },
    ] },
    { key: 'srd_champion', name: 'Champion', document: doc, desc: 'Raw physical power.', subclass_of: { name: 'Fighter', key: 'srd_fighter' }, features: [
      { name: 'Improved Critical', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'You score a critical hit on a 19 or 20.', gained_at: [{ level: 3, detail: null }] },
      { name: 'Remarkable Athlete', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'Add half your proficiency bonus to some checks.', gained_at: [{ level: 7, detail: null }] },
      { name: 'Superior Critical', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'You score a critical hit on an 18 to 20.', gained_at: [{ level: 15, detail: null }] },
      { name: 'Survivor', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'Regain hit points at the start of each turn.', gained_at: [{ level: 18, detail: null }] },
    ] },
    { key: 'srd-2024_fighter', name: 'Fighter', document: 'srd-2024', desc: 'A master of all arms.', hit_points: { hit_dice_name: 'D10' }, features: [
      { name: 'Weapon Mastery', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'Use the mastery properties of weapons.', gained_at: [{ level: 1, detail: null }] },
      { name: 'Tactical Mind', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'Use Second Wind on a failed check.', gained_at: [{ level: 2, detail: null }] },
    ] },
    { key: 'srd-2024_champion', name: 'Champion', document: 'srd-2024', desc: 'Athletic excellence.', subclass_of: { name: 'Fighter', key: 'srd-2024_fighter' }, features: [{ name: 'Remarkable Athlete', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'Advantage on initiative.', gained_at: [{ level: 3, detail: null }] }] },
    { key: 'tdcs_juggernaut', name: 'Path of Steel', document: doc, desc: 'Not a fighter subclass.', subclass_of: { name: 'Barbarian', key: 'srd_barbarian' }, features: [] },
    { key: 'evoker', name: 'Evoker', document: doc, desc: 'A master of destructive magic.', subclass_of: { name: 'Wizard', key: 'wizard' }, features: [{ name: 'Sculpt Spells', feature_type: 'CLASS_LEVEL_FEATURE', desc: 'You shape your spells around allies.', gained_at: [{ level: 2 }] }] },
  ],
  species: [
    { key: 'elf', name: 'Elf', document: doc, desc: 'Graceful and long lived.', is_subspecies: false, traits: [{ name: 'Darkvision', desc: '**_Darkvision._** You can see in dim light within 60 feet.', order: 1 }, { name: 'Fey Ancestry', desc: 'You have advantage against being Charmed.', order: 2 }] },
    { key: 'high-elf', name: 'High Elf', document: doc, desc: 'A scholarly elf.', is_subspecies: true, subspecies_of: 'elf', traits: [] },
    // a species the character builder does not have itself, with a subspecies, so it offers them from the library
    { key: 'catfolk', name: 'Catfolk', document: doc, desc: 'Lithe hunters.', is_subspecies: false, traits: [{ name: 'Ability Score Increase', desc: 'Your Dexterity score increases by 2.' }, { name: 'Speed', desc: 'Your base walking speed is 30 feet.' }, { name: 'Size', desc: 'Your size is Medium.' }, { name: "Hunter's Senses", desc: 'You have proficiency in the Perception and Stealth skills.' }] },
    { key: 'malkin', name: 'Malkin', document: doc, desc: 'A curious catfolk.', is_subspecies: true, subspecies_of: 'catfolk', traits: [{ name: 'Ability Score Increase', desc: 'Your Intelligence score increases by 1.' }, { name: 'Curiously Clever', desc: 'You have proficiency in the Investigation skill.' }] },
  ],
  backgrounds: [{ key: 'sage', name: 'Sage', document: doc, desc: 'You spent years learning the lore of the multiverse.', benefits: [{ name: 'Skill Proficiencies', desc: 'Arcana, History' }, { name: 'Feature: Researcher', desc: 'You know where to find answers.' }] }],
  feats: [{ key: 'alert', name: 'Alert', document: doc, type: 'GENERAL', prerequisite: 'Level 4 or higher', desc: 'You are always on the lookout for danger.', benefits: [{ desc: 'You add your proficiency bonus to initiative.' }, { desc: 'You cannot be surprised while conscious.' }] },
    { key: 'srd-2024_savage-attacker', name: 'Savage Attacker', document: 'srd-2024', type: 'ORIGIN', desc: 'You have trained to deal particularly damaging strikes.', benefits: [{ desc: 'Once per turn when you hit with a weapon, roll its damage dice twice and use either roll.' }] },
    { key: 'srd-2024_skilled', name: 'Skilled', document: 'srd-2024', type: 'ORIGIN', desc: 'You have exceptionally broad learning.', benefits: [{ desc: 'You gain proficiency in any combination of three skills or tools.' }] }],
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
