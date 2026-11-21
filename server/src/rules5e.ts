import type { Rng } from './dice.js'
import type { Sheet } from './sheet.js'

// The 5th edition rules the table can apply for the GM (each one is switched on separately, see `automation` in the table settings):
// damage types with resistance, concentration, death saves and rests. Pure functions over a sheet, tested without a server.

/** Pathfinder 2e's damage types, for a Pathfinder world without a pack of its own. */
export const DAMAGE_TYPES_PF2E = ['acid', 'bludgeoning', 'cold', 'electricity', 'fire', 'force', 'mental', 'piercing', 'poison', 'slashing', 'sonic', 'spirit', 'vitality', 'void'] as const
export const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'] as const

/**
 * The damage types an unconditional entry of a list names ("fire, cold; poison"). An entry with a condition ("slashing from nonmagical
 * attacks") is left out: the table cannot tell whether a weapon is magical, so the GM adjusts those by hand.
 */
export function typesIn(list: string | undefined, types: readonly string[] = DAMAGE_TYPES): Set<string> {
  const out = new Set<string>()
  for (const part of (list ?? '').toLowerCase().split(/[;,]/)) {
    if (/\b(from|nonmagical|non-magical|that aren|except|unless|while)\b/.test(part)) continue
    for (const t of types) if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(part)) out.add(t)
  }
  return out
}

export type Effect = 'immune' | 'resistant' | 'vulnerable' | null

/** Damage after resistance (halved, rounded down), vulnerability (doubled) or immunity. Resistance and vulnerability to the same type cancel out. */
export function adjustDamage(amount: number, type: string | undefined, s: Pick<Sheet, 'resistances' | 'vulnerabilities' | 'immunities'> | undefined, types: readonly string[] = DAMAGE_TYPES): { amount: number; effect: Effect } {
  const t = (type ?? '').trim().toLowerCase()
  if (!s || !t || amount <= 0) return { amount, effect: null }
  if (typesIn(s.immunities, types).has(t)) return { amount: 0, effect: 'immune' }
  const res = typesIn(s.resistances, types).has(t), vul = typesIn(s.vulnerabilities, types).has(t)
  if (res && !vul) return { amount: Math.floor(amount / 2), effect: 'resistant' }
  if (vul && !res) return { amount: amount * 2, effect: 'vulnerable' }
  return { amount, effect: null }
}

/** The difficulty of the Constitution save that keeps a spell going after damage: half the damage, at least 10. */
export const concentrationDc = (damage: number) => Math.max(10, Math.floor(damage / 2))

export const modOf = (score: number) => Math.floor((score - 10) / 2)

export type DeathOutcome = 'success' | 'failure' | 'critical failure' | 'revived' | 'stable' | 'dead'

/** One death saving throw from the d20 that was rolled. A natural 20 brings the character back with 1 hit point, a natural 1 counts as two failures. */
export function deathSave(d20: number, saves: { ok: number; fail: number } = { ok: 0, fail: 0 }): { saves: { ok: number; fail: number }; outcome: DeathOutcome } {
  if (d20 === 20) return { saves: { ok: 0, fail: 0 }, outcome: 'revived' }
  let { ok, fail } = saves
  let outcome: DeathOutcome
  if (d20 === 1) { fail += 2; outcome = 'critical failure' } else if (d20 >= 10) { ok += 1; outcome = 'success' } else { fail += 1; outcome = 'failure' }
  ok = Math.min(3, ok); fail = Math.min(3, fail)
  if (fail >= 3) outcome = 'dead'
  else if (ok >= 3) outcome = 'stable'
  return { saves: { ok, fail }, outcome }
}

/** Spends hit dice on a short rest: largest dice first, each heals its roll plus the Constitution modifier (at least 0). */
export function shortRest(sheet: Sheet, spend: number, rng: Rng): { sheet: Sheet; healed: number; spent: number; lines: string[] } {
  const next = structuredClone(sheet)
  const dice = [...(next.hitDice ?? [])].sort((a, b) => b.sides - a.sides)
  const con = modOf(next.abilities.con)
  let healed = 0, spent = 0
  for (let i = 0; i < spend; i++) {
    const d = dice.find((x) => x.used < x.total)
    if (!d) break
    d.used += 1
    spent += 1
    healed += Math.max(0, rng(d.sides) + con)
  }
  if (spent) {
    const cur = next.hp.current ?? next.hp.max
    next.hp.current = next.hp.max > 0 ? Math.min(next.hp.max, cur + healed) : cur + healed
    healed = next.hp.current - cur
  }
  let features = 0
  for (const group of Object.values(next.features)) for (const f of group) if (f.usage?.type === 'rest' && (f.used ?? 0) > 0) { f.used = 0; features++ }
  const lines = [`takes a short rest`]
  if (spent) lines.push(`spends ${spent} hit ${spent === 1 ? 'die' : 'dice'} and heals ${healed}`)
  if (features) lines.push(`${features} ${features === 1 ? 'feature is' : 'features are'} ready again`)
  return { sheet: next, healed, spent, lines }
}

/** A long rest: full hit points, all spell slots and uses back, half the hit dice (at least one), death saves cleared. */
export function longRest(sheet: Sheet): { sheet: Sheet; lines: string[] } {
  const next = structuredClone(sheet)
  next.hp.current = next.hp.max
  next.hp.temp = 0
  if (next.deathSaves) next.deathSaves = { ok: 0, fail: 0 }
  let slots = 0
  if (next.spellcasting) for (const s of next.spellcasting.slots) { slots += s.used; s.used = 0 }
  const dice = next.hitDice ?? []
  let back = Math.max(1, Math.floor(dice.reduce((n, d) => n + d.total, 0) / 2))
  const regained = dice.length ? back : 0
  for (const d of [...dice].sort((a, b) => b.sides - a.sides)) { const give = Math.min(back, d.used); d.used -= give; back -= give }
  let features = 0
  for (const group of Object.values(next.features)) for (const f of group) if ((f.usage?.type === 'rest' || f.usage?.type === 'perDay') && (f.used ?? 0) > 0) { f.used = 0; features++ }
  const lines = ['takes a long rest and is at full hit points']
  if (slots) lines.push(`${slots} spell ${slots === 1 ? 'slot is' : 'slots are'} back`)
  if (features) lines.push(`${features} ${features === 1 ? 'feature is' : 'features are'} ready again`)
  if (regained) lines.push('hit dice recovered')
  return { sheet: next, lines }
}

/** Proficiency bonus from the total level of a character (1 to 4: +2, 5 to 8: +3, and so on). */
export const proficiencyOf = (sheet: Pick<Sheet, 'classes'>) => 2 + Math.floor((Math.max(1, (sheet.classes ?? []).reduce((n, c) => n + c.level, 0)) - 1) / 4)

/** A saving throw bonus: the sheet's own number when it has one, else the ability modifier plus proficiency for a character. No sheet means +0. */
export function saveBonusOf(sheet: Sheet | undefined, ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'): number {
  if (!sheet) return 0
  const own = sheet.saves[ability]
  if (own != null) return own
  return modOf(sheet.abilities[ability]) + (sheet.kind === 'character' && sheet.profs?.saves.includes(ability) ? proficiencyOf(sheet) : 0)
}
