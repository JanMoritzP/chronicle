import { ExternalLink, X } from 'lucide-react'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { api } from '../api'
import { ReadOnlyDoc } from '../editor/Embed'
import { typeOfCategory } from '../lib/homebrew'
import { fetchLibraryEntry, useLibrary } from '../lib/library'
import { entryFeatureNames, headingNames, matchFeature, ruleNames, sectionKey } from '../lib/sheetFeatures'
import { useStore } from '../store'
import type { FullPage, LibraryCategory, LibraryEntry } from '../types'
import { EntryBody } from './LibraryEntry'
import { InfoboxContext, type InfoboxHost } from '../editor/Infobox'
import { BOX_ZONES, typeOf, zonesInText, type BoxZone } from '../lib/pageTypes'
import { useTypes } from './TypeIcon'
import { ZoneBlocks } from './TypeLayout'

// A character sheet stores names ("Fighter", "Longsword", "Fire Bolt"), not links: whatever was typed or picked stays valid even
// when an entry is removed. The links are found from the names when the sheet is drawn, so old sheets get them too.

/** Where a name on a sheet leads: a page of the world (an imported or homebrew entry) or a library entry. */
export type Target = { pageId: string } | { libKey: string }
export type FindEntry = (name: string, categories: LibraryCategory[]) => Target | null

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()

/**
 * Finds entries by their exact name (case and spacing do not matter; "Potion of Healing (greater)" also tries "Potion of Healing").
 * Pages of the world come first, then homebrew, then the source of the sheet's rules (2014 or 2024), then any other.
 */
export function useEntryFinder(ruleset: string): FindEntry | null {
  const signedIn = useStore((s) => !!s.user)
  const index = useLibrary((s) => s.index)
  const loaded = useLibrary((s) => s.loaded)
  const pages = useStore((s) => s.data.pages)
  useEffect(() => { if (signedIn && !loaded) useLibrary.getState().load().catch(() => {}) }, [signedIn, loaded])
  return useMemo(() => {
    if (!signedIn) return null
    const byName = new Map<string, { key: string; category: LibraryCategory; source: string }[]>()
    for (const [key, category, name, source] of index?.rows ?? []) {
      const n = norm(name)
      const list = byName.get(n)
      if (list) list.push({ key, category, source }); else byName.set(n, [{ key, category, source }])
    }
    const modern = ruleset === '5e-2024'
    const rank = (r: { key: string; source: string }) => (r.key.includes(':hb.') ? 0 : r.source.includes('2024') === modern ? 1 : 2)
    const one = (n: string, categories: LibraryCategory[]): Target | null => {
      for (const p of pages) {
        if (norm(p.title) !== n) continue
        if (categories.some((c) => p.library?.startsWith(`${c}:`) || (typeOfCategory(c) && p.type === typeOfCategory(c)))) return { pageId: p.id }
      }
      const hits = (byName.get(n) ?? []).filter((r) => categories.includes(r.category))
      if (!hits.length) return null
      return { libKey: hits.sort((a, b) => rank(a) - rank(b) || categories.indexOf(a.category) - categories.indexOf(b.category))[0].key }
    }
    return (name, categories) => {
      const n = norm(name)
      if (!n) return null
      return one(n, categories) ?? (/\(.*\)$/.test(n) ? one(n.replace(/\s*\(.*\)$/, ''), categories) : null)
    }
  }, [signedIn, index, pages, ruleset])
}

/** A class, species or background of the sheet: where its features come from. */
export interface Origin { name: string; category: 'class' | 'species' | 'background' }
/** The entry that gives a feature, and the name of that entry. */
interface Giver { target: Target; from: string }
/** What is shown in the window over the sheet: an entry, or one section of it. */
type Shown = Target & { section?: string }

/** The features an entry gives, each list with the entry to open for them: a subspecies also has those of its species. */
async function featuresOf(giver: Giver, find: FindEntry): Promise<{ giver: Giver; features: string[] }[]> {
  const { target } = giver
  const page = 'pageId' in target ? await api.getPage(target.pageId) : null
  const key = 'libKey' in target ? target.libKey : page?.props?.library
  const entry = typeof key === 'string' ? await fetchLibraryEntry(key).catch(() => null) : null
  const features = page ? [...headingNames(page.content), ...ruleNames(page.props?.rules)] : entryFeatureNames(entry?.data)
  const own = [{ giver, features }]
  const parent = entry?.category === 'species' ? entry.data?.subspecies_of : null
  if (typeof parent !== 'string') return own
  // "srd_elf" is looked up by its name: of an Elf in several books the library keeps one, so the key itself may be missing
  const name = parent.replace(/^[^_]*_/, '').replace(/-/g, ' ')
  const up = find(name, ['species'])
  return up ? [...own, ...await featuresOf({ target: up, from: name.replace(/\b\w/g,(c) => c.toUpperCase()) }, find).catch(() => [])] : own
}

