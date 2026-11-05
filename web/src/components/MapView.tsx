import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  ChevronRight, Hexagon, Layers as LayersIcon, MapPin, MousePointer2, Plus, Route, Ruler, Settings2, Trash2, Eye, EyeOff, Clock,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { itemTimes, itemStateAt, journeyAt, journeyTimes, niceNumber, pathLength, formatDistance, formatMeters, isPoint } from '../lib/mapTime'
import { alertDialog, askText, confirmDialog } from '../lib/dialog'
import { startMapUpload } from '../lib/mapUpload'
import { useWorld } from '../lib/world'
import { useStore } from '../store'
import type { Geometry, MapFull, MapItem, Pt } from '../types'
import { DEFAULT_COLOR, MapInspector } from './MapInspector'
import { TimeBar, type TimeTick } from './TimeBar'
import { Select } from './Select'

type Tool = 'select' | 'point' | 'line' | 'polygon' | 'measure'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const MIN_VERTS = { line: 2, polygon: 3 }

export function MapView({ id, itemId, place }: { id: string; itemId?: string; place?: string }) {
  const [full, setFull] = useState<MapFull | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setFull(await api.map(id)); setError('') } catch (e: any) { setError(e.status === 404 ? 'This map no longer exists.' : e.message) }
  }, [id])
  useEffect(() => { setFull(null); load() }, [load])
  useEffect(() => {
    if (full?.status !== 'processing') return
    const t = setInterval(load, 1500)
    return () => clearInterval(t)
  }, [full?.status, load])

  if (error) return <div className="view muted">{error}</div>
  if (!full) return <div className="view muted">Loading…</div>
  if (full.status === 'processing') {
    return <div className="view"><h1>{full.name}</h1><p className="muted">Preparing map tiles… Very large images can take a few minutes. This page updates by itself.</p></div>
  }
  if (full.status === 'error') {
    return <div className="view"><h1>{full.name}</h1><p className="error">Could not process this image: {full.error}</p>
      <button className="btn danger" onClick={async () => { await api.deleteMap(id); await useWorld.getState().reloadMaps(); useStore.getState().navigate({ type: 'maps' }) }}>Delete this map</button></div>
  }
  return <MapCanvas key={full.id} full={full} setFull={setFull} reload={load} focusItem={itemId} place={place} />
}

