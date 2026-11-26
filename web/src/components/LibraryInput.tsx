import { Link2 } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fuzzy, highlight } from '../lib/fuzzy'
import { typeOfCategory } from '../lib/homebrew'
import { categoryLabel, fetchLibraryEntry, searchLibrary, useLibrary } from '../lib/library'
import { useStore } from '../store'
import type { LibraryCategory, LibraryEntry, LibraryRow } from '../types'
import { useFindEntry } from './SheetLinks'

// A text box on a sheet that suggests entries of the library and pages of the world while you type: the species, a class, an item.
// The sheet keeps the name; the link is found from it when the sheet is drawn (SheetLinks), so typing a name of your own stays fine.

/** What was chosen: the name, and the full library entry or the page of the world it came from. */
export interface Picked { name: string; entry?: LibraryEntry; pageId?: string }

interface Option { key: string; label: string; sub: string; indices: number[]; pick: () => Promise<Picked | null> | Picked | null }

interface Props {
  value: string
  onChange: (text: string) => void
  categories: LibraryCategory[]
  label: string
  placeholder?: string
  /** a suggestion was chosen; without it the name is simply put in the box */
  onPick?: (p: Picked) => void
  /** an add box: Enter adds what was typed (the first suggestion), and the box empties after each choice */
  onAdd?: (p: Picked) => void
  /** offers "New species “x”…" at the end of the list */
  onMake?: (name: string) => void
  /** leaves out library entries that do not fit here (subclasses in a box for the class) */
  filter?: (row: LibraryRow) => boolean
  className?: string
}

export function LibraryInput({ value, onChange, categories, label, placeholder, onPick, onAdd, onMake, filter, className = 'sv-text' }: Props) {
  const index = useLibrary((s) => s.index)
  const loaded = useLibrary((s) => s.loaded)
  const pages = useStore((s) => s.data.pages)
  const find = useFindEntry()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  // a line the pointer rests on is only highlighted; Enter takes it when it was reached with the arrow keys or names what was typed
  const keyed = useRef(false)
  const q = value.trim()
  const kind = categoryLabel(categories[0]).toLowerCase()

  const options = useMemo<Option[]>(() => {
    if (!open) return []
    const out: Option[] = []
    const imported = new Set<string>()
    for (const p of pages) {
      const own = categories.some((c) => p.library?.startsWith(`${c}:`) || (typeOfCategory(c) && p.type === typeOfCategory(c)))
      if (!own) continue
      if (p.library) imported.add(p.library)
      const h = fuzzy(q, p.title)
      if (!h || !p.title) continue
      out.push({ key: `p:${p.id}`, label: p.title, sub: 'Page in this world', indices: h.indices, pick: () => ({ name: p.title, pageId: p.id }) })
    }
    const hits = categories.flatMap((c) => searchLibrary(index, q, c, filter ? 400 : 12)).sort((a, b) => b.score - a.score)
    for (const h of hits) {
      if (imported.has(h.row[0]) || (filter && !filter(h.row))) continue
      out.push({
        key: `l:${h.row[0]}`, label: h.row[2], sub: `${categories.length > 1 ? `${categoryLabel(h.row[1])} · ` : ''}${index?.sources[h.row[3]] ?? h.row[3]}`, indices: h.indices,
        pick: async () => { const entry = await fetchLibraryEntry(h.row[0]); return { name: entry.name, entry } },
      })
    }
    const shown = out.slice(0, 12)
    if (onAdd && q && !shown.some((o) => o.label.toLowerCase() === q.toLowerCase())) shown.unshift({ key: 'text', label: `Add “${q}”`, sub: 'As you typed it', indices: [], pick: () => ({ name: q }) })
    if (onMake) shown.push({ key: 'new', label: `New ${kind}${q ? ` “${q}”` : ''}…`, sub: 'Make it yourself, as a page of this world or in a library', indices: [], pick: () => { onMake(q); return null } })
    return shown
  }, [open, q, pages, index, categories, onAdd, onMake, filter, kind])

  // an add box starts on its first line; a box that holds a name only on the entry of that exact name, so Enter keeps what was typed
  useEffect(() => {
    setActive(onAdd ? (options.length ? 0 : -1) : options.findIndex((o) => o.key !== 'new' && o.label.toLowerCase() === q.toLowerCase()))
  }, [options, onAdd, q])

  // the list hangs under the box (over it near the bottom of the window) and follows it when the page scrolls
  const place = () => {
    if (!input.current) return
    const r = input.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const flip = below < 200 && above > below
    const width = Math.min(window.innerWidth - 16, Math.max(r.width, 260))
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width, maxHeight: Math.min(320, flip ? above : below),
      ...(flip ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    })
  }
  useLayoutEffect(() => { if (open) place(); else setPos(null) }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const follow = (e: Event) => { if (!list.current?.contains(e.target as Node)) place() }
    window.addEventListener('resize', follow)
    window.addEventListener('scroll', follow, true)
    return () => { window.removeEventListener('resize', follow); window.removeEventListener('scroll', follow, true) }
  }, [open])

  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [open, active])

  const choose = async (o: Option | undefined) => {
    if (!o) return
    setBusy(true)
    try {
      const p = await o.pick()
      if (!p) { setOpen(false); return }
      if (onAdd) { onAdd(p); onChange('') } else if (onPick) onPick(p); else onChange(p.name)
      if (!onAdd) setOpen(false)
    } catch {
      // the entry could not be fetched: keep the name, without what the entry would have filled in
      const name = o.label
      if (onAdd) { onAdd({ name }); onChange('') } else onChange(name)
      setOpen(false)
    } finally { setBusy(false) }
  }

  const linked = !onAdd && q && find ? find(q, categories) : null
  return (
    <span className="li">
      <input ref={input} className={className} aria-label={label} placeholder={placeholder} value={value} role="combobox" aria-expanded={open} aria-autocomplete="list" aria-controls={listId}
        onFocus={() => { setOpen(true); if (!loaded) useLibrary.getState().load().catch(() => {}) }}
        onBlur={() => setOpen(false)}
        onChange={(e) => { keyed.current = false; onChange(e.target.value); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); keyed.current = true; setOpen(true); setActive((i) => Math.min(options.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); keyed.current = true; setActive((i) => Math.max(0, i - 1)) }
          else if (e.key === 'Enter') {
            e.preventDefault()
            const o = !open ? undefined : keyed.current ? options[active] : onAdd ? options[0] : options.find((x) => x.key !== 'new' && x.label.toLowerCase() === q.toLowerCase())
            if (o) void choose(o)
            else if (onAdd && q) { onAdd({ name: q }); onChange('') }
            else setOpen(false)
          }
          else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) }
        }} />
      {linked && <span className="li-linked" title="Linked: the sheet shows what it does"><Link2 size={12} aria-label="Linked to an entry" /></span>}
      {open && pos && options.length > 0 && createPortal(
        <div ref={list} id={listId} className="lf-pop li-pop" role="listbox" style={pos}>
          {options.map((o, i) => (
            <div key={o.key} className={`result${i === active ? ' sel' : ''}`} role="option" aria-selected={i === active} aria-disabled={busy}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); if (!busy) void choose(o) }}>
              <div className="grow">
                <div className="ellipsis">{o.indices.length ? highlight(o.label, o.indices).map((p, k) => (typeof p === 'string' ? p : <mark key={k}>{p.m}</mark>)) : o.label}</div>
                <div className="sub ellipsis">{o.sub}</div>
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </span>
  )
}