/** Which entry gives each feature of the sheet's classes, species and background; the first one named wins. */
function useFeatureGivers(find: FindEntry | null, origins: Origin[]) {
  const wanted = JSON.stringify(origins.flatMap((o) => { const target = find?.(o.name, [o.category]); return target ? [{ target, from: o.name }] : [] }))
  const [givers, setGivers] = useState(() => new Map<string, Giver>())
  useEffect(() => {
    if (!find) return
    let alive = true
    // one that cannot be loaded gives nothing; its features are then looked up like any name
    Promise.all((JSON.parse(wanted) as Giver[]).map((g) => featuresOf(g, find).catch(() => []))).then((all) => {
      if (!alive) return
      const map = new Map<string, Giver>()
      for (const { giver, features } of all.flat()) for (const f of features) { const k = sectionKey(f); if (!map.has(k)) map.set(k, giver) }
      setGivers(map)
    })
    return () => { alive = false }
  }, [wanted, find])
  return givers
}

interface Links { find: FindEntry | null; peek: (t: Shown) => void; givers: Map<string, Giver> }
const LinksContext = createContext<Links>({ find: null, peek: () => {}, givers: new Map() })

/** The finder of the sheet around, for edit boxes that show whether their name is linked. */
export const useFindEntry = () => useContext(LinksContext).find

/** Gives the links on a sheet their finder, and shows a clicked entry in a window over the sheet, so the sheet stays open. */
export function SheetLinksHost({ ruleset, origins, children }: { ruleset: string; origins: Origin[]; children: ReactNode }) {
  const find = useEntryFinder(ruleset)
  const givers = useFeatureGivers(find, origins)
  const [shown, setShown] = useState<Shown | null>(null)
  const value = useMemo(() => ({ find, peek: setShown, givers }), [find, givers])
  return (
    <LinksContext.Provider value={value}>
      {children}
      {shown && <EntryPeek target={shown} onClose={() => setShown(null)} />}
    </LinksContext.Provider>
  )
}

/** A name on the sheet that leads to its entry: hovering shows the card, a click opens it over the sheet, Ctrl or Shift opens it in a tab or beside. */
export function EntryLink({ name, categories, children }: { name: string; categories: LibraryCategory[]; children?: ReactNode }) {
  const { find, peek } = useContext(LinksContext)
  const target = name.trim() && find ? find(name, categories) : null
  if (!target) return <>{children ?? name}</>
  const data = 'pageId' in target ? { 'data-page-id': target.pageId } : { 'data-lib-key': target.libKey }
  return <button type="button" className="sheet-link" {...data} title="Show what it does" onClick={(e) => openTarget(e, target, peek)}>{children ?? name}</button>
}

function openTarget(e: MouseEvent, target: Shown, peek: (t: Shown) => void) {
  e.stopPropagation()
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    const how = e.shiftKey ? { split: true } : { newTab: true }
    const nav = useStore.getState().navigate
    if ('pageId' in target) nav({ type: 'page', id: target.pageId }, how); else nav({ type: 'library', key: target.libKey }, how)
  } else peek(target)
}

/**
 * The name of a feature or action. One that a class, species or background of the sheet gives opens that entry at its section
 * (and not a spell or rule that only shares the name, as Darkvision does); any other is looked up by name.
 */
export function FeatureLink({ name, categories }: { name: string; categories: LibraryCategory[] }) {
  const { givers, peek } = useContext(LinksContext)
  const hit = name.trim() ? matchFeature(givers, name) : null
  if (!hit) return <EntryLink name={name} categories={categories} />
  // no hover card: it would show the whole class or species, not this feature
  return <button type="button" className="sheet-link" title={`From ${hit.found.from}`} onClick={(e) => openTarget(e, { ...hit.found.target, section: hit.section }, peek)}>{name}</button>
}

