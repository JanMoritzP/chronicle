import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { CLASSES } from '../lib/builder'
import { cleanRules, loadHomebrew, type ClassRules, type HomebrewOption } from '../lib/homebrew'
import { fetchLibraryEntry, fitsRules, useLibrary } from '../lib/library'
import { classFeaturesAt, givesAsi, givesEpicBoon, hitDieOf, levelUp, needsSubclass, open5eColumns, SUBCLASSES, subclassLevel, totalLevel, type ClassInfo, type ClassInfos, type Column } from '../lib/levelup'
import { firstParagraph } from '../lib/open5eRules'
import { ABILITIES, type Ability, type Feature, type Sheet } from '../lib/sheet'
import { useStore } from '../store'
import type { LibraryEntry, LibraryIndex, LibraryRow } from '../types'
import { LibraryInput } from './LibraryInput'
import { Select } from './Select'
import type { SheetPatch } from './SheetView'

// The level up of a character: pick the class, take the average hit points or roll them, see what changes, add the features the class
// gains at the new level, and apply it all as one change to the sheet. Features come from a class page of the world (an imported class
// has them), else from the Open5e class and subclass of the same rules edition. Classes the level up rules do not know by name
// (homebrew, Open5e) bring their hit die, spell slots, subclass level and class table from their rules.

const key = (s: string) => s.trim().toLowerCase()
/** The Open5e edition a sheet's rules match; books of other game systems (third-party) fit both. */
const fitsEdition = (system: unknown, ruleset: string) => {
  const s = String(system ?? '')
  if (s !== '5e-2014' && s !== '5e-2024') return true
  return s === (ruleset === '5e-2024' ? '5e-2024' : '5e-2014')
}
/** Features the level up asks for itself: the ability score improvement, the Epic Boon and the subclass choice (each 2014 class names it its own way). */
const ASKED = /^(ability score improvement|epic boon|.*\bsubclass(es)?|.*\barchetype|primal path|bard college|divine domain|druid circle|monastic tradition|sacred oath|sorcerous origin|otherworldly patron|arcane tradition)$/i
const isSubclassRow = (r: LibraryRow) => /^subclass of/i.test(r[4])

function infoOf(o: HomebrewOption | undefined): ClassInfo | undefined {
  if (!o) return undefined
  const r = cleanRules('class', o.rules) as ClassRules
  return { die: r.die, caster: r.caster || null, subclassLevel: r.subclassLevel }
}

/**
 * The Open5e class (or subclass of `subclassOf`) of this name in the sheet's edition: the System Reference Document of that edition first,
 * then a third-party book. The library keeps both SRD editions of a class.
 */
async function open5eClass(index: LibraryIndex | null, name: string, ruleset: string, subclassOf?: string): Promise<LibraryEntry | null> {
  const srd = ruleset === '5e-2024' ? 'srd-2024' : 'srd-2014'
  const rows = (index?.rows ?? [])
    .filter((r) => r[1] === 'class' && key(r[2]) === key(name) && !r[0].includes(':hb.') && fitsRules(r, ruleset) && (subclassOf ? key(r[4]) === key(`Subclass of ${subclassOf}`) : !isSubclassRow(r)))
    .sort((a, b) => Number(b[3] === srd) - Number(a[3] === srd))
  for (const row of rows) {
    const e = await fetchLibraryEntry(row[0])
    if (fitsEdition(e.data?.system, ruleset)) return e
  }
  return null
}

export interface Offered { name: string; text: string; /** what changes at this level ("two uses") */ detail?: string }

/** Features an Open5e class or subclass gains at a class level, with what the level changes about a feature it had before. */
function featuresAt(e: LibraryEntry, level: number): Offered[] {
  return (Array.isArray(e.data?.features) ? e.data.features : [])
    .filter((f: any) => f?.feature_type === 'CLASS_LEVEL_FEATURE' && (f.gained_at ?? []).some((g: any) => g?.level === level) && !ASKED.test(String(f.name ?? '').trim()))
    .map((f: any) => {
      const detail = String(f.gained_at.find((g: any) => g?.level === level)?.detail ?? '').trim()
      return { name: String(f.name).trim(), text: firstParagraph(f.desc, 1200), ...(detail ? { detail } : {}) }
    })
}

