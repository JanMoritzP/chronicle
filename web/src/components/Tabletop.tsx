import { Color } from 'pixi.js'
import { BrickWall, Dices, Map as MapIcon, Pencil, UserRound, Ellipsis, Crosshair, Eraser, Eye, MessageSquare, EyeOff, Lock, LockOpen, Maximize, Minus, Plus, Ruler, RotateCw, Swords, Trash2, UserPlus, MousePointer2, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { askText, confirmDialog } from '../lib/dialog'
import { colorFor } from '../lib/collab'
import { useStore } from '../store'
import { TableEngine, type Tool } from '../tabletop/engine'
import { snap } from '../tabletop/grid'
import { joinTable, leaveTable, onTableMessage, sendTable, useTable, type DrawKind, type Scene, type Token } from '../tabletop/state'
import { pickBackground, pickImage, uploadImage, videoSize } from '../tabletop/upload'
import { exportUvtt, importUvtt } from '../tabletop/uvttFiles'
import { EncounterPanel } from './TableEncounters'
import { shownTiles, TilePanel, TilesSection } from './TableTiles'
import { HandoutViewer, HandoutsPanel } from './TableHandouts'
import { AudioPlayer } from './TableAudio'
import { TriggersSection } from './TableTriggers'
import { MapEditor } from './MapEditor'
import { AssetLibrary } from './AssetLibrary'
import { partOfDay } from '../lib/daylight'
import { loadPerf, savePerf, statsText, type Perf } from '../lib/tableperf'
import { bind, DEFAULT_KEYS, KEY_ACTIONS, loadKeys, pressed, saveKeys, type KeyAction } from '../lib/tablekeys'
import { PinDialog } from './PinDialog'
import { ReadyBanner } from './ReadyBanner'
import { ThreatBanner } from './ThreatBanner'
import { Replay } from './Replay'
import { TokenActions, TokenBars, TokenLook } from './TokenLook'
import { TablesAndDecks } from './TableDecks'
import { ChatPanel, CombatPanel, LinkPage, SightLight, TokenSheet, TokenStats } from './TableParts'
import { Select } from './Select'

const PALETTE = ['#c0392b', '#2e86c1', '#27ae60', '#d68910', '#8e44ad', '#16a085', '#7f8c8d', '#d35400']
const colorNum = (id: string) => new Color(colorFor(id)).toNumber()

/** True on a phone-sized screen; follows a rotation or a resized window. */
function useNarrow() {
  const query = '(max-width: 900px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

export function TableView() {
  const wsId = useStore((s) => s.wsId)
  const conn = useTable((s) => s.conn)
  const role = useTable((s) => s.role)
  const scenes = useTable((s) => s.scenes)
  const active = useTable((s) => s.active)
  const sceneId = useTable((s) => s.sceneId)
  const error = useTable((s) => s.error)
  const [tool, setTool] = useState<Tool>('select')
  const [panel, setPanel] = useState<'token' | 'scene' | 'table' | 'chat' | 'combat' | 'encounters' | 'handouts' | 'games'>('token')
  const combat = useTable((s) => s.combat)
  const unread = useTable((s) => s.unread)
  const narrow = useNarrow()
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia('(max-width: 900px)').matches)
  useEffect(() => { setPanelOpen(!narrow) }, [narrow])
  const host = useRef<HTMLDivElement>(null)
  const styleRef = useRef({ color: '#ff5252', width: 4 })
  const gmOnlyRef = useRef(false)
  const tempRef = useRef(false)
  const [pinAt, setPinAt] = useState<{ x: number; y: number } | null>(null)
  const engine = useRef<TableEngine | null>(null)
  const scene = scenes.find((s) => s.id === sceneId) ?? null
  const gm = role === 'gm'
  const canAdd = useTable((s) => s.role === 'gm' || (s.role === 'player' && s.settings.playersCreateTokens))

  useEffect(() => {
    if (!wsId) return
    joinTable(wsId)
    return () => leaveTable()
  }, [wsId])

  // the picture
  useEffect(() => {
    const el = host.current
    if (!el) return
    const e = new TableEngine(el, {
      canMove: (t) => {
        const st = useTable.getState()
        return st.role === 'gm' || (st.role === 'player' && st.settings.playersMoveOwn && !t.locked && !!st.you && t.owners.includes(st.you.id))
      },
      moveLeft: (t) => {
        const st = useTable.getState()
        const speed = t.data?.speed
        if (typeof speed !== 'number' || speed <= 0) return null
        const turn = st.combat.active ? st.combat.list.find((x) => x.id === st.combat.turn) : undefined
        // in combat, what the token has already walked this turn is taken off, but only on its own turn
        return Math.max(0, speed - (turn && turn.tokenId === t.id ? turn.moved ?? 0 : 0))
      },
      onMove: (moves) => { sendTable({ t: 'token.move', moves }) },
      onSelect: (ids) => { useTable.setState(ids.length ? { selected: ids, selectedTile: null } : { selected: ids }); if (ids.length) setPanel('token') },
      onPing: (p) => { sendTable({ t: 'ping', x: p.x, y: p.y }) },
      onCursor: (p) => { sendTable({ t: 'cursor', x: p.x, y: p.y }) },
      onRuler: (points) => { sendTable({ t: 'ruler', points }) },
      onWallAdd: (walls) => { const id = useTable.getState().sceneId; if (id) sendTable({ t: 'wall.add', sceneId: id, walls }) },
      onWallErase: (id) => { sendTable({ t: 'wall.delete', ids: [id] }) },
      onDoorLock: (id, locked) => { sendTable({ t: 'door.lock', id, locked }) },
      onReveal: (r) => { const id = useTable.getState().sceneId; if (id) sendTable({ t: 'fog.reveal', sceneId: id, x: r.x, y: r.y, w: r.w, h: r.h }) },
      onUnreveal: (id) => { sendTable({ t: 'fog.unreveal', id }) },
      onWallMove: (updates) => { for (const u of updates) sendTable({ t: 'wall.update', id: u.id, patch: u.patch }) },
      onDoor: (id) => { sendTable({ t: 'door.toggle', id }) },
      onDraw: (d) => { const id = useTable.getState().sceneId; if (id && d.points.length) sendTable({ t: 'draw.add', sceneId: id, kind: d.kind, points: d.points, color: d.color, width: d.width, ...(d.fill ? { fill: d.fill } : {}), gmOnly: gmOnlyRef.current && useTable.getState().role === 'gm', ...(tempRef.current ? { temp: true } : {}) }) },
      onDrawMove: (id, dx, dy) => { sendTable({ t: 'draw.move', id, dx, dy }) },
      onPull: (p) => { const v = engine.current?.getView(); if (v) sendTable({ t: 'camera.pull', x: p.x - v.w / 2, y: p.y - v.h / 2, w: v.w, h: v.h }) },
      onPinPlace: (p) => setPinAt(p),
      onPin: (pin) => { if (pin.pageId) useStore.getState().navigate({ type: 'page', id: pin.pageId }) },
      onPinDelete: (id) => { sendTable({ t: 'pin.delete', id }) },
      onText: async (p) => {
        const id = useTable.getState().sceneId
        const text = await askText('Write on the map', { label: 'Text', placeholder: 'The cellar door', okLabel: 'Place' })
        if (id && text?.trim()) sendTable({ t: 'draw.add', sceneId: id, kind: 'text', points: [p], color: styleRef.current.color, width: styleRef.current.width, text: text.trim(), gmOnly: gmOnlyRef.current && useTable.getState().role === 'gm' })
      },
      onDrawErase: (id) => { sendTable({ t: 'draw.delete', ids: [id] }) },
      onTileSelect: (id) => { useTable.setState(id ? { selectedTile: id, selected: [] } : { selectedTile: null }); if (id) setPanel('token') },
      onTileMove: (id, x, y) => { sendTable({ t: 'tile.update', id, patch: { x, y } }) },
      onExplored: (png) => { const id = useTable.getState().sceneId; if (id) sendTable({ t: 'fog.save', sceneId: id, mask: png }) },
      colorOf: colorNum,
    })
    engine.current = e
    let off = () => {}
    e.init().then(() => {
      const push = () => {
        const s = useTable.getState()
        e.setScene(s.scenes.find((x) => x.id === s.sceneId) ?? null)
      }
      const viewer = () => {
        const s = useTable.getState()
        e.setViewer({ shared: s.settings.sharedVision, id: s.you?.id ?? '', gm: s.role === 'gm', spectator: s.role === 'spectator', canDoors: s.role === 'player' && s.settings.playersOpenDoors })
      }
      viewer()
      push()
      e.setWalls(useTable.getState().walls)
      e.setReveals(useTable.getState().reveals)
      e.setPins(useTable.getState().pins)
      e.setTriggers(useTable.getState().triggers.filter((t) => !t.scene || t.scene === useTable.getState().sceneId).filter((t) => t.event === 'enter'))
      e.setLights(useTable.getState().lights)
      e.setTokens(useTable.getState().tokens)
      e.setSelected(useTable.getState().selected)
      e.setExplored(useTable.getState().fog)
      e.setDrawings(useTable.getState().drawings)
      e.setTiles(shownTiles(useTable.getState()))
      e.setSelectedTile(useTable.getState().selectedTile)
      e.setDrawStyle({ kind: 'free', color: '#ff5252', width: 4, fill: '' })
      const turn = () => { const s = useTable.getState(); e.setTurn(s.combat.active ? s.combat.list.find((x) => x.id === s.combat.turn)?.tokenId ?? null : null) }
      turn()
      const unsub = useTable.subscribe((s, prev) => {
        if (s.role !== prev.role || s.you !== prev.you || s.settings.playersOpenDoors !== prev.settings.playersOpenDoors || s.settings.sharedVision !== prev.settings.sharedVision) viewer()
        if (s.scenes !== prev.scenes || s.sceneId !== prev.sceneId) push()
        if (s.combat !== prev.combat || s.tokens !== prev.tokens) turn()
        if (s.drawings !== prev.drawings) e.setDrawings(s.drawings)
        if (s.tiles !== prev.tiles || s.hiddenLayers !== prev.hiddenLayers) e.setTiles(shownTiles(s))
        if (s.selectedTile !== prev.selectedTile) e.setSelectedTile(s.selectedTile)
        if (s.walls !== prev.walls) e.setWalls(s.walls)
        if (s.reveals !== prev.reveals) e.setReveals(s.reveals)
        if (s.pins !== prev.pins) e.setPins(s.pins)
        if (s.triggers !== prev.triggers || s.sceneId !== prev.sceneId) e.setTriggers(s.triggers.filter((t) => !t.scene || t.scene === s.sceneId).filter((t) => t.event === 'enter'))
        if (s.lights !== prev.lights) e.setLights(s.lights)
        if (s.sceneId !== prev.sceneId || s.fog !== prev.fog) e.setExplored(s.fog)
        if (s.tokens !== prev.tokens) e.setTokens(s.tokens)
        if (s.selected !== prev.selected) e.setSelected(s.selected)
        if (s.cursors !== prev.cursors || s.rulers !== prev.rulers) e.setOthers(s.cursors, s.rulers)
      })
      const unmsg = onTableMessage((m) => { if (m.t === 'ping') e.ping({ x: m.x, y: m.y }, m.user); if (m.t === 'camera') e.setView({ x: m.x, y: m.y, w: m.w, h: m.h }); if (m.t === 'fog.reset') e.setExplored(null) })
      off = () => { unsub(); unmsg() }
    })
    return () => { off(); e.destroy(); engine.current = null }
  }, [])

  const [draw, setDraw] = useState<{ kind: DrawKind; color: string; width: number; fill: boolean; opacity: number; temp: boolean }>({ kind: 'free', color: '#ff5252', width: 4, fill: false, opacity: 35, temp: false })
  const [gmOnly, setGmOnly] = useState(false)
  const canDraw = useTable((s) => s.role === 'gm' || (s.role === 'player' && s.settings.playersDraw))
  useEffect(() => {
    styleRef.current = { color: draw.color, width: draw.width }
    gmOnlyRef.current = gmOnly
    tempRef.current = draw.temp
    engine.current?.setDrawStyle({ kind: draw.kind, color: draw.color, width: draw.width, fill: draw.fill ? draw.color + Math.round((draw.opacity / 100) * 255).toString(16).padStart(2, '0') : '' })
  }, [draw, gmOnly])
  const [wallKind, setWallKind] = useState<'wall' | 'door' | 'secret' | 'window' | 'oneway' | 'terrain'>('wall')
  const [wallShape, setWallShape] = useState<'line' | 'rect'>('line')
  // the GM can look at the scene as a player (or one token) sees it: fog, darkness, secret doors and hidden tokens, without a decoy account
  const [previewKey, setPreviewKey] = useState('')
  // views the GM wants to come back to (a room, the stairs): kept in this browser, per scene
  const viewsKey = `tt-views:${sceneId ?? ''}`
  const [views, setViews] = useState<{ name: string; x: number; y: number; w: number; h: number }[]>([])
  useEffect(() => { try { setViews(JSON.parse(localStorage.getItem(viewsKey) ?? '[]')) } catch { setViews([]) } }, [viewsKey])
  const keepViews = (v: typeof views) => { setViews(v); try { localStorage.setItem(viewsKey, JSON.stringify(v)) } catch { /* private window */ } }
  const people = useTable((s) => s.members)
  const sceneTokens = useTable((s) => s.tokens)
  const previewOptions = useMemo(() => {
    const owners = [...new Set(sceneTokens.flatMap((t) => t.owners))].filter((id) => people.some((m) => m.id === id))
    return {
      players: owners.map((id) => ({ key: `u:${id}`, label: `As ${people.find((m) => m.id === id)!.username}`, users: [id], tokens: [] as string[] })),
      all: owners.length > 1 ? { key: 'all', label: 'As all players', users: owners, tokens: [] as string[] } : null,
      tokens: sceneTokens.map((t) => ({ key: `t:${t.id}`, label: `Through ${t.name || 'a token'}`, users: [] as string[], tokens: [t.id] })),
    }
  }, [sceneTokens, people])
  const previewing = [...previewOptions.players, ...(previewOptions.all ? [previewOptions.all] : []), ...previewOptions.tokens].find((o) => o.key === previewKey) ?? null
  useEffect(() => { engine.current?.setPreview(previewing ? { users: previewing.users, tokens: previewing.tokens } : null) }, [previewing?.key, previewing?.users.join(), previewing?.tokens.join(), sceneId])
  useEffect(() => { engine.current?.setTool(tool) }, [tool])
  useEffect(() => { engine.current?.setWallKind(wallKind) }, [wallKind])
  useEffect(() => { engine.current?.setWallShape(wallShape) }, [wallShape])

  const tokens = useTable((s) => s.tokens)
  const selected = useTable((s) => s.selected)
  const selectedTile = useTable((s) => s.selectedTile)
  const one = selected.length === 1 ? tokens.find((t) => t.id === selected[0]) ?? null : null

  const [keys, setKeys] = useState(loadKeys)
  const [perf, setPerf] = useState(loadPerf)
  const [stats, setStats] = useState('')
  useEffect(() => { const on = () => setPerf(loadPerf()); window.addEventListener('tt-perf', on); return () => window.removeEventListener('tt-perf', on) }, [])
  useEffect(() => { engine.current?.setPerformance(perf) }, [perf])
  useEffect(() => {
    if (!perf.show) { setStats(''); return }
    const t = window.setInterval(() => { const s = engine.current?.getStats(); if (s) setStats(statsText(s)) }, 1000)
    return () => clearInterval(t)
  }, [perf.show])
  useEffect(() => { const on = () => setKeys(loadKeys()); window.addEventListener('tt-keys', on); return () => window.removeEventListener('tt-keys', on) }, [])
  // keys act on the selection
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, [role=listbox]')) return
    const st = useTable.getState()
    const sel = st.tokens.filter((t) => st.selected.includes(t.id))
    if (e.key === 'Enter' && tool === 'wall') engine.current?.finishWalls()
    else if (e.key === 'Enter' && tool === 'draw') engine.current?.finishPolygon()
    else if (e.key === 'Escape') { engine.current?.finishWalls(); useTable.setState({ selected: [] }); setTool('select') }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); engine.current?.undoMove() }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && sel.length) { clipboard = sel.map((t) => structuredClone(t)) }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && clipboard.length && scene) {
      e.preventDefault()
      for (const t of clipboard) sendTable({ t: 'token.add', sceneId: scene.id, token: { name: t.name, x: t.x + scene.gridSize, y: t.y + scene.gridSize, size: t.size, rotation: t.rotation, image: t.image, color: t.color, hidden: t.hidden, owners: gm ? t.owners : [], data: t.data, ...(t.pageId ? { pageId: t.pageId } : {}) } })
    }
    else if (pressed(e, keys, 'fit')) engine.current?.fit()
    else if (pressed(e, keys, 'rotate') && sel.length) for (const t of sel) sendTable({ t: 'token.update', id: t.id, patch: { rotation: (t.rotation + 45) % 360 } })
    else if (gm && (e.key === 'Delete' || e.key === 'Backspace') && st.selectedTile && !sel.length) { e.preventDefault(); sendTable({ t: 'tile.delete', ids: [st.selectedTile] }) }
    else if (gm && (e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); sendTable({ t: 'token.delete', ids: sel.map((t) => t.id) }) }
    else if (gm && pressed(e, keys, 'hide') && sel.length) for (const t of sel) sendTable({ t: 'token.update', id: t.id, patch: { hidden: !t.hidden } })
    else if (gm && pressed(e, keys, 'lock') && sel.length) for (const t of sel) sendTable({ t: 'token.update', id: t.id, patch: { locked: !t.locked } })
    else if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); useTable.setState({ selected: st.tokens.map((t) => t.id) }) }
    else if (e.key.startsWith('Arrow') && sel.length && scene) {
      e.preventDefault()
      const d = e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0] : e.key === 'ArrowUp' ? [0, -1] : [0, 1]
      sendTable({ t: 'token.move', moves: sel.map((t) => ({ id: t.id, x: t.x + d[0] * scene.gridSize, y: t.y + d[1] * scene.gridSize })) })
    } else return
  }

  const addScene = async () => {
    const name = await askText('New scene', { label: 'Name', placeholder: 'The crypt under the chapel', okLabel: 'Create' })
    if (name?.trim()) sendTable({ t: 'scene.create', name: name.trim() })
  }
  const addToken = async () => {
    if (!scene) return
    const name = await askText('New token', { label: 'Name', placeholder: 'Goblin 1', okLabel: 'Add' })
    if (name == null) return
    const c = engine.current?.centre() ?? { x: scene.width / 2, y: scene.height / 2 }
    const p = snap(c, 1, scene)
    const n = useTable.getState().tokens.length
    sendTable({ t: 'token.add', sceneId: scene.id, token: { name: name.trim(), x: p.x, y: p.y, color: PALETTE[n % PALETTE.length] } })
  }

  if (!wsId) return <div className="view muted">Create a world first.</div>

  return (
    <div className="tt" tabIndex={0} onKeyDown={onKey}>
      <div className="tt-bar">
        <Select className="input tt-scene" value={sceneId ?? ''} placeholder="No scenes yet" disabled={!gm} onChange={(id) => sendTable({ t: 'view', sceneId: id })}>
          {[...scenes].sort((a, b) => (a.folder ?? '').localeCompare(b.folder ?? '') || a.sort - b.sort).map((s) => <option key={s.id} value={s.id}>{s.folder ? `${s.folder} › ` : ''}{s.name}{s.id === active ? ' (table)' : ''}</option>)}
        </Select>
        {gm && <button className="btn sm" onClick={addScene}><Plus size={13} /> Scene</button>}
        {gm && scene && scene.id !== active && <button className="btn sm" title="Bring every player to this scene" onClick={() => sendTable({ t: 'scene.activate', id: scene.id })}><Users size={13} /> Move players here</button>}
        <span className="tt-sep" />
        <button className={`btn sm square${tool === 'select' ? ' on' : ''}`} title="Select and move (Esc)" aria-label="Select" onClick={() => setTool('select')}><MousePointer2 size={14} /></button>
        <button className={`btn sm square${tool === 'ruler' ? ' on' : ''}`} title="Measure distance" aria-label="Ruler" onClick={() => setTool('ruler')}><Ruler size={14} /></button>
        {canDraw && <button className={`btn sm square${tool === 'draw' ? ' on' : ''}`} title="Draw on the map" aria-label="Draw" onClick={() => setTool(tool === 'draw' ? 'select' : 'draw')}><Pencil size={14} /></button>}
        {canDraw && tool === 'draw' && (
          <>
            <span className="seg tt-kinds" role="group" aria-label="Kind of drawing">
              {([['free', 'Pen', 'Draw freehand'], ['line', 'Line', 'A straight line'], ['arrow', 'Arrow', 'A line with a head'], ['polygon', 'Shape', 'Click the corners, double-click to close it'], ['rect', 'Box', 'A rectangle'], ['ellipse', 'Circle', 'An ellipse'], ['text', 'Text', 'Write on the map'], ['cone', 'Cone', 'Spell area: a cone from the origin, as long as it is wide at the end'], ['beam', 'Ray', 'Spell area: a line one cell wide'], ['blast', 'Burst', 'Spell area: a circle from its centre'], ['cube', 'Cube', 'Spell area: a square from the middle of one side']] as const).map(([k, label, hint]) => <button key={k} className={draw.kind === k ? 'on' : ''} title={hint} onClick={() => setDraw({ ...draw, kind: k })}>{label}</button>)}
            </span>
            <span className="tt-swatches" role="group" aria-label="Colour">
              {['#ff5252', '#ffb300', '#66bb6a', '#29b6f6', '#ab47bc', '#ffffff', '#212121'].map((c) => <button key={c} className={`tt-swatch${draw.color === c ? ' on' : ''}`} style={{ background: c }} title={c} aria-label={`Colour ${c}`} onClick={() => setDraw({ ...draw, color: c })} />)}
            </span>
            <label className="tt-inline" title="Line width">Width<input type="range" min={2} max={16} value={draw.width} onChange={(e) => setDraw({ ...draw, width: Number(e.target.value) })} /></label>
            {(draw.kind === 'rect' || draw.kind === 'ellipse' || draw.kind === 'polygon') && <label className="tt-inline"><input type="checkbox" checked={draw.fill} onChange={(e) => setDraw({ ...draw, fill: e.target.checked })} />Filled</label>}
            {draw.fill && <label className="tt-inline" title="How solid the fill is">Fill<input type="range" min={10} max={100} aria-label="Fill strength" value={draw.opacity} onChange={(e) => setDraw({ ...draw, opacity: Number(e.target.value) })} /></label>}
            <label className="tt-inline" title="Gone after a few seconds, to point something out"><input type="checkbox" checked={draw.temp} onChange={(e) => setDraw({ ...draw, temp: e.target.checked })} />Fades away</label>
            {gm && <label className="tt-inline" title="Only you see it"><input type="checkbox" checked={gmOnly} onChange={(e) => setGmOnly(e.target.checked)} />GM only</label>}
          </>
        )}
        {canDraw && <button className={`btn sm square${tool === 'erase' ? ' on' : ''}`} title="Remove a drawing (or a wall) by clicking it" aria-label="Erase" onClick={() => setTool(tool === 'erase' ? 'select' : 'erase')}><Eraser size={14} /></button>}
        {gm && scene && <button className="btn sm" title="Remove every drawing on this scene" onClick={async () => { if (await confirmDialog('Every drawing on this scene is removed for everyone.', { title: 'Clear drawings', okLabel: 'Clear', danger: true })) sendTable({ t: 'draw.clear', sceneId: scene.id }) }}>Clear drawings</button>}
        {gm && <button className={`btn sm square${tool === 'wall' ? ' on' : ''}`} title="Draw walls, doors and windows. Click to place points, double-click or Enter to finish." aria-label="Draw walls" onClick={() => setTool(tool === 'wall' ? 'select' : 'wall')}><BrickWall size={14} /></button>}
        {gm && scene && (
          <>
            <button className={`btn sm${tool === 'pin' ? ' on' : ''}`} title="Click the map to pin a note, with a page if you like" aria-label="Pin a note" onClick={() => setTool(tool === 'pin' ? 'select' : 'pin')}>Pin</button>
            <button className={`btn sm${tool === 'reveal' ? ' on' : ''}`} title="Drag a rectangle to show that part of the map to the players" aria-label="Show an area" onClick={() => setTool(tool === 'reveal' ? 'select' : 'reveal')}>Show area</button>
            <button className={`btn sm${tool === 'conceal' ? ' on' : ''}`} title="Click an area you showed to take it back" aria-label="Hide a shown area" onClick={() => setTool(tool === 'conceal' ? 'select' : 'conceal')}>Hide area</button>
          </>
        )}
        {gm && tool === 'wall' && (
          <span className="seg tt-kinds" role="group" aria-label="Kind of wall">
            {(['wall', 'door', 'secret', 'window', 'oneway', 'terrain'] as const).map((k) => <button key={k} className={wallKind === k ? 'on' : ''} title={k === 'terrain' ? 'A hill or hedge: seen past once, but two of them in a row block the view' : undefined} onClick={() => setWallKind(k)}>{k === 'wall' ? 'Wall' : k === 'door' ? 'Door' : k === 'secret' ? 'Secret door' : k === 'window' ? 'Window' : k === 'oneway' ? 'One-way' : 'Terrain'}</button>)}
          </span>
        )}
        {gm && tool === 'wall' && (
          <span className="seg tt-kinds" role="group" aria-label="Shape of wall drawing">
            <button className={wallShape === 'line' ? 'on' : ''} onClick={() => setWallShape('line')}>Lines</button>
            <button className={wallShape === 'rect' ? 'on' : ''} onClick={() => setWallShape('rect')}>Rectangle</button>
          </span>
        )}
        <button className="btn sm square" title="Zoom in" aria-label="Zoom in" onClick={() => engine.current?.zoomBy(1.25)}><Plus size={14} /></button>
        <button className="btn sm square" title="Zoom out" aria-label="Zoom out" onClick={() => engine.current?.zoomBy(0.8)}><Minus size={14} /></button>
        <button className="btn sm square" title="Fit the scene (F)" aria-label="Fit the scene" onClick={() => engine.current?.fit()}><Maximize size={14} /></button>
        {role === 'gm' && scene && (
          <Select className="input tt-preview" value={previewing ? previewKey : ''} title="See the scene as a player does" onChange={setPreviewKey}>
            <option value="">GM view</option>
            {previewOptions.all && <option value={previewOptions.all.key}>{previewOptions.all.label}</option>}
            {previewOptions.players.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            {previewOptions.tokens.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </Select>
        )}
        {role === 'gm' && scene && (
          <>
            <button className="btn sm" title="Show everyone on this scene the part of it you are looking at" onClick={() => { const v = engine.current?.getView(); if (v) sendTable({ t: 'camera.pull', x: v.x, y: v.y, w: v.w, h: v.h }) }}>Bring everyone here</button>
            <Select className="input tt-preview" value="" title="Saved views" onChange={async (v) => {
              if (v === '*save') {
                const name = await askText('Save this view', { label: 'Name', placeholder: 'The stairs', okLabel: 'Save' })
                const view = engine.current?.getView()
                if (name?.trim() && view) keepViews([...views.filter((x) => x.name !== name.trim()), { name: name.trim(), ...view }])
              } else if (v.startsWith('x:')) keepViews(views.filter((x) => x.name !== v.slice(2)))
              else { const hit = views.find((x) => x.name === v); if (hit) engine.current?.setView(hit) }
            }}>
              <option value="">Views</option>
              {views.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
              <option value="*save">Save this view…</option>
              {views.map((x) => <option key={`x${x.name}`} value={`x:${x.name}`}>Forget {x.name}</option>)}
            </Select>
          </>
        )}
        {previewing && <button className="btn sm primary" aria-label="Leave the preview" onClick={() => setPreviewKey('')}><Eye size={13} /> Preview: {previewing.label.replace(/^(As|Through) /, '')}</button>}
        {scene && canAdd && <button className="btn sm" onClick={addToken}><UserPlus size={13} /> Token</button>}
        <span className="grow" />
        <span className={`tt-conn ${conn}`} title={conn === 'open' ? 'Connected' : 'Reconnecting'}>{conn === 'open' ? '' : conn === 'connecting' ? 'Connecting…' : 'Offline, reconnecting…'}</span>
        {!narrow && <button className="btn sm tt-toggle" onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? 'Hide panel' : 'Panel'}</button>}
      </div>
      {error && <div className="tt-error" role="alert" onClick={() => useTable.setState({ error: '' })}>{error}</div>}
      <div className="tt-main">
        <div className="tt-canvas" ref={host}>
          {!scene && <div className="tt-empty muted">{gm ? 'No scenes yet. Create one to start.' : 'The GM has not opened a scene yet.'}</div>}
        </div>
        {panelOpen && (
          <aside className={`tt-panel${narrow ? ' sheet' : ''}`} aria-label="Table panel">
            <div className="seg">
              <button className={panel === 'token' ? 'on' : ''} onClick={() => setPanel('token')}>Token</button>
              {gm && <button className={panel === 'scene' ? 'on' : ''} onClick={() => setPanel('scene')}>Scene</button>}
              {gm && <button className={panel === 'encounters' ? 'on' : ''} onClick={() => setPanel('encounters')}>Encounters</button>}
              <button className={panel === 'combat' ? 'on' : ''} onClick={() => setPanel('combat')}><Swords size={12} /> Combat{combat.active ? ` (R${combat.round})` : ''}</button>
              <button className={panel === 'chat' ? 'on' : ''} onClick={() => setPanel('chat')}><MessageSquare size={12} /> Chat{unread > 0 && panel !== 'chat' ? ` (${unread})` : ''}</button>
              <button className={panel === 'handouts' ? 'on' : ''} onClick={() => setPanel('handouts')}>Handouts</button>
              <button className={panel === 'games' ? 'on' : ''} onClick={() => setPanel('games')}>Tables and decks</button>
              <button className={panel === 'table' ? 'on' : ''} onClick={() => setPanel('table')}>Table</button>
            </div>
            {panel === 'token' && (selectedTile && !selected.length && gm ? <TilePanel /> : <TokenPanel token={one} count={selected.length} />)}
            {panel === 'scene' && gm && scene && <TilesSection scene={scene} wsId={wsId} centre={() => engine.current?.centre() ?? { x: scene.width / 2, y: scene.height / 2 }} />}
            {panel === 'scene' && gm && scene && <ScenePanel scene={scene} active={active === scene.id} wsId={wsId} />}
            {panel === 'scene' && gm && scene && <TriggersSection scene={scene} />}
            {panel === 'table' && <TablePanel />}
            {panel === 'chat' && <ChatPanel />}
            {panel === 'handouts' && <HandoutsPanel />}
            {panel === 'games' && <TablesAndDecks />}
            {panel === 'combat' && <CombatPanel />}
            {panel === 'encounters' && gm && <EncounterPanel />}
          </aside>
        )}
      </div>
      <HandoutViewer />
      <ReadyBanner />
      {stats && <div className="tt-stats-badge" role="status" aria-label="Performance">{stats}</div>}
      <ThreatBanner />
      {pinAt && <PinDialog at={pinAt} onClose={() => setPinAt(null)} />}
      <AudioPlayer />
      {narrow && <MyStrip />}
      {narrow && (
        <nav className="tt-nav" aria-label="Table sections">
          <button className={!panelOpen ? 'on' : ''} aria-label="Map" onClick={() => setPanelOpen(false)}><MapIcon size={18} /><span>Map</span></button>
          <button className={panelOpen && panel === 'token' ? 'on' : ''} aria-label="Me" onClick={() => {
            const st = useTable.getState()
            const mine = st.tokens.find((t) => st.you && t.owners.includes(st.you.id))
            if (mine && !st.selected.length) useTable.setState({ selected: [mine.id], selectedTile: null })
            setPanel('token'); setPanelOpen(true)
          }}><UserRound size={18} /><span>Me</span></button>
          <button className={panelOpen && panel === 'combat' ? 'on' : ''} aria-label="Combat" onClick={() => { setPanel('combat'); setPanelOpen(true) }}><Swords size={18} /><span>{combat.active ? `Round ${combat.round}` : 'Combat'}</span></button>
          <button className={panelOpen && panel === 'chat' ? 'on' : ''} aria-label="Chat and dice" onClick={() => { setPanel('chat'); setPanelOpen(true) }}><Dices size={18} /><span>Chat{unread > 0 && !(panelOpen && panel === 'chat') ? ` (${unread})` : ''}</span></button>
          <button className={panelOpen && (panel === 'table' || panel === 'scene' || panel === 'encounters') ? 'on' : ''} aria-label="More" onClick={() => { setPanel(gm ? 'scene' : 'table'); setPanelOpen(true) }}><Ellipsis size={18} /><span>More</span></button>
        </nav>
      )}
    </div>
  )
}

/** On a phone: your own character's hit points, always in reach, without opening anything. */
function MyStrip() {
  const you = useTable((s) => s.you)
  const role = useTable((s) => s.role)
  const settings = useTable((s) => s.settings)
  const mine = useTable((s) => s.tokens.find((t) => !!you && t.owners.includes(you.id) && (t.data.hp as { max?: number } | undefined)?.max))
  if (!mine) return null
  const hp = mine.data.hp as { value?: number; max?: number; temp?: number }
  const can = role === 'gm' || (role === 'player' && settings.playersEditOwnStats)
  const ratio = hp.max ? Math.max(0, Math.min(1, (hp.value ?? 0) / hp.max)) : 0
  const change = async (sign: 1 | -1) => {
    const raw = await askText(sign === 1 ? 'Damage taken' : 'Healing received', { label: 'Amount', placeholder: '7', okLabel: sign === 1 ? 'Take damage' : 'Heal' })
    const n = Math.abs(parseInt(raw ?? '', 10))
    if (n) sendTable({ t: 'token.stat', id: mine.id, damage: sign * n })
  }
  return (
    <div className="tt-strip" aria-label={`${mine.name} hit points`}>
      <b className="ellipsis">{mine.name}</b>
      <div className="tt-hpbar" aria-hidden><span style={{ width: `${ratio * 100}%`, background: ratio > 0.5 ? '#4caf50' : ratio > 0.25 ? '#f1c40f' : '#e74c3c' }} /></div>
      <span className="tt-strip-hp">{hp.value ?? 0}/{hp.max}{hp.temp ? ` +${hp.temp}` : ''}</span>
      {can && <><button className="btn sm" onClick={() => change(1)}>Damage</button><button className="btn sm" onClick={() => change(-1)}>Heal</button></>}
    </div>
  )
}

/** Tokens copied with Ctrl+C, for Ctrl+V to put down again. */
let clipboard: Token[] = []

function TokenPanel({ token, count }: { token: Token | null; count: number }) {
  const role = useTable((s) => s.role)
  const members = useTable((s) => s.members)
  const tokens = useTable((s) => s.tokens)
  const wsId = useStore((s) => s.wsId)!
  const gm = role === 'gm'
  const [name, setName] = useState(token?.name ?? '')
  useEffect(() => setName(token?.name ?? ''), [token?.id, token?.name])
  if (!token) {
    return (
      <>
        {gm && count > 1 && <button className="btn sm" title="Roll each one's hit points from the dice on its sheet" onClick={() => sendTable({ t: 'token.rollhp', ids: useTable.getState().selected })}>Roll hit points for each</button>}
        <p className="muted tt-hint">{count > 1 ? `${count} tokens selected. R turns them, arrows move them${gm ? ', Delete removes them' : ''}.` : 'Click a token to select it. Hold Alt and click the map to ping. Drag empty ground to move the view, scroll to zoom.'}</p>
        <ul className="tt-tokens" aria-label="Tokens on this scene">
          {tokens.map((t) => <li key={t.id}><button className="btn ghost sm" onClick={() => useTable.setState({ selected: [t.id] })}><span className="tt-dot" style={{ background: t.color || '#6b7280' }} />{t.name || 'Unnamed'}{t.hidden ? ' (hidden)' : ''}</button></li>)}
        </ul>
      </>
    )
  }
  const patch = (p: Record<string, unknown>) => sendTable({ t: 'token.update', id: token.id, patch: p })
  const owned = new Set(token.owners)
  return (
    <div className="tt-form">
      <label>Name<input className="input" value={name} disabled={!gm} onChange={(e) => setName(e.target.value)} onBlur={() => name !== token.name && patch({ name })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>
      <TokenStats token={token} />
      <TokenBars token={token} can={gm} />
      <TokenActions token={token} gm={gm} />
      {gm && (
        <>
          <button className="btn sm" title="Roll the hit points from the dice on the sheet" onClick={() => sendTable({ t: 'token.rollhp', ids: [token.id] })}>Roll hit points</button>
          <TokenLook token={token} />
        </>
      )}
      {gm && (
        <>
          <LinkPage token={token} />
          <label>Size
            <Select className="input" value={String(token.size)} onChange={(v) => patch({ size: Number(v) })}>
              {[0.5, 1, 2, 3, 4, 5].map((s) => <option key={s} value={String(s)}>{s === 0.5 ? 'Tiny (half a cell)' : s === 1 ? 'Medium (1 cell)' : `${s} cells`}</option>)}
            </Select>
          </label>
          <SightLight token={token} />
          <label>Colour<input type="color" className="tt-color" value={token.color || '#6b7280'} onChange={(e) => patch({ color: e.target.value })} /></label>
          <div className="tt-row">
            <button className="btn sm" onClick={async () => { const f = await pickImage(); if (f) { const url = await uploadImage(wsId, f); if (url) patch({ image: url }) } }}>Set picture</button>
            {token.image && <button className="btn sm" onClick={() => patch({ image: '' })}>Remove picture</button>}
          </div>
          <div className="tt-row">
            <button className="btn sm" onClick={() => patch({ hidden: !token.hidden })}>{token.hidden ? <><Eye size={13} /> Reveal</> : <><EyeOff size={13} /> Hide</>}</button>
            <button className="btn sm" onClick={() => patch({ locked: !token.locked })}>{token.locked ? <><LockOpen size={13} /> Unlock</> : <><Lock size={13} /> Lock</>}</button>
            <button className="btn sm" title="Turn 45 degrees (R)" onClick={() => patch({ rotation: (token.rotation + 45) % 360 })}><RotateCw size={13} /></button>
          </div>
          <div className="tt-owners">
            <b>Who controls it</b>
            {members.filter((m) => m.role !== 'viewer').map((m) => (
              <label key={m.id} className="tt-check"><input type="checkbox" checked={owned.has(m.id)} onChange={(e) => patch({ owners: e.target.checked ? [...token.owners, m.id] : token.owners.filter((o) => o !== m.id) })} />{m.username}</label>
            ))}
          </div>
          <button className="btn sm danger" onClick={async () => { if (await confirmDialog(`“${token.name || 'This token'}” is removed from the scene for everyone.`, { title: 'Delete token', okLabel: 'Delete', danger: true })) sendTable({ t: 'token.delete', ids: [token.id] }) }}><Trash2 size={13} /> Delete token</button>
        </>
      )}
      <TokenSheet token={token} />
      {!gm && <div className="tt-row"><button className="btn sm" title="Turn 45 degrees (R)" disabled={!token.owners.length} onClick={() => patch({ rotation: (token.rotation + 45) % 360 })}><RotateCw size={13} /> Turn</button></div>}
    </div>
  )
}

/** Sends chosen players to look at this scene while the rest of the table stays where it is (the party splits). */
function SendPlayers({ scene }: { scene: Scene }) {
  const online = useTable((st) => st.online)
  const you = useTable((st) => st.you)
  const [picked, setPicked] = useState<string[]>([])
  const players = online.filter((o) => o.role === 'player' && o.id !== you?.id)
  if (!players.length) return null
  return (
    <div className="tt-form" role="group" aria-label="Send players to this scene">
      <b>Send players here</b>
      {players.map((o) => <label key={o.id} className="tt-check"><input type="checkbox" checked={picked.includes(o.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, o.id] : picked.filter((x) => x !== o.id))} />{o.username}</label>)}
      <button className="btn sm" disabled={!picked.length} onClick={() => { sendTable({ t: 'scene.send', id: scene.id, to: picked }); setPicked([]) }}>Send them to “{scene.name}”</button>
    </div>
  )
}

function ScenePanel({ scene, active, wsId }: { scene: Scene; active: boolean; wsId: string }) {
  const [name, setName] = useState(scene.name)
  const [editing, setEditing] = useState(false)
  const [library, setLibrary] = useState(false)
  useEffect(() => setName(scene.name), [scene.id, scene.name])
  const patch = (p: Record<string, unknown>) => sendTable({ t: 'scene.update', id: scene.id, patch: p })
  const num = (key: string, value: number, min: number) => (
    <input className="input" type="number" min={min} defaultValue={value} key={`${scene.id}${key}${value}`} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= min && n !== value) patch({ [key]: n }) }} />
  )
  return (
    <div className="tt-form">
      <label>Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== scene.name && patch({ name: name.trim() })} /></label>
      <div className="tt-row">
        <button className="btn sm" onClick={async () => { const f = await pickBackground(); if (!f) return; const size = f.type.startsWith('video/') ? await videoSize(f) : null; const url = await uploadImage(wsId, f); if (url) patch({ bg: url, ...(size ? { width: Math.min(40000, Math.max(100, size.width)), height: Math.min(40000, Math.max(100, size.height)) } : {}) }) }}>Set map image or loop</button>
        {scene.bg && <button className="btn sm" onClick={() => patch({ bg: '' })}>Remove image</button>}
      </div>
      <div className="tt-row">
        <button className="btn sm" title="Draw rooms, corridors, doors and lights and make this scene from them" onClick={() => setEditing(true)}>Open the map editor</button>
        <button className="btn sm" title="Every picture and sound of this world" onClick={() => setLibrary(true)}>Asset library</button>
      </div>
      {library && <AssetLibrary scene={scene} wsId={wsId} onClose={() => setLibrary(false)} />}
      {editing && <MapEditor scene={scene} wsId={wsId} onClose={() => setEditing(false)} />}
      <div className="tt-row">
        <button className="btn sm" title="Make a new scene from a map file made by Dungeondraft or another map tool" onClick={() => void importUvtt(wsId)}>Import a Universal VTT map</button>
        <button className="btn sm" title="Save this scene, its walls and lights as a map file" onClick={() => void exportUvtt(scene)}>Export as Universal VTT</button>
      </div>
      <label>Grid
        <Select className="input" value={scene.grid} onChange={(v) => patch({ grid: v })}>
          <option value="square">Square</option>
          <option value="hex-row">Hexes, pointy top</option>
          <option value="hex-col">Hexes, flat top</option>
          <option value="none">No grid</option>
        </Select>
      </label>
      <label>Cell size in pixels{num('gridSize', scene.gridSize, 10)}</label>
      <div className="tt-row">
        <label>Grid colour<input className="tt-color" type="color" aria-label="Grid colour" value={scene.gridColor ?? '#ffffff'} onChange={(e) => patch({ gridColor: e.target.value })} /></label>
        <label>Grid strength<input type="range" min={0} max={100} aria-label="Grid strength" value={Math.round((scene.gridOpacity ?? 0.28) * 100)} onChange={(e) => patch({ gridOpacity: Number(e.target.value) / 100 })} /></label>
      </div>
      <div className="tt-row">
        <label>Ambient colour<input className="tt-color" type="color" aria-label="Ambient colour" value={scene.ambient || '#ffd9a0'} onChange={(e) => patch({ ambient: e.target.value })} /></label>
        {scene.ambient && <button className="btn sm" onClick={() => patch({ ambient: '' })}>No ambient colour</button>}
      </div>
      <label>Folder<input className="input" aria-label="Scene folder" maxLength={60} placeholder="Chapter 1" defaultValue={scene.folder ?? ''} key={scene.id + (scene.folder ?? '')} onBlur={(e) => e.target.value.trim() !== (scene.folder ?? '') && patch({ folder: e.target.value.trim() })} /></label>
      <label>Notes for you<textarea className="input" aria-label="Scene notes" rows={3} maxLength={5000} placeholder="Read-aloud text, secrets, where the traps are" defaultValue={scene.notes ?? ''} key={scene.id + 'n'} onBlur={(e) => e.target.value !== (scene.notes ?? '') && patch({ notes: e.target.value })} /></label>
      <div className="tt-row">
        <button className="btn sm" onClick={() => sendTable({ t: 'scene.duplicate', id: scene.id })}>Duplicate this scene</button>
      </div>
      <SendPlayers scene={scene} />
      <div className="tt-row">
        <label>Cell is{num('dist', scene.dist, 0.1)}</label>
        <label>Unit<input className="input" defaultValue={scene.unit} key={scene.id + scene.unit} maxLength={8} onBlur={(e) => e.target.value.trim() && e.target.value !== scene.unit && patch({ unit: e.target.value.trim() })} /></label>
      </div>
      <label>Diagonal moves
        <Select className="input" value={scene.diagonal} onChange={(v) => patch({ diagonal: v })}>
          <option value="5-10-5">Every second diagonal counts double (5-10-5)</option>
          <option value="5-5-5">Every diagonal counts one cell (5-5-5)</option>
          <option value="euclid">Straight line length</option>
          <option value="manhattan">Across then down</option>
        </Select>
      </label>
      <label className="tt-check"><input type="checkbox" checked={scene.fog} onChange={(e) => patch({ fog: e.target.checked })} />Fog of war: players only see what their tokens see</label>
      <label>Weather
        <Select className="input" value={scene.weather ?? 'none'} onChange={(v) => patch({ weather: v })} title="Weather over the scene">
          <option value="none">Clear</option>
          <option value="rain">Rain</option>
          <option value="snow">Snow</option>
        </Select>
      </label>
      <label>Darkness ({Math.round(scene.darkness * 100)} %)<input type="range" min={0} max={100} value={Math.round(scene.darkness * 100)} onChange={(e) => patch({ darkness: Number(e.target.value) / 100 })} /></label>
      <DaylightControl scene={scene} />
      {scene.fog && <button className="btn sm" onClick={() => sendTable({ t: 'fog.reset', sceneId: scene.id })}>Forget what players explored</button>}
      <div className="tt-row"><label>Width (px){num('width', scene.width, 100)}</label><label>Height (px){num('height', scene.height, 100)}</label></div>
      <div className="tt-row">
        {!active && <button className="btn sm" onClick={() => sendTable({ t: 'scene.activate', id: scene.id })}>Move players here</button>}
        <button className="btn sm danger" onClick={async () => { if (await confirmDialog(`“${scene.name}” and every token on it are deleted for good.`, { title: 'Delete scene', okLabel: 'Delete', danger: true })) sendTable({ t: 'scene.delete', id: scene.id }) }}><Trash2 size={13} /> Delete scene</button>
      </div>
    </div>
  )
}