/** "Level 1: Magic Missile, Shield" with each spell linked; lines and the label before a colon stay as they are. */
export function SpellLinks({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const m = /^([^:]{0,40}:\s*)?(.*)$/.exec(line)!
        const parts = (m[2] ?? '').split(/(,\s*|;\s*)/)
        return (
          <span key={i} className="cs-spell-line">
            {m[1] && <span className="muted">{m[1]}</span>}
            {parts.map((p, k) => (k % 2 ? p : <EntryLink key={k} name={p} categories={['spell']} />))}
          </span>
        )
      })}
    </>
  )
}

/** "Thieves' tools, Common, Elvish" with each part that names an entry linked. */
export function ListLinks({ text, categories }: { text: string; categories: LibraryCategory[] }) {
  return <>{text.split(/(,\s*|;\s*)/).map((p, k) => (k % 2 ? p : <EntryLink key={k} name={p} categories={categories} />))}</>
}

/** A page of the world, read-only: the fields of its special page type where its layout puts them, then its text. */
function PageBody({ page }: { page: FullPage }) {
  const types = useTypes()
  const type = typeOf(types, { type: page.props?.type ?? null })
  const data = useMemo(() => ({ ...(page.props?.data ?? {}), portrait: page.props?.portrait }), [page])
  const inText = useMemo(() => zonesInText(page.content), [page])
  const zone = (z: BoxZone) => {
    const blocks = type?.layout[z].filter((b) => b.type !== 'body') ?? []
    return blocks.length ? <ZoneBlocks blocks={blocks} zone={`peek-${z}`} data={data} readOnly setValue={() => {}} pickImage={async () => null} /> : null
  }
  const host = useMemo<InfoboxHost | null>(() => (type ? { render: zone } : null), [type, data])
  if (!type) return <>{page.props?.portrait && <img className="peek-portrait" src={page.props.portrait} alt="" />}<div className="editor"><ReadOnlyDoc doc={page.content} /></div></>
  return (
    <InfoboxContext.Provider value={host}>
      {BOX_ZONES.filter((z) => !inText.has(z)).map((z) => <div key={z} className="peek-zone">{zone(z)}</div>)}
      <div className="editor"><ReadOnlyDoc doc={page.content} /></div>
    </InfoboxContext.Provider>
  )
}

function EntryPeek({ target, onClose }: { target: Shown; onClose: () => void }) {
  const body = useRef<HTMLDivElement>(null)
  // the text is drawn after it has loaded (a page's text a moment later still), so watch for the section's heading
  useEffect(() => {
    const el = body.current
    if (!el || !target.section) return
    const watch = new MutationObserver(() => show())
    const show = () => {
      const heading = [...el.querySelectorAll('h1, h2, h3, h4')].find((h) => sectionKey(h.textContent ?? '') === target.section)
      if (heading) { heading.scrollIntoView({ block: 'start' }); watch.disconnect() }
    }
    watch.observe(el, { childList: true, subtree: true })
    show()
    return () => watch.disconnect()
  }, [target])
  const [entry, setEntry] = useState<LibraryEntry | null>(null)
  const [page, setPage] = useState<FullPage | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const fail = (e: Error) => alive && setError(e.message)
    if ('libKey' in target) fetchLibraryEntry(target.libKey).then((e) => alive && setEntry(e)).catch(fail)
    else api.getPage(target.pageId).then((p) => alive && setPage(p)).catch(fail)
    return () => { alive = false }
  }, [target])
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  }, [onClose])
  const title = entry?.name ?? page?.title ?? ''
  const openFull = () => {
    const nav = useStore.getState().navigate
    if ('pageId' in target) nav({ type: 'page', id: target.pageId }); else nav({ type: 'library', key: target.libKey })
    onClose()
  }
  return (
    <div className="overlay dialog-overlay peek-overlay" onMouseDown={onClose}>
      <div className="dialog peek" role="dialog" aria-modal="true" aria-label={title || 'Entry'} onMouseDown={(e) => e.stopPropagation()}>
        <div className="peek-head">
          <h3>{title || 'Loading…'}</h3>
          <button className="btn sm" title="Open it as a page" onClick={openFull}><ExternalLink size={12} /> Open</button>
          <button className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="peek-body lib-detail" ref={body}>
          {error ? <p className="muted">{error}</p>
            : entry ? <EntryBody entry={entry} />
            : page ? <PageBody page={page} />
            : <p className="muted">Loading…</p>}
        </div>
      </div>
    </div>
  )
}
