import { Plus, Trash2 } from 'lucide-react'
import { Fragment } from 'react'
import { ABILITIES, SPEED_MODES, signed, speedText, type ActionCost, type Feature, type FeatureGroup, type Sheet } from '../lib/sheet'
import { Select } from './Select'
import type { SheetPatch } from './SheetView'

// A Pathfinder 2e creature as a stat block. Same data and the same in place editing as the 5e sheet; the numbers that differ
// (level, Perception, Fortitude, Reflex, Will, ability modifiers) live under `sheet.pf2e`.

const GLYPH: Record<ActionCost, string> = { one: '◆', two: '◆◆', three: '◆◆◆', reaction: '↺', free: '◇' }
const COST_LABEL: Record<ActionCost, string> = { one: 'One action', two: 'Two actions', three: 'Three actions', reaction: 'Reaction', free: 'Free action' }
const GROUPS: { id: FeatureGroup; title: string }[] = [{ id: 'traits', title: 'Abilities' }, { id: 'actions', title: 'Actions and strikes' }, { id: 'reactions', title: 'Reactions' }]
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

function Num({ value, onChange, label, min = -10, max = 80, width = 56 }: { value: number | undefined; onChange: (n: number) => void; label: string; min?: number; max?: number; width?: number }) {
  return <input type="number" className="sv-num" aria-label={label} min={min} max={max} style={{ width }} value={value ?? ''} onChange={(e) => { if (e.target.value === '') return; const n = Math.round(Number(e.target.value)); if (Number.isFinite(n)) onChange(n) }} />
}
function Txt({ value, onChange, label, placeholder, className }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; className?: string }) {
  return <input className={`sv-text${className ? ` ${className}` : ''}`} aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
}

