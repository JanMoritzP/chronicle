import { useMemo, useState } from 'react'
import { PageIcon } from './TypeIcon'
import { searchPages } from '../lib/linkSearch'
import type { PageMeta } from '../types'

export function PagePicker({ onPick, placeholder = 'Find a page…', autoFocus }: { onPick: (p: PageMeta) => void; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const hits = useMemo(() => searchPages(q, 6), [q])
  return (
    <div className="page-picker">
      <input className="input" autoFocus={autoFocus} placeholder={placeholder} value={q}
        onChange={(e) => { setQ(e.target.value); setIdx(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(hits.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
          else if (e.key === 'Enter' && hits[idx]) { e.preventDefault(); onPick(hits[idx].page) }
        }} />
      <div className="page-picker-list">
        {hits.map((h, i) => (
          <div key={h.page.id} className={`result ${i === idx ? 'sel' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => onPick(h.page)}>
            <span className="muted row"><PageIcon page={h.page} /></span>
            <span className="grow ellipsis">{h.page.title || 'Untitled'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
