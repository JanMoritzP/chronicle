import { BookUp, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import type { Ruleset } from '../lib/builder'
import { alertDialog } from '../lib/dialog'
import {
  categoryOfPage, cleanRules, emptyRules, hasRules, isHomebrewKey, pageToEntry, rulesFields, rulesSub, typeOfCategory,
  type BackgroundRules, type ClassRules, type Rules, type RulesCategory, type SpeciesRules,
} from '../lib/homebrew'
import { categoryLabel, LIBRARY_CATEGORIES, useLibrary } from '../lib/library'
import { ABILITIES, SKILLS, type Ability } from '../lib/sheet'
import { useRules } from '../lib/pack'
import { useStore } from '../store'
import type { LibraryCategory, LibraryCollection } from '../types'
import { Select } from './Select'

// Making homebrew where it is needed (a class in the character builder, a species on a sheet, a spell in a field) and putting
// pages into libraries. What is made is a page of the world, an entry of a library, or both.

const NEW = '__new__'
const titleCase = (s: string) => s.replace(/\b\w+/g, (w) => (w === 'of' || w === 'and' ? w : w[0].toUpperCase() + w.slice(1)))
export const collectionOfKey = (key: string) => /^[a-z]+:hb\.([a-z0-9-]+)\./.exec(key)?.[1] ?? null

/** The homebrew libraries, read once per open of a picker. */
export function useCollections() {
  const [list, setList] = useState<LibraryCollection[] | null>(null)
  const reload = () => api.libraryCollections().then(setList).catch((e) => { setList([]); alertDialog(e.message) })
  useEffect(() => { void reload() }, [])
  return { list, reload }
}

/** Choose one of the libraries, or name a new one right here. Gives the id, or '' while nothing usable is chosen. */
export function CollectionPicker({ value, onChange, label = 'Library' }: { value: string; onChange: (id: string) => void; label?: string }) {
  const { list, reload } = useCollections()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (list && !value && list.length) onChange(list[0].id); if (list && !list.length) setNaming(true) }, [list])
  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try { const c = await api.createLibraryCollection({ name: name.trim() }); await reload(); onChange(c.id); setNaming(false); setName('') } catch (e: any) { alertDialog(e.message) } finally { setBusy(false) }
  }
  if (!list) return <span className="muted">Loading the libraries…</span>
  return (
    <div className="hb-pick">
      {!naming ? (
        <Select className="input" title={label} value={value} onChange={(v) => (v === NEW ? setNaming(true) : onChange(v))}>
          {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value={NEW}>New library…</option>
        </Select>
      ) : (
        <span className="cb-row">
          <input className="input" autoFocus aria-label="Name of the new library" placeholder="Homebrew of the Sunken Coast" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void create() } }} />
          <button className="btn sm" disabled={!name.trim() || busy} onClick={() => void create()}>Make the library</button>
          {list.length > 0 && <button className="btn ghost sm" onClick={() => setNaming(false)}>Choose one instead</button>}
        </span>
      )}
    </div>
  )
}

/**
 * Puts a page into a library. A page that came from an entry of the same library updates that entry; any other page becomes a new
 * entry. Afterwards the page remembers its entry, so the next push updates it.
 */
export async function pushPageToLibrary(pageId: string, collection: string, category?: LibraryCategory): Promise<string> {
  const page = await api.getPage(pageId, true)
  const entry = await pageToEntry(page, category)
  const prior = typeof page.props?.library === 'string' && isHomebrewKey(page.props.library) && collectionOfKey(page.props.library) === collection ? page.props.library : undefined
  const { key } = await api.putLibraryEntry(collection, entry, prior)
  await api.patchPage(pageId, { propsPatch: { library: key } })
  useStore.getState().patchPageMeta(pageId, { library: key })
  await useLibrary.getState().load()
  return key
}

function Overlay({ label, onClose, children, wide }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const on = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }; window.addEventListener('keydown', on, true); return () => window.removeEventListener('keydown', on, true) }, [onClose])
  return (
    <div className="overlay dialog-overlay hb-overlay" onMouseDown={onClose}>
      <div className={`dialog hb${wide ? ' hb-wide' : ''}`} role="dialog" aria-modal="true" aria-label={label} onMouseDown={(e) => e.stopPropagation()}>{children}</div>
    </div>
  )
}

