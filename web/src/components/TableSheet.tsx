import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Select } from './Select'
import { useRules } from '../lib/pack'
import { ABILITIES, FEATURE_GROUPS, PF_SKILLS, multipleAttack, pfLore, pfPerception, pfSave, pfSkill, pfStrike, SKILLS, abilityMod, crText, initiativeBonus, isCharacter, passivePerception, rollsIn, saveBonus, sheetOf, signed, skillBonus, speedText, usesLeft, type Sheet } from '../lib/sheet'

// The sheet of a creature as a table card: every number that can be rolled is a button.
// Click rolls it, Shift-click with advantage, Ctrl-click with disadvantage. The roll goes to the table chat.

export type RollFn = (expr: string, label: string) => void

/**
 * Any roll button of a sheet can be kept as a macro with a right click. The line it makes is found by pressing the button while the
 * roll is caught instead of sent: `caught` is set for that moment, and the roll function of the table asks it first.
 */
let caught: ((expr: string, label: string) => void) | null = null
export const catchRoll = (expr: string, label: string): boolean => { if (!caught) return false; caught(expr, label); return true }
function useDraggableRolls() {
  const ref = useRef<HTMLDivElement>(null)
  const onContextMenu = (e: React.MouseEvent) => {
    const b = (e.target as HTMLElement).closest('button.tt-roll') as HTMLButtonElement | null
    if (!b) return
    e.preventDefault()
    let line = ''
    caught = (expr, label) => { line = `/roll ${expr} ${label}`.trim() }
    try { b.click() } finally { caught = null }
    if (line) window.dispatchEvent(new CustomEvent('tt-save-macro', { detail: line }))
  }
  return { ref, onContextMenu }
}

type PageInfo = { sheet: Sheet | null; type: string | null; portrait: string | null; /** the page's own token picture */ token: string | null }
const cache = new Map<string, Promise<PageInfo>>()

/** The sheet of a page, read once. A page that is not a creature has none. */
export function loadSheet(pageId: string, fresh = false) {
  if (fresh) cache.delete(pageId)
  let p = cache.get(pageId)
  if (!p) {
    p = api.getPage(pageId, fresh).then((pg) => ({ sheet: sheetOf(pg.props), type: (pg.props?.type as string) ?? null, portrait: (pg.props?.portrait as string) ?? null, token: typeof pg.props?.data?.token === 'string' ? pg.props.data.token : null })).catch(() => ({ sheet: null, type: null, portrait: null, token: null }))
    cache.set(pageId, p)
  }
  return p
}

/** The sheet of a page. `watch` is anything that changes when the sheet may have (the token's hit points): the sheet is read again then. */
export function useSheet(pageId: string | null, watch = '') {
  const [state, setState] = useState<{ sheet: Sheet | null; loading: boolean }>({ sheet: null, loading: !!pageId })
  const [tick, setTick] = useState(0)
  const first = useRef(true)
  useEffect(() => {
    if (!pageId) { setState({ sheet: null, loading: false }); return }
    let live = true
    if (first.current) setState((s) => ({ ...s, loading: true }))
    loadSheet(pageId, !first.current).then((r) => { if (live) { first.current = false; setState({ sheet: r.sheet, loading: false }) } })
    return () => { live = false }
  }, [pageId, watch, tick])
  return { ...state, reload: () => setTick((t) => t + 1) }
}

const mode = (e: React.MouseEvent) => (e.shiftKey ? ' adv' : e.ctrlKey || e.metaKey ? ' dis' : '')
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

/** The damage dice at the start of a strike's damage ("1d8+4 slashing" gives "1d8+4"). */
const diceOf = (text: string | undefined) => /^\s*(\d+d\d+(?:\s*[+\-]\s*\d+)?)/.exec(text ?? '')?.[1].replace(/\s+/g, '')

const GLYPH = { one: '◆', two: '◆◆', three: '◆◆◆', reaction: '↺', free: '◇' } as const

