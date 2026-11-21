import type { Rng } from './dice.js'

// Roll tables and card decks. Pure rules; table.ts stores them and sends each person what they may see.

// ---------- roll tables ----------

export interface TableEntry { weight: number; text: string }
export const MAX_ENTRIES = 200

/** One entry per line. A leading "3: " makes it three times as likely as an entry without one. Blank lines are skipped. */
export function parseEntries(text: string): TableEntry[] {
  const out: TableEntry[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = /^(\d{1,4})\s*:\s*(.+)$/.exec(line)
    const weight = m ? Math.max(1, Math.min(1000, Number(m[1]))) : 1
    out.push({ weight, text: (m ? m[2] : line).slice(0, 300) })
    if (out.length >= MAX_ENTRIES) break
  }
  return out
}

/** The entries as the text a person edits. */
export const entriesText = (es: TableEntry[]) => es.map((e) => (e.weight > 1 ? `${e.weight}: ${e.text}` : e.text)).join('\n')

export const totalWeight = (es: TableEntry[]) => es.reduce((n, e) => n + e.weight, 0)

/** Rolls a die as big as the total weight and finds the entry it lands in. Null for an empty table. */
export function pick(es: TableEntry[], rng: Rng): { index: number; roll: number; total: number } | null {
  const total = totalWeight(es)
  if (!total) return null
  const roll = rng(total)
  let at = roll
  for (let i = 0; i < es.length; i++) {
    at -= es[i].weight
    if (at <= 0) return { index: i, roll, total }
  }
  return { index: es.length - 1, roll, total }
}

// ---------- decks ----------

export interface Card { name: string; text: string }
export const MAX_CARDS = 200

/** One card per line, "Name | what it says". "3x Fireball" makes three copies. */
export function parseCards(text: string): Card[] {
  const out: Card[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = /^(\d{1,2})\s*x\s+(.+)$/i.exec(line)
    const copies = m ? Math.max(1, Number(m[1])) : 1
    const [name, ...rest] = (m ? m[2] : line).split('|')
    const card = { name: name.trim().slice(0, 80), text: rest.join('|').trim().slice(0, 300) }
    if (!card.name) continue
    for (let i = 0; i < copies && out.length < MAX_CARDS; i++) out.push(card)
  }
  return out
}

export const cardsText = (cards: Card[]) => {
  const out: string[] = []
  for (let i = 0; i < cards.length; i++) {
    let n = 1
    while (i + n < cards.length && cards[i + n].name === cards[i].name && cards[i + n].text === cards[i].text) n++
    out.push(`${n > 1 ? `${n}x ` : ''}${cards[i].name}${cards[i].text ? ` | ${cards[i].text}` : ''}`)
    i += n - 1
  }
  return out.join('\n')
}

/** A fair shuffle with the random source given. */
export function shuffle<T>(list: T[], rng: Rng): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) { const j = rng(i + 1) - 1; [a[i], a[j]] = [a[j], a[i]] }
  return a
}

/** Where every card of a deck is: face down to draw, face up in the discard pile, or in someone's hand. Cards are numbers, their place in the deck. */
export interface DeckState { draw: number[]; discard: number[]; hands: Record<string, number[]> }

export const freshDeck = (size: number, rng: Rng): DeckState => ({ draw: shuffle(Array.from({ length: size }, (_, i) => i), rng), discard: [], hands: {} })

/** Takes cards off the top. When the pile runs out the discard pile is shuffled back in; when there is nothing left, fewer cards come. */
export function drawCards(st: DeckState, n: number, rng: Rng): { state: DeckState; drawn: number[] } {
  let draw = [...st.draw], discard = [...st.discard]
  const drawn: number[] = []
  while (drawn.length < n) {
    if (!draw.length) {
      if (!discard.length) break
      draw = shuffle(discard, rng)
      discard = []
    }
    drawn.push(draw.shift()!)
  }
  return { state: { ...st, draw, discard }, drawn }
}

export const handOf = (st: DeckState, user: string) => st.hands[user] ?? []

export function toHand(st: DeckState, user: string, cards: number[]): DeckState {
  return { ...st, hands: { ...st.hands, [user]: [...handOf(st, user), ...cards] } }
}

/** A card leaves the person's hand for the discard pile. Null when they do not hold it. */
export function discardFromHand(st: DeckState, user: string, card: number): DeckState | null {
  const hand = handOf(st, user)
  const at = hand.indexOf(card)
  if (at < 0) return null
  const rest = hand.filter((_, i) => i !== at)
  const hands = { ...st.hands }
  if (rest.length) hands[user] = rest; else delete hands[user]
  return { ...st, hands, discard: [card, ...st.discard] }
}

export const toDiscard = (st: DeckState, cards: number[]): DeckState => ({ ...st, discard: [...[...cards].reverse(), ...st.discard] })
