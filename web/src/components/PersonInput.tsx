import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fuzzy, highlight } from '../lib/fuzzy'
import { worldPeople } from '../lib/people'
import { useStore } from '../store'
import type { Person } from '../types'
import { usePopPosition } from './LibraryInput'

// A text box that suggests the people of the world while you type, such as the player on a character sheet.
// The box keeps a name: someone who has no account yet can still be written in.

const ROLE: Record<Person['role'], string> = { owner: 'Owns the world', gm: 'GM of the world', editor: 'Edits the world', viewer: 'Reads the world' }

export function PersonInput({ value, onChange, label, placeholder, className = 'sv-text' }: { value: string; onChange: (name: string) => void; label: string; placeholder?: string; className?: string }) {
  const wsId = useStore((s) => s.wsId)
  const [people, setPeople] = useState<Person[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  useEffect(() => { if (wsId) void worldPeople(wsId).then(setPeople) }, [wsId])

  const q = value.trim()
  const options = useMemo(() => {
    if (!open) return []
    const hits = people.flatMap((p) => { const h = fuzzy(q, p.username); return h ? [{ p, h }] : [] })
    // players first, the owner last: the one who runs the game rarely plays a character too
    const rank = (p: Person) => (p.role === 'owner' ? 1 : 0)
    return hits.sort((a, b) => rank(a.p) - rank(b.p) || b.h.score - a.h.score).slice(0, 12)
  }, [open, q, people])
  useEffect(() => { setActive(options.findIndex((o) => o.p.username.toLowerCase() === q.toLowerCase())) }, [options, q])
  const pos = usePopPosition(input, list, open, options.length)

  const choose = (p: Person | undefined) => { if (p) onChange(p.username); setOpen(false) }
  return (
    <span className="li">
      <input ref={input} className={className} aria-label={label} placeholder={placeholder} value={value} role="combobox" aria-expanded={open} aria-autocomplete="list" aria-controls={listId}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(options.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
          else if (e.key === 'Enter') { e.preventDefault(); choose(open ? options[active]?.p : undefined) }
          else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) }
        }} />
      {open && pos && options.length > 0 && createPortal(
        <div ref={list} id={listId} className="lf-pop li-pop" role="listbox" style={pos}>
          {options.map(({ p, h }, i) => (
            <div key={p.id} className={`result${i === active ? ' sel' : ''}`} role="option" aria-selected={i === active}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(p) }}>
              <div className="grow">
                <div className="ellipsis">{h.indices.length ? highlight(p.username, h.indices).map((x, k) => (typeof x === 'string' ? x : <mark key={k}>{x.m}</mark>)) : p.username}</div>
                <div className="sub ellipsis">{ROLE[p.role]}</div>
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </span>
  )
}