function TablePanel() {
  const online = useTable((s) => s.online)
  const settings = useTable((s) => s.settings)
  const members = useTable((s) => s.members)
  const you = useTable((s) => s.you)
  const role = useTable((s) => s.role)
  const gm = role === 'gm'
  const [replaying, setReplaying] = useState(false)
  const [lefty, setLefty] = useState(() => { try { return !!localStorage.getItem('tt-left') } catch { return false } })
  useEffect(() => { document.documentElement.classList.toggle('tt-lefty', lefty) }, [lefty])
  const wsId = useStore((s) => s.wsId)!
  const set = (patch: Record<string, unknown>) => sendTable({ t: 'settings.set', patch })
  const flags = useMemo(() => [
    ['playersMoveOwn', 'Players move their own tokens'],
    ['playersCreateTokens', 'Players add tokens'],
    ['playersEditOwnStats', 'Players change their own hit points and conditions'],
    ['playersOpenDoors', 'Players open and close doors'],
    ['playersDraw', 'Players draw on the map'],
    ['playersPing', 'Players ping the map'],
    ['playersRuler', 'Players share their ruler'],
    ['showCursors', 'Show everyone’s pointer'],
    ['sharedVision', 'Players see through each other’s tokens'],
  ] as const, [])
  return (
    <div className="tt-form">
      <b><Swords size={13} /> At the table</b>
      <ul className="tt-people">
        {online.map((o) => (
          <li key={o.id}><span className="avatar" style={{ background: colorFor(o.id) }}>{o.username.slice(0, 1).toUpperCase()}</span>{o.username}{o.id === you?.id ? ' (you)' : ''}<small className="muted"> {o.role === 'gm' ? 'GM' : o.role === 'spectator' ? 'watching' : ''}{settings.muted?.includes(o.id) ? ' muted' : ''}</small>
            <span className="grow" />
            {gm && o.id !== you?.id && o.role !== 'gm' && (
              <>
                <button className="btn ghost sm" aria-label={`${settings.muted?.includes(o.id) ? 'Unmute' : 'Mute'} ${o.username}`} onClick={() => sendTable({ t: 'user.mute', user: o.id, muted: !settings.muted?.includes(o.id) })}>{settings.muted?.includes(o.id) ? 'Unmute' : 'Mute'}</button>
                <button className="btn ghost sm" aria-label={`Send ${o.username} away`} title="Disconnects them; they can open the table again" onClick={() => sendTable({ t: 'user.kick', user: o.id })}>Kick</button>
                <button className="btn ghost sm danger" aria-label={`Ban ${o.username}`} onClick={async () => { if (await confirmDialog(`${o.username} is disconnected and cannot open this table until you let them back in.`, { title: 'Ban from the table', okLabel: 'Ban', danger: true })) sendTable({ t: 'user.ban', user: o.id, banned: true }) }}>Ban</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {gm && (settings.banned ?? []).length > 0 && (
        <ul className="tt-people" aria-label="Banned from the table">
          {(settings.banned ?? []).map((id) => <li key={id}><span className="grow">{members.find((m) => m.id === id)?.username ?? 'Someone'} <small className="muted">banned</small></span><button className="btn sm" aria-label={`Let ${members.find((m) => m.id === id)?.username ?? 'them'} back in`} onClick={() => sendTable({ t: 'user.ban', user: id, banned: false })}>Let back in</button></li>)}
        </ul>
      )}
      <label className="tt-check"><input type="checkbox" checked={lefty} onChange={(e) => { setLefty(e.target.checked); try { localStorage.setItem('tt-left', e.target.checked ? '1' : '') } catch { /* private window */ } }} />Panel on the left (for left-handed use)</label>
      <div className="tt-form" role="group" aria-label="Slower machine">
        <b>If the table is slow</b>
        <PerfBox k="fogOnDrop" label="Work out the fog when a token is put down" />
        <PerfBox k="light" label="Lighter drawing: coarser fog, no weather, no moving lights" />
        <PerfBox k="show" label="Show frames per second" />
      </div>
      <div className="tt-form" role="group" aria-label="Keys">
        <b>Keys</b>
        {KEY_ACTIONS.filter((a) => !a.gm || gm).map((a) => <KeyField key={a.id} action={a.id} label={a.label} />)}
      </div>
      {gm && <button className="btn sm" title="Watch the last session again: tokens moving over the map, and what was said" onClick={() => setReplaying(true)}>Replay the last session</button>}
      {replaying && <Replay wsId={wsId} onClose={() => setReplaying(false)} />}
      {gm && <button className="btn sm" title="Ask everyone whether they are ready" onClick={() => sendTable({ t: 'ready.start' })}>Ready check</button>}
      {gm && (
        <>
          <b><Crosshair size={13} /> Rules of the table</b>
          {flags.map(([k, label]) => <label key={k} className="tt-check"><input type="checkbox" checked={settings[k]} onChange={(e) => set({ [k]: e.target.checked })} />{label}</label>)}
          <b>Rules the table applies for you</b>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>All off, so you play by hand until you choose. They apply to tokens linked to a sheet.</p>
          {([['damage', 'Damage types: resistance, vulnerability and immunity'], ['concentration', 'Concentration saves when someone who concentrates is hurt'], ['deathSaves', 'Falling unconscious at 0 hit points, and death saves'], ['attacks', 'Attacks and saves rolled against targets, with the damage applied']] as const).map(([k, label]) => (
            <label key={k} className="tt-check"><input type="checkbox" checked={settings.automation[k]} onChange={(e) => set({ automation: { ...settings.automation, [k]: e.target.checked } })} />{label}</label>
          ))}
          <b>Also runs the table</b>
          {members.filter((m) => m.role !== 'owner' && m.role !== 'viewer').map((m) => (
            <label key={m.id} className="tt-check"><input type="checkbox" checked={settings.gms.includes(m.id)} onChange={(e) => set({ gms: e.target.checked ? [...settings.gms, m.id] : settings.gms.filter((g) => g !== m.id) })} />{m.username}</label>
          ))}
        </>
      )}
    </div>
  )
}

/** One shortcut: click the box and press the letter or number it should have from now on (kept in this browser). */
function KeyField({ action, label }: { action: KeyAction; label: string }) {
  const [keys, setKeys] = useState(loadKeys)
  const [error, setError] = useState('')
  return (
    <div className="tt-row">
      <span className="grow">{label}</span>
      <input className="input tt-num" aria-label={label} value={keys[action].toUpperCase()} readOnly maxLength={1} title="Click, then press the key"
        onKeyDown={(e) => {
          if (e.key === 'Tab') return
          e.preventDefault(); e.stopPropagation()
          const r = bind(keys, action, e.key)
          if ('error' in r) { setError(r.error); return }
          setError(''); setKeys(r.keys); saveKeys(r.keys); window.dispatchEvent(new Event('tt-keys'))
        }} />
      <button className="btn ghost sm" aria-label={`Reset to ${DEFAULT_KEYS[action].toUpperCase()} (${action})`} disabled={keys[action] === DEFAULT_KEYS[action]} onClick={() => { const next = { ...keys, [action]: DEFAULT_KEYS[action] }; setKeys(next); saveKeys(next); setError(''); window.dispatchEvent(new Event('tt-keys')) }}>Reset</button>
      {error && <small role="alert" className="muted">{error}</small>}
    </div>
  )
}

/** One option for a slow machine, kept in this browser. */
function PerfBox({ k, label }: { k: keyof Perf; label: string }) {
  const [perf, setPerf] = useState(loadPerf)
  useEffect(() => { const on = () => setPerf(loadPerf()); window.addEventListener('tt-perf', on); return () => window.removeEventListener('tt-perf', on) }, [])
  return <label className="tt-check"><input type="checkbox" checked={perf[k]} onChange={(e) => savePerf({ ...loadPerf(), [k]: e.target.checked })} />{label}</label>
}

/** The hour of the day at the table. A scene that follows it is dark at night and light by day, set by the server for everyone. */
function DaylightControl({ scene }: { scene: Scene }) {
  const hour = useTable((s) => s.settings.hour ?? 12)
  const daylight = useTable((s) => s.settings.daylight ?? [])
  const follows = daylight.includes(scene.id)
  const set = (patch: Record<string, unknown>) => sendTable({ t: 'settings.set', patch })
  return (
    <div className="tt-form" role="group" aria-label="Time of day">
      <b>Time of day: {String(hour).padStart(2, '0')}:00, {partOfDay(hour)}</b>
      <div className="tt-row">
        <button className="btn sm" aria-label="One hour earlier" onClick={() => set({ hour: (hour + 23) % 24 })}>-1 h</button>
        <input type="range" min={0} max={23} aria-label="Hour of the day" value={hour} onChange={(e) => set({ hour: Number(e.target.value) })} />
        <button className="btn sm" aria-label="One hour later" onClick={() => set({ hour: (hour + 1) % 24 })}>+1 h</button>
      </div>
      <label className="tt-check"><input type="checkbox" checked={follows} onChange={(e) => set({ daylight: e.target.checked ? [...daylight, scene.id] : daylight.filter((x) => x !== scene.id) })} />This scene follows the time of day</label>
    </div>
  )
}
