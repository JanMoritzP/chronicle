// Encounter difficulty by the 5e (2014) method: add up the monsters' XP, multiply by how many there are, compare with the party's thresholds.

export type Difficulty = 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly' | 'low' | 'moderate' | 'high' | 'over' | 'severe' | 'extreme'
export type RuleSystem = '5e' | '5e-2024' | 'pf2e'

/** XP of a creature by challenge rating. */
export const XP_BY_CR: Record<string, number> = {
  '0': 10, '0.125': 25, '0.25': 50, '0.5': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900,
  '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000, '17': 18000, '18': 20000, '19': 22000, '20': 25000, '21': 33000, '22': 41000,
  '23': 50000, '24': 62000, '25': 75000, '26': 90000, '27': 105000, '28': 120000, '29': 135000, '30': 155000,
}

export const xpOfCr = (cr: number | undefined | null) => (cr == null ? 0 : XP_BY_CR[String(cr)] ?? 0)

/** Per character level: the XP at which an encounter is easy, medium, hard, deadly. */
const THRESHOLDS: [number, number, number, number][] = [
  [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500], [250, 500, 750, 1100], [300, 600, 900, 1400], [350, 750, 1100, 1700],
  [450, 900, 1400, 2100], [550, 1100, 1600, 2400], [600, 1200, 1900, 2800], [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500], [1100, 2200, 3400, 5100],
  [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400], [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700],
]

export function partyThresholds(levels: number[]) {
  const sum = [0, 0, 0, 0]
  for (const l of levels) {
    const t = THRESHOLDS[Math.min(20, Math.max(1, Math.round(l))) - 1]
    for (let i = 0; i < 4; i++) sum[i] += t[i]
  }
  return { easy: sum[0], medium: sum[1], hard: sum[2], deadly: sum[3] }
}

const MULTIPLIERS = [0.5, 1, 1.5, 2, 2.5, 3, 4]
/** How much more dangerous a crowd is than the sum of its parts. A small party feels it more, a large one less. */
export function multiplier(monsters: number, partySize: number) {
  if (monsters <= 0) return 0
  let step = monsters === 1 ? 0 : monsters === 2 ? 1 : monsters <= 6 ? 2 : monsters <= 10 ? 3 : monsters <= 14 ? 4 : 5
  if (partySize < 3) step++
  else if (partySize > 5) step--
  // index 0 is the step below a single monster, which only a large party reaches
  return MULTIPLIERS[Math.min(MULTIPLIERS.length - 1, Math.max(0, step + 1))]
}

/**
 * 2024: XP a character adds to the budget at Low, Moderate and High difficulty, by level.
 * Levels 1, 3, 5, 10 and 20 were checked against the published table, the others are from the book as remembered.
 */
const BUDGET_2024: [number, number, number][] = [
  [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100], [600, 1000, 1400], [750, 1300, 1700], [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100],
  [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800], [3800, 6100, 9800], [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000],
]

export function partyBudget(levels: number[]) {
  const sum = [0, 0, 0]
  for (const l of levels) { const t = BUDGET_2024[Math.min(20, Math.max(1, Math.round(l))) - 1]; for (let i = 0; i < 3; i++) sum[i] += t[i] }
  return { low: sum[0], moderate: sum[1], high: sum[2] }
}

export interface Rated { xp: number; count: number; /** Pathfinder 2e: the creature's level */ level?: number }

/** Pathfinder 2e: XP of a creature by how far its level is from the party's. Weaker than four below counts for nothing. */
const PF2E_XP: Record<number, number> = { [-4]: 10, [-3]: 15, [-2]: 20, [-1]: 30, 0: 40, 1: 60, 2: 80, 3: 120, 4: 160 }
export const pf2eCreatureXp = (creatureLevel: number, partyLevel: number) => PF2E_XP[Math.max(-5, Math.min(5, creatureLevel - partyLevel))] ?? 0

/** Budgets for a party of four, and what each character more or fewer adds or takes away. */
const PF2E_BUDGET = { trivial: [40, 10], low: [60, 15], moderate: [80, 20], severe: [120, 30], extreme: [160, 40] } as const

export function pf2eBudget(partySize: number) {
  const f = (k: keyof typeof PF2E_BUDGET) => Math.max(0, PF2E_BUDGET[k][0] + (partySize - 4) * PF2E_BUDGET[k][1])
  return { trivial: f('trivial'), low: f('low'), moderate: f('moderate'), severe: f('severe'), extreme: f('extreme') }
}

/** Pathfinder 2e: the party's level is the average, creatures are worth XP by level against it, and the total is a threat level. */
function ratePf2e(monsters: Rated[], levels: number[]) {
  const partyLevel = levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : 0
  const count = monsters.reduce((n, m) => n + m.count, 0)
  const total = monsters.reduce((n, m) => n + pf2eCreatureXp(m.level ?? partyLevel, partyLevel) * m.count, 0)
  const b = pf2eBudget(levels.length)
  const difficulty: Difficulty = !levels.length || !count ? 'trivial' : total >= b.extreme ? 'extreme' : total >= b.severe ? 'severe' : total >= b.moderate ? 'moderate' : total >= b.low ? 'low' : 'trivial'
  return { method: 'pf2e' as const, total, count, adjusted: total, partyLevel, thresholds: { easy: b.low, medium: b.moderate, hard: b.severe, deadly: b.extreme }, budget: null, pf2eBudget: b, difficulty, perCharacter: 0 }
}

/** The 2024 method: no multiplier, the creatures' XP is compared with the party's budget. */
function rate2024(monsters: Rated[], levels: number[]) {
  const total = monsters.reduce((n, m) => n + m.xp * m.count, 0)
  const count = monsters.reduce((n, m) => n + m.count, 0)
  const b = partyBudget(levels)
  const difficulty: Difficulty = !levels.length || !count ? 'trivial' : total > b.high ? 'over' : total > b.moderate ? 'high' : total > b.low ? 'moderate' : 'low'
  return { method: '5e-2024' as const, total, count, adjusted: total, thresholds: { easy: b.low, medium: b.moderate, hard: b.high, deadly: 0 }, budget: b, difficulty, perCharacter: levels.length ? Math.floor(total / levels.length) : 0 }
}

export function rate(monsters: Rated[], levels: number[], system: RuleSystem = '5e') {
  if (system === '5e-2024') return rate2024(monsters, levels)
  if (system === 'pf2e') return ratePf2e(monsters, levels)
  const total = monsters.reduce((n, m) => n + m.xp * m.count, 0)
  const count = monsters.reduce((n, m) => n + m.count, 0)
  const adjusted = Math.round(total * (levels.length ? multiplier(count, levels.length) : 1))
  const t = partyThresholds(levels)
  const difficulty: Difficulty = !levels.length || !count ? 'trivial' : adjusted >= t.deadly ? 'deadly' : adjusted >= t.hard ? 'hard' : adjusted >= t.medium ? 'medium' : adjusted >= t.easy ? 'easy' : 'trivial'
  return { method: '5e' as const, budget: null, total, count, adjusted, thresholds: t, difficulty, /** XP shared out when the fight is won */ perCharacter: levels.length ? Math.floor(total / levels.length) : 0 }
}
