import { Plus, Trash2 } from 'lucide-react'
import { classResources, columnsOf, recoveryText, spendPatch, spentOf } from '../lib/levelup'
import type { Counter, Sheet } from '../lib/sheet'
import { Bubbles, Num, Txt } from './CharacterSheet'
import { Select } from './Select'
import { FeatureLink } from './SheetLinks'
import type { SheetPatch } from './SheetView'

// What a character's classes count through a day (rages, ki, channel divinity), the numbers of their class tables that matter in play
// (rage damage, sneak attack, martial arts die), and counters kept by hand. The counts follow the class levels; only what is spent is stored.

/** Columns of a class table shown elsewhere: the counted ones here as resources, the spell ones in the spellbook. */
const ELSEWHERE = /known|prepared/i

export function SheetResources({ sheet, set, edit, style }: { sheet: Sheet; set?: (patch: SheetPatch) => void; edit: boolean; style?: React.CSSProperties }) {
  const resources = classResources(sheet)
  const counted = new Set(resources.map((r) => r.name.toLowerCase()))
  const several = (sheet.classes ?? []).filter((c) => c.name.trim() && c.level > 0).length > 1
  const numbers = (sheet.classes ?? []).flatMap((c) => (c.level < 1 ? [] : columnsOf(c.name, c.subclass, sheet.ruleset)
    .filter((col) => !counted.has(col.name.toLowerCase()) && !ELSEWHERE.test(col.name))
    .flatMap((col) => { const v = col.at(c.level); return v == null ? [] : [{ name: col.name, value: v, from: c.name }] })))
  const counters = sheet.counters ?? []
  const setCounters = (list: Counter[]) => set?.({ counters: list })
  if (!resources.length && !numbers.length && !counters.length && !edit) return null
  return (
    <section className="cs-resources" aria-label="Class resources" style={style}>
      <h4>Class resources</h4>
      <div className="cs-res-grid">
        {resources.map((r) => {
          const used = spentOf(sheet, r.id)
          const label = <><FeatureLink name={r.feature} categories={['feat', 'rule']}>{r.name}</FeatureLink>{several && <small className="muted"> {r.from}</small>}</>
          return (
            <div key={r.id} className="cs-res" title={`${r.name}: ${recoveryText(r.rest)}`}>
              <b>{label}</b>
              {r.max == null ? <span className="cs-res-n">Unlimited</span>
                : r.pool ? (
                  <span className="cs-res-n">
                    {set ? <Num label={`${r.name} left`} value={r.max - used} min={0} max={r.max} width={56} onChange={(n) => set(spendPatch(sheet, r, r.max! - Math.max(0, Math.min(r.max!, n))))} /> : r.max - used}
                    <span className="muted"> / {r.max}</span>
                  </span>
                ) : (
                  <span className="cs-res-n">
                    <Bubbles label={`${r.name} used`} total={r.max} used={used} onChange={(n) => set?.(spendPatch(sheet, r, n))} />
                    <small className="muted">{r.max - used} of {r.max} left</small>
                  </span>
                )}
              <small className="muted">{recoveryText(r.rest)}</small>
            </div>
          )
        })}
        {counters.map((c, i) => (
          <div key={i} className="cs-res">
            {edit ? (
              <span className="cs-line">
                <Txt value={c.name} label={`Name of counter ${i + 1}`} placeholder="Lucky" onChange={(v) => setCounters(counters.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
                <Num label={`Uses of ${c.name || `counter ${i + 1}`}`} value={c.max} min={1} max={100} width={48} onChange={(n) => setCounters(counters.map((x, j) => (j === i ? { ...x, max: Math.max(1, n), used: Math.min(x.used, Math.max(1, n)) } : x)))} />
                <Select className="input" style={{ width: 'auto' }} title="When the uses come back" value={c.rest} onChange={(v) => setCounters(counters.map((x, j) => (j === i ? { ...x, rest: v === 'short' ? 'short' : 'long' } : x)))}>
                  <option value="short">Short rest</option><option value="long">Long rest</option>
                </Select>
                <button className="icon-btn" aria-label={`Remove ${c.name || 'counter'}`} onClick={() => setCounters(counters.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
              </span>
            ) : <b><FeatureLink name={c.name} categories={['feat', 'rule', 'spell']} /></b>}
            <span className="cs-res-n">
              <Bubbles label={`${c.name || 'Counter'} used`} total={Math.min(c.max, 40)} used={c.used} onChange={(n) => set && setCounters(counters.map((x, j) => (j === i ? { ...x, used: n } : x)))} />
              <small className="muted">{c.max - c.used} of {c.max} left</small>
            </span>
            <small className="muted">{recoveryText(c.rest)}</small>
          </div>
        ))}
      </div>
      {numbers.length > 0 && (
        <div className="cs-line cs-facts" aria-label="Class table">
          {numbers.map((n) => <span key={`${n.from}.${n.name}`} className="cs-pill"><b>{n.name}{several ? ` (${n.from})` : ''}</b> {n.value}</span>)}
        </div>
      )}
      {edit && <button className="btn sm" onClick={() => setCounters([...counters, { name: '', max: 1, used: 0, rest: 'long' }])}><Plus size={12} /> Add a counter</button>}
    </section>
  )
}
