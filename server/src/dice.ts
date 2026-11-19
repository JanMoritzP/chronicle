import { randomInt } from 'node:crypto'

// Dice notation: 2d20kh1+5, 4d6dl1, 1d8!, d%, 3, plus "adv" or "dis" after the expression.
// A roll is described term by term so the chat can show how the total came about. The random source is injectable for tests.

export interface Die { v: number; /** kept out of the total (dropped by kh/kl/dh/dl) */ dropped?: boolean; /** came from an explosion */ extra?: boolean }
export type Term =
  | { kind: 'num'; sign: 1 | -1; value: number }
  | { kind: 'dice'; sign: 1 | -1; count: number; sides: number; dice: Die[]; subtotal: number; text: string }
export interface Roll { expr: string; label: string; total: number; terms: Term[]; /** a single d20 that came up 20 or 1 (after keep/drop) */ crit: 'hit' | 'miss' | null }

export type Rng = (sides: number) => number
export const cryptoRng: Rng = (sides) => randomInt(1, sides + 1)

const MAX_COUNT = 100, MAX_SIDES = 1000, MAX_DICE = 500, MAX_EXPLODE = 100
const TERM = /^\s*([+-])?\s*(?:(\d{1,3})?d(\d{1,4}|%)((?:kh\d*|kl\d*|dh\d*|dl\d*|!)*)|(\d{1,6}))/i

/** Reads the leading roll from some text. Anything after it is the label ("1d20+5 stealth" has the label "stealth"). Null when the text does not start with a roll. */
export function parseRoll(input: string, rng: Rng = cryptoRng): Roll | null {
  let rest = input.trim()
  const terms: Term[] = []
  let used = 0
  let first = true
  let total = 0
  while (rest) {
    const m = TERM.exec(rest)
    if (!m || (!first && !m[1])) break
    const sign: 1 | -1 = m[1] === '-' ? -1 : 1
    if (m[5] !== undefined) {
      const value = Number(m[5])
      terms.push({ kind: 'num', sign, value })
      total += sign * value
    } else {
      const count = m[2] ? Number(m[2]) : 1
      const sides = m[3] === '%' ? 100 : Number(m[3])
      if (count < 1 || count > MAX_COUNT || sides < 2 || sides > MAX_SIDES) return null
      used += count
      if (used > MAX_DICE) return null
      const t = rollDice(count, sides, m[4].toLowerCase(), sign, rng)
      terms.push(t)
      total += sign * t.subtotal
    }
    rest = rest.slice(m[0].length)
    first = false
  }
  if (!terms.length) return null
  // "adv" and "dis" turn the first d20 into two dice, keeping the best or the worst
  const flag = /^\s*(adv|dis)\b/i.exec(rest)
  let label = rest
  if (flag) {
    label = rest.slice(flag[0].length)
    const idx = terms.findIndex((t) => t.kind === 'dice' && t.sides === 20 && t.count === 1)
    if (idx >= 0) {
      const old = terms[idx] as Extract<Term, { kind: 'dice' }>
      total -= old.sign * old.subtotal
      // the die already rolled stays; one more joins it
      const t = rollDice(1, 20, '', old.sign, rng)
      t.dice.unshift(old.dice[0])
      t.count = 2
      t.text = `2d20${flag[1].toLowerCase() === 'adv' ? 'kh1' : 'kl1'}`
      const live = t.dice.slice().sort((a, b) => a.v - b.v)
      ;(flag[1].toLowerCase() === 'adv' ? live[0] : live[1]).dropped = true
      t.subtotal = t.dice.filter((d) => !d.dropped).reduce((n, d) => n + d.v, 0)
      terms[idx] = t
      total += t.sign * t.subtotal
    }
  }
  const kept = terms.filter((t): t is Extract<Term, { kind: 'dice' }> => t.kind === 'dice' && t.sides === 20 && t.dice.filter((d) => !d.dropped).length === 1)
  const one = kept.length === 1 ? kept[0].dice.find((d) => !d.dropped)! : null
  const expr = input.trim().slice(0, input.trim().length - rest.length).trim() + (flag ? ` ${flag[1].toLowerCase()}` : '')
  return { expr, label: label.trim(), total, terms, crit: one ? (one.v === 20 ? 'hit' : one.v === 1 ? 'miss' : null) : null }
}

function rollDice(count: number, sides: number, mods: string, sign: 1 | -1, rng: Rng): Extract<Term, { kind: 'dice' }> {
  const dice: Die[] = []
  const explode = mods.includes('!')
  for (let i = 0; i < count; i++) {
    let v = rng(sides)
    dice.push({ v })
    let n = 0
    while (explode && v === sides && sides > 1 && n++ < MAX_EXPLODE) { v = rng(sides); dice.push({ v, extra: true }) }
  }
  // keep and drop act on the dice that were rolled, lowest or highest first
  for (const [, kind, num] of mods.matchAll(/(kh|kl|dh|dl)(\d*)/g)) {
    const n = num ? Number(num) : 1
    const live = dice.filter((d) => !d.dropped).sort((a, b) => a.v - b.v)
    const drop = kind === 'kh' ? live.slice(0, Math.max(0, live.length - n)) : kind === 'kl' ? live.slice(n) : kind === 'dh' ? live.slice(Math.max(0, live.length - n)) : live.slice(0, n)
    for (const d of drop) d.dropped = true
  }
  const subtotal = dice.filter((d) => !d.dropped).reduce((s, d) => s + d.v, 0)
  return { kind: 'dice', sign, count, sides, dice, subtotal, text: `${count}d${sides}${mods}` }
}

/** The whole roll as one line for people and logs: "2d20kh1+5 = [17, ~4~] + 5 = 22". */
export function describe(r: Roll): string {
  const parts = r.terms.map((t, i) => {
    const s = t.sign === -1 ? '- ' : i ? '+ ' : ''
    return t.kind === 'num' ? `${s}${t.value}` : `${s}[${t.dice.map((d) => (d.dropped ? `~${d.v}~` : String(d.v))).join(', ')}]`
  })
  return `${r.expr} = ${parts.join(' ')} = ${r.total}`
}
