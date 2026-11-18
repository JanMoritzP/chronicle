import { BookPlus, Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { alertDialog, confirmDialog } from '../lib/dialog'
import { highlight } from '../lib/fuzzy'
import { LIBRARY_CATEGORIES, searchLibrary, useLibrary, type LibraryHit } from '../lib/library'
import { creatureToStatBlock, entryDoc } from '../lib/open5e'
import { useStore } from '../store'
import type { LibraryCategory, LibraryEntry } from '../types'
import { EntryBody } from './LibraryEntry'

const entryCache = new Map<string, LibraryEntry>()
async function fetchEntry(key: string): Promise<LibraryEntry> {
  const hit = entryCache.get(key)
  if (hit) return hit
  const e = await api.libraryEntry(key)
  entryCache.set(key, e)
  return e
}

/**
 * Creatures become Monster pages with the stat block filled in; everything else becomes a normal page.
 * Links that pointed at the library entry can be moved to the new page. An entry is only imported once per world.
 */
export async function addToWorld(key: string): Promise<void> {
  const st = useStore.getState()
  const existing = st.data.pages.find((p) => p.library === key)
  if (existing) { st.navigate({ type: 'page', id: existing.id }); return }
  const e = await fetchEntry(key)
  const linking = new Set(st.data.links.filter((l) => l.libKey === key).map((l) => l.sourceId)).size
  const library = key
  const page = e.category === 'creature'
    ? await st.createPage({ title: e.name, type: 'monster', props: { library, data: { main: creatureToStatBlock(e) } }, open: false })
    : await st.createPage({ title: e.name, content: entryDoc(e), props: { library }, open: false })
  if (!page) return
  if (linking > 0) {
    const ok = await confirmDialog(
      `${linking === 1 ? '1 page links' : `${linking} pages link`} to “${e.name}” in the library. Point ${linking === 1 ? 'that link' : 'those links'} at your new page instead?`,
      { title: 'Update links', okLabel: 'Point links to the page' },
    )
    const ws = useStore.getState().wsId
    if (ok && ws) {
      await api.libraryRepoint(ws, key, page.id)
      await useStore.getState().refresh()
    }
  }
  useStore.getState().navigate({ type: 'page', id: page.id })
}

function useLibraryReady() {
  const { status, index, loaded } = useLibrary()
  useEffect(() => { if (!loaded) useLibrary.getState().load().catch((e) => alertDialog(e.message)) }, [loaded])
  return { status, index, loaded }
}

function Empty({ owner }: { owner: boolean }) {
  const { status } = useLibrary()
  if (status?.running) return <div className="muted lib-empty">Downloading the library: {status.phase || 'working'}. This takes about a minute.</div>
  return (
    <div className="lib-empty">
      <p>The library is empty. It holds creatures, spells, items, classes and more from Open5e, so you can search and add them to any world.</p>
      {status?.error && <p className="error">{status.error}</p>}
      {owner
        ? <button className="btn primary row" onClick={() => useLibrary.getState().refresh().catch((e) => alertDialog(e.message))}><Download size={15} /> Download the library</button>
        : <p className="muted">Ask the owner of this server to download it once.</p>}
    </div>
  )
}

function Chips({ value, onChange }: { value: LibraryCategory | null; onChange: (c: LibraryCategory | null) => void }) {
  return (
    <div className="lib-chips" role="group" aria-label="Filter by kind">
      <button className={`lib-chip${value === null ? ' on' : ''}`} onClick={() => onChange(null)}>All</button>
      {LIBRARY_CATEGORIES.map((c) => (
        <button key={c.id} className={`lib-chip${value === c.id ? ' on' : ''}`} onClick={() => onChange(value === c.id ? null : c.id)}>{c.plural}</button>
      ))}
    </div>
  )
}

function HitRow({ h, sources, selected, onClick, onHover }: { h: LibraryHit; sources: Record<string, string>; selected: boolean; onClick: () => void; onHover?: () => void }) {
  const [key, , name, source, sub] = h.row
  return (
    <div key={key} className={`result${selected ? ' sel' : ''}`} role="option" aria-selected={selected} data-active={selected} onMouseEnter={onHover} onClick={onClick}>
      <div className="grow">
        <div className="ellipsis">{h.indices.length ? highlight(name, h.indices).map((p, k) => typeof p === 'string' ? p : <mark key={k}>{p.m}</mark>) : name}</div>
        <div className="sub ellipsis">{sub}</div>
      </div>
      <span className="lib-source" title={sources[source]}>{sources[source] ?? source}</span>
    </div>
  )
}

/** Quick add: type a few letters, press Enter, and the entry is a page in the current world. */
export function LibraryDialog() {
  const open = useStore((s) => s.libraryOpen)
  const owner = useStore((s) => s.user?.role === 'owner')
  const { index } = useLibraryReady()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<LibraryCategory | null>(null)
  const [idx, setIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const close = () => useStore.getState().setUi({ libraryOpen: false })

  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => input.current?.focus(), 0) } }, [open])
  const hits = useMemo(() => (open ? searchLibrary(index, q, cat, 50) : []), [open, index, q, cat])
  useEffect(() => {
    document.querySelector('.lib-dialog .result.sel')?.scrollIntoView({ block: 'nearest' })
  }, [idx, hits])

  if (!open) return null
  const add = async (h?: LibraryHit) => {
    if (!h || busy) return
    setBusy(true)
    try { await addToWorld(h.row[0]); close() } catch (e: any) { alertDialog(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog lib-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={input} className="big" role="combobox" aria-expanded aria-controls="lib-results" aria-label="Search the library" placeholder="Goblin, fireball, longsword, wizard…" value={q}
          disabled={!index}
          onChange={(e) => { setQ(e.target.value); setIdx(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(hits.length - 1, i + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
            else if (e.key === 'Enter') {
              if ((e.ctrlKey || e.shiftKey) && hits[idx]) { close(); useStore.getState().navigate({ type: 'library', key: hits[idx].row[0] }) }
              else add(hits[idx])
            }
          }} />
        {index ? (
          <>
            <Chips value={cat} onChange={(c) => { setCat(c); setIdx(0); input.current?.focus() }} />
            <div className="results" id="lib-results" role="listbox">
              {hits.map((h, i) => <HitRow key={h.row[0]} h={h} sources={index.sources} selected={i === idx} onHover={() => setIdx(i)} onClick={() => add(h)} />)}
              {!hits.length && <div className="muted" style={{ padding: 14 }}>Nothing in the library matches “{q}”.</div>}
            </div>
            <div className="muted lib-foot">↑↓ choose · Enter add to this world · Shift+Enter open in the library</div>
          </>
        ) : <Empty owner={owner} />}
      </div>
    </div>
  )
}

function EntryDetail({ entry }: { entry: LibraryEntry }) {
  const readOnly = useStore((s) => s.user?.role === 'viewer')
  const pages = useStore((s) => s.data.pages)
  const links = useStore((s) => s.data.links)
  const navigate = useStore((s) => s.navigate)
  const [busy, setBusy] = useState(false)
  const imported = pages.find((p) => p.library === entry.key)
  const linkedFrom = useMemo(() => {
    const ids = new Set(links.filter((l) => l.libKey === entry.key).map((l) => l.sourceId))
    return pages.filter((p) => ids.has(p.id))
  }, [links, pages, entry.key])
  return (
    <div className="lib-detail">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }} className="grow">{entry.name}</h2>
        {imported ? (
          <button className="btn row" title="This entry is already a page in this world" onClick={() => navigate({ type: 'page', id: imported.id })}><BookPlus size={15} /> Open the page</button>
        ) : !readOnly && (
          <button className="btn primary row" disabled={busy} onClick={async () => {
            setBusy(true)
            try { await addToWorld(entry.key) } catch (e: any) { alertDialog(e.message) } finally { setBusy(false) }
          }}><BookPlus size={15} /> Add to this world</button>
        )}
      </div>
      <EntryBody entry={entry} />
      {linkedFrom.length > 0 && (
        <div className="lib-linked">
          <h3>Linked from</h3>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {linkedFrom.map((p) => <button key={p.id} className="lib-chip" onClick={() => navigate({ type: 'page', id: p.id })}>{p.title || 'Untitled'}</button>)}
          </div>
        </div>
      )}
    </div>
  )
}

export function LibraryView({ entryKey }: { entryKey?: string }) {
  const { status, index, loaded } = useLibraryReady()
  const owner = useStore((s) => s.user?.role === 'owner')
  const navigate = useStore((s) => s.navigate)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<LibraryCategory | null>(null)
  const [entry, setEntry] = useState<LibraryEntry | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setError('')
    if (!entryKey) { setEntry(null); return }
    let live = true
    fetchEntry(entryKey).then((e) => live && setEntry(e)).catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [entryKey])

  const hits = useMemo(() => searchLibrary(index, q, cat, 80), [index, q, cat])

  if (!loaded) return <div className="view muted">Loading the library…</div>
  return (
    <div className="lib-view">
      <div className="lib-side">
        <div className="row" style={{ gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: '1.3rem' }} className="grow">Library</h1>
          {owner && index && (
            <button className="btn sm" disabled={status?.running} title="Download the latest version from Open5e" onClick={() => useLibrary.getState().refresh().catch((e) => alertDialog(e.message))}>
              {status?.running ? 'Updating…' : 'Refresh'}
            </button>
          )}
        </div>
        {index ? (
          <>
            <input className="input" autoFocus={!entryKey} aria-label="Search the library" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
            <Chips value={cat} onChange={setCat} />
            <div className="results" role="listbox">
              {hits.map((h) => <HitRow key={h.row[0]} h={h} sources={index.sources} selected={h.row[0] === entryKey} onClick={() => navigate({ type: 'library', key: h.row[0] })} />)}
              {!hits.length && <div className="muted" style={{ padding: 14 }}>Nothing matches “{q}”.</div>}
            </div>
            <div className="muted lib-foot">{status?.count.toLocaleString('en-US')} entries from Open5e{status?.updatedAt ? `, updated ${new Date(status.updatedAt).toLocaleDateString()}` : ''}. {status?.running && (status.phase || 'Updating…')}</div>
          </>
        ) : <Empty owner={owner} />}
      </div>
      <div className="lib-main">
        {error && <div className="error">{error}</div>}
        {entry ? <EntryDetail entry={entry} /> : !error && <div className="muted lib-empty">Pick an entry on the left. Everything here is read-only; “Add to this world” makes an editable page.</div>}
      </div>
    </div>
  )
}
