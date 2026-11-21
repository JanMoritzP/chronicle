import { useState } from 'react'
import { sendTable, useTable } from '../tabletop/state'
import type { PageMeta } from '../types'
import { PagePicker } from './PagePicker'

// A note pinned to the map: a label, and optionally a Chronicle page it opens when someone clicks the pin.

export function PinDialog({ at, onClose }: { at: { x: number; y: number }; onClose: () => void }) {
  const [label, setLabel] = useState('')
  const [page, setPage] = useState<PageMeta | null>(null)
  const [gmOnly, setGmOnly] = useState(false)
  const save = () => {
    const sceneId = useTable.getState().sceneId
    if (!sceneId || !label.trim()) return
    sendTable({ t: 'pin.add', sceneId, x: Math.round(at.x), y: Math.round(at.y), label: label.trim(), pageId: page?.id ?? null, gmOnly })
    onClose()
  }
  return (
    <div className="tt-handout-overlay" role="dialog" aria-label="Pin a note" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="tt-handout" style={{ maxWidth: 420 }}>
        <h3>Pin a note</h3>
        <div className="tt-form">
          <input className="input" autoFocus aria-label="Pin label" placeholder="The old well" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          {page ? (
            <div className="tt-row"><span className="grow">Opens “{page.title || 'Untitled'}”</span><button className="btn sm" onClick={() => setPage(null)}>Not a page</button></div>
          ) : <PagePicker placeholder="Open a page when clicked (optional)…" onPick={setPage} />}
          <label className="tt-check"><input type="checkbox" checked={gmOnly} onChange={(e) => setGmOnly(e.target.checked)} />Only I see this pin</label>
          <div className="tt-row">
            <button className="btn primary" disabled={!label.trim()} onClick={save}>Pin it</button>
            <button className="btn" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}
