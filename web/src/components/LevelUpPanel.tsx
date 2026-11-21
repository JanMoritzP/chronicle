import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { classFeaturesAt, givesAsi, hitDieOf, levelUp, needsSubclass, SUBCLASSES, totalLevel } from '../lib/levelup'
import { ABILITIES, type Ability, type Feature, type Sheet } from '../lib/sheet'
import { useStore } from '../store'
import { Select } from './Select'
import type { SheetPatch } from './SheetView'

// The level up of a character: pick the class, take the average hit points or roll them, see what changes, add the class features a
// class page of the world lists for the new level (an imported class has them), and apply it all as one change to the sheet.

export function LevelUpPanel({ sheet, set, onClose }: { sheet: Sheet; set: (patch: SheetPatch) => void; onClose: () => void }) {
  const classes = (sheet.classes ?? []).filter((c) => c.name.trim())
  const [cls, setCls] = useState(classes[0]?.name ?? '')
  const [other, setOther] = useState('')
  const [dieText, setDieText] = useState('')
  const [rolled, setRolled] = useState<number | null>(null)
  const [subclass, setSubclass] = useState('')
  const [asi, setAsi] = useState<Partial<Record<Ability, number>>>({})
  const [feat, setFeat] = useState('')
  const [featNote, setFeatNote] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [offered, setOffered] = useState<{ name: string; text: string }[]>([])
  const pages = useStore((s) => s.data.pages)
  const name = (cls === '*' ? other : cls).trim()
  const die = hitDieOf(name) ?? (Number(dieText) || null)
  const mine = classes.find((c) => c.name.trim().toLowerCase() === name.toLowerCase())
  const classLevel = (mine?.level ?? 0) + 1
  const askSubclass = !!name && needsSubclass(name, classLevel, mine?.subclass)
  const askAsi = !!name && givesAsi(name, classLevel)
  const spent = Object.values(asi).reduce((n, v) => n + (v ?? 0), 0)
  const result = useMemo(() => levelUp(sheet, name, {
    ...(rolled != null ? { hit: rolled } : {}), ...(die && !hitDieOf(name) ? { die } : {}),
    ...(askSubclass && subclass.trim() ? { subclass } : {}),
    ...(askAsi && feat.trim() ? { feat: { name: feat, text: featNote } } : askAsi && spent ? { asi } : {}),
  }), [sheet, name, rolled, die, askSubclass, subclass, askAsi, feat, featNote, asi, spent])
  const newLevel = 'error' in result ? 0 : classLevel
  const classPage = useMemo(() => pages.find((p) => p.title.trim().toLowerCase() === name.toLowerCase()), [pages, name])

  useEffect(() => {
    setOffered([]); setPicked(new Set())
    if (!classPage || !newLevel) return
    let live = true
    api.getPage(classPage.id).then((p) => {
      if (!live) return
      const f = classFeaturesAt(p.content, newLevel)
      setOffered(f); setPicked(new Set(f.map((x) => x.name)))
    }).catch(() => undefined)
    return () => { live = false }
  }, [classPage?.id, newLevel])

  const apply = () => {
    if ('error' in result) return
    const have = new Set(sheet.features.traits.map((f) => f.name.toLowerCase()))
    const base = (result.patch['features.traits'] as Feature[] | undefined) ?? sheet.features.traits
    const added: Feature[] = offered.filter((f) => picked.has(f.name) && !have.has(f.name.toLowerCase())).map((f) => ({ name: f.name, text: f.text }))
    set({ ...result.patch, ...(added.length ? { 'features.traits': [...base, ...added] } : {}) })
    onClose()
  }

  return (
    <div className="cs-levelup" role="dialog" aria-label="Level up">
      <b>Level up</b>
      <div className="cs-line">
        <label className="sv-mini">Class
          <Select className="input" value={cls} onChange={setCls} title="Class to level">
            {classes.map((c) => <option key={c.name} value={c.name}>{c.name} {c.level}</option>)}
            <option value="*">A new class</option>
          </Select>
        </label>
        {cls === '*' && <input className="sv-text" aria-label="Name of the new class" placeholder="Class" value={other} onChange={(e) => setOther(e.target.value)} />}
        {name && !hitDieOf(name) && <input className="sv-num" aria-label="Hit die sides" placeholder="d?" inputMode="numeric" value={dieText} onChange={(e) => setDieText(e.target.value.replace(/\D/g, ''))} />}
        <button className="btn sm" disabled={!die} onClick={() => setRolled(Math.floor(Math.random() * (die ?? 1)) + 1)}>Roll hit die{rolled != null ? ` (${rolled})` : ''}</button>
        {rolled != null && <button className="btn sm" onClick={() => setRolled(null)}>Take the average</button>}
      </div>
      {'error' in result ? <p className="muted">{result.error}</p> : (
        <ul aria-label="What changes">{result.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      )}
      {askSubclass && (
        <label className="sv-mini">Subclass
          <input className="sv-text" list="cs-subclasses" aria-label="Subclass" placeholder="Choose one" value={subclass} onChange={(e) => setSubclass(e.target.value)} />
          <datalist id="cs-subclasses">{(SUBCLASSES[name.toLowerCase()] ?? []).map((n) => <option key={n} value={n} />)}</datalist>
        </label>
      )}
      {askAsi && (
        <div role="group" aria-label="Ability score improvement">
          <span className="muted">Spend 2 points ({2 - spent} left), or take a feat</span>
          <div className="cs-line">
            {ABILITIES.map((a) => (
              <span key={a} className="sv-mini">
                {a.toUpperCase()} {sheet.abilities[a]}{asi[a] ? ` +${asi[a]}` : ''}
                <button className="btn sm" aria-label={`Add a point to ${a.toUpperCase()}`} disabled={!!feat.trim() || spent >= 2 || (asi[a] ?? 0) >= 2 || sheet.abilities[a] + (asi[a] ?? 0) >= 20} onClick={() => setAsi((x) => ({ ...x, [a]: (x[a] ?? 0) + 1 }))}>+</button>
                <button className="btn sm" aria-label={`Take a point from ${a.toUpperCase()}`} disabled={!asi[a]} onClick={() => setAsi((x) => ({ ...x, [a]: (x[a] ?? 1) - 1 }))}>-</button>
              </span>
            ))}
          </div>
          <div className="cs-line">
            <input className="sv-text" aria-label="Feat taken instead" placeholder="A feat instead" disabled={spent > 0} value={feat} onChange={(e) => setFeat(e.target.value)} />
            {feat.trim() && <input className="sv-text" aria-label="What the feat does" placeholder="What it does (optional)" value={featNote} onChange={(e) => setFeatNote(e.target.value)} />}
          </div>
        </div>
      )}
      {offered.length > 0 && (
        <div role="group" aria-label="Class features gained">
          <span className="muted">Features from the {name} page for level {newLevel}</span>
          {offered.map((f) => (
            <label key={f.name} className="tt-check"><input type="checkbox" checked={picked.has(f.name)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(f.name); else n.delete(f.name); return n })} />{f.name}</label>
          ))}
        </div>
      )}
      <div className="cs-line">
        <button className="btn primary sm" disabled={'error' in result} onClick={apply}>Level up to {totalLevel(sheet.classes) + 1}</button>
        <button className="btn sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
