import { useEffect, useState } from 'react'
import { api } from '../api'
import { ABILITIES, FEATURE_GROUPS, abilityMod, crText, initiativeBonus, passivePerception, rollsIn, saveBonus, sheetOf, signed, speedText, type Sheet } from '../lib/sheet'

// The sheet of a creature as a table card: every number that can be rolled is a button.
// Click rolls it, Shift-click with advantage, Ctrl-click with disadvantage. The roll goes to the table chat.

export type RollFn = (expr: string, label: string) => void

const cache = new Map<string, Promise<{ sheet: Sheet | null; type: string | null; portrait: string | null }>>()

/** The sheet of a page, read once. A page that is not a creature has none. */
export function loadSheet(pageId: string) {
  let p = cache.get(pageId)
  if (!p) {
    p = api.getPage(pageId).then((pg) => ({ sheet: sheetOf(pg.props), type: (pg.props?.type as string) ?? null, portrait: (pg.props?.portrait as string) ?? null })).catch(() => ({ sheet: null, type: null, portrait: null }))
    cache.set(pageId, p)
  }
  return p
}

export function useSheet(pageId: string | null) {
  const [state, setState] = useState<{ sheet: Sheet | null; loading: boolean }>({ sheet: null, loading: !!pageId })
  useEffect(() => {
    if (!pageId) { setState({ sheet: null, loading: false }); return }
    let live = true
    setState((s) => ({ ...s, loading: true }))
    loadSheet(pageId).then((r) => { if (live) setState({ sheet: r.sheet, loading: false }) })
    return () => { live = false }
  }, [pageId])
  return state
}

const mode = (e: React.MouseEvent) => (e.shiftKey ? ' adv' : e.ctrlKey || e.metaKey ? ' dis' : '')
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

export function SheetCard({ sheet, roll }: { sheet: Sheet; roll: RollFn }) {
  const bonus = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n)}`
  const check = (e: React.MouseEvent, n: number, label: string) => roll(`1d20${bonus(n)}${mode(e)}`, label)
  return (
    <div className="tt-sheet">
      <div className="tt-sheet-sub muted">{[sheet.size, sheet.type, sheet.alignment && `, ${sheet.alignment}`].filter(Boolean).join(' ').replace(' ,', ',')}</div>
      <div className="tt-sheet-facts">
        <span><b>AC</b> {sheet.ac.value}{sheet.ac.note ? ` (${sheet.ac.note})` : ''}</span>
        <span><b>HP</b> {sheet.hp.max}{sheet.hp.formula ? ` (${sheet.hp.formula})` : ''}</span>
        <span><b>Speed</b> {speedText(sheet)}</span>
        {sheet.cr != null && <span><b>CR</b> {crText(sheet.cr)}</span>}
        <button className="tt-roll" title="Roll initiative. Shift for advantage, Ctrl for disadvantage." onClick={(e) => check(e, initiativeBonus(sheet), 'Initiative')}>Initiative {signed(initiativeBonus(sheet))}</button>
        <span><b>Passive Perception</b> {passivePerception(sheet)}</span>
      </div>
      <div className="tt-abil" role="group" aria-label="Ability checks">
        {ABILITIES.map((a) => (
          <button key={a} className="tt-roll tt-ab" title={`Roll ${a.toUpperCase()} check. Shift for advantage, Ctrl for disadvantage.`} onClick={(e) => check(e, abilityMod(sheet.abilities[a]), `${a.toUpperCase()} check`)}>
            <b>{a.toUpperCase()}</b><span>{sheet.abilities[a]}</span><small>{signed(abilityMod(sheet.abilities[a]))}</small>
          </button>
        ))}
      </div>
      <div className="tt-chips" role="group" aria-label="Saving throws">
        {ABILITIES.map((a) => <button key={a} className={`tt-roll${sheet.saves[a] != null ? ' prof' : ''}`} onClick={(e) => check(e, saveBonus(sheet, a), `${a.toUpperCase()} save`)}>{a.toUpperCase()} save {signed(saveBonus(sheet, a))}</button>)}
      </div>
      {Object.keys(sheet.skills).length > 0 && (
        <div className="tt-chips" role="group" aria-label="Skills">
          {Object.entries(sheet.skills).map(([k, v]) => <button key={k} className="tt-roll prof" onClick={(e) => check(e, v, `${title(k)} check`)}>{title(k)} {signed(v)}</button>)}
        </div>
      )}
      {(sheet.vulnerabilities || sheet.resistances || sheet.immunities || sheet.conditionImmunities) && (
        <div className="tt-sheet-facts">
          {sheet.vulnerabilities && <span><b>Vulnerable</b> {sheet.vulnerabilities}</span>}
          {sheet.resistances && <span><b>Resists</b> {sheet.resistances}</span>}
          {sheet.immunities && <span><b>Immune</b> {sheet.immunities}</span>}
          {sheet.conditionImmunities && <span><b>Condition immune</b> {sheet.conditionImmunities}</span>}
        </div>
      )}
      {FEATURE_GROUPS.map((g) => sheet.features[g].length > 0 && (
        <div key={g} className="tt-features">
          <h4>{g === 'bonus' ? 'Bonus actions' : title(g)}</h4>
          {sheet.features[g].map((f, i) => {
            const r = rollsIn(f.text)
            return (
              <details key={i} className="tt-feature">
                <summary>
                  <b>{f.name}</b>
                  {f.usage?.type === 'recharge' && <small> (Recharge {f.usage.min}{f.usage.min < 6 ? '-6' : ''})</small>}
                  {f.usage?.type === 'perDay' && <small> ({f.usage.times}/Day)</small>}
                  {f.cost ? <small> (Costs {f.cost})</small> : null}
                </summary>
                <p>{f.text}</p>
                {(r.attack != null || r.damage.length > 0) && (
                  <div className="tt-chips">
                    {r.attack != null && <button className="tt-roll" onClick={(e) => check(e, r.attack!, `${f.name}, attack`)}>To hit {signed(r.attack)}</button>}
                    {r.damage.map((d, j) => <button key={j} className="tt-roll" onClick={() => roll(d.expr, `${f.name}, ${d.type ? `${d.type} damage` : 'damage'}`)}>{d.expr}{d.type ? ` ${d.type}` : ''}</button>)}
                  </div>
                )}
              </details>
            )
          })}
        </div>
      ))}
    </div>
  )
}
