import { CalendarDays, Map as MapIcon, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { formatRange } from '../lib/calendar'
import { useWorld } from '../lib/world'
import { useStore } from '../store'
import { DateField } from './DateField'

function useWorldFor(wsId: string) {
  const loaded = useWorld((s) => s.wsId)
  useEffect(() => { if (loaded !== wsId) useWorld.getState().load(wsId).catch(() => {}) }, [wsId, loaded])
  return loaded === wsId
}

/** /pin: choose a map, then the map opens ready to drop this page's marker. */
export function PinDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const wsId = useStore((s) => s.wsId)!
  const ready = useWorldFor(wsId)
  const maps = useWorld((s) => s.maps).filter((m) => m.status !== 'error')
  const [idx, setIdx] = useState(0)
  const pick = (id: string) => { onClose(); useStore.getState().navigate({ type: 'map', id, place: pageId }) }
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <input className="big" autoFocus readOnly placeholder="Put this page on which map?"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') setIdx((i) => Math.min(maps.length - 1, i + 1))
            if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1))
            if (e.key === 'Enter' && maps[idx]) pick(maps[idx].id)
          }} />
        <div className="results">
          {!ready && <div className="muted" style={{ padding: 14 }}>Loading…</div>}
          {ready && !maps.length && <div className="muted" style={{ padding: 14 }}>No maps yet. Upload one under Maps first.</div>}
          {maps.map((m, i) => (
            <div key={m.id} className={`result ${i === idx ? 'sel' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => pick(m.id)}>
              <span className="muted row"><MapIcon size={15} /></span><span className="grow">{m.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** /teven: give this page a date (and optional end) on the timeline, no map needed. */
export function EventDialog({ pageId, pageTitle, onClose, onSaved }: { pageId: string; pageTitle: string; onClose: () => void; onSaved: () => void }) {
  const wsId = useStore((s) => s.wsId)!
  const ready = useWorldFor(wsId)
  const cal = useWorld((s) => s.calendar)
  const [title, setTitle] = useState(pageTitle)
  const [t, setT] = useState(0)
  const [range, setRange] = useState(false)
  const [end, setEnd] = useState(0)
  const [err, setErr] = useState('')
  if (!ready) return null
  const save = async () => {
    try {
      await api.createEvent(wsId, { pageId, title: title.trim() || pageTitle || 'Event', tStart: t, tEnd: range ? Math.max(end, t) : null })
      await useWorld.getState().reloadEvents()
      onSaved()
      onClose()
    } catch (e: any) { setErr(e.message) }
  }
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" style={{ padding: 16, gap: 12, maxHeight: 'none' }} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <b>Add to timeline</b>
        <input className="input" autoFocus value={title} placeholder="What happened?" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <div className="field"><span>Date</span><DateField cal={cal} value={t} onChange={(v) => { setT(v); if (end < v) setEnd(v) }} /></div>
        <label className="row"><input type="checkbox" checked={range} onChange={(e) => { setRange(e.target.checked); setEnd(Math.max(end, t)) }} /> Lasts until a later date</label>
        {range && <div className="field"><span>Until</span><DateField cal={cal} value={Math.max(end, t)} onChange={setEnd} /></div>}
        {err && <div className="error">{err}</div>}
        <div className="row"><button className="btn primary" onClick={save}>Add event</button><button className="btn" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  )
}

/** Events and map pins of one page, shown under it. */
export function PageWorldSection({ pageId, readOnly, version }: { pageId: string; readOnly: boolean; version: number }) {
  const wsId = useStore((s) => s.wsId)!
  const ready = useWorldFor(wsId)
  const cal = useWorld((s) => s.calendar)
  const allEvents = useWorld((s) => s.events)
  const [pins, setPins] = useState<{ id: string; mapId: string; mapName: string; kind: string }[]>([])
  const events = allEvents.filter((e) => e.pageId === pageId)
  useEffect(() => { api.pagePins(pageId).then(setPins).catch(() => {}) }, [pageId, version])
  if (!ready || (!events.length && !pins.length)) return null
  const nav = useStore.getState().navigate
  return (
    <div className="section">
      <h3>Where & when</h3>
      {pins.map((p) => (
        <a key={p.id} className="backlink" onClick={() => nav({ type: 'map', id: p.mapId, item: p.id })}>
          <MapIcon size={13} style={{ verticalAlign: -2 }} /> {p.mapName} <span className="muted">({p.kind === 'point' ? 'marker' : p.kind === 'line' ? 'line' : 'region'})</span>
        </a>
      ))}
      {events.map((e) => (
        <div key={e.id} className="row" style={{ padding: '2px 0' }}>
          <CalendarDays size={13} className="muted" />
          <span className="grow"><b>{e.title}</b> <span className="muted">· {formatRange(cal, e.tStart, e.tEnd)}</span></span>
          <a className="muted" style={{ cursor: 'pointer', fontSize: 12 }} onClick={() => nav({ type: 'timeline' })}>timeline</a>
          {!readOnly && <button className="icon-btn" title="Remove from timeline" onClick={async () => { await api.deleteEvent(e.id); useWorld.getState().reloadEvents() }}><Trash2 size={13} /></button>}
        </div>
      ))}
    </div>
  )
}
