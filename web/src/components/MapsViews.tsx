import { Map as MapIcon, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import {
  DEFAULT_CALENDAR, formatDate, formatRange, fromParts, toParts, validateCalendar, yearLength, type Calendar,
} from '../lib/calendar'
import { startMapUpload } from '../lib/mapUpload'
import { useWorld } from '../lib/world'
import { confirmDialog } from '../lib/dialog'
import { useStore } from '../store'
import type { EventRow } from '../types'
import { DateField } from './DateField'
import { PagePicker } from './PagePicker'

function useWorldLoaded() {
  const wsId = useStore((s) => s.wsId)
  const loadedFor = useWorld((s) => s.wsId)
  const [err, setErr] = useState('')
  useEffect(() => { if (wsId) useWorld.getState().load(wsId).catch((e) => setErr(e.message)) }, [wsId])
  return { ready: loadedFor === wsId, err }
}

export function MapsView() {
  const { ready, err } = useWorldLoaded()
  const maps = useWorld((s) => s.maps)
  const canEdit = useStore((s) => s.user?.role) !== 'viewer'
  const nav = useStore.getState().navigate
  if (err) return <div className="view error">{err}</div>
  if (!ready) return <div className="view muted">Loadingâ€¦</div>

  const tree = (parent: string | null, depth: number): React.ReactNode =>
    maps.filter((m) => (m.parentMapId && maps.some((x) => x.id === m.parentMapId) ? m.parentMapId : null) === parent).map((m) => (
      <div key={m.id}>
        <div className="side-item map-row" style={{ paddingLeft: 10 + depth * 22 }} onClick={() => nav({ type: 'map', id: m.id })}>
          <MapIcon size={16} className="muted" />
          <span className="grow ellipsis">{m.name}</span>
          {m.status === 'processing' && <span className="chip">preparingâ€¦</span>}
          {m.status === 'error' && <span className="chip" style={{ color: 'var(--danger)' }}>failed</span>}
          {m.width && <span className="muted" style={{ fontSize: 12 }}>{m.width} Ã— {m.height}</span>}
        </div>
        {tree(m.id, depth + 1)}
      </div>
    ))

  return (
    <div className="view">
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>Maps</h1>
        {canEdit && <button className="btn primary" onClick={() => startMapUpload(null)}><Plus size={15} /> Upload map</button>}
      </div>
      {!maps.length && <p className="muted">No maps yet. Upload a PNG, JPEG, WebP or AVIF of your world. Very large images are cut into tiles, so they stay smooth to zoom.</p>}
      {tree(null, 0)}
      {maps.length > 0 && <p className="muted" style={{ fontSize: 13 }}>Maps can sit inside other maps: open a map, then use Layers â†’ â€œAdd a map inside this oneâ€.</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

function CalendarEditor({ initial, onSave, onCancel }: { initial: Calendar; onSave: (c: Calendar) => Promise<void>; onCancel: () => void }) {
  const [c, setC] = useState<Calendar>(structuredClone(initial))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const patch = (p: Partial<Calendar>) => setC({ ...c, ...p })

  const setLevels = (levels: 0 | 1 | 2) => {
    if (levels === c.levels) return
    let units = c.units
    let level1Label = c.level1Label
    let level2Label = c.level2Label
    if (levels === 1 && c.levels === 2) {
      // flatten: the lower level (e.g. months) becomes the only level
      units = c.units.flatMap((u) => (u.children ?? []).map((ch) => ({ name: ch.name, days: ch.days })))
      level1Label = c.level2Label || 'Month'
    } else if (levels === 2 && c.levels === 1) {
      // wrap the existing units (months) in one upper-level unit (season)
      units = [{ name: 'Season 1', children: c.units.map((u) => ({ name: u.name, days: u.days ?? 30 })) }]
      level2Label = c.level1Label || 'Month'
      level1Label = 'Season'
    } else if (levels === 0) units = []
    if (levels > 0 && !units.length) units = levels === 1 ? [{ name: 'Month 1', days: 30 }] : [{ name: 'Season 1', children: [{ name: 'Month 1', days: 30 }] }]
    setC({ ...c, levels, units, level1Label: level1Label || (levels === 2 ? 'Season' : 'Month'), level2Label: level2Label || 'Month' })
  }
  const setUnit = (i: number, u: Partial<Calendar['units'][0]>) => patch({ units: c.units.map((x, k) => (k === i ? { ...x, ...u } : x)) })
  const total = yearLength(c)

  return (
    <div className="cal-editor">
      <div className="grid2">
        <label className="field"><span>Name of the largest unit</span><input className="input" value={c.yearLabel} onChange={(e) => patch({ yearLabel: e.target.value })} /></label>
        <label className="field"><span>First year is numbered</span><input className="input" type="number" value={c.startYear} onChange={(e) => patch({ startYear: Number(e.target.value) || 0 })} /></label>
        <label className="field"><span>Name of a single day</span><input className="input" value={c.dayLabel} onChange={(e) => patch({ dayLabel: e.target.value })} /></label>
        <div className="field"><span>Levels between {c.yearLabel || 'year'} and {c.dayLabel || 'day'}</span>
          <div className="seg">
            {([0, 1, 2] as const).map((n) => <button key={n} className={c.levels === n ? 'on' : ''} onClick={() => setLevels(n)}>{n}</button>)}
          </div>
        </div>
      </div>

      {c.levels === 0 && (
        <label className="field"><span>Days per {c.yearLabel}</span><input className="input" type="number" min={1} value={c.yearDays} onChange={(e) => patch({ yearDays: Number(e.target.value) || 1 })} /></label>
      )}

      {c.levels >= 1 && (
        <>
          <div className="grid2">
            <label className="field"><span>{c.levels === 2 ? 'Upper' : 'Sub'}-level is called</span>
              <input className="input" value={c.level1Label} onChange={(e) => patch({ level1Label: e.target.value })} /></label>
            {c.levels === 2 && <label className="field"><span>Lower level is called</span>
              <input className="input" value={c.level2Label} onChange={(e) => patch({ level2Label: e.target.value })} /></label>}
          </div>
          <div className="units">
            {c.units.map((u, i) => (
              <div key={i} className="unit">
                <div className="row">
                  <input className="input grow" value={u.name} placeholder={`${c.level1Label} name`} onChange={(e) => setUnit(i, { name: e.target.value })} />
                  {c.levels === 1 && <><input className="input days" type="number" min={1} value={u.days ?? 1} onChange={(e) => setUnit(i, { days: Number(e.target.value) || 1 })} /><small className="muted">days</small></>}
                  <button className="icon-btn" disabled={c.units.length < 2} onClick={() => patch({ units: c.units.filter((_, k) => k !== i) })}><X size={14} /></button>
                </div>
                {c.levels === 2 && (
                  <div className="children">
                    {(u.children ?? []).map((ch, j) => (
                      <div key={j} className="row">
                        <input className="input grow" value={ch.name} placeholder={`${c.level2Label} name`}
                          onChange={(e) => setUnit(i, { children: u.children!.map((x, k) => (k === j ? { ...x, name: e.target.value } : x)) })} />
                        <input className="input days" type="number" min={1} value={ch.days}
                          onChange={(e) => setUnit(i, { children: u.children!.map((x, k) => (k === j ? { ...x, days: Number(e.target.value) || 1 } : x)) })} />
                        <small className="muted">days</small>
                        <button className="icon-btn" disabled={(u.children?.length ?? 0) < 2} onClick={() => setUnit(i, { children: u.children!.filter((_, k) => k !== j) })}><X size={14} /></button>
                      </div>
                    ))}
                    <button className="btn sm" onClick={() => setUnit(i, { children: [...(u.children ?? []), { name: `${c.level2Label} ${(u.children?.length ?? 0) + 1}`, days: 30 }] })}><Plus size={13} /> {c.level2Label || 'Sub-unit'}</button>
                  </div>
                )}
              </div>
            ))}
            <button className="btn sm" onClick={() => patch({
              units: [...c.units, c.levels === 1 ? { name: `${c.level1Label} ${c.units.length + 1}`, days: 30 } : { name: `${c.level1Label} ${c.units.length + 1}`, children: [{ name: `${c.level2Label} 1`, days: 30 }] }],
            })}><Plus size={13} /> Add {c.level1Label || 'unit'}</button>
          </div>
        </>
      )}

      <p className="muted">One {c.yearLabel.toLowerCase()} has {total} {c.dayLabel.toLowerCase()}s. Example: <b>{formatDate(c, fromParts(c, { year: c.startYear + 3, l1: 0, l2: 0, day: 5 }))}</b></p>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={async () => {
          const bad = validateCalendar(c)
          if (bad) return setErr(bad)
          setBusy(true)
          try { await onSave(c) } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
        }}>Save calendar</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn ghost" onClick={() => setC(structuredClone(DEFAULT_CALENDAR))}>Reset to 12 Ã— 30</button>
      </div>
      <small className="muted">Changing the calendar keeps every date as a day count, so existing events stay in place but may read differently.</small>
    </div>
  )
}

export function TimelineView() {
  const { ready, err } = useWorldLoaded()
  const { calendar: cal, events, maps, customCalendar } = useWorld()
  const pages = useStore((s) => s.data.pages)
  const wsId = useStore((s) => s.wsId)!
  const canEdit = useStore((s) => s.user?.role) !== 'viewer'
  const nav = useStore.getState().navigate
  const [editCal, setEditCal] = useState(false)
  const [draft, setDraft] = useState<{ id?: string; title: string; pageId: string | null; t: number; end: number | null } | null>(null)
  const [q, setQ] = useState('')

  const pageOf = (id: string | null) => (id ? pages.find((p) => p.id === id) : undefined)
  const [onMaps, setOnMaps] = useState<Record<string, { mapId: string; mapName: string }>>({})
  useEffect(() => {
    // which pages are pinned somewhere, so an event can offer "show on map"
    let alive = true
    const ids = [...new Set(events.map((e) => e.pageId).filter(Boolean))] as string[]
    Promise.all(ids.map((id) => api.pagePins(id).then((r) => [id, r[0]] as const).catch(() => [id, undefined] as const))).then((rows) => {
      if (alive) setOnMaps(Object.fromEntries(rows.filter(([, v]) => v).map(([k, v]) => [k, { mapId: v!.mapId, mapName: v!.mapName }])))
    })
    return () => { alive = false }
  }, [events])

  const shown = useMemo(() => {
    const lower = q.trim().toLowerCase()
    return events.filter((e) => !lower || e.title.toLowerCase().includes(lower) || (pageOf(e.pageId)?.title ?? '').toLowerCase().includes(lower))
  }, [events, q, pages])
  const byYear = useMemo(() => {
    const m = new Map<number, EventRow[]>()
    for (const e of shown) { const y = toParts(cal, e.tStart).year; (m.get(y) ?? m.set(y, []).get(y)!).push(e) }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [shown, cal])

  if (err) return <div className="view error">{err}</div>
  if (!ready) return <div className="view muted">Loadingâ€¦</div>

  return (
    <div className="view">
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>Timeline</h1>
        {canEdit && <button className="btn" onClick={() => setEditCal(!editCal)}>{customCalendar ? 'Edit calendar' : 'Set up your calendar'}</button>}
        {canEdit && <button className="btn primary" onClick={() => setDraft({ title: '', pageId: null, end: null, t: fromParts(cal, { year: cal.startYear, l1: 0, l2: 0, day: 1 }) })}><Plus size={15} /> Event</button>}
      </div>

      {editCal && <CalendarEditor initial={cal} onCancel={() => setEditCal(false)} onSave={async (c) => { await useWorld.getState().setCalendar(c); setEditCal(false) }} />}
      {!customCalendar && !editCal && <p className="muted">Using a plain 12 Ã— 30 day calendar. Set up your own (seasons, month names, days per month) before you add many events; dates are stored as day counts, so they survive later changes.</p>}

      {draft && (
        <div className="event-draft">
          <input className="input" autoFocus placeholder="What happened?" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <DateField cal={cal} value={draft.t} onChange={(t) => setDraft({ ...draft, t, end: draft.end !== null && draft.end < t ? t : draft.end })} />
          <label className="row"><input type="checkbox" checked={draft.end !== null} onChange={(e) => setDraft({ ...draft, end: e.target.checked ? draft.t : null })} /> Lasts until a later date</label>
          {draft.end !== null && <DateField cal={cal} value={draft.end} onChange={(end) => setDraft({ ...draft, end: Math.max(end, draft.t) })} />}
          <div className="field"><span>Page (optional)</span>
            {draft.pageId ? <div className="row"><span className="chip">{pageOf(draft.pageId)?.title}</span><button className="btn sm" onClick={() => setDraft({ ...draft, pageId: null })}>Clear</button></div>
              : <PagePicker placeholder="Attach to a pageâ€¦" onPick={(p) => setDraft({ ...draft, pageId: p.id, title: draft.title || p.title })} />}
          </div>
          <div className="row">
            <button className="btn primary" disabled={!draft.title.trim()} onClick={async () => {
              const body = { title: draft.title.trim(), pageId: draft.pageId, tStart: draft.t, tEnd: draft.end }
              if (draft.id) await api.patchEvent(draft.id, body); else await api.createEvent(wsId, body)
              await useWorld.getState().reloadEvents()
              setDraft(null)
            }}>{draft.id ? 'Save event' : 'Add event'}</button>
            <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}

      <input className="input" placeholder="Filter eventsâ€¦" value={q} onChange={(e) => setQ(e.target.value)} style={{ margin: '8px 0 16px' }} />
      {!events.length && <p className="muted">No events yet. Add one here, or type <kbd>/teven</kbd> on any page to give it a date.</p>}

      {byYear.map(([year, list]) => (
        <section key={year} className="tl-year">
          <h3>{cal.yearLabel} {year}</h3>
          {list.map((e) => {
            const pg = pageOf(e.pageId)
            const pin = e.pageId ? onMaps[e.pageId] : undefined
            return (
              <div key={e.id} className="tl-event">
                <div className="tl-date">{formatRange(cal, e.tStart, e.tEnd)}</div>
                <div className="grow">
                  <b>{e.title}</b>
                  {pg && <> Â· <a data-page-id={pg.id} onClick={() => nav({ type: 'page', id: pg.id })}>{pg.title || 'Untitled'}</a></>}
                  {pin && <> Â· <a title={pin.mapName} onClick={() => { localStorage.setItem(`mapT:${pin.mapId}`, String(e.tStart)); localStorage.setItem(`mapTimeOn:${pin.mapId}`, '1'); nav({ type: 'map', id: pin.mapId }) }}>on map â€œ{pin.mapName}â€</a></>}
                </div>
                {canEdit && <button className="icon-btn" title="Edit" onClick={() => { setDraft({ id: e.id, title: e.title, pageId: e.pageId, t: e.tStart, end: e.tEnd }); window.scrollTo?.(0, 0); document.querySelector('.view')?.scrollTo?.(0, 0) }}><Pencil size={14} /></button>}
                {canEdit && <button className="icon-btn" title="Delete" onClick={async () => { if (await confirmDialog('Delete this event?', { okLabel: 'Delete', danger: true })) { await api.deleteEvent(e.id); useWorld.getState().reloadEvents() } }}><Trash2 size={14} /></button>}
              </div>
            )
          })}
        </section>
      ))}
      {maps.length === 0 && events.length > 0 && <p className="muted" style={{ fontSize: 13 }}>Events attached to a page that is pinned on a map get a â€œshow on mapâ€ link.</p>}
    </div>
  )
}
