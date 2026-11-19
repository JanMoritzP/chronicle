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
const feature = z.object({ name: text(200), text: text(8000), usage: usage.optional(), cost: optInt(1, 10) })
const features = z.array(feature).max(60)
const score = int(0, 60)
const bonus = int(-30, 60)

export const sheetSchema = z.object({
  v: z.literal(1),
  ruleset: z.enum(['5e', '5e-2024']),
  name: text(300),
  size: text(40),
  type: text(80),
  alignment: text(80),
  abilities: z.object({ str: score, dex: score, con: score, int: score, wis: score, cha: score }),
  ac: z.object({ value: int(0, 99), note: text(200) }),
  hp: z.object({ max: int(0, 100000), formula: text(100) }),
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
