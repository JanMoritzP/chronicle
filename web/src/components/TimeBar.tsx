import { CalendarDays, ChevronsLeft, ChevronsRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDate, nextSpanStart, prevSpanStart, yearLength, type Calendar } from '../lib/calendar'
import { CalendarGrid, DateField } from './DateField'
import { Select } from './Select'

type Step = 'day' | 'span' | 'year'

export interface TimeTick { t: number; label: string; kind: 'item' | 'event' }

export function TimeBar({ cal, T, setT, ticks }: { cal: Calendar; T: number; setT: (t: number) => void; ticks: TimeTick[] }) {
  const [step, setStep] = useState<Step>('day')
  const [playing, setPlaying] = useState(false)
  const [open, setOpen] = useState(false)
  const yl = yearLength(cal)
  const cur = useRef(T)
  cur.current = T

  const move = (dir: 1 | -1, s: Step = step) => {
    const t = cur.current
    if (s === 'day') return t + dir
    if (s === 'year') return t + dir * yl
    return dir > 0 ? nextSpanStart(cal, t) : prevSpanStart(cal, t)
  }

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => setT(move(1)), 350)
    return () => window.clearInterval(id)
  }, [playing, step, cal])

  const base = useMemo(() => {
    if (!ticks.length) return { lo: 0, hi: yl * 2 }
    const ts = ticks.map((t) => t.t)
    const lo = Math.min(...ts), hi = Math.max(...ts)
    const pad = Math.max(yl / 6, (hi - lo) * 0.1)
    return { lo: Math.floor(lo - pad), hi: Math.ceil(hi + pad) }
  }, [ticks, yl])
  const lo = Math.min(base.lo, T), hi = Math.max(base.hi, T)

  const sorted = useMemo(() => [...new Set(ticks.map((t) => t.t))].sort((a, b) => a - b), [ticks])
  const prevChange = () => { const t = [...sorted].reverse().find((x) => x < T); if (t !== undefined) setT(t) }
  const nextChange = () => { const t = sorted.find((x) => x > T); if (t !== undefined) setT(t) }
  const marks = useMemo(() => new Set(ticks.map((t) => t.t)), [ticks])
  const pct = (t: number) => ((t - lo) / Math.max(1, hi - lo)) * 100

  return (
    <div className="timebar">
      <div className="timebar-row">
        <button className="icon-btn" title="Previous change" onClick={prevChange}><SkipBack size={16} /></button>
        <button className="icon-btn" title="Back one step" onClick={() => setT(move(-1))}><ChevronsLeft size={16} /></button>
        <button className="icon-btn" title={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="icon-btn" title="Forward one step" onClick={() => setT(move(1))}><ChevronsRight size={16} /></button>
        <button className="icon-btn" title="Next change" onClick={nextChange}><SkipForward size={16} /></button>
        <Select className="input timebar-step" value={step} onChange={(v) => setStep(v as Step)} title="Step size">
          <option value="day">{cal.dayLabel}</option>
          <option value="span">{cal.levels === 0 ? cal.yearLabel : cal.levels === 1 ? cal.level1Label : cal.level2Label}</option>
          <option value="year">{cal.yearLabel}</option>
        </Select>
        <button className="btn timebar-date" onClick={() => setOpen(!open)}><CalendarDays size={15} /> {formatDate(cal, T)}</button>
      </div>
      <div className="timebar-track">
        <input type="range" min={lo} max={hi} step={1} value={T} onChange={(e) => setT(Number(e.target.value))} />
        {ticks.slice(0, 400).map((t, i) => (
          <i key={i} className={`tick ${t.kind}`} style={{ left: `${pct(t.t)}%` }} title={`${t.label} · ${formatDate(cal, t.t)}`} onClick={() => setT(t.t)} />
        ))}
      </div>
      {open && (
        <div className="timebar-pop">
          <DateField cal={cal} value={T} onChange={setT} />
          <CalendarGrid cal={cal} value={T} onPick={setT} marks={marks} />
        </div>
      )}
    </div>
  )
}
