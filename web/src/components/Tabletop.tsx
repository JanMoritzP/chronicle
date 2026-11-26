import { Color } from 'pixi.js'
import { BrickWall, ChevronRight, Dices, Eraser, Eye, EyeOff, Focus, Lightbulb, Lock, LockOpen, Map as MapIcon, MapPin, Maximize, MessageSquare, Minus, MousePointer2, PanelRightClose, PanelRightOpen, Pencil, Plus, Ruler, RotateCw, ScanEye, ScrollText, Settings2, Skull, SquareDashed, Sun, SunDim, Swords, Trash2, UserPlus, UserRound, Users, Ellipsis, Crosshair, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { askText, confirmDialog } from '../lib/dialog'
import { colorFor } from '../lib/collab'
import { useStore } from '../store'
import { TableEngine, type Tool } from '../tabletop/engine'
import { snap } from '../tabletop/grid'
import { isLightSource, joinTable, leaveTable, onTableMessage, sendTable, useTable, type DrawKind, type Scene, type Token } from '../tabletop/state'
import { pickBackground, pickImage, uploadImage, videoSize } from '../tabletop/upload'
import { exportUvtt, importUvtt } from '../tabletop/uvttFiles'
import { EncounterPanel } from './TableEncounters'
import { shownTiles, shownTokens, TilePanel, TilesSection, TokenLayer } from './TableTiles'
import { HandoutViewer, HandoutsPanel } from './TableHandouts'
import { AudioPlayer } from './TableAudio'
import { TriggersSection } from './TableTriggers'
import { MapEditor } from './MapEditor'
import { AssetLibrary } from './AssetLibrary'
import { saveMessageAsMacro } from './TableMacros'
import { partOfDay } from '../lib/daylight'
import { loadPerf, savePerf, statsText, type Perf } from '../lib/tableperf'
import { bind, DEFAULT_KEYS, KEY_ACTIONS, loadKeys, pressed, saveKeys, type KeyAction } from '../lib/tablekeys'
import { PinDialog } from './PinDialog'
import { ReadyBanner } from './ReadyBanner'
import { ThreatBanner } from './ThreatBanner'
import { DiceTray } from './DiceTray'
import { CallPanel } from './CallPanel'
import { Replay } from './Replay'
import { TokenActions, TokenBars, TokenLook } from './TokenLook'
import { TablesAndDecks } from './TableDecks'
import { AREA_PRESETS, LIGHT_PRESETS, LightSourcePanel, SceneLights } from './TableLight'
import { ChatPanel, CombatPanel, LinkPage, PagePicture, SightLight, TokenSheet, TokenStats } from './TableParts'
import { Select } from './Select'
import { blockedPath } from '../tabletop/movement'

const WALL_HINTS = {
  wall: 'Stops sight, light and tokens',
  door: 'Click it to open or close it; Ctrl-click locks it',
  secret: 'A door that looks like a wall to the players until it is opened',
  window: 'Sight and light pass, tokens do not',
  oneway: 'Seen through from the side its arrow points to only',
  terrain: 'A hill or hedge: seen past once, but two of them in a row block the view. Tokens walk over it.',
} as const

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
      onLightPlace: (p) => {
        const st = useTable.getState()
        const id = st.sceneId
        if (!id) return
        const n = st.tokens.filter(isLightSource).length + 1
        const area = AREA_PRESETS.find((x) => x.id === lightPresetRef.current)
        if (area) { sendTable({ t: 'token.add', sceneId: id, token: { name: `${area.label} ${n}`, hidden: true, size: 0.5, x: p.x, y: p.y, data: { lightSource: true, obscure: { ...area.area } } } }); return }
        const preset = LIGHT_PRESETS.find((x) => x.id === lightPresetRef.current) ?? LIGHT_PRESETS[1]
        sendTable({ t: 'token.add', sceneId: id, token: { name: `${preset.label} ${n}`, hidden: true, size: 0.5, x: p.x, y: p.y, data: { lightSource: true, light: { ...preset.light } } } })
      },
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
        e.setViewer({ shared: s.settings.sharedVision, id: s.you?.id ?? '', gm: s.role === 'gm', spectator: s.role === 'spectator', canDoors: s.role === 'player' && s.settings.playersOpenDoors, wallsBlock: s.settings.wallsBlockMovement !== false })
      }
      viewer()
      push()
      e.setWalls(useTable.getState().walls)
      e.setReveals(useTable.getState().reveals)
      e.setPins(useTable.getState().pins)
      e.setTriggers(useTable.getState().triggers.filter((t) => !t.scene || t.scene === useTable.getState().sceneId).filter((t) => t.event === 'enter'))
      e.setLights(useTable.getState().lights)
      e.setTokens(shownTokens(useTable.getState()))
      e.setSelected(useTable.getState().selected)
      e.setExplored(useTable.getState().fog)
      e.setDrawings(useTable.getState().drawings)
      e.setTiles(shownTiles(useTable.getState()))
      e.setSelectedTile(useTable.getState().selectedTile)
      e.setDrawStyle({ kind: 'free', color: '#ff5252', width: 4, fill: '' })
      const turn = () => { const s = useTable.getState(); e.setTurn(s.combat.active ? s.combat.list.find((x) => x.id === s.combat.turn)?.tokenId ?? null : null) }
      turn()
      const unsub = useTable.subscribe((s, prev) => {
        if (s.role !== prev.role || s.you !== prev.you || s.settings.playersOpenDoors !== prev.settings.playersOpenDoors || s.settings.sharedVision !== prev.settings.sharedVision || s.settings.wallsBlockMovement !== prev.settings.wallsBlockMovement) viewer()
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
        if (s.tokens !== prev.tokens || s.hiddenLayers !== prev.hiddenLayers) e.setTokens(shownTokens(s))
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
  // what a light placed with the light tool is like, and whether the GM sees the scene's light (both kept in this browser)
  const [lightPreset, setLightPresetState] = useState(() => { try { return localStorage.getItem('tt-light-preset') || 'torch' } catch { return 'torch' } })
  const lightPresetRef = useRef(lightPreset)
  const setLightPreset = (id: string) => { setLightPresetState(id); lightPresetRef.current = id; try { localStorage.setItem('tt-light-preset', id) } catch { /* private window */ } }
  const [gmLight, setGmLightState] = useState(() => { try { return localStorage.getItem('tt-gm-light') !== '0' } catch { return true } })
  const setGmLight = (on: boolean) => { setGmLightState(on); try { localStorage.setItem('tt-gm-light', on ? '1' : '0') } catch { /* private window */ } }
  useEffect(() => { engine.current?.setGmLight(gmLight) }, [gmLight])
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
  // a right click on a roll button of a sheet keeps that roll as a macro
  useEffect(() => { const on = (e: Event) => void saveMessageAsMacro((e as CustomEvent<string>).detail); window.addEventListener('tt-save-macro', on); return () => window.removeEventListener('tt-save-macro', on) }, [])
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
      // a nudge into a wall goes nowhere (the GM passes with Ctrl, as when dragging)
      const free = st.settings.wallsBlockMovement === false || (gm && (e.ctrlKey || e.metaKey))
      const moves = sel.map((t) => ({ id: t.id, x: t.x + d[0] * scene.gridSize, y: t.y + d[1] * scene.gridSize })).filter((m, i) => free || !blockedPath(sel[i], m, st.walls))
      if (moves.length) sendTable({ t: 'token.move', moves })
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

  const tabs: { id: typeof panel; label: string; icon: React.ReactNode; badge?: string; show: boolean }[] = [
    { id: 'token', label: 'Token', icon: <MousePointer2 size={16} />, show: true },
    { id: 'combat', label: 'Combat', icon: <Swords size={16} />, badge: combat.active ? `R${combat.round}` : undefined, show: true },
    { id: 'chat', label: 'Chat', icon: <MessageSquare size={16} />, badge: unread > 0 && panel !== 'chat' ? String(unread) : undefined, show: true },
    { id: 'scene', label: 'Scene', icon: <MapIcon size={16} />, show: gm },
    { id: 'encounters', label: 'Encounters', icon: <Skull size={16} />, show: gm },
    { id: 'handouts', label: 'Handouts', icon: <ScrollText size={16} />, show: true },
    { id: 'games', label: 'Tables and decks', icon: <Dices size={16} />, show: true },
    { id: 'table', label: 'Table', icon: <Settings2 size={16} />, show: true },
  ]
  const title: Record<typeof panel, string> = { token: one ? (isLightSource(one) ? (one.data.obscure ? (one.data.obscure.kind === 'fog' ? 'Fog' : 'Magical darkness') : 'Light') : one.name || 'Token') : selected.length > 1 ? `${selected.length} tokens` : selectedTile ? 'Prop' : 'Tokens', combat: 'Combat', chat: 'Chat and dice', scene: scene?.name ?? 'Scene', encounters: 'Encounters', handouts: 'Handouts', games: 'Tables, decks and sound', table: 'The table' }
  const toolButton = (t: Tool, label: string, hint: string, icon: React.ReactNode) => (
    <button className={`tt-tool${tool === t ? ' on' : ''}`} title={hint} aria-label={label} aria-pressed={tool === t} onClick={() => setTool(tool === t && t !== 'select' ? 'select' : t)}>{icon}</button>
  )
  const lit = !!scene && scene.lighting !== false && scene.darkness > 0

  return (
    <div className="tt" tabIndex={0} onKeyDown={onKey}>
      <div className="tt-bar">
        {gm
          ? <Select className="input tt-scene" value={sceneId ?? ''} placeholder="No scenes yet" onChange={(id) => sendTable({ t: 'view', sceneId: id })}>
              {[...scenes].sort((a, b) => (a.folder ?? '').localeCompare(b.folder ?? '') || a.sort - b.sort).map((s) => <option key={s.id} value={s.id}>{s.folder ? `${s.folder} › ` : ''}{s.name}{s.id === active ? ' (players are here)' : ''}</option>)}
            </Select>
          : <b className="tt-scene-name ellipsis">{scene?.name ?? 'Waiting for the GM'}</b>}
        {gm && <button className="btn sm square" title="New scene" aria-label="New scene" onClick={addScene}><Plus size={14} /></button>}
        {gm && scene && scene.id !== active && <button className="btn sm primary" title="Bring every player to this scene" onClick={() => sendTable({ t: 'scene.activate', id: scene.id })}><Users size={13} /> Move players here</button>}
        {gm && scene && scene.id === active && <span className="tt-live" title="The players are on this scene">Players are here</span>}
        <span className="grow" />
        {gm && scene && lit && (
          <button className={`btn sm square${gmLight ? ' on' : ''}`} aria-pressed={gmLight} aria-label="Show the light on my screen" title={gmLight ? 'You see the darkness and the light, softened. Click to see the plain map.' : 'Show the darkness and the light, softened'} onClick={() => setGmLight(!gmLight)}>{gmLight ? <Sun size={14} /> : <SunDim size={14} />}</button>
        )}
        {gm && scene && (
          <Select className="input tt-preview" value={previewing ? previewKey : ''} title="See the scene as a player does" onChange={setPreviewKey}>
            <option value="">GM view</option>
            {previewOptions.all && <option value={previewOptions.all.key}>{previewOptions.all.label}</option>}
            {previewOptions.players.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            {previewOptions.tokens.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </Select>
        )}
        {previewing && <button className="btn sm primary" aria-label="Leave the preview" onClick={() => setPreviewKey('')}><Eye size={13} /> {previewing.label.replace(/^(As|Through) /, '')}</button>}
        {gm && scene && (
          <Select className="input tt-preview" value="" placeholder="Views" title="Saved views" onChange={async (v) => {
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
        )}
        {gm && scene && <button className="btn sm square" title="Show everyone on this scene the part of it you are looking at" aria-label="Bring everyone here" onClick={() => { const v = engine.current?.getView(); if (v) sendTable({ t: 'camera.pull', x: v.x, y: v.y, w: v.w, h: v.h }) }}><Focus size={14} /></button>}
        <span className={`tt-conn ${conn}`} title={conn === 'open' ? 'Connected' : 'Reconnecting'}>{conn === 'open' ? '' : conn === 'connecting' ? 'Connecting…' : 'Offline, reconnecting…'}</span>
        {!narrow && <button className="btn sm square tt-toggle" aria-label={panelOpen ? 'Hide panel' : 'Show panel'} title={panelOpen ? 'Hide the panel' : 'Show the panel'} onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}</button>}
      </div>
      {error && <div className="tt-error" role="alert" onClick={() => useTable.setState({ error: '' })}>{error}</div>}
      <div className="tt-main">
        <div className="tt-canvas" ref={host}>
          {!scene && <div className="tt-empty">{gm ? <><b>No scene yet</b><span className="muted">A scene is a battle map: a picture, a grid, walls and light.</span><button className="btn primary" onClick={addScene}><Plus size={14} /> Make the first scene</button></> : <span className="muted">The GM has not opened a scene yet.</span>}</div>}
          {scene && (
            <div className="tt-rail" role="toolbar" aria-label="Tools" aria-orientation="vertical">
              {toolButton('select', 'Select', 'Select and move (Esc)', <MousePointer2 size={16} />)}
              {toolButton('ruler', 'Ruler', 'Measure a distance (Shift keeps the last leg)', <Ruler size={16} />)}
              {canDraw && toolButton('draw', 'Draw', 'Draw on the map, or mark a spell area', <Pencil size={16} />)}
              {canDraw && toolButton('erase', 'Erase', 'Click a drawing to remove it (the GM also removes walls and pins)', <Eraser size={16} />)}
              {gm && <span className="tt-rail-sep" />}
              {gm && toolButton('wall', 'Draw walls', 'Walls, doors and windows: they stop sight, light and tokens', <BrickWall size={16} />)}
              {gm && toolButton('light', 'Place a light', 'Click the map to place a light', <Lightbulb size={16} />)}
              {gm && toolButton('pin', 'Pin a note', 'Click the map to pin a note, with a page if you like', <MapPin size={16} />)}
              {gm && toolButton('reveal', 'Show an area', 'Drag a rectangle to show that part of the map to the players', <ScanEye size={16} />)}
              {gm && toolButton('conceal', 'Hide a shown area', 'Click an area you showed to take it back', <SquareDashed size={16} />)}
              {canAdd && <span className="tt-rail-sep" />}
              {canAdd && <button className="tt-tool" title="Add a token in the middle of the view" aria-label="New token" onClick={addToken}><UserPlus size={16} /></button>}
              <span className="tt-rail-sep" />
              <button className="tt-tool" title="Zoom in" aria-label="Zoom in" onClick={() => engine.current?.zoomBy(1.25)}><Plus size={16} /></button>
              <button className="tt-tool" title="Zoom out" aria-label="Zoom out" onClick={() => engine.current?.zoomBy(0.8)}><Minus size={16} /></button>
              <button className="tt-tool" title="Fit the scene (F)" aria-label="Fit the scene" onClick={() => engine.current?.fit()}><Maximize size={16} /></button>
            </div>
          )}
          {scene && tool !== 'select' && (
            <div className="tt-options" role="group" aria-label="Tool options">
              {tool === 'ruler' && <span className="tt-hint-inline">Drag to measure. Hold Shift to keep the last leg and go round a corner.</span>}
              {tool === 'draw' && (
                <>
                  <span className="seg tt-kinds" role="group" aria-label="Kind of drawing">
                    {([['free', 'Pen', 'Draw freehand'], ['line', 'Line', 'A straight line'], ['arrow', 'Arrow', 'A line with a head'], ['polygon', 'Shape', 'Click the corners, double-click to close it'], ['rect', 'Box', 'A rectangle'], ['ellipse', 'Circle', 'An ellipse'], ['text', 'Text', 'Write on the map']] as const).map(([k, label, hint]) => <button key={k} className={draw.kind === k ? 'on' : ''} title={hint} onClick={() => setDraw({ ...draw, kind: k })}>{label}</button>)}
                  </span>
                  <span className="seg tt-kinds" role="group" aria-label="Spell areas">
                    {([['cone', 'Cone', 'Spell area: a cone from the origin, as long as it is wide at the end'], ['beam', 'Ray', 'Spell area: a line one cell wide'], ['blast', 'Burst', 'Spell area: a circle from its centre'], ['cube', 'Cube', 'Spell area: a square from the middle of one side']] as const).map(([k, label, hint]) => <button key={k} className={draw.kind === k ? 'on' : ''} title={hint} onClick={() => setDraw({ ...draw, kind: k })}>{label}</button>)}
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
              {tool === 'erase' && (
                <>
                  <span className="tt-hint-inline">Click a drawing to remove it{gm ? ', or a wall or pin' : ''}.</span>
                  {gm && <button className="btn sm" title="Remove every drawing on this scene" onClick={async () => { if (await confirmDialog('Every drawing on this scene is removed for everyone.', { title: 'Clear drawings', okLabel: 'Clear', danger: true })) sendTable({ t: 'draw.clear', sceneId: scene.id }) }}>Clear drawings</button>}
                </>
              )}
              {gm && tool === 'wall' && (
                <>
                  <span className="seg tt-kinds" role="group" aria-label="Kind of wall">
                    {(['wall', 'door', 'secret', 'window', 'oneway', 'terrain'] as const).map((k) => <button key={k} className={wallKind === k ? 'on' : ''} title={WALL_HINTS[k]} onClick={() => setWallKind(k)}>{k === 'wall' ? 'Wall' : k === 'door' ? 'Door' : k === 'secret' ? 'Secret door' : k === 'window' ? 'Window' : k === 'oneway' ? 'One-way' : 'Terrain'}</button>)}
                  </span>
                  <span className="seg tt-kinds" role="group" aria-label="Shape of wall drawing">
                    <button className={wallShape === 'line' ? 'on' : ''} onClick={() => setWallShape('line')}>Lines</button>
                    <button className={wallShape === 'rect' ? 'on' : ''} onClick={() => setWallShape('rect')}>Rectangle</button>
                  </span>
                  <span className="tt-hint-inline">{wallShape === 'line' ? 'Click to place points, double-click or Enter to finish. Drag an end to move it.' : 'Drag a rectangle: four walls at once.'}</span>
                </>
              )}
              {gm && tool === 'light' && (
                <>
                  <label className="tt-inline">Place
                    <Select className="input" value={lightPreset} onChange={setLightPreset} title="What a click places; change it later in its panel">
                      {LIGHT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.light.bright}/{p.light.dim} {scene.unit})</option>)}
                      {AREA_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.area.radius} {scene.unit} radius)</option>)}
                    </Select>
                  </label>
                  <span className="tt-hint-inline">{AREA_PRESETS.some((p) => p.id === lightPreset)
                    ? (scene.fog || lit ? 'Click the map to place it. It blocks the view of players, darkvision included.' : 'Click the map to place it. Switch fog of war or lighting on in the Scene panel to see it work.')
                    : lit ? 'Click the map to place one.' : 'Click the map to place one. Switch lighting on in the Scene panel to see it work.'}</span>
                </>
              )}
              {gm && tool === 'pin' && <span className="tt-hint-inline">Click the map to pin a note.</span>}
              {gm && tool === 'reveal' && <span className="tt-hint-inline">Drag a rectangle: players see it as if their tokens had.</span>}
              {gm && tool === 'conceal' && <span className="tt-hint-inline">Click a shown area to hide it again.</span>}
              <button className="btn ghost sm square" title="Back to select (Esc)" aria-label="Close the tool" onClick={() => setTool('select')}><X size={14} /></button>
            </div>
          )}
          {stats && <div className="tt-stats-badge" role="status" aria-label="Performance">{stats}</div>}
          <DiceTray />
          <CallPanel />
        </div>
        {panelOpen && (
          <aside className={`tt-panel${narrow ? ' sheet' : ''}`} aria-label="Table panel">
            <div className="tt-tabs" role="group" aria-label="Panel">
              {tabs.filter((t) => t.show).map((t) => (
                <button key={t.id} aria-pressed={panel === t.id} className={panel === t.id ? 'on' : ''} aria-label={t.label} title={t.label} onClick={() => setPanel(t.id)}>
                  {t.icon}{t.badge && <span className="tt-badge">{t.badge}</span>}
                </button>
              ))}
            </div>
            <h3 className="tt-panel-title ellipsis">{title[panel]}</h3>
            <div className="tt-panel-body">
              {panel === 'token' && (selectedTile && !selected.length && gm ? <TilePanel /> : <TokenPanel token={one} count={selected.length} />)}
              {panel === 'scene' && gm && scene && <ScenePanel scene={scene} active={active === scene.id} wsId={wsId} onPlaceLight={() => setTool('light')} centre={() => engine.current?.centre() ?? { x: scene.width / 2, y: scene.height / 2 }} />}
              {panel === 'scene' && gm && !scene && <p className="muted tt-hint">Create a scene first.</p>}
              {panel === 'table' && <TablePanel />}
              {panel === 'chat' && <ChatPanel />}
              {panel === 'handouts' && <HandoutsPanel />}
              {panel === 'games' && <TablesAndDecks />}
              {panel === 'combat' && <CombatPanel />}
              {panel === 'encounters' && gm && <EncounterPanel />}
            </div>
          </aside>
        )}
      </div>
      <HandoutViewer />
      <ReadyBanner />
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

/** A part of a panel that folds away, so a long panel shows only what is being worked on. Open or closed is remembered in this browser. */
function Fold({ id, title, open: initial = false, children }: { id: string; title: string; open?: boolean; children: React.ReactNode }) {
  const key = `tt-fold:${id}`
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(key); return v == null ? initial : v === '1' } catch { return initial } })
  return (
    <details className="tt-fold" open={open} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o === open) return; setOpen(o); try { localStorage.setItem(key, o ? '1' : '0') } catch { /* private window */ } }}>
      <summary><ChevronRight size={14} className="tt-fold-mark" />{title}</summary>
      {open && <div className="tt-fold-body">{children}</div>}
    </details>
  )
}

