import { Eraser, Lamp, Redo2, Square, Undo2, X, DoorOpen, Route, Armchair, Trash2, Brush, Wand2, Slash } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { alertDialog, confirmDialog } from '../lib/dialog'
import { cellsBetween, cleanDoc, emptyDoc, generateDungeon, paintBrush, paintCorridor, paintRect, PROPS, PROP_NAMES, resizeDoc, THEMES, toggleDoor, tableLights, wallSegments, type MapDoc, type Opening, type PropKind } from '../tabletop/mapdoc'
import { drawMap, mapPicture } from '../tabletop/mapRender'
import { sendTable, useTable, type Scene } from '../tabletop/state'
import { pickImage, uploadImage } from '../tabletop/upload'
import { Select } from './Select'

// The map editor: draw rooms and corridors on a grid, put doors on their edges, set props and lights, and make the scene from it: the picture,
// the walls (worked out from where the floor ends), the doors and the lights. The map is kept so it can be opened and changed again.

type Tool = 'floor' | 'erase' | 'corridor' | 'cave' | 'diagonal' | 'door' | 'prop' | 'light' | 'remove'
const SCENE_PX = 70
/** How far a point is from a wall between two corners, in cells. */
const segDistance = (px: number, py: number, g: { x1: number; y1: number; x2: number; y2: number }) => {
  const dx = g.x2 - g.x1, dy = g.y2 - g.y1, t = Math.max(0, Math.min(1, ((px - g.x1) * dx + (py - g.y1) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - (g.x1 + t * dx), py - (g.y1 + t * dy))
}
const nearestEdge = (doc: MapDoc, fx: number, fy: number) => {
  // which edge of the cell the pointer is closest to: top and left are the cell's own, bottom and right belong to the cell below and to the right
  const x = Math.floor(fx), y = Math.floor(fy), dx = fx - x, dy = fy - y
  const d = [dy, dx, 1 - dy, 1 - dx], at = d.indexOf(Math.min(...d))
  return at === 0 ? { x, y, side: 'n' as const } : at === 1 ? { x, y, side: 'w' as const } : at === 2 ? { x, y: y + 1, side: 'n' as const } : { x: x + 1, y, side: 'w' as const }
}

export function MapEditor({ scene, wsId, onClose }: { scene: Scene; wsId: string; onClose: () => void }) {
  const [doc, setDoc] = useState<MapDoc | null>(null)
  const [past, setPast] = useState<MapDoc[]>([])
  const [future, setFuture] = useState<MapDoc[]>([])
  const [tool, setTool] = useState<Tool>('floor')
  const [prop, setProp] = useState<PropKind | 'picture'>('table')
  const [pictureUrl, setPictureUrl] = useState('')
  const [pictureSize, setPictureSize] = useState(2)
  const [corner, setCorner] = useState<{ x: number; y: number } | null>(null)
  const [redraw, setRedraw] = useState(0)
  const [turn, setTurn] = useState(0)
  const [radius, setRadius] = useState(4)
  const [color, setColor] = useState('#ffd9a0')
  const [width, setWidth] = useState(1)
  const [opening, setOpening] = useState<Opening>('door')
  const [brush, setBrush] = useState(3)
  const [brushClears, setBrushClears] = useState(false)
  const [seed, setSeed] = useState('')
  const [rooms, setRooms] = useState(8)
  const [last, setLast] = useState<{ x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState(28)
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null)
  const [busy, setBusy] = useState(false)
  const [size, setSize] = useState({ cols: '30', rows: '20' })
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let live = true
    api.getMapDoc(wsId, scene.id).then((r) => {
      if (!live) return
      const d = cleanDoc(r.doc) ?? emptyDoc(Math.max(5, Math.round(scene.width / SCENE_PX)) > 100 ? 30 : Math.max(10, Math.round(scene.width / SCENE_PX)), Math.max(10, Math.round(scene.height / SCENE_PX)) > 100 ? 20 : Math.max(10, Math.round(scene.height / SCENE_PX)))
      setDoc(d); setSize({ cols: String(d.cols), rows: String(d.rows) })
    }).catch(() => { if (live) setDoc(emptyDoc()) })
    return () => { live = false }
  }, [wsId, scene.id])

  useEffect(() => { setCorner(null) }, [tool])
  const change = (next: MapDoc) => { if (!doc) return; setPast((p) => [...p.slice(-60), doc]); setFuture([]); setDoc(next) }
  const undo = () => { const last = past.at(-1); if (!last || !doc) return; setPast(past.slice(0, -1)); setFuture([doc, ...future]); setDoc(last) }
  const redo = () => { const nx = future[0]; if (!nx || !doc) return; setFuture(future.slice(1)); setPast([...past, doc]); setDoc(nx) }

  // the picture on screen: the map, and what is being dragged
  const shown = useMemo(() => {
    if (!doc || !drag) return doc
    if (tool === 'floor' || tool === 'erase') return paintRect(doc, drag.a.x, drag.a.y, drag.b.x, drag.b.y, tool === 'floor')
    if (tool === 'corridor') return paintCorridor(doc, drag.a.x, drag.a.y, drag.b.x, drag.b.y, width)
    return doc
  }, [doc, drag, tool, width])
  useEffect(() => {
    const c = canvas.current
    if (!c || !shown) return
    c.width = shown.cols * zoom; c.height = shown.rows * zoom
    const ctx = c.getContext('2d')!
    drawMap(ctx, shown, zoom, { lights: true, onLoad: () => setRedraw((n) => n + 1) })
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= shown.cols; x++) { ctx.moveTo(x * zoom + 0.5, 0); ctx.lineTo(x * zoom + 0.5, shown.rows * zoom) }
    for (let y = 0; y <= shown.rows; y++) { ctx.moveTo(0, y * zoom + 0.5); ctx.lineTo(shown.cols * zoom, y * zoom + 0.5) }
    ctx.stroke()
    if (corner) { ctx.beginPath(); ctx.arc(corner.x * zoom, corner.y * zoom, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffd23f'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke() }
  }, [shown, zoom, redraw, corner])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [role=listbox]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
      else if (e.key === 'r' && tool === 'prop') setTurn((t) => (t + 1) % 4)
      else if (e.key === 'Escape') setCorner(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  if (!doc) return <div className="map-editor-overlay" role="dialog" aria-label="Map editor"><p className="muted" style={{ padding: 20 }}>Opening the map…</p></div>

  const at = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { fx: (e.clientX - r.left) / zoom, fy: (e.clientY - r.top) / zoom }
  }
  const cell = (e: React.PointerEvent) => { const { fx, fy } = at(e); return { x: Math.min(doc.cols - 1, Math.max(0, Math.floor(fx))), y: Math.min(doc.rows - 1, Math.max(0, Math.floor(fy))) } }
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const c = cell(e)
    if (tool === 'door') { const { fx, fy } = at(e); change(toggleDoor(doc, { ...nearestEdge(doc, fx, fy), ...(opening !== 'door' ? { kind: opening } : {}) })); return }
    if (tool === 'cave') { setPast((p) => [...p.slice(-60), doc]); setFuture([]); setDoc(paintBrush(doc, c.x, c.y, brush, !brushClears)); setLast(c); (e.target as HTMLElement).setPointerCapture(e.pointerId); return }
    if (tool === 'prop') {
      if (prop === 'picture' && !pictureUrl) { void alertDialog('Choose a picture first.'); return }
      change({ ...doc, props: [...doc.props.filter((p) => !(p.x === c.x && p.y === c.y && (p.kind === 'rug') === (prop === 'rug'))), { x: c.x, y: c.y, kind: prop, turn, ...(prop === 'picture' ? { image: pictureUrl, size: pictureSize } : {}) }] }); return
    }
    if (tool === 'light') { change({ ...doc, lights: [...doc.lights.filter((l) => !(l.x === c.x && l.y === c.y)), { x: c.x, y: c.y, radius, color }] }); return }
    if (tool === 'diagonal') {
      const { fx, fy } = at(e)
      const p = { x: Math.min(doc.cols, Math.max(0, Math.round(fx))), y: Math.min(doc.rows, Math.max(0, Math.round(fy))) }
      if (!corner) { setCorner(p); return }
      setCorner(null)
      if (p.x !== corner.x || p.y !== corner.y) change({ ...doc, diag: [...(doc.diag ?? []), { x1: corner.x, y1: corner.y, x2: p.x, y2: p.y }].slice(-300) })
      return
    }
    if (tool === 'remove') { const { fx: rx, fy: ry } = at(e); change({ ...doc, diag: (doc.diag ?? []).filter((g) => segDistance(rx, ry, g) > 0.45), props: doc.props.filter((p) => !(p.x === c.x && p.y === c.y)), lights: doc.lights.filter((l) => !(l.x === c.x && l.y === c.y)), doors: doc.doors.filter((d) => !(d.x === c.x && d.y === c.y)) }); return }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ a: c, b: c })
  }
  const move = (e: React.PointerEvent) => {
    if (last) {
      const c = cell(e)
      if (c.x === last.x && c.y === last.y) return
      setDoc((cur) => (cur ? cellsBetween(last.x, last.y, c.x, c.y).reduce((d, p) => paintBrush(d, p.x, p.y, brush, !brushClears), cur) : cur))
      setLast(c)
    } else if (drag) setDrag({ ...drag, b: cell(e) })
  }
  const up = () => {
    if (last) { setLast(null); return }
    if (!drag) return
    if (tool === 'floor' || tool === 'erase') change(paintRect(doc, drag.a.x, drag.a.y, drag.b.x, drag.b.y, tool === 'floor'))
    else if (tool === 'corridor') change(paintCorridor(doc, drag.a.x, drag.a.y, drag.b.x, drag.b.y, width))
    setDrag(null)
  }

  const apply = async () => {
    const walls = wallSegments(doc, SCENE_PX)
    if (!walls.length && !doc.floor.some((r) => r.includes('1'))) { await alertDialog('The map is empty. Draw some rooms first.'); return }
    const st = useTable.getState()
    const sceneWalls = st.walls
    if (!(await confirmDialog(`This makes the picture of “${scene.name}” from the map and replaces its ${sceneWalls.length} walls and doors with the ones the map makes, and the lights the editor placed before. Tokens stay where they are.`, { title: 'Make the scene from the map', okLabel: 'Make the scene' }))) return
    setBusy(true)
    try {
      const url = await uploadImage(wsId, new File([await mapPicture(doc, SCENE_PX)], `${scene.name || 'map'}.png`, { type: 'image/png' }))
      if (!url) { setBusy(false); return }
      await api.putMapDoc(wsId, scene.id, doc)
      sendTable({ t: 'scene.update', id: scene.id, patch: { bg: url, width: doc.cols * SCENE_PX, height: doc.rows * SCENE_PX, grid: 'square', gridSize: SCENE_PX, dist: 5, unit: 'ft' } })
      for (let i = 0; i < sceneWalls.length; i += 100) sendTable({ t: 'wall.delete', ids: sceneWalls.slice(i, i + 100).map((w) => w.id) })
      for (let i = 0; i < walls.length; i += 200) sendTable({ t: 'wall.add', sceneId: scene.id, walls: walls.slice(i, i + 200) })
      const old = st.tokens.filter((t) => t.data?.editorLight).map((t) => t.id)
      if (old.length) sendTable({ t: 'token.delete', ids: old })
      for (const l of tableLights(doc, SCENE_PX, 5)) sendTable({ t: 'token.add', sceneId: scene.id, token: { name: 'Light', hidden: true, x: l.x, y: l.y, data: { editorLight: true, lightSource: true, light: { bright: l.bright, dim: l.dim, color: l.color } } } })
      onClose()
    } catch (e: any) { setBusy(false); await alertDialog(e.message ?? 'The map could not be applied.') }
  }

  const tools: { id: Tool; label: string; icon: React.ReactNode }[] = [
    { id: 'floor', label: 'Room', icon: <Square size={14} /> }, { id: 'erase', label: 'Erase floor', icon: <Eraser size={14} /> }, { id: 'corridor', label: 'Corridor', icon: <Route size={14} /> },
    { id: 'cave', label: 'Cave brush', icon: <Brush size={14} /> },
    { id: 'diagonal', label: 'Diagonal wall', icon: <Slash size={14} /> },
    { id: 'door', label: 'Door', icon: <DoorOpen size={14} /> }, { id: 'prop', label: 'Prop', icon: <Armchair size={14} /> }, { id: 'light', label: 'Light', icon: <Lamp size={14} /> }, { id: 'remove', label: 'Remove item', icon: <Trash2 size={14} /> },
  ]
  return (
    <div className="map-editor-overlay" role="dialog" aria-label="Map editor">
      <div className="map-editor-bar">
        <b>Map editor</b>
        <span className="seg" role="group" aria-label="Tools">
          {tools.map((t) => <button key={t.id} className={tool === t.id ? 'on' : ''} aria-pressed={tool === t.id} title={t.label} onClick={() => setTool(t.id)}>{t.icon} {t.label}</button>)}
        </span>
        {tool === 'prop' && (
          <>
            <Select className="input" style={{ width: 150 }} value={prop} onChange={(v) => setProp(v as PropKind | 'picture')} title="Kind of prop">{[...PROPS.map((p) => <option key={p} value={p}>{PROP_NAMES[p]}</option>), <option key="picture" value="picture">A picture of your own</option>]}</Select>
            {prop === 'picture' && (
              <>
                <button className="btn sm" onClick={async () => { const f = await pickImage(); if (f) { const url = await uploadImage(wsId, f); if (url) setPictureUrl(url) } }}>{pictureUrl ? 'Another picture' : 'Choose a picture'}</button>
                <label className="sv-mini">Cells across<input className="input tt-num" type="number" min={0.5} max={20} step={0.5} aria-label="Picture size in cells" value={pictureSize} onChange={(e) => setPictureSize(Math.min(20, Math.max(0.5, Number(e.target.value) || 1)))} /></label>
              </>
            )}
            <button className="btn sm" title="Turn it a quarter (R)" onClick={() => setTurn((turn + 1) % 4)}>Turn</button>
          </>
        )}
        {tool === 'light' && (
          <>
            <label className="sv-mini">Radius<input className="input tt-num" type="number" min={1} max={30} aria-label="Light radius in cells" value={radius} onChange={(e) => setRadius(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} /></label>
            <input className="tt-color" type="color" aria-label="Light colour for new lights" value={color} onChange={(e) => setColor(e.target.value)} />
          </>
        )}
        {tool === 'door' && <Select className="input tt-type" style={{ width: 150 }} value={opening} onChange={(v) => setOpening(v as Opening)} title="Kind of opening">
          <option value="door">Door</option><option value="secret">Secret door</option><option value="window">Window</option>
        </Select>}
        {tool === 'cave' && (
          <>
            <label className="sv-mini">Brush<input className="input tt-num" type="number" min={1} max={9} aria-label="Brush size in cells" value={brush} onChange={(e) => setBrush(Math.min(9, Math.max(1, Number(e.target.value) || 1)))} /></label>
            <label className="tt-check"><input type="checkbox" checked={brushClears} onChange={(e) => setBrushClears(e.target.checked)} />The brush clears floor</label>
          </>
        )}
        {tool === 'corridor' && <label className="sv-mini">Width<input className="input tt-num" type="number" min={1} max={6} aria-label="Corridor width in cells" value={width} onChange={(e) => setWidth(Math.min(6, Math.max(1, Number(e.target.value) || 1)))} /></label>}
        <button className="btn sm" aria-label="Undo" disabled={!past.length} onClick={undo}><Undo2 size={14} /></button>
        <button className="btn sm" aria-label="Redo" disabled={!future.length} onClick={redo}><Redo2 size={14} /></button>
        <span className="grow" />
        <button className="btn primary" disabled={busy} onClick={apply}>{busy ? 'Making the scene…' : 'Make the scene'}</button>
        <button className="btn" aria-label="Close the map editor" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="map-editor-bar">
        <label className="sv-mini">Look
          <Select className="input" value={doc.theme} onChange={(v) => change({ ...doc, theme: v as MapDoc['theme'] })} title="Look of the map">{Object.entries(THEMES).map(([k, t]) => <option key={k} value={k}>{t.name}</option>)}</Select>
        </label>
        <label className="sv-mini">Cells wide<input className="input tt-num" type="number" min={5} max={100} aria-label="Cells wide" value={size.cols} onChange={(e) => setSize({ ...size, cols: e.target.value })} /></label>
        <label className="sv-mini">high<input className="input tt-num" type="number" min={5} max={100} aria-label="Cells high" value={size.rows} onChange={(e) => setSize({ ...size, rows: e.target.value })} /></label>
        <button className="btn sm" onClick={() => change(resizeDoc(doc, Number(size.cols), Number(size.rows)))}>Resize</button>
        <label className="sv-mini">Zoom<input type="range" min={14} max={48} aria-label="Zoom" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
        <label className="sv-mini">Rooms<input className="input tt-num" type="number" min={2} max={30} aria-label="Rooms to generate" value={rooms} onChange={(e) => setRooms(Math.min(30, Math.max(2, Number(e.target.value) || 2)))} /></label>
        <label className="sv-mini">Seed<input className="input tt-num" aria-label="Seed of the dungeon" placeholder="random" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, '').slice(0, 9))} /></label>
        <button className="btn sm" title="Makes rooms, corridors, doors and lights by itself, which can then be changed by hand" onClick={async () => {
          if (doc.floor.some((r) => r.includes('1')) && !(await confirmDialog('The rooms, doors and lights on this map are replaced by a new dungeon. Undo brings them back.', { title: 'Generate a dungeon', okLabel: 'Generate' }))) return
          const n = seed ? Number(seed) : Math.floor(Math.random() * 1e9)
          setSeed(String(n)); change(generateDungeon(n, doc.cols, doc.rows, rooms, doc.theme))
        }}><Wand2 size={13} /> Generate a dungeon</button>
        <button className="btn sm" onClick={async () => { if (await confirmDialog('Every room, door, prop and light on this map is removed.', { title: 'Clear the map', okLabel: 'Clear', danger: true })) change(emptyDoc(doc.cols, doc.rows, doc.theme)) }}>Clear</button>
        <span className="muted" style={{ fontSize: 12 }}>{doc.floor.join('').split('1').length - 1} cells of floor, {wallSegments(doc, 1).filter((w) => w.kind === 'door').length} doors, {wallSegments(doc, 1).filter((w) => w.kind === 'window').length} windows, {wallSegments(doc, 1).filter((w) => w.kind === 'secret').length} secret doors, {(doc.diag ?? []).length} diagonal walls, {doc.lights.length} lights</span>
      </div>
      <div className="map-editor-scroll">
        <canvas ref={canvas} aria-label="Map" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} onContextMenu={(e) => e.preventDefault()} style={{ touchAction: 'none', cursor: 'crosshair' }} />
      </div>
    </div>
  )
}
