import { Plus, Trash2 } from 'lucide-react'
import { Fragment, useState, type ReactNode } from 'react'
import { ABILITIES, FEATURE_GROUPS, SENSES, SPEED_MODES, abilityMod, crFromText, crText, passivePerception, profBonus, signed, speedText, type Ability, type Feature, type FeatureGroup, type Sheet } from '../lib/sheet'
import { xpOfCr } from '../tabletop/encounter'
import { Select } from './Select'
import { makeLinker, useAutoLinks, type Linker } from './useAutoLinks'

// The sheet of a creature as the printed stat block. With `set` it can be edited in place; every change is one or two field paths
// ("hp.max", "abilities.str"), saved by the page. Derived values (modifiers, passive Perception, proficiency) are shown, never typed.

export type SheetPatch = Record<string, unknown>
const GROUP_TITLE: Record<FeatureGroup, string> = { traits: 'Traits', actions: 'Actions', bonus: 'Bonus actions', reactions: 'Reactions', legendary: 'Legendary actions' }
const ABILITY_NAME: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' }
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

function Num({ value, onChange, label, min = 0, max, placeholder, width }: { value: number | undefined; onChange: (n: number | null) => void; label: string; min?: number; max?: number; placeholder?: string; width?: number }) {
  return (
    <input type="number" className="sv-num" aria-label={label} min={min} max={max} placeholder={placeholder} style={width ? { width } : undefined} value={value ?? ''}
      onChange={(e) => { const raw = e.target.value; if (raw === '') return onChange(null); const n = Math.round(Number(raw)); if (Number.isFinite(n)) onChange(n) }} />
  )
}

function Txt({ value, onChange, label, placeholder, className }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; className?: string }) {
  return <input className={`sv-text${className ? ` ${className}` : ''}`} aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
}

function usageText(f: Feature) {
  const u = f.usage
  const parts = [u?.type === 'recharge' ? `Recharge ${u.min}${u.min < 6 ? '-6' : ''}` : u?.type === 'perDay' ? `${u.times}/Day` : u?.type === 'rest' ? 'Recharges after a Short or Long Rest' : '', f.cost && f.cost > 1 ? `Costs ${f.cost} Actions` : ''].filter(Boolean)
  return parts.length ? ` (${parts.join(', ')})` : ''
}

