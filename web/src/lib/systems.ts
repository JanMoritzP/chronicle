import type { RuleSystem } from '../types'

// The rules systems the app has, written the way a system pack is: the lists and names the table shows. The three built-in systems are packs too,
// so a person can export one as a starting point for their own. A pack from a world changes what is shown (see server/src/pack.ts for the format);
// the engine underneath (`base`) still decides how rolls, difficulty and the sheets work.

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'
export const ABILITY_KEYS: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']
export const SHEET_SECTIONS = ['combat', 'abilities', 'skills', 'spells', 'features', 'extra', 'gear'] as const
export type SheetSection = (typeof SHEET_SECTIONS)[number]
export const SECTION_NAMES: Record<SheetSection, string> = { combat: 'Armor, hit points and speed', abilities: 'Abilities', skills: 'Skills', spells: 'Spellcasting', features: 'Features and attacks', extra: 'Extra fields', gear: 'Equipment' }

/** Where each section of a character sheet goes and which are hidden, from a pack's layout: the named ones first in their order, the others after in the usual order. */
export function layoutOf(layout: PackData['sheetLayout']): { order: Record<SheetSection, number>; hidden: Set<SheetSection> } {
  const first = [...new Set(layout?.order ?? [])]
  const all = [...first, ...SHEET_SECTIONS.filter((s) => !first.includes(s))]
  return { order: Object.fromEntries(all.map((s, i) => [s, i + 1])) as Record<SheetSection, number>, hidden: new Set(layout?.hidden ?? []) }
}

export interface SheetField { id: string; label: string; kind: 'number' | 'text' | 'check' }
export interface AbilityName { name: string; short: string }

export interface PackData {
  format: 'chronicle-system'; v: 1; id: string; name: string; version?: string; author?: string; description?: string
  base: RuleSystem
  abilities?: Partial<Record<AbilityKey, AbilityName>>
  conditions?: string[]
  damageTypes?: string[]
  initiative?: string
  grid?: { unit: string; dist: number; type: 'square' | 'hex-row' | 'hex-col' | 'none' }
  sheetFields?: SheetField[]
  sheetLayout?: { order?: SheetSection[]; hidden?: SheetSection[] }
  content?: { rollTables?: { name: string; entries: string; secret?: boolean }[]; decks?: { name: string; cards: string }[]; macros?: { name: string; text: string }[] }
}

export const ABILITY_DEFAULTS: Record<AbilityKey, AbilityName> = {
  str: { name: 'Strength', short: 'STR' }, dex: { name: 'Dexterity', short: 'DEX' }, con: { name: 'Constitution', short: 'CON' },
  int: { name: 'Intelligence', short: 'INT' }, wis: { name: 'Wisdom', short: 'WIS' }, cha: { name: 'Charisma', short: 'CHA' },
}

export const CONDITIONS_5E = ['Blinded', 'Charmed', 'Concentrating', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious']
/** Pathfinder 2e conditions. The ones with a value (Frightened 2) go up by one on each click and clear after 4. */
export const CONDITIONS_PF2E = ['Blinded', 'Clumsy', 'Concealed', 'Confused', 'Dazzled', 'Deafened', 'Doomed', 'Drained', 'Dying', 'Enfeebled', 'Fascinated', 'Fatigued', 'Fleeing', 'Frightened', 'Grabbed', 'Hidden', 'Immobilized', 'Invisible', 'Off-guard', 'Paralyzed', 'Petrified', 'Prone', 'Quickened', 'Restrained', 'Sickened', 'Slowed', 'Stunned', 'Stupefied', 'Unconscious', 'Wounded']
export const DAMAGE_TYPES_5E = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder']
export const DAMAGE_TYPES_PF2E = ['acid', 'bludgeoning', 'cold', 'electricity', 'fire', 'force', 'mental', 'piercing', 'poison', 'slashing', 'sonic', 'spirit', 'vitality', 'void']

const FIVE = { abilities: ABILITY_DEFAULTS, conditions: CONDITIONS_5E, damageTypes: DAMAGE_TYPES_5E, initiative: '1d20', grid: { unit: 'ft', dist: 5, type: 'square' as const } }
export const BUILTIN: Record<RuleSystem, PackData> = {
  '5e': { format: 'chronicle-system', v: 1, id: 'dnd-5e-2014', name: 'D&D 5e, 2014 rules', base: '5e', description: 'The built-in 5th edition rules of 2014.', ...FIVE },
  '5e-2024': { format: 'chronicle-system', v: 1, id: 'dnd-5e-2024', name: 'D&D 5e, 2024 rules', base: '5e-2024', description: 'The built-in 5th edition rules of 2024.', ...FIVE },
  pf2e: { format: 'chronicle-system', v: 1, id: 'pathfinder-2e', name: 'Pathfinder 2e', base: 'pf2e', description: 'The built-in Pathfinder second edition rules.', ...FIVE, conditions: CONDITIONS_PF2E, damageTypes: DAMAGE_TYPES_PF2E },
}

export interface Rules {
  name: string; base: RuleSystem
  abilities: Record<AbilityKey, AbilityName>
  conditions: string[]; damageTypes: string[]; initiative: string
  grid: NonNullable<PackData['grid']>
  /** extra fields the pack adds to a character sheet */
  sheetFields: SheetField[]
  /** the order of the sections of a character sheet and the ones left out */
  sheetLayout: { order: Record<SheetSection, number>; hidden: Set<SheetSection> }
  /** the installed pack in use, if any */
  pack: PackData | null
}

/** What the table shows for a world: the built-in lists of its engine, with whatever the world's pack changes put over them. */
export function resolveRules(system: RuleSystem, pack: PackData | null): Rules {
  const b = BUILTIN[pack?.base ?? system]
  return {
    name: pack?.name ?? b.name, base: b.base, pack,
    abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, pack?.abilities?.[k] ?? ABILITY_DEFAULTS[k]])) as Record<AbilityKey, AbilityName>,
    conditions: pack?.conditions?.length ? pack.conditions : b.conditions!,
    damageTypes: pack?.damageTypes?.length ? pack.damageTypes.map((t) => t.toLowerCase()) : b.damageTypes!,
    initiative: pack?.initiative ?? b.initiative!,
    grid: pack?.grid ?? b.grid!,
    sheetFields: pack?.sheetFields ?? [],
    sheetLayout: layoutOf(pack?.sheetLayout),
  }
}

/** The file for a system: what is shown when someone exports it. */
export const packFile = (p: PackData): PackData => p

/** A pack file as text, for saving. */
export const packText = (p: PackData) => JSON.stringify(p, null, 2)

/** A short readable id from a name: "Dark Fantasy!" becomes "dark-fantasy". */
export function slugOf(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return s.length >= 3 ? s : `${s || 'pack'}-pack`.slice(0, 40)
}
