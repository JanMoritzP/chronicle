import { BookPlus, Download, FileDown, FileUp, Library as LibraryIcon, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { alertDialog, askText, confirmDialog } from '../lib/dialog'
import { homebrewPlan } from '../lib/homebrew'
import { resolveTypes } from '../lib/pageTypes'
import { highlight } from '../lib/fuzzy'
import { categoryLabel, LIBRARY_CATEGORIES, fetchLibraryEntry as fetchEntry, searchLibrary, useLibrary, type LibraryHit } from '../lib/library'
import { importPlan } from '../lib/open5e'
import { useStore } from '../store'
import type { LibraryCategory, LibraryCollection, LibraryCollectionEntry, LibraryEntry } from '../types'
import { HomebrewDialog, useCollections } from './Homebrew'
import { EntryBody } from './LibraryEntry'
import { Select } from './Select'

/**
 * Every kind becomes its own special page (Monster, Spell, Item, Class...) with the entry's data in its fields and stat block.
 * Links that pointed at the library entry can be moved to the new page. An entry is only imported once per world.
 */
export async function addToWorld(key: string): Promise<void> {
  const st = useStore.getState()
  const existing = st.data.pages.find((p) => p.library === key)
  if (existing) { st.navigate({ type: 'page', id: existing.id }); return }
  const e = await fetchEntry(key)
  const linking = new Set(st.data.links.filter((l) => l.libKey === key).map((l) => l.sourceId)).size
  const ws = await st.ensureWorkspace()
  if (!ws) return
  // homebrew brings its pictures from the library into the world
  const plan = e.homebrew ? await homebrewPlan(e, ws, new Set(resolveTypes(st.data.pageTypes).map((t) => t.id))) : importPlan(e, useLibrary.getState().index)
  const page = await st.createPage({ title: e.name, type: plan.type, props: plan.props, content: plan.content, tags: 'tags' in plan ? plan.tags : undefined, open: false })
  if (!page) return
  if (linking > 0) {
    const ok = await confirmDialog(
      `${linking === 1 ? '1 page links' : `${linking} pages link`} to “${e.name}” in the library. Point ${linking === 1 ? 'that link' : 'those links'} at your new page instead?`,
      { title: 'Update links', okLabel: 'Point links to the page' },
    )
    if (ok) {
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

function EntryDetail({ entry, onBook }: { entry: LibraryEntry; onBook: (id: string) => void }) {
  const readOnly = useStore((s) => s.user?.role === 'viewer')
  const remove = async () => {
    if (!(await confirmDialog(`“${entry.name}” is deleted from the library ${entry.sourceName}. Pages that were made from it stay in their worlds.`, { title: 'Delete the entry', okLabel: 'Delete the entry', danger: true }))) return
    try { await api.deleteLibraryEntry(entry.key); await useLibrary.getState().load(); navigate({ type: 'library' }) } catch (e: any) { alertDialog(e.message) }
  }
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
        {entry.homebrew && !readOnly && <button className="btn row" title="Delete it from the library" onClick={() => void remove()}><Trash2 size={15} /> Delete</button>}
      </div>
      {entry.homebrew && <button className="lib-chip" style={{ alignSelf: 'flex-start' }} onClick={() => onBook(entry.homebrew!)}><LibraryIcon size={12} /> {entry.sourceName}</button>}
      <EntryBody entry={entry} />
      {linkedFrom.length > 0 && (
        <div className="lib-linked">
          <h3>Linked from</h3>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {linkedFrom.map((p) => <button key={p.id} className="lib-chip" data-page-id={p.id} onClick={() => navigate({ type: 'page', id: p.id })}>{p.title || 'Untitled'}</button>)}
          </div>
        </div>
      )}
    </div>
  )
}

function download(name: string, data: unknown) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

/** Reads a library file and adds it. A library with the same name in the file is replaced only after asking. */
export async function importLibraryFile(): Promise<LibraryCollection | null> {
  const f = await new Promise<File | null>((resolve) => { const el = document.createElement('input'); el.type = 'file'; el.accept = '.json,application/json'; el.onchange = () => resolve(el.files?.[0] ?? null); el.oncancel = () => resolve(null); el.click() })
  if (!f) return null
  let file: unknown
  try { file = JSON.parse(await f.text()) } catch { alertDialog('That file could not be read. A library is a .chronicle-library.json file.'); return null }
  try {
    let r
    try { r = await api.importLibrary(file) } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 409) throw e
      if (!(await confirmDialog(e.message, { title: 'Replace the library', okLabel: 'Replace it', danger: true }))) return null
      r = await api.importLibrary(file, true)
    }
    await useLibrary.getState().load()
    alertDialog(`${r.entries === 1 ? '1 entry' : `${r.entries} entries`} from “${r.collection.name}” are in the library now.`, 'Library imported')
    return r.collection
  } catch (e: any) { alertDialog(e.message); return null }
}

/** Your own libraries, in the side of the Library view. */
function Books({ selected, onSelect, version }: { selected: string | null; onSelect: (id: string | null) => void; version: number }) {
  const { list, reload } = useCollections()
  const canEdit = useStore((s) => s.user?.role !== 'viewer')
  useEffect(() => { void reload() }, [version])
  const create = async () => {
    const name = (await askText('New library', { label: 'Name', placeholder: 'Homebrew of the Sunken Coast', okLabel: 'Make the library' }))?.trim()
    if (!name) return
    try { const c = await api.createLibraryCollection({ name }); await reload(); await useLibrary.getState().load(); onSelect(c.id) } catch (e: any) { alertDialog(e.message) }
  }
  return (
    <div className="lib-books" aria-label="Your libraries">
      <div className="lib-books-head">
        <b>Your libraries</b>
        {canEdit && <button className="icon-btn" title="New library" aria-label="New library" onClick={() => void create()}><Plus size={15} /></button>}
        {canEdit && <button className="icon-btn" title="Import a library file" aria-label="Import a library file" onClick={async () => { const c = await importLibraryFile(); if (c) { await reload(); onSelect(c.id) } }}><FileUp size={15} /></button>}
      </div>
      {list?.map((c) => (
        <div key={c.id} className={`lib-book${selected === c.id ? ' on' : ''}`}>
          <button className="grow" onClick={() => onSelect(selected === c.id ? null : c.id)} title={c.description || c.name}>{c.name}</button>
          <small>{c.count}</small>
        </div>
      ))}
      {list && !list.length && <span className="muted" style={{ fontSize: 12.5 }}>None yet. Make one, import a file, or put a page in one from its menu.</span>}
    </div>
  )
}

/** One of your libraries: what is in it, adding to it, and taking it to another server as a file. */
function BookDetail({ id, onChanged, onGone }: { id: string; onChanged: () => void; onGone: () => void }) {
  const user = useStore((s) => s.user)
  const navigate = useStore((s) => s.navigate)
  const system = useStore((s) => s.workspaces.find((w) => w.id === s.wsId)?.settings?.system ?? '5e')
  const [book, setBook] = useState<(LibraryCollection & { entries: LibraryCollectionEntry[] }) | null>(null)
  const [kind, setKind] = useState<LibraryCategory>('class')
  const [making, setMaking] = useState(false)
  const load = () => api.libraryCollection(id).then(setBook).catch((e) => alertDialog(e.message))
  useEffect(() => { setBook(null); void load() }, [id])
  if (!book) return <div className="muted">Loading…</div>
  const canEdit = user?.role !== 'viewer'
  const manage = user?.role === 'owner' || user?.username === book.createdBy
  const edit = async (field: 'name' | 'description' | 'author' | 'license', label: string) => {
    const v = await askText(`Library ${label.toLowerCase()}`, { label, initial: book[field], okLabel: 'Save' })
    if (v == null || (field === 'name' && !v.trim())) return
    try { await api.updateLibraryCollection(id, { [field]: v.trim() }); await load(); await useLibrary.getState().load(); onChanged() } catch (e: any) { alertDialog(e.message) }
  }
  const remove = async () => {
    if (!(await confirmDialog(`The library “${book.name}” and its ${book.count === 1 ? 'entry' : `${book.count} entries`} are deleted from this server. Pages made from them stay in their worlds. Export it first to keep a copy.`, { title: 'Delete the library', okLabel: 'Delete the library', danger: true }))) return
    try { await api.deleteLibraryCollection(id); await useLibrary.getState().load(); onGone() } catch (e: any) { alertDialog(e.message) }
  }
  return (
    <div className="lib-collection">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }} className="grow">{book.name}</h2>
        <button className="btn row" title="Save the library with its pictures as one file" onClick={() => api.exportLibraryCollection(id).then((f) => download(`${book.name.replace(/[^\w\- ]+/g, '').trim() || 'library'}.chronicle-library.json`, f)).catch((e) => alertDialog(e.message))}><FileDown size={15} /> Export</button>
        {manage && <button className="btn row" onClick={() => void remove()}><Trash2 size={15} /> Delete</button>}
      </div>
      <dl className="lib-facts">
        <dt>Description</dt><dd>{book.description || <span className="muted">none</span>} {manage && <button className="icon-btn" aria-label="Change the description" title="Change" onClick={() => void edit('description', 'Description')}><Pencil size={12} /></button>}</dd>
        <dt>Author</dt><dd>{book.author || <span className="muted">none</span>} {manage && <button className="icon-btn" aria-label="Change the author" title="Change" onClick={() => void edit('author', 'Author')}><Pencil size={12} /></button>}</dd>
        <dt>License</dt><dd>{book.license || <span className="muted">none</span>} {manage && <button className="icon-btn" aria-label="Change the license" title="Change" onClick={() => void edit('license', 'License')}><Pencil size={12} /></button>}</dd>
        <dt>Made by</dt><dd>{book.createdBy || 'unknown'}{manage && <> <button className="btn ghost sm" onClick={() => void edit('name', 'Name')}>Rename</button></>}</dd>
      </dl>
      {canEdit && (
        <div className="cb-row">
          <span>New</span>
          <Select className="input" title="Kind of entry" value={kind} onChange={(v) => setKind(v as LibraryCategory)}>
            {LIBRARY_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label.toLowerCase()}</option>)}
          </Select>
          <button className="btn sm" onClick={() => setMaking(true)}><Plus size={12} /> Make it</button>
          <span className="muted" style={{ fontSize: 12.5 }}>Any page can also go in here from its menu: Put in a library.</span>
        </div>
      )}
      <div className="results" role="listbox" aria-label={`Entries of ${book.name}`}>
        {book.entries.map((e) => (
          <div key={e.key} className="result" role="option" aria-selected={false} onClick={() => navigate({ type: 'library', key: e.key })}>
            <div className="grow"><div className="ellipsis">{e.name}</div><div className="sub ellipsis">{e.sub}</div></div>
            <span className="lib-source">{categoryLabel(e.category)}</span>
          </div>
        ))}
        {!book.entries.length && <div className="muted" style={{ padding: 14 }}>This library is empty.</div>}
      </div>
      {making && <HomebrewDialog category={kind} keep="library" collection={id} ruleset={system === '5e-2024' ? '5e-2024' : '5e'} onClose={() => setMaking(false)} onDone={(m) => { setMaking(false); void load(); onChanged(); if (m.key) navigate({ type: 'library', key: m.key }) }} />}
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
  const [book, setBook] = useState<string | null>(null)
  const [booksVersion, setBooksVersion] = useState(0)

  useEffect(() => {
    setError('')
    if (entryKey) setBook(null)
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
              {status?.running ? 'Updating…' : status?.open5e ? 'Refresh' : 'Download Open5e'}
            </button>
          )}
        </div>
        <Books selected={book} version={booksVersion} onSelect={(id) => { setBook(id); if (id && entryKey) navigate({ type: 'library' }) }} />
        {index ? (
          <>
            <input className="input" autoFocus={!entryKey} aria-label="Search the library" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
            <Chips value={cat} onChange={setCat} />
            <div className="results" role="listbox">
              {hits.map((h) => <HitRow key={h.row[0]} h={h} sources={index.sources} selected={h.row[0] === entryKey} onClick={() => navigate({ type: 'library', key: h.row[0] })} />)}
              {!hits.length && <div className="muted" style={{ padding: 14 }}>Nothing matches “{q}”.</div>}
            </div>
            <div className="muted lib-foot">{status?.open5e.toLocaleString('en-US')} entries from Open5e{status && status.count > status.open5e ? `, ${(status.count - status.open5e).toLocaleString('en-US')} homebrew` : ''}{status?.updatedAt ? `, updated ${new Date(status.updatedAt).toLocaleDateString()}` : ''}. {status?.running && (status.phase || 'Updating…')}</div>
          </>
        ) : <Empty owner={owner} />}
      </div>
      <div className="lib-main">
        {error && <div className="error">{error}</div>}
        {book ? <BookDetail id={book} onChanged={() => setBooksVersion((v) => v + 1)} onGone={() => { setBook(null); setBooksVersion((v) => v + 1) }} />
          : entry ? <EntryDetail entry={entry} onBook={(id) => { setBook(id); navigate({ type: 'library' }) }} /> : !error && <div className="muted lib-empty">Pick an entry on the left. Everything here is read-only; “Add to this world” makes an editable page. Your own libraries hold homebrew: make one, import a file, or put any page in one from its menu.</div>}
      </div>
    </div>
  )
}
