import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Select } from './Select'
import {
  childName, formatDate, fromParts, nextSpanStart, prevSpanStart, spanDays, spanStart, toParts, unitName, type Calendar,
} from '../lib/calendar'

/** Year / level-1 / level-2 / day inputs for a point in time, following the workspace calendar. */
export function DateField({ cal, value, onChange, disabled }: { cal: Calendar; value: number; onChange: (t: number) => void; disabled?: boolean }) {
  const p = toParts(cal, value)
  const set = (patch: Partial<typeof p>) => onChange(fromParts(cal, { ...p, ...patch }))
  const maxDay = spanDays(cal, p)
  return (
    <span className="date-field">
      <label><span>{cal.yearLabel}</span>
        <input className="input" type="number" disabled={disabled} value={p.year} onChange={(e) => set({ year: Number(e.target.value) || 0 })} /></label>
      {cal.levels >= 1 && (
        <label><span>{cal.level1Label}</span>
          <Select className="input" disabled={disabled} value={String(p.l1)} onChange={(v) => set({ l1: Number(v), l2: 0 })}>
            {cal.units.map((u, i) => <option key={i} value={i}>{u.name}</option>)}
          </Select></label>
      )}
      {cal.levels === 2 && (
        <label><span>{cal.level2Label}</span>
          <Select className="input" disabled={disabled} value={String(p.l2)} onChange={(v) => set({ l2: Number(v) })}>
            {(cal.units[p.l1]?.children ?? []).map((u, i) => <option key={i} value={i}>{u.name}</option>)}
          </Select></label>
      )}
      <label><span>{cal.dayLabel}</span>
        <input className="input" type="number" min={1} max={maxDay} disabled={disabled} value={p.day} onChange={(e) => set({ day: Number(e.target.value) || 1 })} /></label>
    </span>
  )
}

/** Month-style grid for picking a day. `marks` are days that have something happening. */
export function CalendarGrid({ cal, value, onPick, marks }: { cal: Calendar; value: number; onPick: (t: number) => void; marks?: Set<number> }) {
  const [view, setView] = useState(() => spanStart(cal, value))
  const p = toParts(cal, view)
  const days = spanDays(cal, p)
  const title = cal.levels === 2 ? `${childName(cal, p.l1, p.l2)}, ${unitName(cal, p.l1)}` : cal.levels === 1 ? unitName(cal, p.l1) : cal.yearLabel
  const cols = days <= 31 ? 7 : 10
  return (
    <div className="cal-grid">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="icon-btn" onClick={() => setView(prevSpanStart(cal, view))}><ChevronLeft size={16} /></button>
        <b>{title} · {cal.yearLabel} {p.year}</b>
        <button className="icon-btn" onClick={() => setView(nextSpanStart(cal, view))}><ChevronRight size={16} /></button>
      </div>
      <div className="cal-days" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: days }, (_, i) => {
          const t = view + i
          return (
            <button key={i} className={`cal-day ${t === value ? 'sel' : ''} ${marks?.has(t) ? 'mark' : ''}`} onClick={() => onPick(t)}>{i + 1}</button>
          )
        })}
      </div>
      <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>{formatDate(cal, value)}</div>
    </div>
  )
}
