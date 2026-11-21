import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { classFeaturesAt, hitDieOf, levelUp, totalLevel } from '../lib/levelup'
import type { Feature, Sheet } from '../lib/sheet'
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
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [offered, setOffered] = useState<{ name: string; text: string }[]>([])
  const pages = useStore((s) => s.data.pages)
  const name = (cls === '*' ? other : cls).trim()
  const die = hitDieOf(name) ?? (Number(dieText) || null)
  const result = useMemo(() => levelUp(sheet, name, { ...(rolled != null ? { hit: rolled } : {}), ...(die && !hitDieOf(name) ? { die } : {}) }), [sheet, name, rolled, die])
  const newLevel = 'error' in result ? 0 : (classes.find((c) => c.name.trim().toLowerCase() === name.toLowerCase())?.level ?? 0) + 1
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
    const added: Feature[] = offered.filter((f) => picked.has(f.name) && !have.has(f.name.toLowerCase())).map((f) => ({ name: f.name, text: f.text }))
    set({ ...result.patch, ...(added.length ? { 'features.traits': [...sheet.features.traits, ...added] } : {}) })
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