function FeatureList({ group, list, set }: { group: FeatureGroup; list: Feature[]; set: (next: Feature[]) => void }) {
  const change = (i: number, p: Partial<Feature>) => set(list.map((f, j) => (j === i ? { ...f, ...p } : f)))
  return (
    <div className="sv-features">
      {list.map((f, i) => (
        <div key={i} className="sv-feature">
          <div className="sv-feature-head">
            <Txt className="sv-fname" value={f.name} label={`Name of ${group} entry ${i + 1}`} placeholder="Name" onChange={(v) => change(i, { name: v })} />
            <Select className="sv-usage" title="Cost" value={f.actions ?? ''} onChange={(v) => { const { actions: _a, ...rest } = f; set(list.map((x, j) => (j === i ? (v ? { ...rest, actions: v as ActionCost } : rest) : x))) }}>
              <option value="">No cost</option>{(Object.keys(COST_LABEL) as ActionCost[]).map((k) => <option key={k} value={k}>{COST_LABEL[k]}</option>)}
            </Select>
            {group === 'actions' && <>
              <label className="sv-mini">attack<Num label={`Attack bonus of ${f.name || 'entry'}`} value={f.bonus} min={-30} width={52} onChange={(n) => change(i, { bonus: n })} /></label>
              <Txt value={f.damage ?? ''} label={`Damage of ${f.name || 'entry'}`} placeholder="1d8+4 slashing" onChange={(v) => change(i, { damage: v || undefined })} />
              <label className="sv-mini"><input type="checkbox" checked={!!f.agile} onChange={(e) => change(i, { agile: e.target.checked || undefined })} />agile</label>
            </>}
            <button className="icon-btn" aria-label={`Remove ${f.name || 'this entry'}`} onClick={() => set(list.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
          </div>
          <textarea className="sv-area" aria-label={`Text of ${f.name || 'entry'}`} rows={2} placeholder="Effect, triggers, saving throws" value={f.text} onChange={(e) => change(i, { text: e.target.value })} />
        </div>
      ))}
      <button className="btn sm" onClick={() => set([...list, { name: '', text: '' }])}><Plus size={12} /> Add</button>
    </div>
  )
}

export function Pf2eSheet({ sheet, set }: { sheet: Sheet; set?: (patch: SheetPatch) => void }) {
  const edit = !!set
  const p = sheet.pf2e
  if (!p) return <p className="muted">This sheet has no Pathfinder 2e data.</p>
  const skills = Object.entries(sheet.skills)
  const skillsText = skills.map(([k, v]) => `${title(k)} ${signed(v)}`).join(', ')
  const row = (label: string, value: string) => value ? <div className="sb-row"><b>{label}</b><span>{value}</span></div> : null

  return (
    <div className={`statblock sb-classic sb-font-serif sv pf${edit ? ' sb-editing' : ''}`} style={{ ['--sb-width' as string]: '460px' }}>
      <div className="pf-head">
        {edit ? <input className="sb-name" aria-label="Name" value={sheet.name} placeholder="Creature name" onChange={(e) => set!({ name: e.target.value })} /> : <div className="sb-name">{sheet.name || 'Unnamed'}</div>}
        {edit
          ? <label className="sv-mini">Creature<Num label="Level" value={p.level} min={-1} max={30} width={52} onChange={(n) => set!({ 'pf2e.level': n })} /></label>
          : <span className="pf-level">Creature {p.level}</span>}
      </div>
      {edit ? (
        <div className="sv-line">
          <Txt value={p.traits.join(', ')} label="Traits" placeholder="Humanoid, Goblin" onChange={(v) => set!({ 'pf2e.traits': v.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 30) })} />
          <Txt value={p.rarity} label="Rarity" placeholder="common" onChange={(v) => set!({ 'pf2e.rarity': v })} />
        </div>
      ) : (
        <div className="pf-traits">{p.rarity && p.rarity !== 'common' && <span className="pf-trait rarity">{title(p.rarity)}</span>}{p.traits.map((t) => <span key={t} className="pf-trait">{t}</span>)}</div>
      )}
      <hr className="sb-rule" />

      {edit ? (
        <>
          <div className="sv-line"><b>Perception</b><Num label="Perception" value={p.perception} onChange={(n) => set!({ 'pf2e.perception': n })} /><Txt value={sheet.languages} label="Languages" placeholder="Common, Goblin" onChange={(v) => set!({ languages: v })} /></div>
          <label className="sv-block"><b>Skills</b><Txt value={skillsText} label="Skills" placeholder="Acrobatics +7, Stealth +7" onChange={(v) => {
            const next: Record<string, number> = {}
            for (const part of v.split(',')) { const m = /^\s*([A-Za-z' ]+?)\s+([+\-−]\d+)\s*$/.exec(part); if (m) next[m[1].toLowerCase()] = Number(m[2].replace('−', '-')) }
            set!({ skills: next })
          }} /></label>
          <div className="sv-line">{ABILITIES.map((a) => <label key={a} className="sv-mini">{a}<Num label={`${a.toUpperCase()} modifier`} value={p.mods[a]} min={-10} max={20} width={48} onChange={(n) => set!({ [`pf2e.mods.${a}`]: n })} /></label>)}</div>
          <hr className="sb-rule" />
          <div className="sv-line"><b>AC</b><Num label="Armor class" value={sheet.ac.value} min={0} max={99} onChange={(n) => set!({ 'ac.value': n })} />
            <label className="sv-mini">Fort<Num label="Fortitude" value={p.fort} width={52} onChange={(n) => set!({ 'pf2e.fort': n })} /></label>
            <label className="sv-mini">Ref<Num label="Reflex" value={p.ref} width={52} onChange={(n) => set!({ 'pf2e.ref': n })} /></label>
            <label className="sv-mini">Will<Num label="Will" value={p.will} width={52} onChange={(n) => set!({ 'pf2e.will': n })} /></label></div>
          <div className="sv-line"><b>HP</b><Num label="Hit points" value={sheet.hp.max} min={0} max={100000} width={64} onChange={(n) => set!({ 'hp.max': n })} />
            <Txt value={sheet.immunities} label="Immunities" placeholder="Immunities" onChange={(v) => set!({ immunities: v })} />
            <Txt value={sheet.resistances} label="Resistances" placeholder="Resistances" onChange={(v) => set!({ resistances: v })} />
            <Txt value={sheet.vulnerabilities} label="Weaknesses" placeholder="Weaknesses" onChange={(v) => set!({ vulnerabilities: v })} /></div>
          <div className="sv-line"><b>Speed</b>{SPEED_MODES.map((m) => <label key={m} className="sv-mini">{m}<Num label={`${m} speed`} value={sheet.speed[m]} min={0} max={1000} width={52} onChange={(n) => set!({ [`speed.${m}`]: n > 0 ? n : null })} /></label>)}</div>
        </>
      ) : (
        <>
          <div className="sb-row"><b>Perception</b><span>{signed(p.perception)}{sheet.senses.darkvision ? '; darkvision' : ''}</span></div>
          {row('Languages', sheet.languages)}
          {row('Skills', skillsText)}
          <div className="sb-row"><b>Modifiers</b><span>{ABILITIES.map((a) => `${title(a)} ${signed(p.mods[a])}`).join(', ')}</span></div>
          <hr className="sb-rule" />
          <div className="sb-row"><b>AC</b><span>{sheet.ac.value}{sheet.ac.note ? ` (${sheet.ac.note})` : ''}; <b>Fort</b> {signed(p.fort)}, <b>Ref</b> {signed(p.ref)}, <b>Will</b> {signed(p.will)}</span></div>
          <div className="sb-row"><b>HP</b><span>{sheet.hp.max}{sheet.immunities ? `; Immunities ${sheet.immunities}` : ''}{sheet.resistances ? `; Resistances ${sheet.resistances}` : ''}{sheet.vulnerabilities ? `; Weaknesses ${sheet.vulnerabilities}` : ''}</span></div>
          <div className="sb-row"><b>Speed</b><span>{speedText(sheet)}</span></div>
        </>
      )}
      <hr className="sb-rule" />

      {GROUPS.map(({ id, title: heading }) => {
        const list = sheet.features[id]
        if (!edit && !list.length) return null
        return (
          <div key={id} className="sb-long">
            <h4>{heading}</h4>
            {edit ? <FeatureList group={id} list={list} set={(next) => set!({ [`features.${id}`]: next })} /> : (
              <div className="sb-rich">{list.map((f, i) => (
                <p key={i}><b><i>{f.name}</i></b>{f.actions && <span className="pf-glyph" title={COST_LABEL[f.actions]}> {GLYPH[f.actions]}</span>}
                  {f.bonus != null && <Fragment> {signed(f.bonus)}{f.agile ? ' (agile)' : ''}</Fragment>}{f.damage ? <Fragment>, Damage {f.damage}</Fragment> : null}{f.text ? <Fragment>; {f.text}</Fragment> : null}</p>
              ))}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
