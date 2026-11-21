import { z } from 'zod'

// Active effects on a token: a spell or condition that lasts a number of rounds and changes armor class, attack rolls or saving throws.
// They live in `token.data.effects`. Pure functions, tested without a server.

/** A bonus written as a signed number or a die: "+2", "-1", "+1d4". */
const bonus = z.string().regex(/^[+-]\d{1,2}(d\d{1,2})?$/)

export const effectSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** full rounds left, or null for one that lasts until it is removed */
  rounds: z.number().int().min(1).max(999).nullable().default(null),
  ac: z.number().int().min(-10).max(10).optional(),
  attack: bonus.optional(),
  save: bonus.optional(),
  note: z.string().max(200).optional(),
  /** the token whose spell it is; with `concentration` the effect ends when that token stops concentrating */
  from: z.string().max(64).optional(),
  concentration: z.boolean().optional(),
})
export type EffectInput = z.infer<typeof effectSchema>
export type ActiveEffect = EffectInput & { id: string }

export const MAX_EFFECTS = 12

/** The effects stored on a token, ignoring anything that is not shaped like one. */
export function effectsOf(data: Record<string, unknown> | undefined): ActiveEffect[] {
  const raw = data?.effects
  if (!Array.isArray(raw)) return []
  const out: ActiveEffect[] = []
  for (const e of raw) {
    const r = effectSchema.safeParse(e)
    if (r.success && typeof (e as { id?: unknown }).id === 'string') out.push({ ...r.data, id: (e as { id: string }).id })
  }
  return out
}

/** What a token's effects add up to: armor class as a number, attack and save bonuses as text to put after a d20 ("+1d4-1"). */
export function modsOf(effects: ActiveEffect[]): { ac: number; attack: string; save: string } {
  return {
    ac: effects.reduce((n, e) => n + (e.ac ?? 0), 0),
    attack: effects.map((e) => e.attack ?? '').join(''),
    save: effects.map((e) => e.save ?? '').join(''),
  }
}

/** One round has passed: effects with a duration lose a round, and those that reach 0 are over. */
export function tick(effects: ActiveEffect[]): { kept: ActiveEffect[]; ended: ActiveEffect[] } {
  const kept: ActiveEffect[] = [], ended: ActiveEffect[] = []
  for (const e of effects) {
    if (e.rounds == null) { kept.push(e); continue }
    if (e.rounds - 1 <= 0) ended.push(e); else kept.push({ ...e, rounds: e.rounds - 1 })
  }
  return { kept, ended }
}