export function LevelUpPanel({ sheet, set, onClose }: { sheet: Sheet; set: (patch: SheetPatch) => void; onClose: () => void }) {
  const ruleset = sheet.ruleset === '5e-2024' ? '5e-2024' : '5e'
  const classes = (sheet.classes ?? []).filter((c) => c.name.trim())
  const [cls, setCls] = useState(classes[0]?.name ?? '*')
  const [other, setOther] = useState('')
  const [dieText, setDieText] = useState('')
  const [rolled, setRolled] = useState<number | null>(null)
  const [subclass, setSubclass] = useState('')
  const [asi, setAsi] = useState<Partial<Record<Ability, number>>>({})
  const [feat, setFeat] = useState('')
  const [featNote, setFeatNote] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [offered, setOffered] = useState<Offered[]>([])
  const [offeredFrom, setOfferedFrom] = useState('')
  const [columns, setColumns] = useState<Column[]>([])
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
    infos, columns,
    ...(rolled != null ? { hit: rolled } : {}), ...(die && !hitDieOf(name, info) ? { die } : {}),
    ...(askSubclass && subclass.trim() ? { subclass } : {}),
    ...(askAsi && feat.trim() ? { feat: { name: feat, text: featNote } } : askAsi && spent ? { asi } : {}),
  }), [sheet, name, infos, info, columns, rolled, die, askSubclass, subclass, askAsi, feat, featNote, asi, spent])
  const newLevel = 'error' in result ? 0 : classLevel
  const first = totalLevel(classes) === 0
  const classPage = useMemo(() => pages.find((p) => key(p.title) === key(name) && (!p.type || p.type === 'class')), [pages, name])
  const sub = (askSubclass ? subclass : mine?.subclass ?? '').trim()
  const have = useMemo(() => new Map(sheet.features.traits.map((f) => [key(f.name), f])), [sheet.features.traits])

  // the class table of a class the level up rules do not know comes from its Open5e entry
  useEffect(() => {
    setColumns([])
    if (!name) return
    let live = true
    open5eClass(index, name, ruleset).then((e) => { if (live && e) setColumns(open5eColumns(e.data)) }).catch(() => {})
    return () => { live = false }
  }, [name, index, ruleset])

  useEffect(() => {
    setOffered([]); setPicked(new Set()); setOfferedFrom('')
    if (!name || !newLevel) return
    let live = true
    ;(async () => {
      const found: Offered[] = []
      const from: string[] = []
      // the class page of the world wins; it may have been changed for this table
      const page = classPage ? await api.getPage(classPage.id).catch(() => null) : null
      const fromPage = page ? classFeaturesAt(page.content, newLevel) : []
      if (fromPage.length) { found.push(...fromPage); from.push(`the ${classPage!.title} page`) } else {
        const e = await open5eClass(index, name, ruleset).catch(() => null)
        const f = e ? featuresAt(e, newLevel) : []
        if (f.length) { found.push(...f); from.push(e!.sourceName) }
      }
      if (sub) {
        const e = await open5eClass(index, sub, ruleset, name).catch(() => null)
        const f = e ? featuresAt(e, newLevel).filter((x) => !found.some((y) => key(y.name) === key(x.name))) : []
        if (f.length) { found.push(...f); from.push(`${sub} (${e!.sourceName})`) }
      }
      if (!live) return
      // a feature the sheet already has (Extra Attack, Action Surge) is offered for a new text, unticked
      setOffered(found); setPicked(new Set(found.filter((x) => !have.has(key(x.name))).map((x) => x.name))); setOfferedFrom(from.join(' and '))
    })()
    return () => { live = false }
  }, [classPage?.id, name, newLevel, sub, index, ruleset, have])

  const subclassNames = useMemo(() => SUBCLASSES[ruleset][key(name)] ?? [], [ruleset, name])
  const subclassFilter = useMemo(() => (r: LibraryRow) => key(r[4]) === key(`Subclass of ${name}`) && fitsRules(r, ruleset), [name, ruleset])

  const apply = () => {
    if ('error' in result) return
    // a bare number (Extra Attack "2") says little in the text; words ("two uses") go in front of it
    const textOf = (f: Offered) => (f.detail && !/^\d+$/.test(f.detail) ? `${name} level ${newLevel}: ${f.detail}.\n${f.text}` : f.text)
    let traits = (result.patch['features.traits'] as Feature[] | undefined) ?? sheet.features.traits
    for (const f of offered.filter((x) => picked.has(x.name))) {
      traits = have.has(key(f.name)) ? traits.map((t) => (key(t.name) === key(f.name) ? { ...t, text: textOf(f) } : t)) : [...traits, { name: f.name, text: textOf(f) }]
    }
    set({ ...result.patch, ...(traits !== sheet.features.traits ? { 'features.traits': traits } : {}) })
    onClose()
  }

  const newClassNames = [...new Set([...CLASSES.map((c) => c.name), ...known.map((o) => o.name)])].filter((n) => !classes.some((c) => key(c.name) === key(n)))
  return (
    <div className="cs-levelup" role="dialog" aria-label="Level up" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="cs-line"><b>{first ? 'First level' : 'Level up'}</b><span className="muted">{ruleset === '5e-2024' ? '2024 rules' : '2014 rules'}</span></div>
      <div className="cs-line">
        <label className="sv-mini">Class
          <Select className="input" value={cls} onChange={(v) => { setCls(v); setSubclass(''); setAsi({}); setFeat(''); setRolled(null) }} title="Class to level">
            {classes.map((c) => <option key={c.name} value={c.name}>{c.name} {c.level}</option>)}
            <option value="*">{classes.length ? 'A new class' : 'Choose a class'}</option>
          </Select>
        </label>
        {cls === '*' && <>
          <input className="sv-text" list="cs-classes" aria-label="Name of the new class" placeholder="Fighter" autoFocus value={other} onChange={(e) => { setOther(e.target.value); setSubclass('') }} />
          <datalist id="cs-classes">{newClassNames.map((n) => <option key={n} value={n} />)}</datalist>
        </>}
        {name && !hitDieOf(name, info) && <input className="sv-num" aria-label="Hit die sides" placeholder="d?" inputMode="numeric" value={dieText} onChange={(e) => setDieText(e.target.value.replace(/\D/g, ''))} />}
        {!first && <>
          <button className="btn sm" disabled={!die} title="Roll the hit die here" onClick={() => setRolled(Math.floor(Math.random() * (die ?? 1)) + 1)}>Roll hit die</button>
          <input className="sv-num" aria-label="Hit die roll" title={die ? `What the d${die} showed, if you rolled it yourself` : 'Choose a class first'} placeholder={die ? `1-${die}` : 'roll'} inputMode="numeric" disabled={!die}
            value={rolled ?? ''} onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '')); setRolled(n && die ? Math.min(die, n) : null) }} />
          {rolled != null && <button className="btn sm" onClick={() => setRolled(null)}>Take the average</button>}
        </>}
      </div>
      {'error' in result ? <p className="muted">{result.error}</p> : <>
        <ul aria-label="What changes">{result.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        {result.warnings.length > 0 && <ul aria-label="Check with your table" className="cs-warn">{result.warnings.map((l) => <li key={l}>{l}</li>)}</ul>}
      </>}
      {askSubclass && (
        <label className="sv-mini">Subclass{classLevel > subclassLevel(name, ruleset, info) ? ' (not chosen yet)' : ''}
          <LibraryInput value={subclass} onChange={setSubclass} label="Subclass" placeholder={subclassNames[0] ?? 'Subclass'} categories={['class']} filter={subclassFilter} extra={subclassNames} />
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
          {spent === 0 && <div className="cs-line">
            <LibraryInput value={feat} onChange={setFeat} label="Feat taken instead" placeholder={boon ? 'Boon of Fate' : 'A feat instead: Alert'} categories={['feat']}
              onPick={(p) => { setFeat(p.name); if (p.entry && !featNote.trim()) setFeatNote(firstParagraph(p.entry.data?.desc, 1800)) }} />
            {feat.trim() && <input className="sv-text" aria-label="What the feat does" placeholder="What it does (optional)" value={featNote} onChange={(e) => setFeatNote(e.target.value)} />}
          </div>}
        </div>
      )}
      {offered.length > 0 && (
        <div role="group" aria-label="Class features gained">
          <span className="muted">Features for {name} level {newLevel}, from {offeredFrom}</span>
          {offered.map((f) => (
            <label key={f.name} className="tt-check" title={f.text}>
              <input type="checkbox" checked={picked.has(f.name)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(f.name); else n.delete(f.name); return n })} />
              {f.name}{f.detail ? ` (${f.detail})` : ''}{have.has(key(f.name)) && <span className="muted">, already on the sheet: tick to update its text</span>}
            </label>
          ))}
        </div>
      )}
      <div className="cs-line">
        <button className="btn primary sm" disabled={'error' in result} onClick={apply}>{'error' in result ? 'Level up' : `Level up to ${result.newLevel}`}</button>
        <button className="btn sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
