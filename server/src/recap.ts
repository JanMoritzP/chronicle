// A first draft of what happened at the last session, from the table chat: who said what, who rolled what. Whispers and the GM's secret rolls are left out.

export interface ChatRow { ts: number; name: string; kind: string; parts: { t: string; text?: string; roll?: { label?: string; expr?: string; total?: number; degree?: string } }[] }

/** The messages of the latest session: the newest ones, back to the first gap of more than `gapMs` (6 hours). Only what everyone could read. */
export function lastSession(rows: ChatRow[], gapMs = 6 * 3600_000): ChatRow[] {
  const open = rows.filter((r) => r.kind !== 'whisper' && r.kind !== 'gmroll').sort((a, b) => a.ts - b.ts)
  let from = open.length
  for (let i = open.length - 1; i >= 0; i--) {
    if (i < open.length - 1 && open[i + 1].ts - open[i].ts > gapMs) break
    from = i
  }
  return open.slice(from)
}

const say = (r: ChatRow) => r.parts.map((p) => (p.t === 'roll' && p.roll ? `${p.roll.label || p.roll.expr || 'a roll'} ${p.roll.total}${p.roll.degree ? ` (${p.roll.degree})` : ''}` : p.text ?? '')).join('').trim()

/** The session as lines: the date first, then one line for each thing said, done or rolled. */
export function recapLines(rows: ChatRow[], locale = 'en-GB'): string[] {
  const session = lastSession(rows)
  if (!session.length) return []
  const out = [new Date(session[0].ts).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })]
  for (const r of session) {
    const text = say(r)
    if (!text) continue
    out.push(r.kind === 'emote' ? `${r.name} ${text}` : r.kind === 'roll' ? `${r.name} rolled ${text}` : `${r.name}: ${text}`)
  }
  return out
}