/** "Put in a library": which library, and what kind of entry the page is. */
export function PushDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const meta = useStore((s) => s.data.pages.find((p) => p.id === pageId))
  const [collection, setCollection] = useState(meta?.library ? collectionOfKey(meta.library) ?? '' : '')
  const [category, setCategory] = useState<LibraryCategory | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    // the kind follows the special page type; the person may pick another
    api.getPage(pageId).then((p) => setCategory((c) => c ?? categoryOfPage(p.props))).catch(() => setCategory('page'))
  }, [pageId])
  const updating = !!meta?.library && isHomebrewKey(meta.library) && collectionOfKey(meta.library) === collection
  const go = async () => {
    if (!collection || !category) return
    setBusy(true)
    try {
      await pushPageToLibrary(pageId, collection, category)
      onClose()
      alertDialog(updating ? `The library entry “${meta?.title || 'Untitled'}” is up to date with the page.` : `“${meta?.title || 'Untitled'}” is now in the library. Every world on this server can add it from the Library.`, 'In the library')
    } catch (e: any) { alertDialog(e.message) } finally { setBusy(false) }
  }
  return (
    <Overlay label="Put the page in a library" onClose={onClose}>
      <header className="cb-head"><div><h2>Put in a library</h2><span className="muted">The page’s fields, sheet, text and pictures are copied into the library. The page stays as it is.</span></div><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></header>
      <div className="cb-body hb-body">
        <label className="cb-field">Library<CollectionPicker value={collection} onChange={setCollection} /></label>
        <label className="cb-field">Kind of entry
          <Select className="input" title="Kind of entry" value={category ?? 'page'} onChange={(v) => setCategory(v as LibraryCategory)}>
            {LIBRARY_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </label>
        {updating && <p className="muted cb-hint">This page came from that library, so its entry there is updated.</p>}
      </div>
      <footer className="cb-foot"><span className="grow" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!collection || !category || busy} onClick={() => void go()}><BookUp size={14} /> {updating ? 'Update the entry' : 'Put in the library'}</button></footer>
    </Overlay>
  )
}

// ---------- the rules forms ----------

