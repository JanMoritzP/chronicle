/**
 * Custom calendar: Year → up to two named sub-levels → days. No leap years.
 * Time is an integer day count T. T = 0 is day 1 of `startYear`'s first unit; negative T is before it.
 */
export interface CalUnit { name: string; days?: number; children?: { name: string; days: number }[] }
export interface Calendar {
  yearLabel: string
  startYear: number
  levels: 0 | 1 | 2
  level1Label: string
  level2Label: string
  dayLabel: string
  yearDays: number
  units: CalUnit[]
}
export interface DateParts { year: number; l1: number; l2: number; day: number }

export const DEFAULT_CALENDAR: Calendar = {
  yearLabel: 'Year', startYear: 1, levels: 1, level1Label: 'Month', level2Label: '', dayLabel: 'Day', yearDays: 360,
  units: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    .map((name) => ({ name, days: 30 })),
}

interface Span { l1: number; l2: number; days: number }

function spans(c: Calendar): Span[] {
  if (c.levels === 0) return [{ l1: 0, l2: 0, days: Math.max(1, c.yearDays) }]
  if (c.levels === 1) return c.units.map((u, i) => ({ l1: i, l2: 0, days: Math.max(1, u.days ?? 1) }))
  return c.units.flatMap((u, i) => (u.children ?? []).map((ch, j) => ({ l1: i, l2: j, days: Math.max(1, ch.days) })))
}

export function yearLength(c: Calendar): number {
  return spans(c).reduce((a, s) => a + s.days, 0) || 1
}

export function toParts(c: Calendar, t: number): DateParts {
  const all = spans(c)
  const yl = yearLength(c)
  const y = Math.floor(t / yl)
  let r = t - y * yl
  for (const s of all) {
    if (r < s.days) return { year: c.startYear + y, l1: s.l1, l2: s.l2, day: r + 1 }
    r -= s.days
  }
  return { year: c.startYear + y, l1: 0, l2: 0, day: 1 }
}

const sameSpan = (c: Calendar, s: Span, p: DateParts) =>
  c.levels === 0 || (c.levels === 1 ? s.l1 === p.l1 : s.l1 === p.l1 && s.l2 === p.l2)

export function spanDays(c: Calendar, p: Pick<DateParts, 'l1' | 'l2'>): number {
  return spans(c).find((s) => sameSpan(c, s, p as DateParts))?.days ?? 1
}

export function fromParts(c: Calendar, p: DateParts): number {
  const all = spans(c)
  let off = 0
  let days = 1
  for (const s of all) {
    if (sameSpan(c, s, p)) { days = s.days; break }
    off += s.days
  }
  const day = Math.min(Math.max(1, Math.round(p.day)), days)
  return (Math.round(p.year) - c.startYear) * yearLength(c) + off + day - 1
}

export const unitName = (c: Calendar, l1: number) => c.units[l1]?.name ?? '?'
export const childName = (c: Calendar, l1: number, l2: number) => c.units[l1]?.children?.[l2]?.name ?? '?'

/** "Year 4 Season Summer Month Glorsh Day 5" */
export function formatDate(c: Calendar, t: number): string {
  const p = toParts(c, t)
  const seg: string[] = [`${c.yearLabel} ${p.year}`]
  if (c.levels >= 1) seg.push(`${c.level1Label} ${unitName(c, p.l1)}`.trim())
  if (c.levels === 2) seg.push(`${c.level2Label} ${childName(c, p.l1, p.l2)}`.trim())
  seg.push(`${c.dayLabel} ${p.day}`)
  return seg.join(' ')
}

/** Compact form for tight spots: "Glorsh 5, 4" */
export function formatShort(c: Calendar, t: number): string {
  const p = toParts(c, t)
  const name = c.levels === 2 ? childName(c, p.l1, p.l2) : c.levels === 1 ? unitName(c, p.l1) : ''
  return `${name} ${p.day}, ${p.year}`.trim()
}

export function formatRange(c: Calendar, a: number, b?: number | null): string {
  return b != null && b !== a ? `${formatDate(c, a)} → ${formatDate(c, b)}` : formatDate(c, a)
}

/** First day of the span (month) containing t. */
export function spanStart(c: Calendar, t: number): number {
  return t - (toParts(c, t).day - 1)
}
export function nextSpanStart(c: Calendar, t: number): number {
  const p = toParts(c, t)
  return spanStart(c, t) + spanDays(c, p)
}
export function prevSpanStart(c: Calendar, t: number): number {
  return spanStart(c, spanStart(c, t) - 1)
}

export function validateCalendar(c: Calendar): string | null {
  if (c.levels === 0 && c.yearDays < 1) return 'The year needs at least one day.'
  if (c.levels === 1 && (!c.units.length || c.units.some((u) => !u.name.trim() || !(u.days && u.days >= 1)))) return 'Every unit needs a name and a day count.'
  if (c.levels === 2 && (!c.units.length || c.units.some((u) => !u.name.trim() || !u.children?.length || u.children.some((ch) => !ch.name.trim() || ch.days < 1)))) {
    return 'Every top-level unit needs sub-units with names and day counts.'
  }
  return null
}
