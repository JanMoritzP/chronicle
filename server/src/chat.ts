import { parseRoll, type Degree, type Rng, type Roll, cryptoRng } from './dice.js'

// What a line typed into the table chat means: plain talk, a roll, an emote or a whisper, with [[1d20+3]] rolling inside the text.

export type Inline = { t: 'text'; text: string } | { t: 'roll'; roll: Roll }
/** A roll template: a titled card of labelled lines, each holding text and rolls. */
export interface CardRow { label: string; parts: Inline[] }
export type Part = Inline | { t: 'card'; title: string; rows: CardRow[] }
export type Kind = 'say' | 'roll' | 'gmroll' | 'emote' | 'whisper' | 'ooc'
export interface Parsed { kind: Kind; /** user name a whisper goes to */ to?: string; /** the name the GM speaks as (/as) */ as?: string; parts: Part[] }

const INLINE = /\[\[([^\]]{1,80})\]\]/g

export function withInline(text: string, rng: Rng): Inline[] {
  const parts: Inline[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const roll = parseRoll(m[1], rng)
    if (!roll) continue
    if (m.index > last) parts.push({ t: 'text', text: text.slice(last, m.index) })
    parts.push({ t: 'roll', roll })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ t: 'text', text: text.slice(last) })
  return parts
}

/** Rows of a card that were typed as `Label: value`, one per segment; a segment without a label is a plain line. */
function rowsFrom(pairs: [string, string][], rng: Rng, system: string): CardRow[] {
  return pairs.slice(0, 12).map(([label, value]) => ({
    label: label.trim().slice(0, 40),
    parts: withInline(value.trim().slice(0, 300), rng).map((p): Inline => (p.t === 'roll' ? { t: 'roll', roll: withDc(p.roll, system) } : p)),
  })).filter((r) => r.parts.length)
}

/**
 * A roll template, either `/card Title | Attack: [[1d20+5]] | Damage: [[1d8+3]] slashing` or the Roll20 way,
 * `&{template:default} {{name=Title}} {{Attack=[[1d20+5]]}}`.
 */
export function parseCard(line: string, rng: Rng = cryptoRng, system = '5e'): Parsed | { error: string } {
  const text = line.trim()
  let title = '', pairs: [string, string][] = []
  if (text.startsWith('&{template:')) {
    for (const m of text.matchAll(/\{\{([^=}]{1,60})=(.*?)\}\}/gs)) {
      if (m[1].trim().toLowerCase() === 'name') title = m[2].trim()
      else pairs.push([m[1], m[2]])
    }
  } else {
    const segs = text.replace(/^\/\w+\s*/, '').split('|').map((s) => s.trim()).filter(Boolean)
    title = segs.shift() ?? ''
    pairs = segs.map((s): [string, string] => { const i = s.indexOf(':'); return i > 0 && i < 41 ? [s.slice(0, i), s.slice(i + 1)] : ['', s] })
  }
  if (!title) return { error: 'A card needs a title: /card Longsword | Attack: [[1d20+5]] | Damage: [[1d8+3]] slashing' }
  if (pairs.length > 12) return { error: 'A card holds at most 12 lines.' }
  const rows = rowsFrom(pairs, rng, system)
  return { kind: 'say', parts: [{ t: 'card', title: title.slice(0, 80), rows }] }
}

/** Returns the parsed line, or an error sentence to show the sender. */
/**
 * How a roll did against a difficulty class. Pathfinder 2e has four degrees: ten or more over or under moves it a step, and so does a natural 20 or 1.
 * 5e only knows success and failure.
 */
export function degreeOf(total: number, dc: number, nat: 'hit' | 'miss' | null, system: string): Degree {
  if (system !== 'pf2e') return total >= dc ? 'success' : 'failure'
  let step = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1
  if (nat === 'hit') step = Math.min(3, step + 1)
  if (nat === 'miss') step = Math.max(0, step - 1)
  return (['critical failure', 'failure', 'success', 'critical success'] as const)[step]
}

export function withDc(roll: Roll, system: string): Roll {
  const m = /\bdc\s*(\d{1,2})\b/i.exec(roll.label)
  if (!m) return roll
  const dc = Number(m[1])
  return { ...roll, dc, degree: degreeOf(roll.total, dc, roll.crit, system) }
}

export function parseChat(line: string, rng: Rng = cryptoRng, system = '5e'): Parsed | { error: string } {
  const text = line.trim()
  if (!text) return { error: 'Nothing to send.' }
  if (text.startsWith('&{template:')) return parseCard(text, rng, system)
  const cmd = /^\/(\w+)\s*(.*)$/s.exec(text)
  if (!cmd) return { kind: 'say', parts: withInline(text, rng) }
  const [, name, rest] = cmd
  switch (name.toLowerCase()) {
    case 'r': case 'roll': case 'gr': case 'gmroll': {
      const roll = parseRoll(rest, rng)
      if (!roll) return { error: 'That is not a roll. Try /roll 1d20+5, or 2d20kh1 for advantage.' }
      return { kind: name.toLowerCase().startsWith('g') ? 'gmroll' : 'roll', parts: [{ t: 'roll', roll: withDc(roll, system) }] }
    }
    case 'card': case 'template': return parseCard(text, rng, system)
    case 'as': {
      const m = /^("[^"]{1,60}"|\S{1,60})\s+(.+)$/s.exec(rest)
      if (!m) return { error: 'Speak as someone with /as Name what they say, or /as "Old Mara" what she says.' }
      return { kind: 'say', as: m[1].replace(/^"|"$/g, ''), parts: withInline(m[2], rng) }
    }
    case 'ooc': case 'o': return rest ? { kind: 'ooc', parts: withInline(rest, rng) } : { error: 'Say something out of character with /ooc your message.' }
    case 'me': case 'em': return rest ? { kind: 'emote', parts: withInline(rest, rng) } : { error: 'What do you do? Try /me draws a sword.' }
    case 'w': case 'whisper': {
      const m = /^(\S+)\s+(.+)$/s.exec(rest)
      if (!m) return { error: 'Whisper to someone with /w name your message.' }
      return { kind: 'whisper', to: m[1], parts: withInline(m[2], rng) }
    }
    default: return { error: `Unknown command /${name}. Try /roll, /gmroll, /w, /me, /ooc, /card or /table.` }
  }
}

/** Who gets to read a message: talk and rolls are for everyone, a whisper for its two people, a GM roll for the GMs and its roller. */
export function readable(m: { kind: Kind; userId: string; to: string[] }, userId: string, isGm: boolean) {
  if (m.kind === 'whisper') return userId === m.userId || m.to.includes(userId)
  if (m.kind === 'gmroll') return userId === m.userId || isGm
  return true
}