function MapCanvas({ full, setFull, reload, focusItem, place }: {
  full: MapFull; setFull: React.Dispatch<React.SetStateAction<MapFull | null>>; reload: () => void; focusItem?: string; place?: string
}) {
  const user = useStore((s) => s.user)!
  const pages = useStore((s) => s.data.pages)
  const nav = useStore.getState().navigate
  const { maps, calendar: cal, events } = useWorld()
  const canEdit = user.role !== 'viewer'
  const maxZoom = full.maxZoom ?? 0

  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const groupRef = useRef<L.LayerGroup | null>(null)
  const handlesRef = useRef<L.LayerGroup | null>(null)
  const draftRef = useRef<L.LayerGroup | null>(null)
  const itemLayers = useRef(new Map<string, L.Layer>())

  const [tool, setTool] = useState<Tool>('select')
  const [selected, setSelected] = useState<string | null>(null)
  const [activeLayer, setActiveLayer] = useState<string | null>(full.layers[0]?.id ?? null)
  const [draft, setDraft] = useState<Pt[]>([])
  const [zoom, setZoom] = useState(0)
  const [showLayers, setShowLayers] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [pendingPage, setPendingPage] = useState<string | null>(place ?? null)
  const [timeOn, setTimeOn] = useState(() => localStorage.getItem(`mapTimeOn:${full.id}`) !== '0')
  const [T, setT] = useState(() => Number(localStorage.getItem(`mapT:${full.id}`) ?? 0) || 0)

  useEffect(() => { localStorage.setItem(`mapT:${full.id}`, String(T)) }, [T, full.id])
  useEffect(() => { localStorage.setItem(`mapTimeOn:${full.id}`, timeOn ? '1' : '0') }, [timeOn, full.id])

  const toolRef = useRef(tool); toolRef.current = tool
  const draftPts = useRef<Pt[]>([]); draftPts.current = draft
  const pendingPageRef = useRef(pendingPage); pendingPageRef.current = pendingPage
  const scale = full.scale

  const selectedItem = full.items.find((i) => i.id === selected) ?? null
  const pageTitle = useCallback((pid: string | null) => (pid ? pages.find((p) => p.id === pid)?.title || '' : ''), [pages])
  const labelOf = (i: MapItem) => i.title || pageTitle(i.pageId)

  // ---------- saving ----------
  const pending = useRef(new Map<string, { patch: Record<string, any>; timer: number }>())
  const flushItem = useCallback(async (itemId: string) => {
    const p = pending.current.get(itemId)
    if (!p) return
    pending.current.delete(itemId)
    clearTimeout(p.timer)
    try { await api.patchItem(itemId, p.patch) } catch (e: any) { alertDialog(e.message ?? 'Could not save'); reload() }
  }, [reload])
  const updateItem = useCallback((itemId: string, patch: Partial<MapItem>) => {
    setFull((f) => f && { ...f, items: f.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) })
    const cur = pending.current.get(itemId)
    if (cur) clearTimeout(cur.timer)
    const merged = { ...(cur?.patch ?? {}), ...patch }
    pending.current.set(itemId, { patch: merged, timer: window.setTimeout(() => flushItem(itemId), 350) })
  }, [flushItem, setFull])
  useEffect(() => () => { for (const k of [...pending.current.keys()]) flushItem(k) }, [flushItem])

  // Timed items record a keyframe at T when moved; journeys keep waypoints in step with their vertices.
  const commitGeometry = useCallback((item: MapItem, geom: Geometry, op?: { insert?: number; remove?: number }) => {
    if (item.timeMode === 'timed') {
      updateItem(item.id, { keyframes: [...item.keyframes.filter((k) => k.t !== T), { t: T, geometry: geom }].sort((a, b) => a.t - b.t) })
    } else if (item.timeMode === 'journey' && item.journey && !isPoint(geom)) {
      const wps = (item.geometry as Pt[]).map((_, k) => item.journey!.waypoints[k] ?? { arrive: null, depart: null })
      if (op?.insert !== undefined) wps.splice(op.insert, 0, { arrive: null, depart: null })
      if (op?.remove !== undefined) wps.splice(op.remove, 1)
      updateItem(item.id, { geometry: geom, journey: { ...item.journey, waypoints: wps } })
    } else updateItem(item.id, { geometry: geom })
  }, [T, updateItem])

  // ---------- map setup ----------
  const toLL = useCallback((p: Pt) => mapRef.current!.unproject(L.point(p[0], p[1]), maxZoom), [maxZoom])
  const fromLL = useCallback((ll: L.LatLng): Pt => {
    const p = mapRef.current!.project(ll, maxZoom)
    return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]
  }, [maxZoom])

  const handleClickRef = useRef<(ll: L.LatLng) => void>(() => {})
  const handleMoveRef = useRef<(ll: L.LatLng) => void>(() => {})
  const finishRef = useRef<() => void>(() => {})

  useEffect(() => {
    const map = L.map(el.current!, {
      crs: L.CRS.Simple, minZoom: -2, maxZoom: maxZoom + 3, zoomControl: true, attributionControl: false, zoomSnap: 0.5, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
    })
    mapRef.current = map
    const sw = map.unproject([0, full.height!], maxZoom)
    const ne = map.unproject([full.width!, 0], maxZoom)
    const bounds = L.latLngBounds(sw, ne)
    L.tileLayer(`/api/maps/${full.id}/t/{z}/{y}/{x}.webp`, {
      tileSize: 256, minNativeZoom: 0, maxNativeZoom: maxZoom, minZoom: -2, maxZoom: maxZoom + 3, noWrap: true, bounds, keepBuffer: 4, updateWhenIdle: false,
    }).addTo(map)
    map.fitBounds(bounds, { animate: false })
    map.setMinZoom(map.getZoom() - 1)
    map.setMaxBounds(bounds.pad(0.4))
    groupRef.current = L.layerGroup().addTo(map)
    handlesRef.current = L.layerGroup().addTo(map)
    draftRef.current = L.layerGroup().addTo(map)
    setZoom(map.getZoom())
    map.on('zoom', () => setZoom(map.getZoom()))
    map.on('click', (e: L.LeafletMouseEvent) => handleClickRef.current(e.latlng))
    map.on('mousemove', (e: L.LeafletMouseEvent) => handleMoveRef.current(e.latlng))
    map.on('dblclick', () => { if (['line', 'polygon'].includes(toolRef.current)) finishRef.current() })
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el.current!)
    return () => { ro.disconnect(); map.remove(); mapRef.current = null }
  }, [full.id])

  // ---------- items ----------
  useEffect(() => {
    const map = mapRef.current, group = groupRef.current
    if (!map || !group) return
    group.clearLayers()
    itemLayers.current.clear()
    const shownLayers = new Set(full.layers.filter((l) => l.visible).map((l) => l.id))
    const Tn = timeOn ? T : null
    const bind = (layer: L.Layer, item: MapItem) => {
      layer.on('click', (e: any) => {
        if (toolRef.current !== 'select') return handleClickRef.current(e.latlng)
        setSelected(item.id)
      })
      layer.on('dblclick', (e: any) => {
        L.DomEvent.stop(e)
        if (toolRef.current !== 'select') return
        if (item.targetMapId) nav({ type: 'map', id: item.targetMapId })
        else if (item.pageId) nav({ type: 'page', id: item.pageId })
      })
    }
    const tag = (layer: any, item: MapItem) => {
      const e: Element | undefined = layer.getElement?.()
      if (e && item.pageId) e.setAttribute('data-page-id', item.pageId)
    }

    for (const item of full.items) {
      if (item.layerId && !shownLayers.has(item.layerId)) continue
      const color = item.style.color ?? DEFAULT_COLOR
      const sel = item.id === selected
      const label = labelOf(item)
      const st = itemStateAt(item, Tn)
      if (!st.visible) continue

      if (item.kind === 'point') {
        const ll = toLL(st.geometry as Pt)
        const html = `<div class="map-dot ${sel ? 'sel' : ''} ${item.targetMapId ? 'portal' : ''}" style="--c:${esc(color)}"><i></i>${label ? `<span>${esc(label)}</span>` : ''}</div>`
        const m = L.marker(ll, {
          icon: L.divIcon({ className: 'map-marker', html, iconSize: [18, 18], iconAnchor: [9, 9] }),
          draggable: sel && canEdit && toolRef.current === 'select', bubblingMouseEvents: false, riseOnHover: true,
        })
        m.on('dragend', () => commitGeometry(item, fromLL(m.getLatLng())))
        bind(m, item)
        m.addTo(group)
        tag(m, item)
        itemLayers.current.set(item.id, m)
        continue
      }

      const geom = st.geometry as Pt[]
      const lls = geom.map(toLL)
      const common = { color, bubblingMouseEvents: false, interactive: true }

      if (item.kind === 'polygon') {
        const poly = L.polygon(lls, { ...common, weight: sel ? 3.5 : 2, fillOpacity: sel ? 0.3 : 0.18, fillColor: color })
        bind(poly, item)
        poly.addTo(group)
        tag(poly, item)
        if (label) poly.bindTooltip(esc(label), { sticky: true, direction: 'top', opacity: 0.95 })
        itemLayers.current.set(item.id, poly)
        continue
      }

      const times = item.timeMode === 'journey' && item.journey ? journeyTimes(item.geometry as Pt[], item.journey.waypoints) : null
      if (times && Tn !== null) {
        const pos = journeyAt(item.geometry as Pt[], times, Tn)
        const planned = L.polyline(lls, { ...common, weight: sel ? 4 : 3, dashArray: '2 8', opacity: 0.55, lineCap: 'round' })
        const done = L.polyline(pos.travelled.map(toLL), { ...common, weight: sel ? 5 : 4, interactive: false })
        const hit = L.polyline(lls, { color, weight: 16, opacity: 0, bubblingMouseEvents: false })
        planned.addTo(group); done.addTo(group); hit.addTo(group)
        bind(hit, item)
        tag(hit, item)
        if (pos.started) {
          const dot = L.marker(toLL(pos.pos), {
            icon: L.divIcon({ className: 'map-marker', html: `<div class="map-party" style="--c:${esc(color)}"><i></i></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }),
            interactive: false,
          })
          dot.addTo(group)
        }
        if (label) hit.bindTooltip(esc(label), { sticky: true, direction: 'top', opacity: 0.95 })
        itemLayers.current.set(item.id, planned)
      } else {
        const line = L.polyline(lls, { ...common, weight: sel ? 5 : 3.5, lineCap: 'round' })
        const hit = L.polyline(lls, { color, weight: 16, opacity: 0, bubblingMouseEvents: false })
        line.addTo(group); hit.addTo(group)
        bind(hit, item)
        tag(hit, item)
        if (label) hit.bindTooltip(esc(label), { sticky: true, direction: 'top', opacity: 0.95 })
        itemLayers.current.set(item.id, line)
      }
    }
  }, [full.items, full.layers, selected, T, timeOn, canEdit, pages, tool])

  // ---------- vertex handles for the selected line / polygon ----------
  useEffect(() => {
    const handles = handlesRef.current
    if (!handles) return
    handles.clearLayers()
    if (!selectedItem || !canEdit || tool !== 'select' || selectedItem.kind === 'point') return
    if (selectedItem.timeMode === 'journey' && !selectedItem.journey) return
    const st = itemStateAt(selectedItem, timeOn ? T : null)
    if (!st.visible) return
    const geom = st.geometry as Pt[]
    const kind = selectedItem.kind as 'line' | 'polygon'
    const layer = itemLayers.current.get(selectedItem.id) as L.Polyline | undefined
    const markers: L.Marker[] = []
    const live = () => {
      const lls = markers.map((m) => m.getLatLng())
      layer?.setLatLngs(lls)
    }
    geom.forEach((pt, i) => {
      const m = L.marker(toLL(pt), {
        icon: L.divIcon({ className: 'vh', iconSize: [12, 12], iconAnchor: [6, 6] }), draggable: true, bubblingMouseEvents: false, zIndexOffset: 1000,
      })
      m.on('drag', live)
      m.on('dragend', () => commitGeometry(selectedItem, markers.map((x) => fromLL(x.getLatLng()))))
      m.on('dblclick', () => {
        if (geom.length <= MIN_VERTS[kind]) return
        commitGeometry(selectedItem, geom.filter((_, k) => k !== i), { remove: i })
      })
      m.bindTooltip('Drag to move · double-click to remove', { direction: 'top', offset: [0, -6], opacity: 0.9 })
      m.addTo(handles)
      markers.push(m)
    })
    const segs = kind === 'polygon' ? geom.length : geom.length - 1
    for (let i = 0; i < segs; i++) {
      const a = geom[i], b = geom[(i + 1) % geom.length]
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const m = L.marker(toLL(mid), {
        icon: L.divIcon({ className: 'vh mid', iconSize: [10, 10], iconAnchor: [5, 5] }), bubblingMouseEvents: false, zIndexOffset: 900,
      })
      m.on('click', () => commitGeometry(selectedItem, [...geom.slice(0, i + 1), mid, ...geom.slice(i + 1)], { insert: i + 1 }))
      m.bindTooltip('Click to add a point', { direction: 'top', offset: [0, -6], opacity: 0.9 })
      m.addTo(handles)
    }
  }, [selectedItem, T, timeOn, canEdit, tool, commitGeometry, toLL, fromLL])

  // ---------- drawing + measuring ----------
  const measuring = tool === 'measure'
  const drawing = tool === 'line' || tool === 'polygon'

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (drawing || measuring) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable()
    map.getContainer().style.cursor = tool === 'select' ? '' : 'crosshair'
  }, [tool, drawing, measuring])

  const cursorRef = useRef<L.LatLng | null>(null)
  const paintDraft = useCallback((pts: Pt[]) => {
    const g = draftRef.current
    if (!g || !mapRef.current) return
    g.clearLayers()
    if (!pts.length) return
    const lls = pts.map(toLL)
    const color = measuring ? '#2e5fa3' : DEFAULT_COLOR
    const opts = { color, weight: 3, dashArray: measuring ? '6 6' : undefined, interactive: false }
    if (cursorRef.current && !measuring) L.polyline([...lls, cursorRef.current], { ...opts, opacity: 0.6, dashArray: '4 6' }).addTo(g)
    else if (cursorRef.current) L.polyline([lls[lls.length - 1], cursorRef.current], { ...opts, opacity: 0.5 }).addTo(g)
    if (tool === 'polygon' && lls.length >= 3) L.polygon(lls, { ...opts, fillOpacity: 0.12, dashArray: undefined }).addTo(g)
    else L.polyline(lls, opts).addTo(g)
    lls.forEach((ll) => L.circleMarker(ll, { radius: 4, color, fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(g))
  }, [toLL, tool, measuring])
  useEffect(() => { paintDraft(draft) }, [draft, paintDraft])
  useEffect(() => { setDraft([]); cursorRef.current = null }, [tool])

  const createItem = useCallback(async (kind: MapItem['kind'], geometry: Geometry, extra: Partial<MapItem> = {}) => {
    try {
      const item = await api.createItem(full.id, {
        kind, geometry, layerId: activeLayer, style: { color: DEFAULT_COLOR }, ...extra,
      })
      setFull((f) => f && { ...f, items: [...f.items, item] })
      setSelected(item.id)
      setTool('select')
      return item
    } catch (e: any) { alertDialog(e.message ?? 'Could not create item') }
  }, [full.id, activeLayer, setFull])

  handleClickRef.current = (ll) => {
    const p = fromLL(ll)
    const t = toolRef.current
    if (t === 'select') { setSelected(null); return }
    if (t === 'point') {
      const pid = pendingPageRef.current
      createItem('point', p, pid ? { pageId: pid, title: '' } : {})
      if (pid) { setPendingPage(null); nav({ type: 'map', id: full.id }) }
      return
    }
    setDraft((d) => [...d, p])
  }
  handleMoveRef.current = (ll) => {
    if (!drawing && !measuring) return
    cursorRef.current = ll
    if (draftPts.current.length) paintDraft(draftPts.current)
  }
  const finishDraw = () => {
    const kind = toolRef.current
    if (kind !== 'line' && kind !== 'polygon') return
    let pts = draftPts.current
    // the double-click that finishes also fired two single clicks on the same spot
    if (pts.length >= 2 && pts[pts.length - 1][0] === pts[pts.length - 2][0] && pts[pts.length - 1][1] === pts[pts.length - 2][1]) pts = pts.slice(0, -1)
    if (pts.length < MIN_VERTS[kind]) return
    createItem(kind, pts)
  }
  finishRef.current = finishDraw

  const measureLen = useMemo(() => pathLength(draft), [draft])

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') {
        if (draftPts.current.length) setDraft([])
        else if (toolRef.current !== 'select') setTool('select')
        else setSelected(null)
        setPendingPage(null)
      } else if (e.key === 'Enter') finishRef.current()
      else if (e.key === 'Backspace' && draftPts.current.length) { e.preventDefault(); setDraft((d) => d.slice(0, -1)) }
      else if (e.key === 'Delete' && selected && canEdit) deleteSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const deleteSelected = async () => {
    if (!selectedItem) return
    if (!(await confirmDialog(`Delete this ${selectedItem.kind === 'point' ? 'marker' : selectedItem.kind === 'line' ? 'line' : 'region'}?`, { okLabel: 'Delete', danger: true }))) return
    await api.deleteItem(selectedItem.id).catch((e) => alertDialog(e.message))
    setFull((f) => f && { ...f, items: f.items.filter((i) => i.id !== selectedItem.id) })
    setSelected(null)
  }

  // ---------- focus an item from a link, place a pinned page ----------
  useEffect(() => {
    const map = mapRef.current
    const item = focusItem ? full.items.find((i) => i.id === focusItem) : null
    if (!map || !item) return
    setSelected(item.id)
    const g = itemStateAt(item, null).geometry
    if (isPoint(g)) map.setView(toLL(g), Math.max(map.getZoom(), maxZoom - 1), { animate: false })
    else map.fitBounds(L.latLngBounds(g.map(toLL)).pad(0.6), { animate: false })
  }, [focusItem])
  useEffect(() => { if (place && canEdit) setTool('point') }, [place, canEdit])
  useEffect(() => { if (selectedItem?.timeMode === 'timed' && !timeOn) setTimeOn(true) }, [selectedItem?.id, selectedItem?.timeMode])

  // ---------- derived UI ----------
  const parentChain = useMemo(() => {
    const chain: typeof maps = []
    let cur = maps.find((m) => m.id === full.id)?.parentMapId ?? full.parentMapId
    for (let n = 0; cur && n < 20; n++) {
      const m = maps.find((x) => x.id === cur)
      if (!m) break
      chain.unshift(m)
      cur = m.parentMapId
    }
    return chain
  }, [maps, full.id, full.parentMapId])
  const children = maps.filter((m) => m.parentMapId === full.id)

  const ticks = useMemo<TimeTick[]>(() => {
    const out: TimeTick[] = []
    const onMap = new Set<string>()
    for (const it of full.items) {
      if (it.pageId) onMap.add(it.pageId)
      const lbl = it.title || pageTitle(it.pageId) || (it.kind === 'point' ? 'Marker' : it.kind === 'line' ? 'Line' : 'Region')
      for (const t of itemTimes(it)) out.push({ t, label: lbl, kind: 'item' })
    }
    for (const ev of events) if (ev.pageId && onMap.has(ev.pageId)) out.push({ t: ev.tStart, label: ev.title, kind: 'event' })
    return out
  }, [full.items, events, pageTitle])

  const mpp = scale ? scale / 2 ** (zoom - maxZoom) : null
  const bar = useMemo(() => {
    if (!mpp) return null
    const m = niceNumber(mpp * 110)
    return { px: m / mpp, label: formatMeters(m) }
  }, [mpp])

  const calibrate = async () => {
    if (measureLen <= 0) return
    const km = Number((await askText('Set map scale', { label: `This line is ${Math.round(measureLen)} px long. How long is it in kilometres?`, okLabel: 'Set scale' }))?.replace(',', '.'))
    if (!km || km <= 0) return
    const s = (km * 1000) / measureLen
    api.patchMap(full.id, { scale: s }).then(() => { setFull((f) => f && { ...f, scale: s }); useWorld.getState().reloadMaps() })
  }

  const toolBtn = (t: Tool, icon: React.ReactNode, label: string, edit = true) =>
    (!edit || canEdit) && (
      <button className={`btn sm tool ${tool === t ? 'on' : ''}`} title={label} onClick={() => { setTool(tool === t ? 'select' : t); setPendingPage(null) }}>{icon}<span>{label}</span></button>
    )

  return (
    <div className="mapview">
      <div className="map-top">
        <div className="crumbs">
          <a onClick={() => nav({ type: 'maps' })}>Maps</a>
          {parentChain.map((m) => <span key={m.id} className="row" style={{ gap: 4 }}><ChevronRight size={13} /><a onClick={() => nav({ type: 'map', id: m.id })}>{m.name}</a></span>)}
          <ChevronRight size={13} /><b>{full.name}</b>
        </div>
        <div className="grow" />
        {toolBtn('select', <MousePointer2 size={15} />, 'Select', false)}
        {toolBtn('point', <MapPin size={15} />, 'Marker')}
        {toolBtn('line', <Route size={15} />, 'Line')}
        {toolBtn('polygon', <Hexagon size={15} />, 'Region')}
        {toolBtn('measure', <Ruler size={15} />, 'Measure', false)}
        <button className={`btn sm tool ${showLayers ? 'on' : ''}`} onClick={() => setShowLayers(!showLayers)}><LayersIcon size={15} /><span>Layers</span></button>
        <button className={`btn sm tool ${timeOn ? 'on' : ''}`} title="Show the time bar" onClick={() => setTimeOn(!timeOn)}><Clock size={15} /><span>Time</span></button>
        {canEdit && <button className="icon-btn" title="Map settings" onClick={() => setShowSettings(!showSettings)}><Settings2 size={16} /></button>}
      </div>

      <div className="map-main">
        <div className="map-canvas" ref={el} />
        {(drawing || pendingPage) && (
          <div className="map-hint">
            {pendingPage ? <>Click where <b>{pageTitle(pendingPage) || 'this page'}</b> is on the map. Esc to cancel.</>
              : <>Click to add points. <b>Double-click</b> or <b>Enter</b> to finish · Backspace undoes · Esc cancels.
                {draft.length >= MIN_VERTS[tool as 'line' | 'polygon'] && <button className="btn sm primary" onClick={finishDraw}>Finish</button>}</>}
          </div>
        )}
        {measuring && (
          <div className="map-hint">
            <b>{draft.length ? formatDistance(measureLen, scale) : 'Click to start measuring'}</b>
            {draft.length > 1 && !scale && canEdit && <button className="btn sm" onClick={calibrate}>Use as scale…</button>}
            {draft.length > 0 && <button className="btn sm" onClick={() => setDraft([])}>Clear</button>}
            {!scale && <span className="muted"> · no scale set yet</span>}
          </div>
        )}
        <div className="map-scale">
          {bar ? <div><div className="bar" style={{ width: bar.px }} /><span>{bar.label}</span></div>
            : canEdit ? <button className="btn sm" onClick={() => setTool('measure')}>Set scale: measure a known distance</button> : null}
        </div>

        {showLayers && (
          <div className="map-panel layers">
            <b>Layers</b>
            {full.layers.map((l) => (
              <div key={l.id} className="row layer-row">
                <button className="icon-btn" onClick={() => { setFull((f) => f && { ...f, layers: f.layers.map((x) => (x.id === l.id ? { ...x, visible: !x.visible } : x)) }); api.patchLayer(l.id, { visible: !l.visible }) }}>
                  {l.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <span className={`grow ellipsis ${activeLayer === l.id ? 'active-layer' : ''}`} onClick={() => setActiveLayer(l.id)} title="New items go to the highlighted layer">{l.name}</span>
                {canEdit && (
                  <>
                    <button className="icon-btn" title="Rename" onClick={async () => { const n = await askText('Rename layer', { label: 'Layer name', initial: l.name, okLabel: 'Rename' }); if (n?.trim()) { await api.patchLayer(l.id, { name: n.trim() }); reload() } }}><Settings2 size={13} /></button>
                    <button className="icon-btn" title="Delete layer (its items stay, unassigned)" onClick={async () => { if (await confirmDialog(`Its items stay on the map.`, { title: `Delete layer “${l.name}”?`, okLabel: 'Delete', danger: true })) { await api.deleteLayer(l.id); if (activeLayer === l.id) setActiveLayer(null); reload() } }}><Trash2 size={13} /></button>
                  </>
                )}
              </div>
            ))}
            {canEdit && <button className="btn sm" onClick={async () => { const n = await askText('New layer', { label: 'Layer name', okLabel: 'Add' }); if (n?.trim()) { const l = await api.createLayer(full.id, n.trim()); setActiveLayer(l.id); reload() } }}><Plus size={13} /> Add layer</button>}
            {children.length > 0 && <><b style={{ marginTop: 8 }}>Maps inside this one</b>{children.map((m) => <a key={m.id} onClick={() => nav({ type: 'map', id: m.id })}>{m.name}</a>)}</>}
            {canEdit && <button className="btn sm" onClick={() => startMapUpload(full.id)}><Plus size={13} /> Add a map inside this one</button>}
          </div>
        )}

        {showSettings && canEdit && (
          <div className="map-panel settings">
            <b>Map settings</b>
            <label className="field"><span>Name</span>
              <input className="input" defaultValue={full.name} onBlur={async (e) => { const n = e.target.value.trim(); if (n && n !== full.name) { await api.patchMap(full.id, { name: n }); setFull((f) => f && { ...f, name: n }); useWorld.getState().reloadMaps() } }} /></label>
            <label className="field"><span>Lies inside</span>
              <Select className="input" value={full.parentMapId ?? ''} onChange={async (v) => {
                try { await api.patchMap(full.id, { parentMapId: v || null }); setFull((f) => f && { ...f, parentMapId: v || null }); useWorld.getState().reloadMaps() } catch (er: any) { alertDialog(er.message) }
              }}>
                <option value="">Nothing (top level)</option>
                {maps.filter((m) => m.id !== full.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select></label>
            <label className="field"><span>Scale (metres per image pixel)</span>
              <input className="input" type="number" step="any" min="0" defaultValue={scale ?? ''} placeholder="not set"
                onBlur={async (e) => { const v = Number(e.target.value); if (v > 0 && v !== scale) { await api.patchMap(full.id, { scale: v }); setFull((f) => f && { ...f, scale: v }) } }} /></label>
            <small className="muted">{full.width} × {full.height} px{scale ? ` · about ${formatMeters(full.width! * scale)} wide` : ''}. Or use the Measure tool on a known distance.</small>
            <button className="btn danger sm" onClick={async () => { if (await confirmDialog('This cannot be undone.', { title: `Delete “${full.name}” and everything on it?`, okLabel: 'Delete', danger: true })) { await api.deleteMap(full.id); await useWorld.getState().reloadMaps(); nav({ type: 'maps' }) } }}>Delete this map</button>
          </div>
        )}

        {selectedItem && (
          <div className="map-panel inspector-wrap">
            <MapInspector
              item={selectedItem} layers={full.layers} maps={maps} mapId={full.id} cal={cal} T={T} scale={scale} canEdit={canEdit}
              stateGeom={itemStateAt(selectedItem, timeOn ? T : null).geometry}
              onUpdate={(p) => updateItem(selectedItem.id, p)} onDelete={deleteSelected} onClose={() => setSelected(null)}
              onJump={(t) => { setTimeOn(true); setT(t) }} onNeedTime={() => setTimeOn(true)}
            />
          </div>
        )}
      </div>

      {timeOn && <TimeBar cal={cal} T={T} setT={setT} ticks={ticks} />}
    </div>
  )
}
