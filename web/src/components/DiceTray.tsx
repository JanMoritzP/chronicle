import { useEffect, useRef, useState } from 'react'
import { loadPerf } from '../lib/tableperf'
import { tumbles, type Tumble } from '../lib/dicefaces'
import { useTable } from '../tabletop/state'

// Every roll that arrives at the table tumbles across the corner of the map for a moment before it settles: a cube for each die, with the number it landed on.

export function DiceTray() {
  const chat = useTable((s) => s.chat)
  const seen = useRef<string | null>(chat.at(-1)?.id ?? null)
  const [shown, setShown] = useState<{ id: string; dice: Tumble[] }[]>([])
  const [off, setOff] = useState(() => loadPerf().light || loadPerf().noDice)
  useEffect(() => { const on = () => setOff(loadPerf().light || loadPerf().noDice); window.addEventListener('tt-perf', on); return () => window.removeEventListener('tt-perf', on) }, [])
  useEffect(() => {
    const last = chat.at(-1)
    if (!last || last.id === seen.current) return
    seen.current = last.id
    if (off || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const dice = tumbles(last)
    if (!dice.length) return
    setShown((s) => [...s.slice(-2), { id: last.id, dice }])
    window.setTimeout(() => setShown((s) => s.filter((x) => x.id !== last.id)), 3200)
  }, [chat, off])
  if (!shown.length) return null
  return (
    <div className="tt-dice" aria-hidden="true">
      {shown.map((r) => (
        <div key={r.id} className="tt-dice-row">
          {r.dice.map((d, i) => (
            <div key={d.key} className="die" style={{ animationDelay: `${i * 70}ms` }} title={`d${d.sides}`}>
              <div className={`die-cube${d.dropped ? ' dropped' : ''}`} style={{ animationDelay: `${i * 70}ms` }}>
                <span className="die-face f-front">{d.value}</span>
                <span className="die-face f-back">{d.faces[0]}</span>
                <span className="die-face f-right">{d.faces[1]}</span>
                <span className="die-face f-left">{d.faces[2]}</span>
                <span className="die-face f-top">{d.faces[3]}</span>
                <span className="die-face f-bottom">{d.faces[4]}</span>
              </div>
              <small>d{d.sides}</small>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
