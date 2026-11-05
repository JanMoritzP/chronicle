import { Eye, EyeOff, LocateFixed, Map as MapIcon, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatDate, formatShort, type Calendar } from '../lib/calendar'
import { confirmDialog } from '../lib/dialog'
import { dist, formatDistance, formatMeters, journeyTimes } from '../lib/mapTime'
import { useStore } from '../store'
import type { Geometry, MapItem, MapLayer, MapMeta, Pt } from '../types'
import { DateField } from './DateField'
import { PagePicker } from './PagePicker'
import { Select } from './Select'

export const PALETTE = ['#c0392b', '#d68910', '#b7950b', '#239b56', '#1f8a9e', '#2e5fa3', '#7d3c98', '#6b4f3a']
export const DEFAULT_COLOR = PALETTE[0]
const MODES = ['foot', 'horse', 'cart', 'ship', 'airship', 'teleport']

interface Props {
  item: MapItem
  layers: MapLayer[]
  maps: MapMeta[]
  mapId: string
  cal: Calendar
  T: number
  scale: number | null
  stateGeom: Geometry | null
  canEdit: boolean
  onUpdate: (patch: Partial<MapItem>) => void
  onDelete: () => void
  onClose: () => void
  onJump: (t: number) => void
  onNeedTime: () => void
}