function TokenPanel({ token, count }: { token: Token | null; count: number }) {
  const role = useTable((s) => s.role)
  const members = useTable((s) => s.members)
  const tokens = useTable((s) => s.tokens)
  const wsId = useStore((s) => s.wsId)!
  const gm = role === 'gm'
  const [name, setName] = useState(token?.name ?? '')
  useEffect(() => setName(token?.name ?? ''), [token?.id, token?.name])
  if (!token) {
    const creatures = tokens.filter((t) => !isLightSource(t))
    return (
      <>
        {gm && count > 1 && <button className="btn sm" title="Roll each one's hit points from the dice on its sheet" onClick={() => sendTable({ t: 'token.rollhp', ids: useTable.getState().selected })}>Roll hit points for each</button>}
        <p className="muted tt-hint">{count > 1 ? `${count} tokens selected. R turns them, arrows move them${gm ? ', Delete removes them' : ''}.` : 'Click a token to select it. Alt-click the map to ping. Drag empty ground to move the view, scroll to zoom.'}</p>
        {creatures.length > 0 && (
          <ul className="tt-tokens" aria-label="Tokens on this scene">
            {creatures.map((t) => <li key={t.id}><button className="btn ghost sm" onClick={() => useTable.setState({ selected: [t.id] })}><span className="tt-dot" style={{ background: t.color || '#6b7280' }} />{t.name || 'Unnamed'}{t.hidden ? ' (hidden)' : ''}</button></li>)}
          </ul>
        )}
      </>
    )
  }
  if (isLightSource(token)) return gm ? <LightSourcePanel token={token} /> : null
  const patch = (p: Record<string, unknown>) => sendTable({ t: 'token.update', id: token.id, patch: p })
  const owned = new Set(token.owners)
  const canTurn = gm || (!!useTable.getState().you && token.owners.includes(useTable.getState().you!.id))
  return (
    <div className="tt-form">
      {gm
        ? <label className="tt-name">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== token.name && patch({ name })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>
        : null}
      <div className="tt-quick" role="group" aria-label="Token actions">
        {gm && <button className="btn sm" onClick={() => patch({ hidden: !token.hidden })}>{token.hidden ? <><Eye size={13} /> Reveal</> : <><EyeOff size={13} /> Hide</>}</button>}
        {gm && <button className="btn sm" onClick={() => patch({ locked: !token.locked })}>{token.locked ? <><LockOpen size={13} /> Unlock</> : <><Lock size={13} /> Lock</>}</button>}
        {canTurn && <button className="btn sm square" title="Turn 45 degrees (R)" aria-label="Turn" onClick={() => patch({ rotation: (token.rotation + 45) % 360 })}><RotateCw size={13} /></button>}
        {gm && <button className="btn sm square danger" title="Delete token" aria-label="Delete token" onClick={async () => { if (await confirmDialog(`“${token.name || 'This token'}” is removed from the scene for everyone.`, { title: 'Delete token', okLabel: 'Delete', danger: true })) sendTable({ t: 'token.delete', ids: [token.id] }) }}><Trash2 size={13} /></button>}
      </div>
      <TokenStats token={token} />
      {!gm && <TokenBars token={token} can={false} />}
      {!gm && <TokenActions token={token} gm={false} />}
      <TokenSheet token={token} />
      {gm && (
        <>
          <Fold id="token-control" title="Character and control">
            <LinkPage token={token} />
            <div className="tt-owners">
              <b>Who moves it</b>
              {members.map((m) => (
                <label key={m.id} className="tt-check"><input type="checkbox" checked={owned.has(m.id)} onChange={(e) => patch({ owners: e.target.checked ? [...token.owners, m.id] : token.owners.filter((o) => o !== m.id) })} />{m.username}{m.role === 'viewer' ? <small className="muted"> (reads the world)</small> : null}</label>
              ))}
              {members.length < 2 && <p className="muted tt-hint">Invite players to the world first (Settings, Worlds).</p>}
            </div>
          </Fold>
          <Fold id="token-look" title="Appearance">
            <label>Size
              <Select className="input" value={String(token.size)} onChange={(v) => patch({ size: Number(v) })}>
                {[0.5, 1, 2, 3, 4, 5].map((s) => <option key={s} value={String(s)}>{s === 0.5 ? 'Tiny (half a cell)' : s === 1 ? 'Medium (1 cell)' : s === 2 ? 'Large (2 cells)' : s === 3 ? 'Huge (3 cells)' : s === 4 ? 'Gargantuan (4 cells)' : `${s} cells`}</option>)}
              </Select>
            </label>
            <div className="tt-row">
              <label className="tt-light-colour">Colour<input type="color" className="tt-color" value={token.color || '#6b7280'} onChange={(e) => patch({ color: e.target.value })} /></label>
              <button className="btn sm" onClick={async () => { const f = await pickImage(); if (f) { const url = await uploadImage(wsId, f); if (url) patch({ image: url }) } }}>Set picture</button>
              {token.image && <button className="btn ghost sm" onClick={() => patch({ image: '' })}>Remove picture</button>}
            </div>
            <PagePicture token={token} />
            <TokenLook token={token} />
            <TokenLayer token={token} />
            <button className="btn sm" title="Roll the hit points from the dice on the sheet" onClick={() => sendTable({ t: 'token.rollhp', ids: [token.id] })}>Roll hit points</button>
          </Fold>
          <Fold id="token-bars" title="Bars and action buttons">
            <TokenBars token={token} can />
            <TokenActions token={token} gm />
          </Fold>
          <Fold id="token-sight" title="Vision and light">
            <SightLight token={token} />
          </Fold>
        </>
      )}
    </div>
  )
}

