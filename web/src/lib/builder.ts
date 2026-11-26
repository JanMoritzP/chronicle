import { ABILITIES, abilityMod, emptyCharacter, type Ability, type Feature, type InventoryItem, type Proficiency, type Sheet } from './sheet'
import { allSlots } from './levelup'

// Making a new 5e character step by step: class, species, background, ability scores, skills, equipment. The rules are the
// System Reference Document's (5.1 for the 2014 rules, 5.2 for 2024), kept short: names, numbers and one line per feature,
// so the sheet that comes out is right at level 1 and can be levelled up from there. Pure functions, no page or server.

export type Ruleset = '5e' | '5e-2024'

export interface ClassDef {
  id: string; name: string; die: number; primary: Ability[]; saves: Ability[]
  skills: { count: number; from: string[] | 'any' }
  spell?: Ability
  /** how its spell slots grow; the classes of the rules are known by name */
  caster?: 'full' | 'half' | 'third' | 'pact'
  subclassLevel?: number
  /** armor class of the starting kit, from the final ability scores */
  ac: (m: Record<Ability, number>) => { value: number; note: string }
  kit: { name: string; qty?: number; weight?: number; equipped?: boolean; note?: string }[]
  /** what a level 1 character of the class can do, one line each */
  features: { name: string; text: string }[]
  attacks: { name: string; ability: 'str' | 'dex' | 'finesse'; damage: string; note?: string }[]
  /** cantrips and spells to choose at level 1, as a reminder on the sheet */
  spells?: string
}

const ANY = 'any' as const
const unarmored = (m: Record<Ability, number>) => ({ value: 10 + m.dex, note: 'no armor' })

