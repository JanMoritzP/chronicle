// The order of play: who goes when, whose turn it is and which round. Pure rules; table.ts stores and sends the result.

export interface Combatant {
  id: string
  /** the token on the map, if there is one */
  tokenId: string | null
  name: string
  init: number | null
  /** kept from the players, like a hidden token */
  hidden: boolean
  /** knocked out or fled: skipped in the order */
  done: boolean
}
export interface Combat { active: boolean; round: number; turn: string | null; list: Combatant[] }

export const emptyCombat = (): Combat => ({ active: false, round: 0, turn: null, list: [] })

/** Highest initiative first; those without one go last, and ties keep the order they were added in. */
export function ordered(list: Combatant[]): Combatant[] {
  return list.map((c, i) => ({ c, i })).sort((a, b) => (b.c.init ?? -Infinity) - (a.c.init ?? -Infinity) || a.i - b.i).map((x) => x.c)
}

const inPlay = (c: Combat) => ordered(c.list).filter((x) => !x.done && x.init !== null)

export function withList(c: Combat, list: Combatant[]): Combat {
  const next = { ...c, list: ordered(list) }
  // if the combatant whose turn it is was removed, play passes to whoever is now first
  if (next.active && (!next.turn || !next.list.some((x) => x.id === next.turn && !x.done))) next.turn = inPlay(next)[0]?.id ?? null
  return next
}

export const start = (c: Combat): Combat => {
  const first = inPlay(c)[0]
  return first ? { ...c, active: true, round: 1, turn: first.id } : c
}

export function advance(c: Combat, step: 1 | -1): Combat {
  if (!c.active) return c
  const order = inPlay(c)
  if (!order.length) return c
  const at = order.findIndex((x) => x.id === c.turn)
  let i = at < 0 ? 0 : at + step
  let round = c.round
  if (i >= order.length) { i = 0; round++ } else if (i < 0) { if (round > 1) { i = order.length - 1; round-- } else i = 0 }
  return { ...c, turn: order[i].id, round }
}

export const end = (c: Combat): Combat => ({ ...c, active: false, round: 0, turn: null })

/** What a person is allowed to see of the order: hidden combatants are only the GM's. */
export function visible(c: Combat, gm: boolean): Combat {
  if (gm) return c
  const list = c.list.filter((x) => !x.hidden)
  return { ...c, list, turn: c.turn && list.some((x) => x.id === c.turn) ? c.turn : null }
}
