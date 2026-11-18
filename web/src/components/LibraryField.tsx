import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzy, highlight } from '../lib/fuzzy'
import { LIBRARY_CATEGORIES, searchLibrary, useLibrary } from '../lib/library'
import type { FieldDef } from '../lib/pageTypes'
import { useStore } from '../store'

/** One entry of a linked field: a library entry, a page of the world (usually an imported entry), or just text. */
export interface LibRef { name: string; note?: string; libKey?: string; pageId?: string }

/** What a field shows for one entry: the name, then the note that belongs to it ("Versatile (1d10)"). */
export const refText = (r: LibRef) => (r.note ? `${r.name} ${r.note}` : r.name)

/** Field values from before the field was linked are plain text; they show up as one unlinked entry. */
export function refsOf(v: unknown): LibRef[] {
  if (Array.isArray(v)) return v.filter((r): r is LibRef => !!r && typeof r === 'object' && typeof (r as LibRef).name === 'string')
  return typeof v === 'string' && v.trim() ? [{ name: v.trim() }] : []
}

/** Linked entries of a stat block field: the links when stored, else the shown text as one unlinked entry. */
export function refsOfData(data: Record<string, string>, key: string): LibRef[] {
  const stored = data[`${key}:refs`]
  if (stored) {
    try { const list = refsOf(JSON.parse(stored)); if (list.length) return list } catch { /* fall back to the text */ }
  }
  return refsOf(data[key])
}

interface Option { key: string; label: string; sub: string; indices: number[]; ref: LibRef }

function Chip({ r, readOnly, onRemove }: { r: LibRef; readOnly: boolean; onRemove: () => void }) {
  const pages = useStore((s) => s.data.pages)
  const navigate = useStore((s) => s.navigate)
  const page = r.pageId ? pages.find((p) => p.id === r.pageId) : undefined
  const label = refText({ ...r, name: page?.title || r.name })
  const open = (e: React.MouseEvent) => {
    const how = e.ctrlKey || e.metaKey ? { newTab: true } : e.shiftKey ? { split: true } : {}
    if (page) navigate({ type: 'page', id: page.id }, how)
    else if (r.libKey) navigate({ type: 'library', key: r.libKey }, how)
  }
  // shared pages have no world to open entries in
  const signedIn = useStore((s) => !!s.user)
  const linked = signedIn && (!!page || !!r.libKey)
  return (
    <span className={`lf-chip${linked ? ' linked' : ''}`}>
      {linked
        ? <button type="button" className="lf-name" {...(page ? { 'data-page-id': page.id } : { 'data-lib-key': r.libKey })} onClick={open}>{label}</button>
        : <span className="lf-name">{label}</span>}
      {!readOnly && <button type="button" className="lf-x" title={`Remove ${label}`} aria-label={`Remove ${label}`} onClick={onRemove}><X size={12} /></button>}
    </span>
  )
}

/** A field whose value is made of library entries. Typing offers entries of one kind, pages already imported first. */
export function LibraryField({ def, value, readOnly, onChange }: { def: FieldDef; value: unknown; readOnly: boolean; onChange: (v: LibRef[] | null) => void }) {
  const refs = refsOf(value)
  const lib = useLibrary()
  const pages = useStore((s) => s.data.pages)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const category = def.library!
  const plural = LIBRARY_CATEGORIES.find((c) => c.id === category)?.plural.toLowerCase() ?? 'entries'
  const full = !def.multi && refs.length >= 1

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const options = useMemo<Option[]>(() => {
    if (!open) return []
    const taken = new Set(refs.map((r) => r.pageId ?? r.libKey ?? `t:${r.name.toLowerCase()}`))
    const out: Option[] = []
    const imported = new Set<string>()
    for (const p of pages) {
      if (!p.library?.startsWith(`${category}:`)) continue
      imported.add(p.library)
      const h = fuzzy(q, p.title)
      if (!h || taken.has(p.id)) continue
      out.push({ key: `p:${p.id}`, label: p.title, sub: 'Page in this world', indices: h.indices, ref: { name: p.title, pageId: p.id } })
    }
    for (const h of searchLibrary(lib.index, q, category, 14)) {
      if (imported.has(h.row[0]) || taken.has(h.row[0])) continue
      out.push({ key: `l:${h.row[0]}`, label: h.row[2], sub: `${h.row[4]} · ${lib.index?.sources[h.row[3]] ?? h.row[3]}`, indices: h.indices, ref: { name: h.row[2], libKey: h.row[0] } })
    }
    const text = q.trim()
    if (text && !out.some((o) => o.label.toLowerCase() === text.toLowerCase())) out.push({ key: 'text', label: `Use “${text}” as text`, sub: 'No link', indices: [], ref: { name: text } })
    return out.slice(0, 10)
  }, [open, q, pages, lib.index, category, refs])

  const add = (o?: Option) => {
    if (!o) return
    onChange([...refs, o.ref])
    setQ(''); setIdx(0)
    if (!def.multi) setOpen(false)
  }
  const remove = (i: number) => onChange(refs.length > 1 ? refs.filter((_, j) => j !== i) : null)

  return (
    <div className="lf" ref={box}>
      <div className="lf-chips">
        {refs.map((r, i) => <Chip key={`${r.pageId ?? r.libKey ?? r.name}:${i}`} r={r} readOnly={readOnly} onRemove={() => remove(i)} />)}
        {!readOnly && !full && (
          <input className="lf-input" value={q} placeholder={refs.length ? 'Add…' : `Search ${plural}…`} aria-label={def.label} role="combobox" aria-expanded={open}
            onFocus={() => { setOpen(true); if (!lib.loaded) lib.load().catch(() => {}) }}
            onChange={(e) => { setQ(e.target.value); setIdx(0); setOpen(true) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setIdx((i) => Math.min(options.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); add(options[idx]) }
              else if (e.key === 'Escape') setOpen(false)
              else if (e.key === 'Backspace' && !q && refs.length) remove(refs.length - 1)
            }} />
        )}
      </div>
      {open && !readOnly && !full && options.length > 0 && (
        <div className="lf-pop" role="listbox">
          {options.map((o, i) => (
            <div key={o.key} className={`result${i === idx ? ' sel' : ''}`} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onMouseDown={(e) => { e.preventDefault(); add(o) }}>
              <div className="grow">
                <div className="ellipsis">{o.indices.length ? highlight(o.label, o.indices).map((p, k) => typeof p === 'string' ? p : <mark key={k}>{p.m}</mark>) : o.label}</div>
                <div className="sub ellipsis">{o.sub}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
