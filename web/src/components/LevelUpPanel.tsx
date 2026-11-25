import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { CLASSES } from '../lib/builder'
import { cleanRules, loadHomebrew, type ClassRules, type HomebrewOption } from '../lib/homebrew'
import { fetchLibraryEntry, useLibrary } from '../lib/library'
import { classFeaturesAt, givesAsi, givesEpicBoon, hitDieOf, levelUp, needsSubclass, SUBCLASSES, totalLevel, type ClassInfo, type ClassInfos } from '../lib/levelup'
import { firstParagraph } from '../lib/open5eRules'
import { ABILITIES, type Ability, type Feature, type Sheet } from '../lib/sheet'
import { useStore } from '../store'
import type { LibraryIndex } from '../types'
import { Select } from './Select'
import type { SheetPatch } from './SheetView'

// The level up of a character: pick the class, take the average hit points or roll them, see what changes, add the features the class
// gains at the new level, and apply it all as one change to the sheet. Features come from a class page of the world (an imported class
// has them), else from the Open5e class and subclass of the same rules edition. Classes the level up rules do not know by name
// (homebrew, Open5e) bring their hit die, spell slots and subclass level from their rules.

const key = (s: string) => s.trim().toLowerCase()
/** The Open5e edition a sheet's rules match; books of other game systems (third-party) fit both. */
const fitsEdition = (system: unknown, ruleset: string) => {
  const s = String(system ?? '')
  if (s !== '5e-2014' && s !== '5e-2024') return true
  return s === (ruleset === '5e-2024' ? '5e-2024' : '5e-2014')
}
/** Features the level up asks for itself: the ability score improvement, the Epic Boon and the subclass choice. */
const ASKED = /^(ability score improvement|epic boon|.*\bsubclass(es)?|.*\barchetype)$/i

function infoOf(o: HomebrewOption | undefined): ClassInfo | undefined {
  if (!o) return undefined
  const r = cleanRules('class', o.rules) as ClassRules
  return { die: r.die, caster: r.caster || null, subclassLevel: r.subclassLevel }
}

/** Features an Open5e class or subclass gains at a class level, when its book is of the sheet's rules edition. */
async function open5eFeatures(index: LibraryIndex | null, name: string, level: number, ruleset: string, subclassOf?: string): Promise<{ features: { name: string; text: string }[]; book: string } | null> {
  const row = index?.rows.find((r) => r[1] === 'class' && key(r[2]) === key(name) && !r[0].includes(':hb.') && (subclassOf ? key(r[4]) === key(`Subclass of ${subclassOf}`) : !/^subclass of/i.test(r[4])))
  if (!row) return null
  const e = await fetchLibraryEntry(row[0])
  if (!fitsEdition(e.data?.system, ruleset)) return null
  const features = (Array.isArray(e.data?.features) ? e.data.features : [])
    .filter((f: any) => f?.feature_type === 'CLASS_LEVEL_FEATURE' && (f.gained_at ?? []).some((g: any) => g?.level === level) && !ASKED.test(String(f.name ?? '').trim()))
    .map((f: any) => ({ name: String(f.name).trim(), text: firstParagraph(f.desc, 1200) }))
  return { features, book: e.sourceName }
}

