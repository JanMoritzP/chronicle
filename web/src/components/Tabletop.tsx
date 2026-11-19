import { Color } from 'pixi.js'
import { BrickWall, Crosshair, Eraser, Eye, MessageSquare, EyeOff, Lock, LockOpen, Maximize, Minus, Plus, Ruler, RotateCw, Swords, Trash2, UserPlus, MousePointer2, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { askText, confirmDialog } from '../lib/dialog'
import { colorFor } from '../lib/collab'
import { useStore } from '../store'
import { TableEngine, type Tool } from '../tabletop/engine'
import { snap } from '../tabletop/grid'
import { joinTable, leaveTable, onTableMessage, sendTable, useTable, type Scene, type Token } from '../tabletop/state'
import { pickImage, uploadImage } from '../tabletop/upload'
import { ChatPanel, CombatPanel, LinkPage, SightLight, TokenSheet, TokenStats } from './TableParts'
import { Select } from './Select'

const PALETTE = ['#c0392b', '#2e86c1', '#27ae60', '#d68910', '#8e44ad', '#16a085', '#7f8c8d', '#d35400']
const colorNum = (id: string) => new Color(colorFor(id)).toNumber()

export function TableView() {
  const wsId = useStore((s) => s.wsId)
  const conn = useTable((s) => s.conn)
  const role = useTable((s) => s.role)
  const scenes = useTable((s) => s.scenes)
  const active = useTable((s) => s.active)
  const sceneId = useTable((s) => s.sceneId)
  const error = useTable((s) => s.error)
  const [tool, setTool] = useState<Tool>('select')
  const [panel, setPanel] = useState<'token' | 'scene' | 'table' | 'chat' | 'combat'>('token')
  const combat = useTable((s) => s.combat)
  const unread = useTable((s) => s.unread)
  const [panelOpen, setPanelOpen] = useState(true)
  const host = useRef<HTMLDivElement>(null)
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
      onMove: (moves) => { sendTable({ t: 'token.move', moves }) },
      onSelect: (ids) => { useTable.setState({ selected: ids }); if (ids.length) setPanel('token') },
      onPing: (p) => { sendTable({ t: 'ping', x: p.x, y: p.y }) },
      onCursor: (p) => { sendTable({ t: 'cursor', x: p.x, y: p.y }) },
      onRuler: (points) => { sendTable({ t: 'ruler', points }) },
      onWallAdd: (walls) => { const id = useTable.getState().sceneId; if (id) sendTable({ t: 'wall.add', sceneId: id, walls }) },
      onWallErase: (id) => { sendTable({ t: 'wall.delete', ids: [id] }) },
      onDoor: (id) => { sendTable({ t: 'door.toggle', id }) },
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
        e.setViewer({ id: s.you?.id ?? '', gm: s.role === 'gm', spectator: s.role === 'spectator', canDoors: s.role === 'player' && s.settings.playersOpenDoors })
      }
      viewer()
      push()
      e.setWalls(useTable.getState().walls)
      e.setLights(useTable.getState().lights)
      e.setTokens(useTable.getState().tokens)
      e.setSelected(useTable.getState().selected)
      e.setExplored(useTable.getState().fog)
      const turn = () => { const s = useTable.getState(); e.setTurn(s.combat.active ? s.combat.list.find((x) => x.id === s.combat.turn)?.tokenId ?? null : null) }
      turn()
      const unsub = useTable.subscribe((s, prev) => {
        if (s.role !== prev.role || s.you !== prev.you || s.settings.playersOpenDoors !== prev.settings.playersOpenDoors) viewer()
        if (s.scenes !== prev.scenes || s.sceneId !== prev.sceneId) push()
        if (s.combat !== prev.combat || s.tokens !== prev.tokens) turn()
        if (s.walls !== prev.walls) e.setWalls(s.walls)
        if (s.lights !== prev.lights) e.setLights(s.lights)
        if (s.sceneId !== prev.sceneId || s.fog !== prev.fog) e.setExplored(s.fog)
        if (s.tokens !== prev.tokens) e.setTokens(s.tokens)
        if (s.selected !== prev.selected) e.setSelected(s.selected)
        if (s.cursors !== prev.cursors || s.rulers !== prev.rulers) e.setOthers(s.cursors, s.rulers)
      })
      const unmsg = onTableMessage((m) => { if (m.t === 'ping') e.ping({ x: m.x, y: m.y }, m.user); if (m.t === 'fog.reset') e.setExplored(null) })
      off = () => { unsub(); unmsg() }
    })
    return () => { off(); e.destroy(); engine.current = null }
  }, [])

  const [wallKind, setWallKind] = useState<'wall' | 'door' | 'secret' | 'window'>('wall')
  useEffect(() => { engine.current?.setTool(tool) }, [tool])
  useEffect(() => { engine.current?.setWallKind(wallKind) }, [wallKind])

  const tokens = useTable((s) => s.tokens)
  const selected = useTable((s) => s.selected)
  const one = selected.length === 1 ? tokens.find((t) => t.id === selected[0]) ?? null : null

  // keys act on the selection
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, [role=listbox]')) return
    const st = useTable.getState()
    const sel = st.tokens.filter((t) => st.selected.includes(t.id))
    if (e.key === 'Enter' && tool === 'wall') engine.current?.finishWalls()
    else if (e.key === 'Escape') { engine.current?.finishWalls(); useTable.setState({ selected: [] }); setTool('select') }
    else if (e.key === 'f' || e.key === 'F') engine.current?.fit()
    else if (e.key === 'r' && !e.ctrlKey && sel.length) for (const t of sel) sendTable({ t: 'token.update', id: t.id, patch: { rotation: (t.rotation + 45) % 360 } })
    else if (gm && (e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); sendTable({ t: 'token.delete', ids: sel.map((t) => t.id) }) }
    else if (gm && e.key === 'h' && sel.length) for (const t of sel) sendTable({ t: 'token.update', id: t.id, patch: { hidden: !t.hidden } })
    else if (gm && e.key === 'l' && sel.length) for (const t of sel) sendTable({ t: 'token.update', id: t.id, patch: { locked: !t.locked } })
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
          {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === active ? ' (table)' : ''}</option>)}
        </Select>
        {gm && <button className="btn sm" onClick={addScene}><Plus size={13} /> Scene</button>}
        {gm && scene && scene.id !== active && <button className="btn sm" title="Bring every player to this scene" onClick={() => sendTable({ t: 'scene.activate', id: scene.id })}><Users size={13} /> Move players here</button>}
        <span className="tt-sep" />
        <button className={`btn sm square${tool === 'select' ? ' on' : ''}`} title="Select and move (Esc)" aria-label="Select" onClick={() => setTool('select')}><MousePointer2 size={14} /></button>
        <button className={`btn sm square${tool === 'ruler' ? ' on' : ''}`} title="Measure distance" aria-label="Ruler" onClick={() => setTool('ruler')}><Ruler size={14} /></button>
        {gm && <button className={`btn sm square${tool === 'wall' ? ' on' : ''}`} title="Draw walls, doors and windows. Click to place points, double-click or Enter to finish." aria-label="Draw walls" onClick={() => setTool(tool === 'wall' ? 'select' : 'wall')}><BrickWall size={14} /></button>}
        {gm && <button className={`btn sm square${tool === 'erase' ? ' on' : ''}`} title="Remove a wall by clicking it" aria-label="Erase walls" onClick={() => setTool(tool === 'erase' ? 'select' : 'erase')}><Eraser size={14} /></button>}
        {gm && tool === 'wall' && (
          <span className="seg tt-kinds" role="group" aria-label="Kind of wall">
            {(['wall', 'door', 'secret', 'window'] as const).map((k) => <button key={k} className={wallKind === k ? 'on' : ''} onClick={() => setWallKind(k)}>{k === 'wall' ? 'Wall' : k === 'door' ? 'Door' : k === 'secret' ? 'Secret door' : 'Window'}</button>)}
          </span>
        )}
        <button className="btn sm square" title="Zoom in" aria-label="Zoom in" onClick={() => engine.current?.zoomBy(1.25)}><Plus size={14} /></button>
        <button className="btn sm square" title="Zoom out" aria-label="Zoom out" onClick={() => engine.current?.zoomBy(0.8)}><Minus size={14} /></button>
        <button className="btn sm square" title="Fit the scene (F)" aria-label="Fit the scene" onClick={() => engine.current?.fit()}><Maximize size={14} /></button>
        {scene && canAdd && <button className="btn sm" onClick={addToken}><UserPlus size={13} /> Token</button>}
        <span className="grow" />
        <span className={`tt-conn ${conn}`} title={conn === 'open' ? 'Connected' : 'Reconnecting'}>{conn === 'open' ? '' : conn === 'connecting' ? 'Connecting…' : 'Offline, reconnecting…'}</span>
        <button className="btn sm tt-toggle" onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? 'Hide panel' : 'Panel'}</button>
      </div>
      {error && <div className="tt-error" role="alert" onClick={() => useTable.setState({ error: '' })}>{error}</div>}
      <div className="tt-main">
        <div className="tt-canvas" ref={host}>
          {!scene && <div className="tt-empty muted">{gm ? 'No scenes yet. Create one to start.' : 'The GM has not opened a scene yet.'}</div>}
        </div>
        {panelOpen && (
          <aside className="tt-panel">
            <div className="seg">
              <button className={panel === 'token' ? 'on' : ''} onClick={() => setPanel('token')}>Token</button>
              {gm && <button className={panel === 'scene' ? 'on' : ''} onClick={() => setPanel('scene')}>Scene</button>}
              <button className={panel === 'combat' ? 'on' : ''} onClick={() => setPanel('combat')}><Swords size={12} /> Combat{combat.active ? ` (R${combat.round})` : ''}</button>
              <button className={panel === 'chat' ? 'on' : ''} onClick={() => setPanel('chat')}><MessageSquare size={12} /> Chat{unread > 0 && panel !== 'chat' ? ` (${unread})` : ''}</button>
              <button className={panel === 'table' ? 'on' : ''} onClick={() => setPanel('table')}>Table</button>
            </div>
            {panel === 'token' && <TokenPanel token={one} count={selected.length} />}
            {panel === 'scene' && gm && scene && <ScenePanel scene={scene} active={active === scene.id} wsId={wsId} />}
            {panel === 'table' && <TablePanel />}
            {panel === 'chat' && <ChatPanel />}
            {panel === 'combat' && <CombatPanel />}
          </aside>
        )}
      </div>
    </div>
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
    return (
      <>
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

function ScenePanel({ scene, active, wsId }: { scene: Scene; active: boolean; wsId: string }) {
  const [name, setName] = useState(scene.name)
  useEffect(() => setName(scene.name), [scene.id, scene.name])
  const patch = (p: Record<string, unknown>) => sendTable({ t: 'scene.update', id: scene.id, patch: p })
  const num = (key: string, value: number, min: number) => (
    <input className="input" type="number" min={min} defaultValue={value} key={`${scene.id}${key}${value}`} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= min && n !== value) patch({ [key]: n }) }} />
  )
  return (
    <div className="tt-form">
      <label>Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== scene.name && patch({ name: name.trim() })} /></label>
      <div className="tt-row">
        <button className="btn sm" onClick={async () => { const f = await pickImage(); if (f) { const url = await uploadImage(wsId, f); if (url) patch({ bg: url }) } }}>Set map image</button>
        {scene.bg && <button className="btn sm" onClick={() => patch({ bg: '' })}>Remove image</button>}
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
      <label>Darkness ({Math.round(scene.darkness * 100)} %)<input type="range" min={0} max={100} value={Math.round(scene.darkness * 100)} onChange={(e) => patch({ darkness: Number(e.target.value) / 100 })} /></label>
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
  const set = (patch: Record<string, unknown>) => sendTable({ t: 'settings.set', patch })
  const flags = useMemo(() => [
    ['playersMoveOwn', 'Players move their own tokens'],
    ['playersCreateTokens', 'Players add tokens'],
    ['playersEditOwnStats', 'Players change their own hit points and conditions'],
    ['playersOpenDoors', 'Players open and close doors'],
    ['playersPing', 'Players ping the map'],
    ['playersRuler', 'Players share their ruler'],
    ['showCursors', 'Show everyone’s pointer'],
  ] as const, [])
  return (
    <div className="tt-form">
      <b><Swords size={13} /> At the table</b>
      <ul className="tt-people">
        {online.map((o) => <li key={o.id}><span className="avatar" style={{ background: colorFor(o.id) }}>{o.username.slice(0, 1).toUpperCase()}</span>{o.username}{o.id === you?.id ? ' (you)' : ''}<small className="muted"> {o.role === 'gm' ? 'GM' : o.role === 'spectator' ? 'watching' : ''}</small></li>)}
      </ul>
      {gm && (
        <>
          <b><Crosshair size={13} /> Rules of the table</b>
          {flags.map(([k, label]) => <label key={k} className="tt-check"><input type="checkbox" checked={settings[k]} onChange={(e) => set({ [k]: e.target.checked })} />{label}</label>)}
          <b>Also runs the table</b>
          {members.filter((m) => m.role !== 'owner' && m.role !== 'viewer').map((m) => (
            <label key={m.id} className="tt-check"><input type="checkbox" checked={settings.gms.includes(m.id)} onChange={(e) => set({ gms: e.target.checked ? [...settings.gms, m.id] : settings.gms.filter((g) => g !== m.id) })} />{m.username}</label>
          ))}
        </>
      )}
    </div>
  )
}