export const CLASSES: ClassDef[] = [
  { id: 'barbarian', name: 'Barbarian', die: 12, primary: ['str'], saves: ['str', 'con'], skills: { count: 2, from: ['animal handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'] },
    ac: (m) => ({ value: 10 + m.dex + m.con, note: 'Unarmored Defense' }),
    kit: [{ name: 'Greataxe', weight: 7, equipped: true }, { name: 'Handaxe', qty: 4, weight: 2 }, { name: "Explorer's pack", weight: 59 }],
    features: [{ name: 'Rage', text: 'Bonus action: advantage on Strength checks and saves, extra damage with Strength attacks, resistance to bludgeoning, piercing and slashing damage. Twice per long rest.' }, { name: 'Unarmored Defense', text: 'Without armor, armor class is 10 + Dexterity + Constitution modifiers. A shield still counts.' }],
    attacks: [{ name: 'Greataxe', ability: 'str', damage: '1d12', note: 'slashing, heavy, two-handed' }, { name: 'Handaxe', ability: 'str', damage: '1d6', note: 'slashing, light, thrown 20/60' }] },
  { id: 'bard', name: 'Bard', die: 8, primary: ['cha'], saves: ['dex', 'cha'], skills: { count: 3, from: ANY }, spell: 'cha',
    ac: (m) => ({ value: 11 + m.dex, note: 'leather armor' }),
    kit: [{ name: 'Leather armor', weight: 10, equipped: true }, { name: 'Rapier', weight: 2, equipped: true }, { name: 'Dagger', weight: 1 }, { name: 'Lute', weight: 2 }, { name: "Entertainer's pack", weight: 38 }],
    features: [{ name: 'Bardic Inspiration', text: 'Bonus action: a creature within 60 feet gains a d6 to add to one ability check, attack roll or saving throw. Uses equal to your Charisma modifier per long rest.' }, { name: 'Spellcasting', text: 'Charisma is your spellcasting ability. You know two cantrips and four 1st-level spells.' }],
    attacks: [{ name: 'Rapier', ability: 'finesse', damage: '1d8', note: 'piercing, finesse' }, { name: 'Dagger', ability: 'finesse', damage: '1d4', note: 'piercing, finesse, light, thrown 20/60' }],
    spells: 'Cantrips (2): Vicious Mockery, Minor Illusion\nLevel 1 (4): Healing Word, Charm Person, Dissonant Whispers, Faerie Fire' },
  { id: 'cleric', name: 'Cleric', die: 8, primary: ['wis'], saves: ['wis', 'cha'], skills: { count: 2, from: ['history', 'insight', 'medicine', 'persuasion', 'religion'] }, spell: 'wis',
    ac: (m) => ({ value: 16 + Math.min(2, m.dex), note: 'scale mail and shield' }),
    kit: [{ name: 'Scale mail', weight: 45, equipped: true }, { name: 'Shield', weight: 6, equipped: true, note: '+2 armor class' }, { name: 'Mace', weight: 4, equipped: true }, { name: 'Holy symbol', weight: 1 }, { name: "Priest's pack", weight: 24 }],
    features: [{ name: 'Spellcasting', text: 'Wisdom is your spellcasting ability. You know three cantrips and prepare Wisdom modifier + level spells each day.' }, { name: 'Divine Domain', text: 'Choose a domain at level 1; it grants domain spells and features.' }],
    attacks: [{ name: 'Mace', ability: 'str', damage: '1d6', note: 'bludgeoning' }],
    spells: 'Cantrips (3): Sacred Flame, Guidance, Light\nPrepared: Bless, Cure Wounds, Healing Word, Shield of Faith' },
  { id: 'druid', name: 'Druid', die: 8, primary: ['wis'], saves: ['int', 'wis'], skills: { count: 2, from: ['arcana', 'animal handling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'] }, spell: 'wis',
    ac: (m) => ({ value: 13 + m.dex, note: 'leather armor and wooden shield' }),
    kit: [{ name: 'Leather armor', weight: 10, equipped: true }, { name: 'Wooden shield', weight: 6, equipped: true, note: '+2 armor class' }, { name: 'Scimitar', weight: 3, equipped: true }, { name: 'Druidic focus', weight: 1 }, { name: "Explorer's pack", weight: 59 }],
    features: [{ name: 'Druidic', text: 'You know Druidic, the secret language of druids.' }, { name: 'Spellcasting', text: 'Wisdom is your spellcasting ability. You know two cantrips and prepare Wisdom modifier + level spells each day.' }],
    attacks: [{ name: 'Scimitar', ability: 'finesse', damage: '1d6', note: 'slashing, finesse, light' }],
    spells: 'Cantrips (2): Produce Flame, Guidance\nPrepared: Cure Wounds, Entangle, Faerie Fire, Goodberry' },
  { id: 'fighter', name: 'Fighter', die: 10, primary: ['str', 'dex'], saves: ['str', 'con'], skills: { count: 2, from: ['acrobatics', 'animal handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'] },
    ac: () => ({ value: 18, note: 'chain mail and shield' }),
    kit: [{ name: 'Chain mail', weight: 55, equipped: true }, { name: 'Shield', weight: 6, equipped: true, note: '+2 armor class' }, { name: 'Longsword', weight: 3, equipped: true }, { name: 'Light crossbow', weight: 5 }, { name: 'Crossbow bolts', qty: 20, weight: 0.075 }, { name: "Dungeoneer's pack", weight: 61.5 }],
    features: [{ name: 'Fighting Style', text: 'Defense: +1 armor class while wearing armor (already counted), or another style of your choice.' }, { name: 'Second Wind', text: 'Bonus action: regain 1d10 + fighter level hit points. Once per short or long rest.' }],
    attacks: [{ name: 'Longsword', ability: 'str', damage: '1d8', note: 'slashing, versatile (1d10)' }, { name: 'Light crossbow', ability: 'dex', damage: '1d8', note: 'piercing, range 80/320, loading' }] },
  { id: 'monk', name: 'Monk', die: 8, primary: ['dex', 'wis'], saves: ['str', 'dex'], skills: { count: 2, from: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'] },
    ac: (m) => ({ value: 10 + m.dex + m.wis, note: 'Unarmored Defense' }),
    kit: [{ name: 'Shortsword', weight: 2, equipped: true }, { name: 'Dart', qty: 10, weight: 0.25 }, { name: "Explorer's pack", weight: 59 }],
    features: [{ name: 'Unarmored Defense', text: 'Without armor or a shield, armor class is 10 + Dexterity + Wisdom modifiers.' }, { name: 'Martial Arts', text: 'Use Dexterity for unarmed strikes and monk weapons, which deal at least 1d4; an unarmed strike as a bonus action after attacking.' }],
    attacks: [{ name: 'Shortsword', ability: 'finesse', damage: '1d6', note: 'piercing, finesse, light' }, { name: 'Unarmed strike', ability: 'finesse', damage: '1d4', note: 'bludgeoning' }] },
  { id: 'paladin', name: 'Paladin', die: 10, primary: ['str', 'cha'], saves: ['wis', 'cha'], skills: { count: 2, from: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'] }, spell: 'cha',
    ac: () => ({ value: 18, note: 'chain mail and shield' }),
    kit: [{ name: 'Chain mail', weight: 55, equipped: true }, { name: 'Shield', weight: 6, equipped: true, note: '+2 armor class' }, { name: 'Longsword', weight: 3, equipped: true }, { name: 'Javelin', qty: 5, weight: 2 }, { name: 'Holy symbol', weight: 1 }, { name: "Priest's pack", weight: 24 }],
    features: [{ name: 'Divine Sense', text: 'Know where celestials, fiends and undead are within 60 feet until the end of your next turn. 1 + Charisma modifier times per long rest.' }, { name: 'Lay on Hands', text: 'A pool of 5 × paladin level hit points to heal with a touch, refilled on a long rest.' }],
    attacks: [{ name: 'Longsword', ability: 'str', damage: '1d8', note: 'slashing, versatile (1d10)' }, { name: 'Javelin', ability: 'str', damage: '1d6', note: 'piercing, thrown 30/120' }] },
  { id: 'ranger', name: 'Ranger', die: 10, primary: ['dex', 'wis'], saves: ['str', 'dex'], skills: { count: 3, from: ['animal handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'] }, spell: 'wis',
    ac: (m) => ({ value: 14 + Math.min(2, m.dex), note: 'scale mail' }),
    kit: [{ name: 'Scale mail', weight: 45, equipped: true }, { name: 'Shortsword', qty: 2, weight: 2, equipped: true }, { name: 'Longbow', weight: 2 }, { name: 'Arrows', qty: 20, weight: 0.05 }, { name: "Explorer's pack", weight: 59 }],
    features: [{ name: 'Favored Enemy', text: 'Advantage on Survival checks to track, and Intelligence checks to recall information, about one type of creature.' }, { name: 'Natural Explorer', text: 'Your favored terrain makes travel and foraging easier for the group.' }],
    attacks: [{ name: 'Longbow', ability: 'dex', damage: '1d8', note: 'piercing, range 150/600, heavy, two-handed' }, { name: 'Shortsword', ability: 'finesse', damage: '1d6', note: 'piercing, finesse, light' }] },
  { id: 'rogue', name: 'Rogue', die: 8, primary: ['dex'], saves: ['dex', 'int'], skills: { count: 4, from: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight of hand', 'stealth'] },
    ac: (m) => ({ value: 11 + m.dex, note: 'leather armor' }),
    kit: [{ name: 'Leather armor', weight: 10, equipped: true }, { name: 'Rapier', weight: 2, equipped: true }, { name: 'Shortbow', weight: 2 }, { name: 'Arrows', qty: 20, weight: 0.05 }, { name: 'Dagger', qty: 2, weight: 1 }, { name: "Thieves' tools", weight: 1 }, { name: "Burglar's pack", weight: 44.5 }],
    features: [{ name: 'Expertise', text: 'Double your proficiency bonus for two of your skill proficiencies (mark them with the diamond on the sheet).' }, { name: 'Sneak Attack', text: 'Once per turn, 1d6 extra damage to a creature you hit with a finesse or ranged weapon when you have advantage or an ally is next to it.' }, { name: "Thieves' Cant", text: 'A secret mix of dialect, jargon and code.' }],
    attacks: [{ name: 'Rapier', ability: 'finesse', damage: '1d8', note: 'piercing, finesse' }, { name: 'Shortbow', ability: 'dex', damage: '1d6', note: 'piercing, range 80/320' }] },
  { id: 'sorcerer', name: 'Sorcerer', die: 6, primary: ['cha'], saves: ['con', 'cha'], skills: { count: 2, from: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'] }, spell: 'cha',
    ac: unarmored,
    kit: [{ name: 'Light crossbow', weight: 5, equipped: true }, { name: 'Crossbow bolts', qty: 20, weight: 0.075 }, { name: 'Dagger', qty: 2, weight: 1 }, { name: 'Arcane focus', weight: 1 }, { name: "Dungeoneer's pack", weight: 61.5 }],
    features: [{ name: 'Spellcasting', text: 'Charisma is your spellcasting ability. You know four cantrips and two 1st-level spells.' }, { name: 'Sorcerous Origin', text: 'Choose the source of your magic at level 1; it grants features.' }],
    attacks: [{ name: 'Light crossbow', ability: 'dex', damage: '1d8', note: 'piercing, range 80/320, loading' }, { name: 'Dagger', ability: 'finesse', damage: '1d4', note: 'piercing, finesse, light, thrown 20/60' }],
    spells: 'Cantrips (4): Fire Bolt, Ray of Frost, Light, Prestidigitation\nLevel 1 (2): Magic Missile, Shield' },
  { id: 'warlock', name: 'Warlock', die: 8, primary: ['cha'], saves: ['wis', 'cha'], skills: { count: 2, from: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'] }, spell: 'cha',
    ac: (m) => ({ value: 11 + m.dex, note: 'leather armor' }),
    kit: [{ name: 'Leather armor', weight: 10, equipped: true }, { name: 'Light crossbow', weight: 5 }, { name: 'Crossbow bolts', qty: 20, weight: 0.075 }, { name: 'Dagger', qty: 2, weight: 1 }, { name: 'Arcane focus', weight: 1 }, { name: "Scholar's pack", weight: 10 }],
    features: [{ name: 'Otherworldly Patron', text: 'You made a pact with a being of power; it grants features.' }, { name: 'Pact Magic', text: 'Charisma is your spellcasting ability. Your spell slots come back on a short rest.' }],
    attacks: [{ name: 'Light crossbow', ability: 'dex', damage: '1d8', note: 'piercing, range 80/320, loading' }],
    spells: 'Cantrips (2): Eldritch Blast, Minor Illusion\nLevel 1 (2): Hex, Armor of Agathys' },
  { id: 'wizard', name: 'Wizard', die: 6, primary: ['int'], saves: ['int', 'wis'], skills: { count: 2, from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'] }, spell: 'int',
    ac: unarmored,
    kit: [{ name: 'Quarterstaff', weight: 4, equipped: true }, { name: 'Spellbook', weight: 3 }, { name: 'Arcane focus', weight: 1 }, { name: "Scholar's pack", weight: 10 }],
    features: [{ name: 'Spellcasting', text: 'Intelligence is your spellcasting ability. Your spellbook holds six 1st-level spells; prepare Intelligence modifier + level of them each day.' }, { name: 'Arcane Recovery', text: 'Once a day after a short rest, regain spell slots of a combined level up to half your wizard level (rounded up).' }],
    attacks: [{ name: 'Quarterstaff', ability: 'str', damage: '1d6', note: 'bludgeoning, versatile (1d8)' }],
    spells: 'Cantrips (3): Fire Bolt, Mage Hand, Light\nSpellbook: Magic Missile, Shield, Sleep, Detect Magic, Mage Armor, Burning Hands' },
]

export interface SpeciesDef {
  id: string; name: string; size: string; speed: number; darkvision: number
  /** extra hit points per level (the dwarf's toughness) */
  hpPerLevel?: number
  /** 2014 only: the scores the species raises */
  asi?: Partial<Record<Ability, number>>
  /** 2014 half-elf: two more scores of the player's choice raised by 1 */
  freeAsi?: number
  languages: string
  traits: { name: string; text: string }[]
  skills?: string[]
}

export const SPECIES_2014: SpeciesDef[] = [
  { id: 'dwarf', name: 'Hill dwarf', size: 'Medium', speed: 25, darkvision: 60, hpPerLevel: 1, asi: { con: 2, wis: 1 }, languages: 'Common, Dwarvish', traits: [{ name: 'Dwarven Resilience', text: 'Advantage on saves against poison, resistance to poison damage.' }, { name: 'Dwarven Toughness', text: '+1 hit point per level (already added).' }, { name: 'Stonecunning', text: 'Double proficiency on History checks about stonework.' }] },
  { id: 'elf', name: 'High elf', size: 'Medium', speed: 30, darkvision: 60, asi: { dex: 2, int: 1 }, languages: 'Common, Elvish', skills: ['perception'], traits: [{ name: 'Fey Ancestry', text: 'Advantage on saves against being charmed; magic cannot put you to sleep.' }, { name: 'Trance', text: 'Four hours of meditation instead of sleep.' }, { name: 'Cantrip', text: 'One wizard cantrip, cast with Intelligence.' }] },
  { id: 'halfling', name: 'Lightfoot halfling', size: 'Small', speed: 25, darkvision: 0, asi: { dex: 2, cha: 1 }, languages: 'Common, Halfling', traits: [{ name: 'Lucky', text: 'Reroll a natural 1 on an attack roll, ability check or saving throw.' }, { name: 'Brave', text: 'Advantage on saves against being frightened.' }, { name: 'Naturally Stealthy', text: 'Hide behind a creature at least one size larger.' }] },
  { id: 'human', name: 'Human', size: 'Medium', speed: 30, darkvision: 0, asi: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, languages: 'Common and one more', traits: [] },
  { id: 'dragonborn', name: 'Dragonborn', size: 'Medium', speed: 30, darkvision: 0, asi: { str: 2, cha: 1 }, languages: 'Common, Draconic', traits: [{ name: 'Breath Weapon', text: 'Exhale destructive energy of your ancestry: 2d6 damage, Dexterity or Constitution save (DC 8 + Con + proficiency) for half. Once per short rest.' }, { name: 'Damage Resistance', text: 'Resistance to the damage type of your ancestry.' }] },
  { id: 'gnome', name: 'Rock gnome', size: 'Small', speed: 25, darkvision: 60, asi: { int: 2, con: 1 }, languages: 'Common, Gnomish', traits: [{ name: 'Gnome Cunning', text: 'Advantage on Intelligence, Wisdom and Charisma saves against magic.' }, { name: 'Tinker', text: 'Build tiny clockwork devices.' }] },
  { id: 'half-elf', name: 'Half-elf', size: 'Medium', speed: 30, darkvision: 60, asi: { cha: 2 }, freeAsi: 2, languages: 'Common, Elvish and one more', traits: [{ name: 'Fey Ancestry', text: 'Advantage on saves against being charmed; magic cannot put you to sleep.' }, { name: 'Skill Versatility', text: 'Proficiency in two skills of your choice.' }] },
  { id: 'half-orc', name: 'Half-orc', size: 'Medium', speed: 30, darkvision: 60, asi: { str: 2, con: 1 }, languages: 'Common, Orc', skills: ['intimidation'], traits: [{ name: 'Relentless Endurance', text: 'Drop to 1 hit point instead of 0, once per long rest.' }, { name: 'Savage Attacks', text: 'Roll one weapon damage die once more on a critical hit.' }] },
  { id: 'tiefling', name: 'Tiefling', size: 'Medium', speed: 30, darkvision: 60, asi: { cha: 2, int: 1 }, languages: 'Common, Infernal', traits: [{ name: 'Hellish Resistance', text: 'Resistance to fire damage.' }, { name: 'Infernal Legacy', text: 'Thaumaturgy cantrip; Hellish Rebuke at level 3, Darkness at 5.' }] },
]

export const SPECIES_2024: SpeciesDef[] = [
  { id: 'aasimar', name: 'Aasimar', size: 'Medium', speed: 30, darkvision: 60, languages: 'Common and two more', traits: [{ name: 'Celestial Resistance', text: 'Resistance to necrotic and radiant damage.' }, { name: 'Healing Hands', text: 'Heal a touched creature by d4 per proficiency bonus, once per long rest.' }] },
  { id: 'dragonborn', name: 'Dragonborn', size: 'Medium', speed: 30, darkvision: 60, languages: 'Common and two more', traits: [{ name: 'Breath Weapon', text: 'Replace one attack with a 15-foot cone or 30-foot line: 1d10 damage, Dexterity save for half. Proficiency bonus times per long rest.' }, { name: 'Damage Resistance', text: 'Resistance to the damage type of your ancestry.' }] },
  { id: 'dwarf', name: 'Dwarf', size: 'Medium', speed: 30, darkvision: 120, hpPerLevel: 1, languages: 'Common and two more', traits: [{ name: 'Dwarven Resilience', text: 'Resistance to poison damage, advantage on saves against being poisoned.' }, { name: 'Dwarven Toughness', text: '+1 hit point per level (already added).' }, { name: 'Stonecunning', text: 'Tremorsense 60 feet as a bonus action, proficiency bonus times per long rest.' }] },
  { id: 'elf', name: 'Elf', size: 'Medium', speed: 30, darkvision: 60, languages: 'Common and two more', skills: ['perception'], traits: [{ name: 'Fey Ancestry', text: 'Advantage on saves against being charmed.' }, { name: 'Trance', text: 'A long rest in four hours.' }, { name: 'Elven Lineage', text: 'A cantrip of your lineage (drow, high elf or wood elf).' }] },
  { id: 'gnome', name: 'Gnome', size: 'Small', speed: 30, darkvision: 60, languages: 'Common and two more', traits: [{ name: 'Gnomish Cunning', text: 'Advantage on Intelligence, Wisdom and Charisma saves.' }] },
  { id: 'goliath', name: 'Goliath', size: 'Medium', speed: 35, darkvision: 0, languages: 'Common and two more', traits: [{ name: 'Giant Ancestry', text: 'A boon of your giant kin, proficiency bonus times per long rest.' }, { name: 'Powerful Build', text: 'Advantage on checks to end being grappled; count as one size larger for carrying.' }] },
  { id: 'halfling', name: 'Halfling', size: 'Small', speed: 30, darkvision: 0, languages: 'Common and two more', traits: [{ name: 'Luck', text: 'Reroll a 1 on a d20 test.' }, { name: 'Brave', text: 'Advantage on saves against being frightened.' }, { name: 'Halfling Nimbleness', text: 'Move through the space of a larger creature.' }] },
  { id: 'human', name: 'Human', size: 'Medium', speed: 30, darkvision: 0, languages: 'Common and two more', traits: [{ name: 'Resourceful', text: 'Heroic Inspiration after each long rest.' }, { name: 'Skillful', text: 'Proficiency in one skill of your choice.' }, { name: 'Versatile', text: 'An Origin feat of your choice.' }] },
  { id: 'orc', name: 'Orc', size: 'Medium', speed: 30, darkvision: 120, languages: 'Common and two more', traits: [{ name: 'Adrenaline Rush', text: 'Dash as a bonus action and gain temporary hit points equal to your proficiency bonus.' }, { name: 'Relentless Endurance', text: 'Drop to 1 hit point instead of 0, once per long rest.' }] },
  { id: 'tiefling', name: 'Tiefling', size: 'Medium', speed: 30, darkvision: 60, languages: 'Common and two more', traits: [{ name: 'Fiendish Legacy', text: 'A resistance and spells of your legacy (abyssal, chthonic or infernal).' }, { name: 'Otherworldly Presence', text: 'The Thaumaturgy cantrip.' }] },
]

export interface BackgroundDef {
  id: string; name: string; skills: string[]; tools: string
  /** 2024: the three scores the background may raise (+2/+1 or +1/+1/+1) and its Origin feat */
  abilities?: Ability[]; feat?: string
}

export const BACKGROUNDS_2014: BackgroundDef[] = [
  { id: 'acolyte', name: 'Acolyte', skills: ['insight', 'religion'], tools: 'Two languages' },
  { id: 'charlatan', name: 'Charlatan', skills: ['deception', 'sleight of hand'], tools: 'Disguise kit, forgery kit' },
  { id: 'criminal', name: 'Criminal', skills: ['deception', 'stealth'], tools: "Thieves' tools, a gaming set" },
  { id: 'entertainer', name: 'Entertainer', skills: ['acrobatics', 'performance'], tools: 'Disguise kit, a musical instrument' },
  { id: 'folk-hero', name: 'Folk hero', skills: ['animal handling', 'survival'], tools: "Artisan's tools, land vehicles" },
  { id: 'guild-artisan', name: 'Guild artisan', skills: ['insight', 'persuasion'], tools: "Artisan's tools, one language" },
  { id: 'hermit', name: 'Hermit', skills: ['medicine', 'religion'], tools: 'Herbalism kit, one language' },
  { id: 'noble', name: 'Noble', skills: ['history', 'persuasion'], tools: 'A gaming set, one language' },
  { id: 'outlander', name: 'Outlander', skills: ['athletics', 'survival'], tools: 'A musical instrument, one language' },
  { id: 'sage', name: 'Sage', skills: ['arcana', 'history'], tools: 'Two languages' },
  { id: 'sailor', name: 'Sailor', skills: ['athletics', 'perception'], tools: "Navigator's tools, water vehicles" },
  { id: 'soldier', name: 'Soldier', skills: ['athletics', 'intimidation'], tools: 'A gaming set, land vehicles' },
  { id: 'urchin', name: 'Urchin', skills: ['sleight of hand', 'stealth'], tools: "Disguise kit, thieves' tools" },
]

export const BACKGROUNDS_2024: BackgroundDef[] = [
  { id: 'acolyte', name: 'Acolyte', skills: ['insight', 'religion'], tools: "Calligrapher's supplies", abilities: ['int', 'wis', 'cha'], feat: 'Magic Initiate (Cleric)' },
  { id: 'artisan', name: 'Artisan', skills: ['investigation', 'persuasion'], tools: "Artisan's tools", abilities: ['str', 'dex', 'int'], feat: 'Crafter' },
  { id: 'charlatan', name: 'Charlatan', skills: ['deception', 'sleight of hand'], tools: 'Forgery kit', abilities: ['dex', 'con', 'cha'], feat: 'Skilled' },
  { id: 'criminal', name: 'Criminal', skills: ['sleight of hand', 'stealth'], tools: "Thieves' tools", abilities: ['dex', 'con', 'int'], feat: 'Alert' },
  { id: 'entertainer', name: 'Entertainer', skills: ['acrobatics', 'performance'], tools: 'A musical instrument', abilities: ['str', 'dex', 'cha'], feat: 'Musician' },
  { id: 'farmer', name: 'Farmer', skills: ['animal handling', 'nature'], tools: "Carpenter's tools", abilities: ['str', 'con', 'wis'], feat: 'Tough' },
  { id: 'guard', name: 'Guard', skills: ['athletics', 'perception'], tools: 'A gaming set', abilities: ['str', 'int', 'wis'], feat: 'Alert' },
  { id: 'guide', name: 'Guide', skills: ['stealth', 'survival'], tools: "Cartographer's tools", abilities: ['dex', 'con', 'wis'], feat: 'Magic Initiate (Druid)' },
  { id: 'hermit', name: 'Hermit', skills: ['medicine', 'religion'], tools: 'Herbalism kit', abilities: ['con', 'wis', 'cha'], feat: 'Healer' },
  { id: 'merchant', name: 'Merchant', skills: ['animal handling', 'persuasion'], tools: "Navigator's tools", abilities: ['con', 'int', 'cha'], feat: 'Lucky' },
  { id: 'noble', name: 'Noble', skills: ['history', 'persuasion'], tools: 'A gaming set', abilities: ['str', 'int', 'cha'], feat: 'Skilled' },
  { id: 'sage', name: 'Sage', skills: ['arcana', 'history'], tools: "Calligrapher's supplies", abilities: ['con', 'int', 'wis'], feat: 'Magic Initiate (Wizard)' },
  { id: 'sailor', name: 'Sailor', skills: ['acrobatics', 'perception'], tools: "Navigator's tools", abilities: ['str', 'dex', 'wis'], feat: 'Tavern Brawler' },
  { id: 'scribe', name: 'Scribe', skills: ['investigation', 'perception'], tools: "Calligrapher's supplies", abilities: ['dex', 'int', 'wis'], feat: 'Skilled' },
  { id: 'soldier', name: 'Soldier', skills: ['athletics', 'intimidation'], tools: 'A gaming set', abilities: ['str', 'dex', 'con'], feat: 'Savage Attacker' },
  { id: 'wayfarer', name: 'Wayfarer', skills: ['insight', 'stealth'], tools: "Thieves' tools", abilities: ['dex', 'wis', 'cha'], feat: 'Lucky' },
]

export const speciesFor = (r: Ruleset) => (r === '5e-2024' ? SPECIES_2024 : SPECIES_2014)
export const backgroundsFor = (r: Ruleset) => (r === '5e-2024' ? BACKGROUNDS_2024 : BACKGROUNDS_2014)

/** What can be chosen: the rules' own classes, species and backgrounds, and the homebrew ones of the world and its libraries. */
export interface Catalog { classes: ClassDef[]; species: SpeciesDef[]; backgrounds: BackgroundDef[] }
export const catalogFor = (r: Ruleset, extra?: Partial<Catalog>): Catalog => ({
  classes: [...CLASSES, ...(extra?.classes ?? [])],
  species: [...speciesFor(r), ...(extra?.species ?? [])],
  backgrounds: [...backgroundsFor(r), ...(extra?.backgrounds ?? [])],
})

// ---------- ability scores ----------

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8]
/** Point buy: what a score from 8 to 15 costs, out of 27 points. */
export const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 }
export const POINT_BUDGET = 27
export const pointsSpent = (scores: Record<Ability, number>) => ABILITIES.reduce((n, a) => n + (POINT_COST[scores[a]] ?? 99), 0)

/** 4d6, the lowest dropped, six times. `rand` gives 0 to 1 (Math.random, or a fixed one in a test). */
export function rollScores(rand: () => number = Math.random): number[] {
  return Array.from({ length: 6 }, () => {
    const dice = Array.from({ length: 4 }, () => 1 + Math.floor(rand() * 6)).sort((a, b) => a - b)
    return dice[1] + dice[2] + dice[3]
  })
}

/** The standard array placed so the class's main scores get the best numbers, then Constitution and Dexterity. */
export function suggestedScores(cls: ClassDef): Record<Ability, number> {
  const order = [...new Set<Ability>([...cls.primary, 'con', 'dex', ...ABILITIES])]
  return Object.fromEntries(order.map((a, i) => [a, STANDARD_ARRAY[i]])) as Record<Ability, number>
}

export interface Choices {
  ruleset: Ruleset
  name: string
  player?: string
  classId: string
  speciesId: string
  backgroundId: string
  /** the scores before species or background raise them */
  base: Record<Ability, number>
  /** 2014 half-elf: the two scores they raise by 1. 2024: the background's +2 and +1 (or three +1 with `spread`). */
  bonus: { plus2?: Ability; plus1?: Ability; spread?: boolean; free?: Ability[] }
  /** skills picked from the class's list */
  skills: string[]
  alignment?: string
  /** 2024: the Origin feat taken instead of the background's own, and what it does (from the library) */
  feat?: { name: string; text?: string }
  /** 2024: the Origin feat of a human's Versatile trait */
  versatileFeat?: { name: string; text?: string }
}

/** A species whose Versatile trait gives an Origin feat of choice (the 2024 human). */
export const givesVersatileFeat = (sp: SpeciesDef | undefined) => !!sp?.traits.some((t) => t.name === 'Versatile' && /origin feat/i.test(t.text))

/** The final scores: the base, plus what the species (2014) or the background (2024) adds. Never above 20. */
export function finalScores(c: Choices, cat: Catalog = catalogFor(c.ruleset)): Record<Ability, number> {
  const out = { ...c.base }
  const add = (a: Ability, n: number) => { out[a] = Math.min(20, out[a] + n) }
  if (c.ruleset === '5e-2024') {
    const bg = cat.backgrounds.find((b) => b.id === c.backgroundId)
    if (bg?.abilities) {
      if (c.bonus.spread) bg.abilities.forEach((a) => add(a, 1))
      else {
        if (c.bonus.plus2 && bg.abilities.includes(c.bonus.plus2)) add(c.bonus.plus2, 2)
        if (c.bonus.plus1 && c.bonus.plus1 !== c.bonus.plus2 && bg.abilities.includes(c.bonus.plus1)) add(c.bonus.plus1, 1)
      }
    }
  } else {
    const sp = cat.species.find((s) => s.id === c.speciesId)
    for (const [a, n] of Object.entries(sp?.asi ?? {})) add(a as Ability, n)
    for (const a of (c.bonus.free ?? []).slice(0, sp?.freeAsi ?? 0)) if (!sp?.asi?.[a]) add(a, 1)
  }
  return out
}

/** Skills a character gets without choosing: from the background and the species. */
export function grantedSkills(c: Pick<Choices, 'ruleset' | 'speciesId' | 'backgroundId'>, cat: Catalog = catalogFor(c.ruleset)): string[] {
  const bg = cat.backgrounds.find((b) => b.id === c.backgroundId)
  const sp = cat.species.find((s) => s.id === c.speciesId)
  return [...new Set([...(bg?.skills ?? []), ...(sp?.skills ?? [])])]
}

/** What is still wrong with the choices, as sentences for the person making the character. Empty when it can be made. */
export function problems(c: Choices, cat: Catalog = catalogFor(c.ruleset)): string[] {
  const out: string[] = []
  const cls = cat.classes.find((x) => x.id === c.classId)
  const bg = cat.backgrounds.find((b) => b.id === c.backgroundId)
  if (!c.name.trim()) out.push('Give the character a name.')
  if (!cls) out.push('Choose a class.')
  if (!cat.species.some((s) => s.id === c.speciesId)) out.push('Choose a species.')
  if (!bg) out.push('Choose a background.')
  if (ABILITIES.some((a) => !(c.base[a] >= 3 && c.base[a] <= 20))) out.push('Every ability score is between 3 and 20.')
  if (cls && c.skills.length !== cls.skills.count) out.push(`Choose ${cls.skills.count} skills from the ${cls.name.toLowerCase()} list (${c.skills.length} chosen).`)
  if (c.ruleset === '5e-2024' && bg?.abilities?.length && !c.bonus.spread && (!c.bonus.plus2 || !c.bonus.plus1 || c.bonus.plus1 === c.bonus.plus2)) out.push('Choose which scores the background raises.')
  return out
}

const attackBonus = (a: 'str' | 'dex' | 'finesse', m: Record<Ability, number>) => (a === 'finesse' ? Math.max(m.str, m.dex) : m[a])
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

/** The level 1 character the choices describe, as a sheet. */
export function buildCharacter(c: Choices, cat: Catalog = catalogFor(c.ruleset)): Sheet {
  const cls = cat.classes.find((x) => x.id === c.classId)!
  const species = cat.species.find((s) => s.id === c.speciesId)!
  const bg = cat.backgrounds.find((b) => b.id === c.backgroundId)!
  const scores = finalScores(c, cat)
  const mods = Object.fromEntries(ABILITIES.map((a) => [a, abilityMod(scores[a])])) as Record<Ability, number>
  const tough = species.hpPerLevel ?? 0
  const hp = Math.max(1, cls.die + mods.con + tough)
  const skills: Record<string, Proficiency> = {}
  for (const s of [...grantedSkills(c, cat), ...c.skills]) skills[s] = 'p'
  const ac = cls.ac(mods)
  const fighterDefense = cls.id === 'fighter'
  const pb = 2
  const attacks: Feature[] = cls.attacks.map((w) => {
    const m = attackBonus(w.ability, mods)
    return { name: w.name, text: `Weapon attack: ${sign(m + pb)} to hit. Hit: ${w.damage}${m ? sign(m) : ''} damage${w.note ? ` (${w.note})` : ''}.` }
  })
  const traits: Feature[] = [
    ...cls.features.map((f) => ({ name: f.name, text: f.text })),
    ...species.traits.map((t) => ({ name: t.name, text: t.text })),
  ]
  const feat = c.feat?.name.trim() || bg.feat
  if (feat) traits.push({ name: feat, text: [`Origin feat from the ${bg.name.toLowerCase()} background.`, c.feat?.name.trim() ? c.feat.text : ''].filter(Boolean).join(' ') })
  const versatile = givesVersatileFeat(species) && c.versatileFeat?.name.trim()
  if (versatile && !traits.some((t) => t.name.toLowerCase() === versatile.toLowerCase())) {
    traits.push({ name: versatile, text: [`Origin feat from the ${species.name.toLowerCase()}'s Versatile trait.`, c.versatileFeat?.text].filter(Boolean).join(' ') })
  }
  const kit: InventoryItem[] = cls.kit.map((k) => ({ name: k.name, qty: k.qty ?? 1, equipped: !!k.equipped, note: k.note ?? '', ...(k.weight ? { weight: k.weight } : {}) }))
  const slots = allSlots([{ name: cls.name, level: 1 }], c.ruleset, { [cls.name.trim().toLowerCase()]: { die: cls.die, caster: cls.caster ?? null } }) ?? []
  const base = emptyCharacter(c.ruleset)
  return {
    ...base,
    name: c.name.trim(),
    player: c.player?.trim() || undefined,
    species: species.name,
    background: bg.name,
    alignment: c.alignment ?? '',
    size: species.size,
    type: 'humanoid',
    abilities: scores,
    ac: { value: ac.value + (fighterDefense ? 1 : 0), note: fighterDefense ? `${ac.note}, Defense` : ac.note },
    hp: { max: hp, formula: '', current: hp, temp: 0 },
    speed: { walk: species.speed },
    senses: species.darkvision ? { darkvision: species.darkvision } : {},
    languages: species.languages,
    classes: [{ name: cls.name, level: 1 }],
    hitDice: [{ sides: cls.die, total: 1, used: 0 }],
    profs: { saves: [...cls.saves], skills, tools: [bg.tools, species.languages].filter(Boolean).join('; ') },
    spellcasting: { ability: cls.spell ?? '', slots: slots.map((n) => ({ total: n, used: 0 })) },
    spells: cls.spells ?? '',
    inventory: kit,
    currency: { cp: 0, sp: 0, ep: 0, gp: c.ruleset === '5e-2024' ? 50 : 10, pp: 0 },
    features: { ...base.features, actions: attacks, traits },
  }
}