export function LevelUpPanel({ sheet, set, onClose }: { sheet: Sheet; set: (patch: SheetPatch) => void; onClose: () => void }) {
  const ruleset = sheet.ruleset === '5e-2024' ? '5e-2024' : '5e'
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
  const [offeredFrom, setOfferedFrom] = useState('')
  const pages = useStore((s) => s.data.pages)
  const index = useLibrary((s) => s.index)
  const libLoaded = useLibrary((s) => s.loaded)
  useEffect(() => { if (!libLoaded) useLibrary.getState().load().catch(() => {}) }, [libLoaded])
  // classes besides the twelve of the rules: the world's class pages, homebrew libraries and Open5e
  const [known, setKnown] = useState<HomebrewOption[]>([])
  useEffect(() => { let live = true; loadHomebrew(pages).then((h) => live && setKnown(h.filter((o) => o.category === 'class'))).catch(() => {}); return () => { live = false } }, [])
  const name = (cls === '*' ? other : cls).trim()
  const infos = useMemo<ClassInfos>(() => {
    const out: ClassInfos = {}
    for (const n of [...classes.map((c) => c.name), name]) {
      const i = infoOf(known.find((o) => key(o.name) === key(n)))
      if (i) out[key(n)] = i
    }
    return out
  }, [known, classes, name])
  const info = infos[key(name)]
  const die = hitDieOf(name, info) ?? (Number(dieText) || null)
  const mine = classes.find((c) => key(c.name) === key(name))
  const classLevel = (mine?.level ?? 0) + 1
  const askSubclass = !!name && needsSubclass(name, classLevel, mine?.subclass, ruleset, info)
  const askAsi = !!name && givesAsi(name, classLevel)
  const boon = askAsi && givesEpicBoon(classLevel, ruleset)
  const spent = Object.values(asi).reduce((n, v) => n + (v ?? 0), 0)
  const result = useMemo(() => levelUp(sheet, name, {
    infos,
    ...(rolled != null ? { hit: rolled } : {}), ...(die && !hitDieOf(name, info) ? { die } : {}),
    ...(askSubclass && subclass.trim() ? { subclass } : {}),
    ...(askAsi && feat.trim() ? { feat: { name: feat, text: featNote } } : askAsi && spent ? { asi } : {}),
  }), [sheet, name, infos, info, rolled, die, askSubclass, subclass, askAsi, feat, featNote, asi, spent])
  const newLevel = 'error' in result ? 0 : classLevel
  const classPage = useMemo(() => pages.find((p) => key(p.title) === key(name) && (!p.type || p.type === 'class')), [pages, name])
  const sub = (askSubclass ? subclass : mine?.subclass ?? '').trim()

  // subclasses to suggest: the rules' own, then the library's subclasses of this class
  const subclassNames = useMemo(() => [...new Set([
    ...(SUBCLASSES[ruleset][key(name)] ?? []),
    ...(index?.rows.filter((r) => r[1] === 'class' && key(r[4]) === key(`Subclass of ${name}`)).map((r) => r[2]) ?? []),
  ])], [ruleset, name, index])

  useEffect(() => {
    setOffered([]); setPicked(new Set()); setOfferedFrom('')
    if (!name || !newLevel) return
    let live = true
    ;(async () => {
      const found: { name: string; text: string }[] = []
      const from: string[] = []
      // the class page of the world wins; it may have been changed for this table
      const page = classPage ? await api.getPage(classPage.id).catch(() => null) : null
      const fromPage = page ? classFeaturesAt(page.content, newLevel) : []
      if (fromPage.length) { found.push(...fromPage); from.push(`the ${classPage!.title} page`) } else {
        const o = await open5eFeatures(index, name, newLevel, ruleset).catch(() => null)
        if (o?.features.length) { found.push(...o.features); from.push(o.book) }
      }
      if (sub) {
        const s = await open5eFeatures(index, sub, newLevel, ruleset, name).catch(() => null)
        if (s?.features.length) { found.push(...s.features.filter((f) => !found.some((x) => key(x.name) === key(f.name)))); from.push(`${sub} (${s.book})`) }
      }
      if (!live) return
      setOffered(found); setPicked(new Set(found.map((x) => x.name))); setOfferedFrom(from.join(' and '))
    })()
    return () => { live = false }
  }, [classPage?.id, name, newLevel, sub, index, ruleset])

  const apply = () => {
    if ('error' in result) return
    const have = new Set(sheet.features.traits.map((f) => f.name.toLowerCase()))
    const base = (result.patch['features.traits'] as Feature[] | undefined) ?? sheet.features.traits
    const added: Feature[] = offered.filter((f) => picked.has(f.name) && !have.has(f.name.toLowerCase())).map((f) => ({ name: f.name, text: f.text }))
    set({ ...result.patch, ...(added.length ? { 'features.traits': [...base, ...added] } : {}) })
    onClose()
  }

  const newClassNames = [...new Set([...CLASSES.map((c) => c.name), ...known.map((o) => o.name)])].filter((n) => !classes.some((c) => key(c.name) === key(n)))
  return (
    <div className="cs-levelup" role="dialog" aria-label="Level up">
      <div className="cs-line"><b>Level up</b><span className="muted">{ruleset === '5e-2024' ? '2024 rules' : '2014 rules'}</span></div>
      <div className="cs-line">
        <label className="sv-mini">Class
          <Select className="input" value={cls} onChange={(v) => { setCls(v); setSubclass(''); setAsi({}); setFeat('') }} title="Class to level">
            {classes.map((c) => <option key={c.name} value={c.name}>{c.name} {c.level}</option>)}
            <option value="*">A new class</option>
          </Select>
        </label>
        {cls === '*' && <>
          <input className="sv-text" list="cs-classes" aria-label="Name of the new class" placeholder="Class" value={other} onChange={(e) => setOther(e.target.value)} />
          <datalist id="cs-classes">{newClassNames.map((n) => <option key={n} value={n} />)}</datalist>
        </>}
        {name && !hitDieOf(name, info) && <input className="sv-num" aria-label="Hit die sides" placeholder="d?" inputMode="numeric" value={dieText} onChange={(e) => setDieText(e.target.value.replace(/\D/g, ''))} />}
        <button className="btn sm" disabled={!die} onClick={() => setRolled(Math.floor(Math.random() * (die ?? 1)) + 1)}>Roll hit die{rolled != null ? ` (${rolled})` : ''}</button>
        {rolled != null && <button className="btn sm" onClick={() => setRolled(null)}>Take the average</button>}
      </div>
      {'error' in result ? <p className="muted">{result.error}</p> : (
        <ul aria-label="What changes">{result.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      )}
      {askSubclass && (
        <label className="sv-mini">Subclass
          <input className="sv-text" list="cs-subclasses" aria-label="Subclass" placeholder="Choose one" value={subclass} onChange={(e) => setSubclass(e.target.value)} />
          <datalist id="cs-subclasses">{subclassNames.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
      )}
      {askAsi && (
        <div role="group" aria-label={boon ? 'Epic Boon' : 'Ability score improvement'}>
          <span className="muted">{boon ? 'Take an Epic Boon feat, or another feat such as Ability Score Improvement (2 points)' : `Spend 2 points (${2 - spent} left), or take a feat`}</span>
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
            <input className="sv-text" aria-label="Feat taken instead" placeholder={boon ? 'Boon of Fate' : 'A feat instead'} disabled={spent > 0} value={feat} onChange={(e) => setFeat(e.target.value)} />
            {feat.trim() && <input className="sv-text" aria-label="What the feat does" placeholder="What it does (optional)" value={featNote} onChange={(e) => setFeatNote(e.target.value)} />}
          </div>
        </div>
      )}
      {offered.length > 0 && (
        <div role="group" aria-label="Class features gained">
          <span className="muted">Features for {name} level {newLevel}, from {offeredFrom}</span>
          {offered.map((f) => (
            <label key={f.name} className="tt-check" title={f.text}><input type="checkbox" checked={picked.has(f.name)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(f.name); else n.delete(f.name); return n })} />{f.name}</label>
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