/** Sends chosen players to look at this scene while the rest of the table stays where it is (the party splits). */
function SendPlayers({ scene }: { scene: Scene }) {
  const online = useTable((st) => st.online)
  const you = useTable((st) => st.you)
  const [picked, setPicked] = useState<string[]>([])
  const players = online.filter((o) => o.role === 'player' && o.id !== you?.id)
  if (!players.length) return <p className="muted tt-hint">No players are at the table right now.</p>
  return (
    <div className="tt-form" role="group" aria-label="Send players to this scene">
      <b>Send some players here</b>
      {players.map((o) => <label key={o.id} className="tt-check"><input type="checkbox" checked={picked.includes(o.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, o.id] : picked.filter((x) => x !== o.id))} />{o.username}</label>)}
      <button className="btn sm" disabled={!picked.length} onClick={() => { sendTable({ t: 'scene.send', id: scene.id, to: picked }); setPicked([]) }}>Send them to “{scene.name}”</button>
    </div>
  )
}

function ScenePanel({ scene, active, wsId, onPlaceLight, centre }: { scene: Scene; active: boolean; wsId: string; onPlaceLight: () => void; centre: () => { x: number; y: number } }) {
  const [name, setName] = useState(scene.name)
  const [editing, setEditing] = useState(false)
  const [library, setLibrary] = useState(false)
  useEffect(() => setName(scene.name), [scene.id, scene.name])
  const patch = (p: Record<string, unknown>) => sendTable({ t: 'scene.update', id: scene.id, patch: p })
  const num = (key: string, value: number, min: number, label: string) => (
    <input className="input" type="number" min={min} aria-label={label} defaultValue={value} key={`${scene.id}${key}${value}`} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= min && n !== value) patch({ [key]: n }) }} />
  )
  const lighting = scene.lighting !== false && (scene.lighting === true || scene.darkness > 0)
  return (
    <div className="tt-form">
      <label>Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== scene.name && patch({ name: name.trim() })} /></label>
      {library && <AssetLibrary scene={scene} wsId={wsId} onClose={() => setLibrary(false)} />}
      {editing && <MapEditor scene={scene} wsId={wsId} onClose={() => setEditing(false)} />}
      <Fold id="scene-map" title="Map and grid" open>
        <div className="tt-row">
          <button className="btn sm" onClick={async () => { const f = await pickBackground(); if (!f) return; const size = f.type.startsWith('video/') ? await videoSize(f) : null; const url = await uploadImage(wsId, f); if (url) patch({ bg: url, ...(size ? { width: Math.min(40000, Math.max(100, size.width)), height: Math.min(40000, Math.max(100, size.height)) } : {}) }) }}>Set map image or loop</button>
          {scene.bg && <button className="btn ghost sm" onClick={() => patch({ bg: '' })}>Remove image</button>}
        </div>
        <div className="tt-row">
          <button className="btn sm" title="Draw rooms, corridors, doors and lights and make this scene from them" onClick={() => setEditing(true)}>Open the map editor</button>
          <button className="btn sm" title="Every picture and sound of this world" onClick={() => setLibrary(true)}>Asset library</button>
        </div>
        <label>Grid
          <Select className="input" value={scene.grid} onChange={(v) => patch({ grid: v })}>
            <option value="square">Square</option>
            <option value="hex-row">Hexes, pointy top</option>
            <option value="hex-col">Hexes, flat top</option>
            <option value="none">No grid</option>
          </Select>
        </label>
        <div className="tt-row">
          <label>Cell size in pixels{num('gridSize', scene.gridSize, 10, 'Cell size in pixels')}</label>
          <label>Cell is{num('dist', scene.dist, 0.1, 'Cell is')}</label>
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
        <div className="tt-row">
          <label className="tt-light-colour">Grid colour<input className="tt-color" type="color" aria-label="Grid colour" value={scene.gridColor ?? '#ffffff'} onChange={(e) => patch({ gridColor: e.target.value })} /></label>
          <label>Grid strength<input type="range" min={0} max={100} aria-label="Grid strength" value={Math.round((scene.gridOpacity ?? 0.28) * 100)} onChange={(e) => patch({ gridOpacity: Number(e.target.value) / 100 })} /></label>
        </div>
        <div className="tt-row"><label>Width (px){num('width', scene.width, 100, 'Width (px)')}</label><label>Height (px){num('height', scene.height, 100, 'Height (px)')}</label></div>
      </Fold>
      <Fold id="scene-light" title="Light and vision" open>
        <label className="tt-check"><input type="checkbox" checked={scene.fog} onChange={(e) => patch({ fog: e.target.checked })} />Fog of war: players only see what their tokens see</label>
        {scene.fog && <button className="btn ghost sm" onClick={() => sendTable({ t: 'fog.reset', sceneId: scene.id })}>Forget what players explored</button>}
        <label className="tt-check"><input type="checkbox" checked={lighting} onChange={(e) => patch(e.target.checked ? { lighting: true, ...(scene.darkness > 0 ? {} : { darkness: 0.7 }) } : { lighting: false })} />Lighting: darkness, light sources and darkvision</label>
        {!lighting && <p className="muted tt-hint">Off: the whole map is in daylight and lights do nothing.</p>}
        {lighting && (
          <>
            <label>Darkness ({Math.round(scene.darkness * 100)} %)<input type="range" min={0} max={100} value={Math.round(scene.darkness * 100)} onChange={(e) => patch({ darkness: Number(e.target.value) / 100 })} /></label>
            <DaylightControl scene={scene} />
          </>
        )}
        {/* fog clouds and magical darkness count with fog of war alone, so the list is there with either */}
        {(lighting || scene.fog) && <SceneLights scene={scene} onPlace={onPlaceLight} />}
      </Fold>
      <Fold id="scene-mood" title="Mood">
        <label>Weather
          <Select className="input" value={scene.weather ?? 'none'} onChange={(v) => patch({ weather: v })} title="Weather over the scene">
            <option value="none">Clear</option>
            <option value="rain">Rain</option>
            <option value="snow">Snow</option>
          </Select>
        </label>
        <div className="tt-row">
          <label className="tt-light-colour">Ambient colour<input className="tt-color" type="color" aria-label="Ambient colour" value={scene.ambient || '#ffd9a0'} onChange={(e) => patch({ ambient: e.target.value })} /></label>
          {scene.ambient && <button className="btn ghost sm" onClick={() => patch({ ambient: '' })}>No ambient colour</button>}
        </div>
      </Fold>
      <Fold id="scene-props" title="Props and layers">
        <TilesSection scene={scene} wsId={wsId} centre={centre} />
      </Fold>
      <Fold id="scene-triggers" title="Triggers">
        <TriggersSection scene={scene} />
      </Fold>
      <Fold id="scene-players" title="Players">
        {!active && <button className="btn sm" onClick={() => sendTable({ t: 'scene.activate', id: scene.id })}>Move all players here</button>}
        <SendPlayers scene={scene} />
      </Fold>
      <Fold id="scene-notes" title="Notes and organising">
        <label>Notes for you<textarea className="input" aria-label="Scene notes" rows={3} maxLength={5000} placeholder="Read-aloud text, secrets, where the traps are" defaultValue={scene.notes ?? ''} key={scene.id + 'n'} onBlur={(e) => e.target.value !== (scene.notes ?? '') && patch({ notes: e.target.value })} /></label>
        <label>Folder<input className="input" aria-label="Scene folder" maxLength={60} placeholder="Chapter 1" defaultValue={scene.folder ?? ''} key={scene.id + (scene.folder ?? '')} onBlur={(e) => e.target.value.trim() !== (scene.folder ?? '') && patch({ folder: e.target.value.trim() })} /></label>
        <div className="tt-row">
          <button className="btn sm" onClick={() => sendTable({ t: 'scene.duplicate', id: scene.id })}>Duplicate this scene</button>
          <button className="btn sm" title="Make a new scene from a map file made by Dungeondraft or another map tool" onClick={() => void importUvtt(wsId)}>Import a Universal VTT map</button>
          <button className="btn sm" title="Save this scene, its walls and lights as a map file" onClick={() => void exportUvtt(scene)}>Export as Universal VTT</button>
        </div>
        <button className="btn sm danger" onClick={async () => { if (await confirmDialog(`“${scene.name}” and every token on it are deleted for good.`, { title: 'Delete scene', okLabel: 'Delete', danger: true })) sendTable({ t: 'scene.delete', id: scene.id }) }}><Trash2 size={13} /> Delete scene</button>
      </Fold>
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
    ['wallsBlockMovement', 'Walls and closed doors stop tokens (hold Ctrl to pass as GM)'],
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
        <PerfBox k="light" label="Lighter drawing: coarser fog, no weather, no moving lights" />
        <PerfBox k="noDice" label="No tumbling dice when someone rolls" />
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
          {flags.map(([k, label]) => <label key={k} className="tt-check"><input type="checkbox" checked={settings[k] !== false} onChange={(e) => set({ [k]: e.target.checked })} />{label}</label>)}
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
