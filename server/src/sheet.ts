import { z } from 'zod'

// The structured sheet of a creature or character, stored as `props.sheet` (see web/src/lib/sheet.ts for the meaning).
// Everything that reaches the database goes through this schema: unknown keys are dropped and sizes are capped.

const text = (max: number) => z.string().max(max)
const int = (min: number, max: number) => z.number().int().min(min).max(max)
const optInt = (min: number, max: number) => int(min, max).optional()

const usage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('recharge'), min: int(2, 6) }),
  z.object({ type: z.literal('perDay'), times: int(1, 99) }),
  z.object({ type: z.literal('rest') }),
])
const feature = z.object({
  name: text(200), text: text(8000), usage: usage.optional(), cost: optInt(1, 10), used: optInt(0, 99),
  actions: z.enum(['one', 'two', 'three', 'reaction', 'free']).optional(), bonus: int(-30, 60).optional(), damage: text(100).optional(), agile: z.boolean().optional(),
})
const features = z.array(feature).max(60)
const score = int(0, 60)
const bonus = int(-30, 60)

const abilityKey = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha'])
const count = (max: number) => int(0, max)
const character = {
  kind: z.enum(['creature', 'character']).optional(),
  player: text(80).optional(),
  species: text(80).optional(),
  background: text(80).optional(),
  classes: z.array(z.object({ name: text(60), level: int(0, 20), subclass: text(60).optional() })).max(6).optional(),
  inspiration: z.boolean().optional(),
  profs: z.object({ saves: z.array(abilityKey).max(6), skills: z.record(text(40), z.enum(['p', 'e'])).refine((r) => Object.keys(r).length <= 30), tools: text(300).optional() }).optional(),
  hitDice: z.array(z.object({ sides: int(2, 100), total: count(40), used: count(40) })).max(6).optional(),
  deathSaves: z.object({ ok: int(0, 3), fail: int(0, 3) }).optional(),
  spellcasting: z.object({ ability: z.union([abilityKey, z.literal('')]), slots: z.array(z.object({ total: count(20), used: count(20) })).max(10) }).optional(),
  spells: text(8000).optional(),
  inventory: z.array(z.object({ name: text(120), qty: count(99999), equipped: z.boolean(), note: text(300) })).max(200).optional(),
  currency: z.object({ cp: count(10_000_000), sp: count(10_000_000), ep: count(10_000_000), gp: count(10_000_000), pp: count(10_000_000) }).optional(),
}

const rank = int(0, 4)
const pf2eChar = z.object({
  ancestry: text(80), heritage: text(80), background: text(80), className: text(80), keyAbility: z.union([abilityKey, z.literal('')]),
  ranks: z.object({ perception: rank, fort: rank, ref: rank, will: rank, classDc: rank, spell: rank, armor: rank, skills: z.record(text(40), rank).refine((r) => Object.keys(r).length <= 30) }),
  lores: z.array(z.object({ name: text(60), rank })).max(20),
  armor: z.object({ name: text(80), bonus: int(0, 20), dexCap: int(0, 10).nullable() }),
  acExtra: int(-10, 20),
  strikes: z.array(z.object({ name: text(80), ability: z.enum(['str', 'dex']), rank, item: int(0, 10), damage: text(100), agile: z.boolean(), note: text(300) })).max(30),
  heroPoints: int(0, 3), dying: int(0, 4), wounded: int(0, 4),
  focus: z.object({ max: int(0, 3), current: int(0, 3) }),
  tradition: text(30), spellAbility: z.union([abilityKey, z.literal('')]),
})
const pf2e = z.object({
  char: pf2eChar.optional(),
  level: int(-1, 30), perception: int(-10, 80), fort: int(-10, 80), ref: int(-10, 80), will: int(-10, 80),
  mods: z.object({ str: int(-10, 20), dex: int(-10, 20), con: int(-10, 20), int: int(-10, 20), wis: int(-10, 20), cha: int(-10, 20) }),
  traits: z.array(text(40)).max(30), rarity: text(20),
})

export const sheetSchema = z.object({
  ...character,
  pf2e: pf2e.optional(),
  v: z.literal(1),
  ruleset: z.enum(['5e', '5e-2024', 'pf2e']),
  name: text(300),
  size: text(40),
  type: text(80),
  alignment: text(80),
  abilities: z.object({ str: score, dex: score, con: score, int: score, wis: score, cha: score }),
  ac: z.object({ value: int(0, 99), note: text(200) }),
  hp: z.object({ max: int(0, 100000), formula: text(100), current: int(-9999, 100000).optional(), temp: int(0, 100000).optional() }),
  speed: z.object({ walk: optInt(0, 1000), burrow: optInt(0, 1000), climb: optInt(0, 1000), crawl: optInt(0, 1000), fly: optInt(0, 1000), swim: optInt(0, 1000), hover: z.boolean().optional() }),
  saves: z.object({ str: bonus.optional(), dex: bonus.optional(), con: bonus.optional(), int: bonus.optional(), wis: bonus.optional(), cha: bonus.optional() }),
  skills: z.record(text(40), bonus).refine((r) => Object.keys(r).length <= 40),
  initiative: bonus.optional(),
  senses: z.object({ blindsight: optInt(0, 1000), darkvision: optInt(0, 1000), tremorsense: optInt(0, 1000), truesight: optInt(0, 1000) }),
  passivePerception: optInt(0, 99),
  vulnerabilities: text(500),
  resistances: text(500),
  immunities: text(500),
  conditionImmunities: text(500),
  languages: text(500),
  cr: z.number().min(0).max(40).optional(),
  xp: optInt(0, 10_000_000),
  features: z.object({ traits: features, actions: features, bonus: features, reactions: features, legendary: features }),
})
export type Sheet = z.infer<typeof sheetSchema>

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])

/**
 * Applies field changes to a sheet. Keys are paths ("hp.max", "abilities.str", "skills.stealth"); a null value removes the field.
 * Arrays (a feature group) are replaced as a whole. Returns null when the result is not a valid sheet.
 */
export function patchSheet(current: unknown, patch: Record<string, unknown>): Sheet | null {
  const next: any = current && typeof current === 'object' ? structuredClone(current) : {}
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split('.')
    if (!keys.length || keys.some((k) => !k || FORBIDDEN.has(k))) return null
    let at = next
    for (const k of keys.slice(0, -1)) {
      if (!at[k] || typeof at[k] !== 'object' || Array.isArray(at[k])) at[k] = {}
      at = at[k]
    }
    const last = keys[keys.length - 1]
    if (value === null) delete at[last]; else at[last] = value
  }
  const r = sheetSchema.safeParse(next)
  return r.success ? r.data : null
}

/** A whole sheet from a client (import, first conversion of an old stat block), or null when it is not valid. */
export function parseSheet(raw: unknown): Sheet | null {
  const r = sheetSchema.safeParse(raw)
  return r.success ? r.data : null
}
