import type { ChatMsg, RollTerm } from '../tabletop/state'

// What a roll looks like when it is shown tumbling: one die for each die that was rolled (at most a handful), with the number it landed on.

export interface Tumble { key: string; sides: number; value: number; dropped: boolean; /** numbers on the other faces */ faces: number[] }

const MAX_DICE = 8

/** The dice of a message to show, or none when it is not a roll. `rng` picks the numbers on the faces that are not the result. */
export function tumbles(msg: Pick<ChatMsg, 'id' | 'parts'>, rng: () => number = Math.random): Tumble[] {
  const out: Tumble[] = []
  const take = (terms: RollTerm[]) => {
    for (const t of terms) {
      if (t.kind !== 'dice') continue
      t.dice.forEach((d, i) => {
        if (out.length >= MAX_DICE || t.sides < 2) return
        out.push({ key: `${msg.id}:${out.length}:${i}`, sides: t.sides, value: d.v, dropped: !!d.dropped, faces: Array.from({ length: 5 }, () => 1 + Math.floor(rng() * t.sides)) })
      })
    }
  }
  for (const p of msg.parts) if (p.t === 'roll') take(p.roll.terms)
  return out
}