/** A Pathfinder 2e creature: checks, saves and strikes with the multiple attack penalty as three buttons. Type "dc 25" after a roll in the chat to see the degree of success. */
function Pf2eCard({ sheet, roll }: { sheet: Sheet; roll: RollFn }) {
  const drag = useDraggableRolls()
  const p = sheet.pf2e!
  const bonus = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n)}`
  const check = (n: number, label: string) => roll(`1d20${bonus(n)}`, label)
  return (
    <div className="tt-sheet" ref={drag.ref} onContextMenu={drag.onContextMenu}>
      <div className="tt-sheet-sub muted">Creature {p.level}{p.traits.length ? ` · ${p.traits.join(', ')}` : ''}</div>
      <div className="tt-sheet-facts">
        <span><b>AC</b> {sheet.ac.value}</span><span><b>HP</b> {sheet.hp.max}</span><span><b>Speed</b> {speedText(sheet)}</span>
        <button className="tt-roll" title="Roll initiative with Perception" onClick={() => check(initiativeBonus(sheet), 'Initiative')}>Initiative {signed(initiativeBonus(sheet))}</button>
      </div>
      <div className="tt-chips" role="group" aria-label="Checks and saves">
        <button className="tt-roll prof" onClick={() => check(p.char ? pfPerception(sheet) : p.perception, 'Perception')}>Perception {signed(p.char ? pfPerception(sheet) : p.perception)}</button>
        <button className="tt-roll prof" onClick={() => check(p.fort, 'Fortitude save')}>Fort {signed(p.fort)}</button>
        <button className="tt-roll prof" onClick={() => check(p.ref, 'Reflex save')}>Ref {signed(p.ref)}</button>
        <button className="tt-roll prof" onClick={() => check(p.will, 'Will save')}>Will {signed(p.will)}</button>
        {p.char
          ? [...Object.keys(PF_SKILLS).map((k): [string, number, boolean] => [title(k), pfSkill(sheet, k), !!p.char!.ranks.skills[k]]), ...p.char.lores.map((l): [string, number, boolean] => [`${l.name || 'Lore'} Lore`, pfLore(sheet, l.rank), l.rank > 0])]
            .map(([name, v, trained]) => <button key={name} className={`tt-roll${trained ? ' prof' : ''}`} onClick={() => check(v, name + ' check')}>{name} {signed(v)}</button>)
          : Object.entries(sheet.skills).map(([k, v]) => <button key={k} className="tt-roll" onClick={() => check(v, `${title(k)} check`)}>{title(k)} {signed(v)}</button>)}
      </div>
      {p.char && p.char.strikes.length > 0 && (
        <div className="tt-features"><h4>Strikes</h4>
          {p.char.strikes.map((s, i) => (
            <div key={i} className="tt-chips" role="group" aria-label={s.name + ' attacks'}>
              <b>{s.name}</b>
              {multipleAttack(pfStrike(sheet, s), s.agile).map((n, j) => <button key={j} className="tt-roll" onClick={() => check(n, s.name + ', attack' + (j ? ' ' + (j + 1) : ''))}>{signed(n)}</button>)}
              {diceOf(s.damage) && <button className="tt-roll" onClick={() => roll(diceOf(s.damage)!, s.name + ', damage')}>{s.damage}</button>}
            </div>
          ))}
        </div>
      )}
      {(['traits', 'actions', 'reactions'] as const).map((g) => sheet.features[g].length > 0 && (
        <div key={g} className="tt-features">
          <h4>{g === 'traits' ? 'Abilities' : g === 'actions' ? 'Actions and strikes' : 'Reactions'}</h4>
          {sheet.features[g].map((f, i) => (
            <details key={i} className="tt-feature">
              <summary><b>{f.name}</b>{f.actions && <span title={f.actions}> {GLYPH[f.actions]}</span>}{f.bonus != null ? <small> {signed(f.bonus)}</small> : null}</summary>
              {f.text && <p>{f.text}</p>}
              {f.bonus != null && (
                <div className="tt-chips" role="group" aria-label={`${f.name} attacks`}>
                  {multipleAttack(f.bonus, f.agile).map((n, j) => (
                    <button key={j} className="tt-roll" title={j === 0 ? 'First attack' : j === 1 ? 'Second attack, multiple attack penalty' : 'Third attack, multiple attack penalty'}
                      onClick={() => check(n, f.name + ', attack' + (j ? ' ' + (j + 1) : ''))}>{signed(n)}</button>
                  ))}
                  {diceOf(f.damage) && <button className="tt-roll" onClick={() => roll(diceOf(f.damage)!, f.name + ', damage')}>{f.damage}</button>}
                </div>
              )}
            </details>
          ))}
        </div>
      ))}
    </div>
  )
}

export interface AttackKit {
  /** the other tokens on the scene a person can see */
  targets: { id: string; name: string }[]
  /** the tokens selected besides this one */
  selected: string[]
  /** spell areas drawn on the scene, and which tokens stand inside one */
  templates: { id: string; label: string }[]
  inside: (templateId: string) => string[]
  send: (targets: string[], a: { label: string; attack?: { bonus: number; mode?: 'adv' | 'dis' }; damage?: { expr: string; type?: string }[]; save?: { ability: string; dc: number; half: boolean } }) => void
}

export function SheetCard({ sheet, roll, onPatch, attack }: { sheet: Sheet; roll: RollFn; /** changes a field of the sheet by path (only given where the person may edit it) */ onPatch?: (patch: Record<string, unknown>) => void; /** when the table rolls attacks against targets */ attack?: AttackKit }) {
  const drag = useDraggableRolls()
  const [target, setTarget] = useState('')
  const an = useRules().abilities
  if (sheet.ruleset === 'pf2e' && sheet.pf2e) return <Pf2eCard sheet={sheet} roll={roll} />
  const slots = sheet.spellcasting?.slots ?? []
  const bonus = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n)}`
  const check = (e: React.MouseEvent, n: number, label: string) => roll(`1d20${bonus(n)}${mode(e)}`, label)
  return (
    <div className="tt-sheet" ref={drag.ref} onContextMenu={drag.onContextMenu}>
      <div className="tt-sheet-sub muted">{[sheet.size, sheet.type, sheet.alignment && `, ${sheet.alignment}`].filter(Boolean).join(' ').replace(' ,', ',')}</div>
      {attack && (
        <div className="tt-row"><span className="muted">Target</span>
          <Select className="input" value={target} onChange={setTarget} title="Target of attacks">
            <option value="">Nobody</option>
            {attack.selected.length > 1 && <option value="*">All selected tokens</option>}
            {attack.templates.map((t) => <option key={t.id} value={`tpl:${t.id}`}>Everyone in {t.label}</option>)}
            {attack.targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </div>
      )}
      <div className="tt-sheet-facts">
        <span><b>AC</b> {sheet.ac.value}{sheet.ac.note ? ` (${sheet.ac.note})` : ''}</span>
        <span><b>HP</b> {isCharacter(sheet) ? `${sheet.hp.current ?? sheet.hp.max} / ${sheet.hp.max}` : `${sheet.hp.max}${sheet.hp.formula ? ` (${sheet.hp.formula})` : ''}`}</span>
        <span><b>Speed</b> {speedText(sheet)}</span>
        {sheet.cr != null && <span><b>CR</b> {crText(sheet.cr)}</span>}
        <button className="tt-roll" title="Roll initiative. Shift for advantage, Ctrl for disadvantage." onClick={(e) => check(e, initiativeBonus(sheet), 'Initiative')}>Initiative {signed(initiativeBonus(sheet))}</button>
        <span><b>Passive Perception</b> {passivePerception(sheet)}</span>
      </div>
      <div className="tt-abil" role="group" aria-label="Ability checks">
        {ABILITIES.map((a) => (
          <button key={a} className="tt-roll tt-ab" title={`Roll ${an[a].short} check. Shift for advantage, Ctrl for disadvantage.`} onClick={(e) => check(e, abilityMod(sheet.abilities[a]), `${an[a].short} check`)}>
            <b>{an[a].short}</b><span>{sheet.abilities[a]}</span><small>{signed(abilityMod(sheet.abilities[a]))}</small>
          </button>
        ))}
      </div>
      <div className="tt-chips" role="group" aria-label="Saving throws">
        {ABILITIES.map((a) => <button key={a} className={`tt-roll${isCharacter(sheet) ? (sheet.profs?.saves.includes(a) ? ' prof' : '') : sheet.saves[a] != null ? ' prof' : ''}`} onClick={(e) => check(e, saveBonus(sheet, a), `${an[a].short} save`)}>{an[a].short} save {signed(saveBonus(sheet, a))}</button>)}
      </div>
      {(isCharacter(sheet) || Object.keys(sheet.skills).length > 0) && (
        <div className="tt-chips" role="group" aria-label="Skills">
          {(isCharacter(sheet) ? Object.keys(SKILLS).map((k): [string, number] => [k, skillBonus(sheet, k)]) : Object.entries(sheet.skills)).map(([k, v]) => <button key={k} className={`tt-roll${isCharacter(sheet) && !sheet.profs?.skills[k] ? '' : ' prof'}`} onClick={(e) => check(e, v, `${title(k)} check`)}>{title(k)} {signed(v)}</button>)}
        </div>
      )}
      {slots.some((sl) => sl.total > 0) && (
        <div className="tt-chips" role="group" aria-label="Spell slots">
          {slots.map((sl, i) => sl.total > 0 && (
            <span key={i} className="tt-slot"><b>{i + 1}</b>
              {Array.from({ length: sl.total }, (_, j) => (
                <button key={j} className={`tt-pip${j < sl.total - sl.used ? ' on' : ''}`} disabled={!onPatch} aria-label={`Level ${i + 1} slot ${j + 1}, ${j < sl.total - sl.used ? 'ready' : 'spent'}`}
                  onClick={() => onPatch?.({ 'spellcasting.slots': slots.map((x, k) => (k === i ? { ...x, used: j < sl.total - sl.used ? Math.min(sl.total, sl.used + 1) : Math.max(0, sl.used - 1) } : x)) })} />
              ))}
            </span>
          ))}
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
                  {f.usage?.type === 'perDay' && (
                    <small> ({usesLeft(f)}/{f.usage.times} left)</small>
                  )}
                  {f.usage?.type === 'perDay' && onPatch && (
                    <button className="btn sm" aria-label={`Use ${f.name}`} disabled={(usesLeft(f) ?? 0) <= 0} onClick={(e) => { e.preventDefault(); onPatch({ [`features.${g}`]: sheet.features[g].map((x, k) => (k === i ? { ...x, used: (x.used ?? 0) + 1 } : x)) }) }}>Use</button>
                  )}
                  {f.cost ? <small> (Costs {f.cost})</small> : null}
                </summary>
                <p>{f.text}</p>
                {(r.attack != null || r.damage.length > 0) && (
                  <div className="tt-chips">
                    {r.attack != null && <button className="tt-roll" onClick={(e) => check(e, r.attack!, `${f.name}, attack`)}>To hit {signed(r.attack)}</button>}
                    {r.damage.map((d, j) => <button key={j} className="tt-roll" onClick={() => roll(d.expr, `${f.name}, ${d.type ? `${d.type} damage` : 'damage'}`)}>{d.expr}{d.type ? ` ${d.type}` : ''}</button>)}
                    {attack && target && (r.attack != null || r.save) && (
                      <button className="btn sm primary" aria-label={`Use ${f.name} on the target`} onClick={(e) => attack.send(target === '*' ? attack.selected : target.startsWith('tpl:') ? attack.inside(target.slice(4)) : [target], {
                        label: f.name,
                        ...(r.attack != null ? { attack: { bonus: r.attack, ...(e.shiftKey ? { mode: 'adv' as const } : e.ctrlKey || e.metaKey ? { mode: 'dis' as const } : {}) } } : {}),
                        ...(r.attack == null && r.save ? { save: { ability: r.save.ability.slice(0, 3).toLowerCase(), dc: r.save.dc, half: /half as much|half damage/i.test(f.text) } } : {}),
                        damage: r.damage.map((d) => ({ expr: d.expr, ...(d.type ? { type: d.type } : {}) })),
                      })}>Roll on target</button>
                    )}
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