function Toggles<T extends string>({ options, value, max, onChange, label }: { options: { id: T; label: string }[]; value: T[]; max: number; onChange: (v: T[]) => void; label: string }) {
  return (
    <span className="cb-row" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o.id)
        return <button key={o.id} type="button" aria-pressed={on} className={`btn sm${on ? ' primary' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id].slice(-max))}>{o.label}</button>
      })}
    </span>
  )
}

function NumIn({ value, onChange, label, min = 0, max = 99, width = 64 }: { value: number; onChange: (n: number) => void; label: string; min?: number; max?: number; width?: number }) {
  return <input type="number" className="input hb-num" aria-label={label} min={min} max={max} style={{ width }} value={value} onChange={(e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))) }} />
}

/** A list of named lines (features, traits, gear, attacks). */
function Rows<T extends { name: string }>({ list, onChange, blank, label, render }: { list: T[]; onChange: (l: T[]) => void; blank: T; label: string; render: (row: T, set: (p: Partial<T>) => void, i: number) => ReactNode }) {
  return (
    <div className="hb-rows">
      {list.map((row, i) => (
        <div key={i} className="hb-row">
          {render(row, (p) => onChange(list.map((x, j) => (j === i ? { ...x, ...p } : x))), i)}
          <button type="button" className="icon-btn" aria-label={`Remove ${row.name || `${label} ${i + 1}`}`} title="Remove" onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => onChange([...list, { ...blank }])}><Plus size={12} /> Add {label}</button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="hb-section"><legend>{title}</legend>{children}</fieldset>
}

function SkillPicks({ value, onChange, max, label }: { value: string[]; onChange: (v: string[]) => void; max?: number; label: string }) {
  return (
    <div className="cb-skills" role="group" aria-label={label}>
      {Object.keys(SKILLS).map((k) => {
        const on = value.includes(k)
        return <label key={k} className="cb-skill"><input type="checkbox" checked={on} disabled={!on && max != null && value.length >= max} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} /><span className="grow">{titleCase(k)}</span></label>
      })}
    </div>
  )
}

export function RulesForm({ category, rules, onChange, ruleset }: { category: RulesCategory; rules: Rules; onChange: (r: Rules) => void; ruleset: Ruleset }) {
  const an = useRules().abilities
  const abilityOptions = ABILITIES.map((a) => ({ id: a, label: an[a].short }))
  if (category === 'class') {
    const r = rules as ClassRules
    const set = (p: Partial<ClassRules>) => onChange({ ...r, ...p })
    const any = r.skills.from === 'any'
    return (
      <>
        <Section title="Basics">
          <div className="cb-row"><b className="hb-label">Hit die</b><span className="seg" role="group" aria-label="Hit die">{[6, 8, 10, 12].map((d) => <button key={d} type="button" className={r.die === d ? 'on' : ''} onClick={() => set({ die: d })}>d{d}</button>)}</span></div>
          <div className="cb-row"><b className="hb-label">Main abilities</b><Toggles label="Main abilities" options={abilityOptions} value={r.primary} max={2} onChange={(v) => set({ primary: v })} /></div>
          <div className="cb-row"><b className="hb-label">Saving throws</b><Toggles label="Saving throws" options={abilityOptions} value={r.saves} max={2} onChange={(v) => set({ saves: v })} /></div>
          <div className="cb-row"><b className="hb-label">Spellcasting</b>
            <Select className="input" title="Spellcasting ability" value={r.spell ?? ''} onChange={(v) => set({ spell: v as Ability | '', caster: v ? (r.caster || 'full') : '' })}>
              <option value="">Casts no spells</option>{ABILITIES.map((a) => <option key={a} value={a}>{an[a].name}</option>)}
            </Select>
          </div>
          {r.spell && (
            <div className="cb-row"><b className="hb-label">Spell slots</b>
              <Select className="input" title="How the spell slots grow" value={r.caster || 'full'} onChange={(v) => set({ caster: v as ClassRules['caster'] })}>
                <option value="full">Like a wizard (full caster)</option><option value="half">Like a paladin (half caster)</option><option value="third">Like an eldritch knight (a third)</option><option value="pact">Like a warlock (pact magic)</option>
              </Select>
            </div>
          )}
          <div className="cb-row"><b className="hb-label">Subclass at level</b><NumIn label="Class level of the subclass" value={r.subclassLevel ?? 3} min={1} max={20} onChange={(n) => set({ subclassLevel: n })} /></div>
        </Section>
        <Section title="Skills">
          <div className="cb-row"><b className="hb-label">Choose</b><NumIn label="Number of skills to choose" value={r.skills.count} max={18} onChange={(n) => set({ skills: { ...r.skills, count: n } })} />
            <label className="tt-check"><input type="checkbox" checked={any} onChange={(e) => set({ skills: { ...r.skills, from: e.target.checked ? 'any' : [] } })} />from any skill</label></div>
          {!any && <SkillPicks label="Skills to choose from" value={r.skills.from as string[]} onChange={(v) => set({ skills: { ...r.skills, from: v } })} />}
        </Section>
        <Section title="Armor class with the starting gear">
          <div className="cb-row">
            <label className="sv-mini">Base<NumIn label="Armor class base" value={r.armor.base} max={30} onChange={(n) => set({ armor: { ...r.armor, base: n } })} /></label>
            <Select className="input" title="Dexterity" value={r.armor.dex} onChange={(v) => set({ armor: { ...r.armor, dex: v as ClassRules['armor']['dex'] } })}>
              <option value="full">plus Dexterity</option><option value="max2">plus Dexterity, at most 2</option><option value="none">no Dexterity</option>
            </Select>
            <Select className="input" title="Another ability" value={r.armor.plus ?? ''} onChange={(v) => set({ armor: { ...r.armor, plus: v as Ability | '' } })}>
              <option value="">no other ability</option>{ABILITIES.map((a) => <option key={a} value={a}>plus {an[a].name}</option>)}
            </Select>
            <label className="tt-check"><input type="checkbox" checked={!!r.armor.shield} onChange={(e) => set({ armor: { ...r.armor, shield: e.target.checked } })} />shield (+2)</label>
          </div>
          <input className="input" aria-label="What the armor is" placeholder="leather armor" value={r.armor.note} onChange={(e) => set({ armor: { ...r.armor, note: e.target.value } })} />
        </Section>
        <Section title="Level 1 features">
          <Rows label="a feature" list={r.features} blank={{ name: '', text: '' }} onChange={(features) => set({ features })} render={(f, setF, i) => (
            <span className="hb-feature"><input className="input" aria-label={`Feature ${i + 1} name`} placeholder="Storm Strike" value={f.name} onChange={(e) => setF({ name: e.target.value })} /><textarea className="input" rows={2} aria-label={`Feature ${i + 1} text`} placeholder="What it does" value={f.text} onChange={(e) => setF({ text: e.target.value })} /></span>
          )} />
        </Section>
        <Section title="Attacks">
          <Rows label="an attack" list={r.attacks} blank={{ name: '', ability: 'str', damage: '1d8' }} onChange={(attacks) => set({ attacks })} render={(a, setA, i) => (
            <span className="cb-row grow">
              <input className="input" aria-label={`Attack ${i + 1} name`} placeholder="Longsword" value={a.name} onChange={(e) => setA({ name: e.target.value })} />
              <Select className="input" title="Attack ability" value={a.ability} onChange={(v) => setA({ ability: v as 'str' })}><option value="str">{an.str.name}</option><option value="dex">{an.dex.name}</option><option value="finesse">the better of the two</option></Select>
              <input className="input hb-num" aria-label={`Attack ${i + 1} damage`} placeholder="1d8" value={a.damage} onChange={(e) => setA({ damage: e.target.value.replace(/\s/g, '') })} />
              <input className="input" aria-label={`Attack ${i + 1} note`} placeholder="slashing, versatile (1d10)" value={a.note ?? ''} onChange={(e) => setA({ note: e.target.value })} />
            </span>
          )} />
        </Section>
        <Section title="Starting gear">
          <Rows label="an item" list={r.kit} blank={{ name: '' }} onChange={(kit) => set({ kit })} render={(k, setK, i) => (
            <span className="cb-row grow">
              <input className="input" aria-label={`Item ${i + 1}`} placeholder="Explorer's pack" value={k.name} onChange={(e) => setK({ name: e.target.value })} />
              <label className="sv-mini">count<NumIn label={`Count of ${k.name || `item ${i + 1}`}`} value={k.qty ?? 1} min={1} max={999} onChange={(n) => setK({ qty: n })} /></label>
              <label className="tt-check"><input type="checkbox" checked={!!k.equipped} onChange={(e) => setK({ equipped: e.target.checked })} />in hand or worn</label>
            </span>
          )} />
        </Section>
        {r.spell && <Section title="Starting spells"><textarea className="input" rows={3} aria-label="Starting spells" placeholder={'Cantrips (2): Shocking Grasp, Light\nLevel 1 (2): Thunderwave, Fog Cloud'} value={r.spells ?? ''} onChange={(e) => set({ spells: e.target.value })} /></Section>}
      </>
    )
  }
  if (category === 'species') {
    const r = rules as SpeciesRules
    const set = (p: Partial<SpeciesRules>) => onChange({ ...r, ...p })
    return (
      <>
        <Section title="Body">
          <div className="cb-row">
            <label className="sv-mini">Size<Select className="input" title="Size" value={r.size} onChange={(v) => set({ size: v })}>{['Tiny', 'Small', 'Medium', 'Large'].map((s) => <option key={s} value={s}>{s}</option>)}</Select></label>
            <label className="sv-mini">Speed (ft)<NumIn label="Speed" value={r.speed} max={120} onChange={(n) => set({ speed: n })} /></label>
            <label className="sv-mini">Darkvision (ft)<NumIn label="Darkvision" value={r.darkvision} max={300} onChange={(n) => set({ darkvision: n })} /></label>
            <label className="sv-mini">Extra hit points per level<NumIn label="Extra hit points per level" value={r.hpPerLevel ?? 0} max={3} width={52} onChange={(n) => set({ hpPerLevel: n })} /></label>
          </div>
          <input className="input" aria-label="Languages" placeholder="Common and one more" value={r.languages} onChange={(e) => set({ languages: e.target.value })} />
        </Section>
        {ruleset !== '5e-2024' && (
          <Section title="Ability scores it raises">
            <div className="cb-row">{ABILITIES.map((a) => <label key={a} className="sv-mini">{an[a].short}<NumIn label={`${an[a].name} raise`} value={r.asi?.[a] ?? 0} max={3} width={52} onChange={(n) => set({ asi: { ...r.asi, [a]: n } })} /></label>)}
              <label className="sv-mini">and +1 to this many others of the player’s choice<NumIn label="Free raises" value={r.freeAsi ?? 0} max={3} width={52} onChange={(n) => set({ freeAsi: n })} /></label></div>
          </Section>
        )}
        <Section title="Skills it gives"><SkillPicks label="Species skills" value={r.skills ?? []} onChange={(v) => set({ skills: v })} /></Section>
        <Section title="Traits">
          <Rows label="a trait" list={r.traits} blank={{ name: '', text: '' }} onChange={(traits) => set({ traits })} render={(t, setT, i) => (
            <span className="hb-feature"><input className="input" aria-label={`Trait ${i + 1} name`} placeholder="Tidal Lungs" value={t.name} onChange={(e) => setT({ name: e.target.value })} /><textarea className="input" rows={2} aria-label={`Trait ${i + 1} text`} placeholder="What it does" value={t.text} onChange={(e) => setT({ text: e.target.value })} /></span>
          )} />
        </Section>
      </>
    )
  }
  const r = rules as BackgroundRules
  const set = (p: Partial<BackgroundRules>) => onChange({ ...r, ...p })
  return (
    <>
      <Section title="Skills it gives (two)"><SkillPicks label="Background skills" max={2} value={r.skills} onChange={(v) => set({ skills: v })} /></Section>
      <Section title="Tools and languages"><input className="input" aria-label="Tools and languages" placeholder="Navigator's tools, one language" value={r.tools} onChange={(e) => set({ tools: e.target.value })} /></Section>
      {ruleset === '5e-2024' && (
        <Section title="Ability scores and feat">
          <div className="cb-row"><b className="hb-label">Scores it may raise (three)</b><Toggles label="Scores the background may raise" options={abilityOptions} value={r.abilities ?? []} max={3} onChange={(v) => set({ abilities: v })} /></div>
          <input className="input" aria-label="Origin feat" placeholder="Alert" value={r.feat ?? ''} onChange={(e) => set({ feat: e.target.value })} />
        </Section>
      )}
    </>
  )
}

/** What is still missing before the homebrew can be made. */
function rulesProblems(category: RulesCategory, rules: Rules, ruleset: Ruleset): string[] {
  if (category === 'class') { const r = rules as ClassRules; return [!r.primary.length && 'Choose at least one main ability.', r.saves.length !== 2 && 'Choose two saving throws.', r.skills.from !== 'any' && r.skills.from.length < r.skills.count && `List at least ${r.skills.count} skills to choose from.`].filter(Boolean) as string[] }
  if (category === 'background') { const r = rules as BackgroundRules; return [r.skills.length !== 2 && 'Choose two skills.', ruleset === '5e-2024' && (r.abilities?.length ?? 0) !== 3 && 'Choose the three scores it may raise.'].filter(Boolean) as string[] }
  return []
}

type Keep = 'page' | 'both' | 'library'
export interface Made { name: string; pageId?: string; key?: string; rules?: Rules; category: LibraryCategory }

/**
 * Makes a new class, species, background or any other entry in place. Classes, species and backgrounds get the rules form the
 * character builder needs; everything gets a description. It becomes a page of the world, an entry of a library, or both.
 */
export function HomebrewDialog({ category, initialName = '', ruleset, onDone, onClose, keep: initialKeep, collection: initialCollection = '' }: {
  category: LibraryCategory; initialName?: string; ruleset: Ruleset; onDone: (made: Made) => void; onClose: () => void; keep?: Keep; collection?: string
}) {
  const ws = useStore((s) => s.wsId)
  const [name, setName] = useState(initialName)
  const [text, setText] = useState('')
  const [rules, setRules] = useState<Rules | null>(hasRules(category) ? emptyRules(category) : null)
  const [keep, setKeep] = useState<Keep>(initialKeep ?? (ws ? 'page' : 'library'))
  const [collection, setCollection] = useState(initialCollection)
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  const label = categoryLabel(category).toLowerCase()
  const issues = [!name.trim() && 'Give it a name.', ...(rules && hasRules(category) ? rulesProblems(category, rules, ruleset) : []), keep !== 'page' && !collection && 'Choose a library.'].filter(Boolean) as string[]

  const create = async () => {
    if (issues.length || busy) return
    setBusy(true)
    try {
      const clean = rules && hasRules(category) ? cleanRules(category, rules) : undefined
      const content = { type: 'doc', content: text.trim() ? text.trim().split(/\n{2,}/).map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p.trim() }] })) : [{ type: 'paragraph' }] }
      const fields = clean && hasRules(category) ? rulesFields(category, clean) : {}
      let pageId: string | undefined, key: string | undefined
      if (keep !== 'library') {
        const page = await useStore.getState().createPage({ title: name.trim(), type: typeOfCategory(category), props: { ...(clean ? { rules: clean } : {}), ...(Object.keys(fields).length ? { data: fields } : {}) }, content, open: false })
        if (!page) return
        pageId = page.id
        if (keep === 'both') key = await pushPageToLibrary(page.id, collection, category)
      } else {
        const r = await api.putLibraryEntry(collection, {
          category, name: name.trim(), sub: clean && hasRules(category) ? rulesSub(category, clean) : `${categoryLabel(category)} · homebrew`,
          ...(typeOfCategory(category) ? { type: typeOfCategory(category) } : {}), ...(clean ? { rules: clean } : {}), ...(Object.keys(fields).length ? { fields } : {}), content,
        })
        key = r.key
        await useLibrary.getState().load()
      }
      onDone({ name: name.trim(), pageId, key, rules: clean, category })
    } catch (e: any) { alertDialog(e.message) } finally { setBusy(false) }
  }

  return (
    <Overlay label={`New ${label}`} onClose={onClose} wide={!!rules}>
      <header className="cb-head"><div><h2>New {label}</h2><span className="muted">{rules ? `Homebrew for the character builder${ruleset === '5e-2024' ? ' (2024 rules)' : ' (2014 rules)'}. Everything can be changed later on its page.` : 'A homebrew entry. Fill in the rest on its page.'}</span></div><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></header>
      <div className="cb-body hb-body">
        <label className="cb-field">Name<input ref={first} className="input" value={name} placeholder={category === 'class' ? 'Storm knight' : category === 'species' ? 'Tidekin' : category === 'background' ? 'Lighthouse keeper' : 'Name'} onChange={(e) => setName(e.target.value)} /></label>
        <label className="cb-field">Description<textarea className="input" rows={3} value={text} placeholder="A few sentences for the page. Paragraphs are separated by an empty line." onChange={(e) => setText(e.target.value)} /></label>
        {rules && hasRules(category) && <RulesForm category={category} rules={rules} onChange={setRules} ruleset={ruleset} />}
        <Section title="Keep it">
          <div className="hb-keep" role="radiogroup" aria-label="Where to keep it">
            {ws && <label className="tt-check"><input type="radio" name="hb-keep" checked={keep === 'page'} onChange={() => setKeep('page')} />As a page of this world</label>}
            {ws && <label className="tt-check"><input type="radio" name="hb-keep" checked={keep === 'both'} onChange={() => setKeep('both')} />As a page and in a library, for other worlds too</label>}
            <label className="tt-check"><input type="radio" name="hb-keep" checked={keep === 'library'} onChange={() => setKeep('library')} />Only in a library</label>
          </div>
          {keep !== 'page' && <CollectionPicker value={collection} onChange={setCollection} />}
        </Section>
      </div>
      <footer className="cb-foot">
        <span className="muted cb-sofar">{issues[0] ?? ''}</span>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!!issues.length || busy} onClick={() => void create()}>Create the {label}</button>
      </footer>
    </Overlay>
  )
}

/** The rules of a homebrew class, species or background, on its page: what the character builder takes from it, and a way to change it. */
export function RulesPanel({ category, rules, readOnly, ruleset, onSave }: { category: RulesCategory; rules: any; readOnly: boolean; ruleset: Ruleset; onSave: (r: Rules) => void }) {
  const an = useRules().abilities
  const [editing, setEditing] = useState<Rules | null>(null)
  const r = cleanRules(category, rules)
  const names = (l: Ability[]) => l.map((a) => an[a].name).join(' and ') || 'none'
  const facts: [string, string][] = category === 'class' ? (() => { const k = r as ClassRules; return [['Hit die', `d${k.die}`], ['Main abilities', names(k.primary)], ['Saving throws', names(k.saves)], ['Skills', `${k.skills.count} from ${k.skills.from === 'any' ? 'any skill' : k.skills.from.map(titleCase).join(', ')}`], ['Armor class', `${k.armor.base}${k.armor.dex === 'full' ? ' + Dexterity' : k.armor.dex === 'max2' ? ' + Dexterity (at most 2)' : ''}${k.armor.plus ? ` + ${an[k.armor.plus].name}` : ''}${k.armor.shield ? ' + 2 (shield)' : ''}${k.armor.note ? `, ${k.armor.note}` : ''}`], ['Spellcasting', k.spell ? `${an[k.spell].name}, ${({ full: 'slots like a wizard', half: 'slots like a paladin', third: 'slots like an eldritch knight', pact: 'pact magic like a warlock' } as Record<string, string>)[k.caster || 'full']}` : 'none'], ['Subclass', `at level ${k.subclassLevel ?? 3}`], ['Features', k.features.map((f) => f.name).join(', ') || 'none'], ['Gear', k.kit.map((i) => i.name).join(', ') || 'none']] as [string, string][] })()
    : category === 'species' ? (() => { const s = r as SpeciesRules; return [['Size and speed', `${s.size}, ${s.speed} ft`], ['Darkvision', s.darkvision ? `${s.darkvision} ft` : 'none'], ...(ruleset !== '5e-2024' ? [['Raises', Object.entries(s.asi ?? {}).map(([a, n]) => `${an[a as Ability].short} +${n}`).join(', ') + (s.freeAsi ? `${Object.keys(s.asi ?? {}).length ? ', ' : ''}+1 to ${s.freeAsi} of choice` : '') || 'nothing']] : []), ['Languages', s.languages || 'none'], ['Skills', (s.skills ?? []).map(titleCase).join(', ') || 'none'], ['Traits', s.traits.map((t) => t.name).join(', ') || 'none']] as [string, string][] })()
      : (() => { const b = r as BackgroundRules; return [['Skills', b.skills.map(titleCase).join(' and ') || 'none'], ['Tools and languages', b.tools || 'none'], ...(ruleset === '5e-2024' ? [['Raises', b.abilities?.map((a) => an[a].short).join(', ') || 'nothing'], ['Feat', b.feat || 'none']] : [])] as [string, string][] })()
  return (
    <div className="hb-panel" aria-label="Character builder rules">
      <div className="cb-row"><b className="grow">In the character builder</b>{!readOnly && <button className="btn sm" onClick={() => setEditing(r)}><Pencil size={12} /> Change the rules</button>}</div>
      <dl className="lib-facts">{facts.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {editing && (
        <Overlay label="Change the rules" onClose={() => setEditing(null)} wide>
          <header className="cb-head"><div><h2>Rules of this {categoryLabel(category).toLowerCase()}</h2><span className="muted">What the character builder uses. Characters made before keep their sheets.</span></div><button className="icon-btn" aria-label="Close" onClick={() => setEditing(null)}><X size={16} /></button></header>
          <div className="cb-body hb-body"><RulesForm category={category} rules={editing} onChange={setEditing} ruleset={ruleset} /></div>
          <footer className="cb-foot"><span className="muted cb-sofar">{rulesProblems(category, editing, ruleset)[0] ?? ''}</span><button className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn primary" disabled={!!rulesProblems(category, editing, ruleset).length} onClick={() => { onSave(cleanRules(category, editing)); setEditing(null) }}>Save the rules</button></footer>
        </Overlay>
      )}
    </div>
  )
}