function TimeCell({ cal, value, T, onChange, nullable, disabled }: {
  cal: Calendar; value: number | null; T: number; onChange: (t: number | null) => void; nullable?: boolean; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="timecell">
      <button className="btn sm" disabled={disabled} onClick={() => setOpen(!open)} title={value === null ? 'No time set' : formatDate(cal, value)}>
        {value === null ? '—' : formatShort(cal, value)}
      </button>
      {open && (
        <div className="timecell-pop">
          <DateField cal={cal} value={value ?? T} onChange={onChange} />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn sm" onClick={() => onChange(T)}>Use current</button>
            {nullable && <button className="btn sm" onClick={() => { onChange(null); setOpen(false) }}>Clear</button>}
            <button className="btn sm primary" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function MapInspector(p: Props) {
  const { item, cal, T, canEdit } = p
  const pages = useStore((s) => s.data.pages)
  const nav = useStore.getState().navigate
  const page = item.pageId ? pages.find((x) => x.id === item.pageId) : null
  const [title, setTitle] = useState(item.title)
  useEffect(() => setTitle(item.title), [item.id, item.title])

  const geomNow = p.stateGeom ?? item.geometry
  const kfs = [...item.keyframes].sort((a, b) => a.t - b.t)
  const setKeyframes = (next: typeof item.keyframes) => p.onUpdate({ keyframes: [...next].sort((a, b) => a.t - b.t) })
  const upsert = (t: number, kf: { geometry?: Geometry; hidden?: boolean }) =>
    setKeyframes([...item.keyframes.filter((k) => k.t !== t), { t, ...kf }])

  const setMode = async (mode: MapItem['timeMode']) => {
    if (mode === item.timeMode) return
    const ask = (message: string) => confirmDialog(message, { okLabel: 'Continue' })
    if (mode === 'static') {
      if (item.timeMode === 'timed' && !(await ask('Remove all keyframes? The item will stay where it is at the current time.'))) return
      p.onUpdate({ timeMode: 'static', keyframes: [], journey: null, geometry: geomNow })
    } else if (mode === 'timed') {
      if (item.timeMode === 'journey' && !(await ask('A line can change over time or be a journey, not both. Drop the journey settings?'))) return
      p.onNeedTime()
      p.onUpdate({ timeMode: 'timed', journey: null, keyframes: [{ t: T, geometry: geomNow }] })
    } else if (item.kind === 'line') {
      if (item.timeMode === 'timed' && !(await ask('A line can change over time or be a journey, not both. Drop the keyframes?'))) return
      p.onNeedTime()
      p.onUpdate({
        timeMode: 'journey', keyframes: [], geometry: geomNow,
        journey: item.journey ?? { mode: 'foot', waypoints: (geomNow as Pt[]).map(() => ({ arrive: null, depart: null })) },
      })
    }
  }

  const journey = item.timeMode === 'journey' ? item.journey : null
  const jt = journey ? journeyTimes(item.geometry as Pt[], journey.waypoints) : null
  const setWp = (i: number, patch: Partial<{ arrive: number | null; depart: number | null }>) => {
    if (!journey) return
    const wps = (item.geometry as Pt[]).map((_, k) => journey.waypoints[k] ?? { arrive: null, depart: null })
    wps[i] = { ...wps[i], ...patch }
    p.onUpdate({ journey: { ...journey, waypoints: wps } })
  }

  return (
    <div className="inspector">
      <div className="row" style={{ marginBottom: 8 }}>
        <b className="grow ellipsis">{item.kind === 'point' ? 'Marker' : item.kind === 'line' ? (journey ? 'Journey line' : 'Line') : 'Region'}</b>
        {canEdit && <button className="icon-btn" title="Delete (Del)" onClick={p.onDelete}><Trash2 size={15} /></button>}
        <button className="icon-btn" title="Close (Esc)" onClick={p.onClose}><X size={15} /></button>
      </div>

      <label className="field"><span>Name</span>
        <input className="input" value={title} disabled={!canEdit} placeholder={page?.title || 'Unnamed'}
          onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== item.title && p.onUpdate({ title })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>

      <div className="field"><span>Linked page</span>
        {page ? (
          <div className="row">
            <a className="chip" data-page-id={page.id} style={{ cursor: 'pointer' }} onClick={() => nav({ type: 'page', id: page.id })}>{page.icon} {page.title || 'Untitled'}</a>
            {canEdit && <button className="btn sm" onClick={() => p.onUpdate({ pageId: null })}>Unlink</button>}
          </div>
        ) : canEdit ? (
          <>
            <PagePicker placeholder="Link a page…" onPick={(pg) => p.onUpdate({ pageId: pg.id })} />
            <button className="btn sm" style={{ marginTop: 6 }} onClick={async () => {
              const created = await useStore.getState().createPage({ title: item.title || 'New place', open: false })
              p.onUpdate({ pageId: created.id })
            }}><Plus size={13} /> New page for this</button>
          </>
        ) : <span className="muted">None</span>}
      </div>

      <div className="field"><span>Colour</span>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {PALETTE.map((c) => (
            <button key={c} className={`swatch ${(item.style.color ?? DEFAULT_COLOR) === c ? 'sel' : ''}`} style={{ background: c }} disabled={!canEdit}
              onClick={() => p.onUpdate({ style: { ...item.style, color: c } })} />
          ))}
          <input type="color" disabled={!canEdit} value={item.style.color ?? DEFAULT_COLOR} onChange={(e) => p.onUpdate({ style: { ...item.style, color: e.target.value } })} />
        </div>
      </div>

      <label className="field"><span>Layer</span>
        <Select className="input" disabled={!canEdit} value={item.layerId ?? ''} onChange={(v) => p.onUpdate({ layerId: v || null })}>
          <option value="">(no layer, always shown)</option>
          {p.layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select></label>

      <label className="field"><span>Opens map (double-click)</span>
        <div className="row">
          <Select className="input" disabled={!canEdit} value={item.targetMapId ?? ''} onChange={(v) => p.onUpdate({ targetMapId: v || null })}>
            <option value="">None</option>
            {p.maps.filter((m) => m.id !== p.mapId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          {item.targetMapId && <button className="icon-btn" title="Open that map" onClick={() => nav({ type: 'map', id: item.targetMapId! })}><MapIcon size={15} /></button>}
        </div>
      </label>

      <div className="field"><span>Over time</span>
        <div className="seg">
          <button className={item.timeMode === 'static' ? 'on' : ''} disabled={!canEdit} onClick={() => setMode('static')}>Static</button>
          <button className={item.timeMode === 'timed' ? 'on' : ''} disabled={!canEdit} onClick={() => setMode('timed')}>Changes</button>
          <button className={item.timeMode === 'journey' ? 'on' : ''} disabled={!canEdit || item.kind !== 'line'}
            title={item.kind !== 'line' ? 'Only lines can be journeys' : ''} onClick={() => setMode('journey')}>Journey</button>
        </div>
        {item.kind === 'line' && <small className="muted">A line can change over time or be a journey, not both.</small>}
      </div>

      {item.timeMode === 'timed' && (
        <div className="field">
          <span>Keyframes</span>
          <small className="muted">Scrub to a date, then move or reshape the item there to record a keyframe.</small>
          {kfs.map((k) => (
            <div key={k.t} className={`kf ${k.t === T ? 'now' : ''}`}>
              <TimeCell cal={cal} value={k.t} T={T} disabled={!canEdit} onChange={(t) => t !== null && setKeyframes(item.keyframes.map((x) => (x === k ? { ...x, t } : x)))} />
              <span className="grow muted" style={{ fontSize: 12 }}>{k.hidden ? 'not there' : 'present'}</span>
              <button className="icon-btn" title="Go to this date" onClick={() => p.onJump(k.t)}><LocateFixed size={14} /></button>
              {canEdit && (
                <>
                  <button className="icon-btn" title={k.hidden ? 'Make present' : 'Make it disappear here'}
                    onClick={() => setKeyframes(item.keyframes.map((x) => (x === k ? (k.hidden ? { t: k.t, geometry: geomNow } : { t: k.t, hidden: true }) : x)))}>
                    {k.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button className="icon-btn" title="Delete keyframe" onClick={() => setKeyframes(item.keyframes.filter((x) => x !== k))}><X size={14} /></button>
                </>
              )}
            </div>
          ))}
          {canEdit && (
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn sm" onClick={() => upsert(T, { geometry: geomNow })}>Keyframe at {formatShort(cal, T)}</button>
              <button className="btn sm" onClick={() => upsert(T, { hidden: true })}>Disappears here</button>
            </div>
          )}
          {item.kind === 'point' || item.kind === 'line' ? (
            <label className="row" style={{ marginTop: 6 }}><input type="checkbox" disabled={!canEdit} checked={!!item.style.glide}
              onChange={(e) => p.onUpdate({ style: { ...item.style, glide: e.target.checked } })} /> Glide between keyframes</label>
          ) : (
            <label className="row" style={{ marginTop: 6 }}><input type="checkbox" disabled={!canEdit} checked={!!item.style.glide}
              onChange={(e) => p.onUpdate({ style: { ...item.style, glide: e.target.checked } })} /> Morph between keyframes (same vertex count)</label>
          )}
        </div>
      )}

      {journey && (
        <div className="field">
          <span>Journey</span>
          <label className="row"><small className="muted">Travelled by</small>
            <input className="input" list="journey-modes" disabled={!canEdit} value={journey.mode}
              onChange={(e) => p.onUpdate({ journey: { ...journey, mode: e.target.value } })} /></label>
          <datalist id="journey-modes">{MODES.map((m) => <option key={m} value={m} />)}</datalist>
          <small className="muted">Set times on the stops you know; points in between are spread by distance.</small>
          <div className="wp-list">
            {(item.geometry as Pt[]).map((pt, i, all) => {
              const w = journey.waypoints[i] ?? { arrive: null, depart: null }
              let leg = ''
              if (i > 0) {
                const px = dist(all[i - 1], pt)
                leg = formatDistance(px, p.scale)
                if (p.scale && jt) {
                  const days = jt.arr[i] - jt.dep[i - 1]
                  if (days > 0) leg += ` · ${formatMeters((px * p.scale) / days)}/${cal.dayLabel.toLowerCase()}`
                }
              }
              return (
                <div key={i} className="wp">
                  <div className="muted" style={{ fontSize: 12 }}>Stop {i + 1}{leg && ` · ${leg}`}</div>
                  <div className="row">
                    <small className="muted">arrive</small>
                    <TimeCell cal={cal} value={i === 0 ? null : w.arrive} T={T} nullable disabled={!canEdit || i === 0} onChange={(t) => setWp(i, { arrive: t })} />
                    <small className="muted">leave</small>
                    <TimeCell cal={cal} value={i === all.length - 1 ? null : w.depart} T={T} nullable disabled={!canEdit || i === all.length - 1} onChange={(t) => setWp(i, { depart: t })} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