export function FeatureEditor({ group, list, set }: { group: FeatureGroup; list: Feature[]; set: (next: Feature[]) => void }) {
  const change = (i: number, p: Partial<Feature>) => set(list.map((f, j) => (j === i ? { ...f, ...p } : f)))
  return (
    <div className="sv-features">
      {list.map((f, i) => (
        <div key={i} className="sv-feature">
          <div className="sv-feature-head">
            <Txt className="sv-fname" value={f.name} label={`Name of ${GROUP_TITLE[group].toLowerCase()} ${i + 1}`} placeholder="Name" onChange={(v) => change(i, { name: v })} />
            <Select className="sv-usage" title="How often" value={f.usage?.type ?? ''} onChange={(t) => {
              const { usage: _drop, ...rest } = f
              set(list.map((x, j) => (j === i ? (t === 'recharge' ? { ...rest, usage: { type: 'recharge' as const, min: 5 } } : t === 'perDay' ? { ...rest, usage: { type: 'perDay' as const, times: 3 } } : t === 'rest' ? { ...rest, usage: { type: 'rest' as const } } : rest) : x)))
            }}>
              <option value="">At will</option><option value="recharge">Recharge</option><option value="perDay">Per day</option><option value="rest">After a rest</option>
            </Select>
            {f.usage?.type === 'recharge' && <Num label="Recharges on" value={f.usage.min} min={2} max={6} width={44} onChange={(n) => n && change(i, { usage: { type: 'recharge', min: Math.min(6, Math.max(2, n)) } })} />}
            {f.usage?.type === 'perDay' && <Num label="Times per day" value={f.usage.times} min={1} width={44} onChange={(n) => n && change(i, { usage: { type: 'perDay', times: n } })} />}
            {group === 'legendary' && <Num label="Cost in actions" value={f.cost ?? 1} min={1} max={10} width={44} onChange={(n) => change(i, { cost: n && n > 1 ? n : undefined })} />}
            <button className="icon-btn" title="Remove" aria-label={`Remove ${f.name || 'this entry'}`} onClick={() => set(list.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
          </div>
          <textarea className="sv-area" aria-label={`Text of ${f.name || 'entry'}`} rows={2} placeholder="What it does" value={f.text} onChange={(e) => change(i, { text: e.target.value })} />
        </div>
      ))}
      <button className="btn sm" onClick={() => set([...list, { name: '', text: '' }])}><Plus size={12} /> Add {group === 'traits' ? 'a trait' : group === 'actions' ? 'an action' : group === 'bonus' ? 'a bonus action' : group === 'reactions' ? 'a reaction' : 'a legendary action'}</button>
    </div>
  )
}

export function SheetView({ sheet, set, libraryLinks }: { sheet: Sheet; set?: (patch: SheetPatch) => void; libraryLinks?: boolean }) {
  const links = useAutoLinks()
  const edit = !!set
  const linker = (): Linker | undefined => (edit ? undefined : makeLinker(links, { selfName: sheet.name, preferPage: !libraryLinks }))
  const modern = sheet.ruleset === '5e-2024'
  const [more, setMore] = useState(false)
  const cr = sheet.cr
  const pb = cr != null ? profBonus(cr) : null
  const lk = linker()
  const text = (s: string): ReactNode => (lk ? lk(s, false) : s)

  const row = (label: string, value: ReactNode) => <div className="sb-row"><b>{label}</b><span>{value}</span></div>
  const skills = Object.entries(sheet.skills)
  const saves = ABILITIES.filter((a) => sheet.saves[a] != null)
  const senses = [...SENSES.filter((k) => sheet.senses[k]).map((k) => `${k} ${sheet.senses[k]} ft.`), `passive Perception ${passivePerception(sheet)}`].join(', ')
  const skillsText = skills.map(([k, v]) => `${title(k)} ${signed(v)}`).join(', ')

  return (
    <div className={`statblock sb-classic sb-font-serif sv${edit ? ' sb-editing' : ''}`} style={{ ['--sb-width' as string]: modern ? '480px' : '440px' }}>
      {edit ? <input className="sb-name" aria-label="Name" value={sheet.name} placeholder="Creature name" onChange={(e) => set!({ name: e.target.value })} />
        : <div className="sb-name">{sheet.name || 'Unnamed'}</div>}
      {edit ? (
        <div className="sv-line">
          <Txt value={sheet.size} label="Size" placeholder="Medium" onChange={(v) => set!({ size: v })} />
          <Txt value={sheet.type} label="Creature type" placeholder="humanoid" onChange={(v) => set!({ type: v })} />
          <Txt value={sheet.alignment} label="Alignment" placeholder="neutral" onChange={(v) => set!({ alignment: v })} />
        </div>
      ) : <div className="sb-sub">{[sheet.size, sheet.type].filter(Boolean).join(' ')}{sheet.alignment ? `, ${sheet.alignment}` : ''}</div>}
      <hr className="sb-rule" />

      {edit ? (
        <>
          <div className="sv-line"><b>Armor Class</b><Num label="Armor class" value={sheet.ac.value} max={99} onChange={(n) => n != null && set!({ 'ac.value': n })} /><Txt value={sheet.ac.note} label="Armor type" placeholder="natural armor" onChange={(v) => set!({ 'ac.note': v })} /></div>
          <div className="sv-line"><b>Hit Points</b><Num label="Hit points" value={sheet.hp.max} onChange={(n) => n != null && set!({ 'hp.max': n })} /><Txt value={sheet.hp.formula} label="Hit dice" placeholder="6d8 + 18" onChange={(v) => set!({ 'hp.formula': v })} /></div>
          <div className="sv-line"><b>Speed</b>{SPEED_MODES.map((m) => (
            <label key={m} className="sv-mini">{m}<Num label={`${m} speed`} value={sheet.speed[m]} width={52} onChange={(n) => set!({ [`speed.${m}`]: n && n > 0 ? n : null })} /></label>
          ))}<label className="sv-mini"><input type="checkbox" checked={!!sheet.speed.hover} onChange={(e) => set!({ 'speed.hover': e.target.checked ? true : null })} />hover</label></div>
        </>
      ) : (
        <>
          {row('Armor Class', `${sheet.ac.value}${sheet.ac.note ? ` (${sheet.ac.note})` : ''}`)}
          {modern && row('Initiative', `${signed(sheet.initiative ?? abilityMod(sheet.abilities.dex))} (${10 + (sheet.initiative ?? abilityMod(sheet.abilities.dex))})`)}
          {row('Hit Points', `${sheet.hp.max}${sheet.hp.formula ? ` (${sheet.hp.formula})` : ''}`)}
          {row('Speed', speedText(sheet))}
        </>
      )}
      <hr className="sb-rule" />

      <div className={modern ? 'sb-abilities2' : 'sb-abilities'}>
        {ABILITIES.map((a) => (
          <div key={a} className={modern ? 'sb-ab2' : 'sb-ab'}>
            <b>{a.toUpperCase()}</b>
            {edit ? <Num label={ABILITY_NAME[a]} value={sheet.abilities[a]} max={60} width={52} onChange={(n) => n != null && set!({ [`abilities.${a}`]: n })} /> : <span>{modern ? sheet.abilities[a] : `${sheet.abilities[a]} (${signed(abilityMod(sheet.abilities[a]))})`}</span>}
            {modern && <span className="sb-mod">{signed(abilityMod(sheet.abilities[a]))}</span>}
            {modern && <><small>Save</small><span className="sb-mod">{signed(sheet.saves[a] ?? abilityMod(sheet.abilities[a]))}</span></>}
            {edit && !modern && <span className="sb-mod">{signed(abilityMod(sheet.abilities[a]))}</span>}
          </div>
        ))}
      </div>
      <hr className="sb-rule" />

      {edit ? (
        <>
          <button className="btn sm" aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'Hide' : 'Show'} saves, skills and senses</button>
          {more && (
            <div className="sv-more">
              <div className="sv-line"><b>Saving throws</b>{ABILITIES.map((a) => <label key={a} className="sv-mini">{a.toUpperCase()}<Num label={`${ABILITY_NAME[a]} saving throw bonus`} min={-30} value={sheet.saves[a]} placeholder={signed(abilityMod(sheet.abilities[a]))} width={52} onChange={(n) => set!({ [`saves.${a}`]: n })} /></label>)}</div>
              <label className="sv-block"><b>Skills</b><Txt value={skillsText} label="Skills" placeholder="Stealth +6, Perception +4" onChange={(v) => {
                const next: Record<string, number> = {}
                for (const part of v.split(',')) { const m = /^\s*([A-Za-z' ]+?)\s+([+\-−]\d+)\s*$/.exec(part); if (m) next[m[1].toLowerCase()] = Number(m[2].replace('−', '-')) }
                set!({ skills: next })
              }} /></label>
              <div className="sv-line"><b>Senses (ft.)</b>{SENSES.map((k) => <label key={k} className="sv-mini">{k}<Num label={`${k} range`} value={sheet.senses[k]} width={52} onChange={(n) => set!({ [`senses.${k}`]: n && n > 0 ? n : null })} /></label>)}<label className="sv-mini">passive Perception<Num label="Passive Perception" value={sheet.passivePerception} placeholder={String(passivePerception({ ...sheet, passivePerception: undefined }))} width={52} onChange={(n) => set!({ passivePerception: n })} /></label></div>
              {([['vulnerabilities', 'Damage vulnerabilities'], ['resistances', 'Damage resistances'], ['immunities', 'Damage immunities'], ['conditionImmunities', 'Condition immunities'], ['languages', 'Languages']] as const).map(([k, label]) => (
                <label key={k} className="sv-block"><b>{label}</b><Txt value={sheet[k]} label={label} onChange={(v) => set!({ [k]: v })} /></label>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {saves.length > 0 && !modern && row('Saving Throws', saves.map((a) => `${title(a)} ${signed(sheet.saves[a]!)}`).join(', '))}
          {skills.length > 0 && row('Skills', text(skillsText))}
          {sheet.vulnerabilities && row(modern ? 'Vulnerabilities' : 'Damage Vulnerabilities', text(sheet.vulnerabilities))}
          {sheet.resistances && row(modern ? 'Resistances' : 'Damage Resistances', text(sheet.resistances))}
          {sheet.immunities && row(modern ? 'Immunities' : 'Damage Immunities', text(sheet.immunities))}
          {sheet.conditionImmunities && !modern && row('Condition Immunities', text(sheet.conditionImmunities))}
          {row('Senses', senses)}
          {sheet.languages && row('Languages', text(sheet.languages))}
        </>
      )}
      {edit ? (
        <div className="sv-line"><b>Challenge</b>
          <input className="sv-num" aria-label="Challenge rating" placeholder="1/4" style={{ width: 56 }} defaultValue={crText(sheet.cr)} key={`cr${sheet.cr}`}
            onBlur={(e) => { const v = crFromText(e.target.value); if (e.target.value.trim() === '') set!({ cr: null, xp: null }); else if (v != null && v >= 0 && v <= 30) set!({ cr: v, xp: xpOfCr(v) }) }} />
          <label className="sv-mini">XP<Num label="Experience points" value={sheet.xp} width={80} onChange={(n) => set!({ xp: n })} /></label>
          {pb != null && <span className="muted">proficiency {signed(pb)}</span>}
        </div>
      ) : cr != null && row(modern ? 'CR' : 'Challenge', `${crText(cr)}${sheet.xp != null ? ` (${modern ? `XP ${sheet.xp.toLocaleString('en-US')}; PB ${signed(pb ?? 2)}` : `${sheet.xp.toLocaleString('en-US')} XP`})` : ''}`)}
      {!edit && !modern && pb != null && row('Proficiency Bonus', signed(pb))}
      <hr className="sb-rule" />

      {FEATURE_GROUPS.map((g) => {
        const list = sheet.features[g]
        if (!edit && !list.length) return null
        return (
          <div key={g} className="sb-long">
            {(g !== 'traits' || edit || modern) && <h4>{GROUP_TITLE[g]}</h4>}
            {edit
              ? <FeatureEditor group={g} list={list} set={(next) => set!({ [`features.${g}`]: next })} />
              : <div className="sb-rich">{list.map((f, i) => (
                <p key={i}>{f.text ? <Fragment><b><i>{f.name}{usageText(f)}.</i></b> {linker() ? linker()!(f.text, false) : f.text}</Fragment> : <Fragment>{f.name}</Fragment>}</p>
              ))}</div>}
          </div>
        )
      })}
    </div>
  )
}
