import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Lock, LockOpen, RotateCw, Trash2 } from 'lucide-react'
import { confirmDialog } from '../lib/dialog'
import { alertDialog, askText } from '../lib/dialog'
import { sendTable, useTable, type Scene, type SceneLayer, type Tile, type TileLayer, type Token } from '../tabletop/state'
import { pickImage, uploadImage } from '../tabletop/upload'
import { Select } from './Select'

// Tiles are pictures laid on a scene: furniture, rubble, a roof that hides a room. The GM places them on one of three layers.
const LAYERS: { id: TileLayer; label: string }[] = [
  { id: 'bg', label: 'Below the tokens' },
  { id: 'overhead', label: 'Above the tokens' },
  { id: 'gm', label: 'GM only' },
]

/** The tiles this person has not hidden on their own screen by hiding a layer. */
export const shownTiles = (s: { tiles: Tile[]; hiddenLayers: string[] }) => (s.hiddenLayers.length ? s.tiles.filter((t) => !t.layerId || !s.hiddenLayers.includes(t.layerId)) : s.tiles)

/** The tokens this person has not hidden on their own screen by hiding a layer. */
export const shownTokens = (s: { tokens: Token[]; hiddenLayers: string[] }) => (s.hiddenLayers.length ? s.tokens.filter((t) => typeof t.data?.layerId !== 'string' || !s.hiddenLayers.includes(t.data.layerId)) : s.tokens)

/** The named layer of a token: a choice in the token's panel (the GM). */
export function TokenLayer({ token }: { token: Token }) {
  const scene = useTable((s) => s.scenes.find((x) => x.id === s.sceneId))
  const layers = scene?.layers ?? []
  if (!layers.length) return null
  return (
    <label>Named layer
      <Select className="input" value={typeof token.data.layerId === 'string' ? token.data.layerId : ''} title="The named layer this token is on" onChange={(v) => { const data = { ...token.data }; if (v) data.layerId = v; else delete data.layerId; sendTable({ t: 'token.update', id: token.id, patch: { data } }) }}>
        <option value="">None</option>
        {layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </Select>
    </label>
  )
}

/** Named layers of a scene: the GM groups props (furniture, secrets, a second floor), then hides, locks or hands them to the players as a group. */
function LayersSection({ scene }: { scene: Scene }) {
  const hiddenLayers = useTable((s) => s.hiddenLayers)
  const layers = scene.layers ?? []
  const save = (next: SceneLayer[]) => sendTable({ t: 'scene.update', id: scene.id, patch: { layers: next } })
  const add = async () => {
    const name = await askText('Name of the layer', { label: 'Name', placeholder: 'Furniture', okLabel: 'Add' })
    if (!name?.trim()) return
    if (layers.length >= 12) { await alertDialog('A scene can have up to 12 layers.'); return }
    save([...layers, { id: Math.random().toString(36).slice(2, 10), name: name.trim().slice(0, 40), players: true, locked: false }])
  }
  const set = (l: SceneLayer, p: Partial<SceneLayer>) => save(layers.map((x) => (x.id === l.id ? { ...x, ...p } : x)))
  const mine = (id: string) => useTable.setState((s) => ({ hiddenLayers: s.hiddenLayers.includes(id) ? s.hiddenLayers.filter((x) => x !== id) : [...s.hiddenLayers, id] }))
  return (
    <div className="tt-form" role="group" aria-label="Layers">
      <b>Layers</b>
      <ul className="tt-tokens" aria-label="Layers of this scene">
        {layers.map((l) => (
          <li key={l.id} className="tt-row">
            <span className="grow ellipsis">{l.name}</span>
            <button className="btn ghost sm" aria-label={`${hiddenLayers.includes(l.id) ? 'Show' : 'Hide'} ${l.name} on my screen`} title="Hide it on your own screen only" onClick={() => mine(l.id)}>{hiddenLayers.includes(l.id) ? <EyeOff size={13} /> : <Eye size={13} />}</button>
            <button className="btn ghost sm" aria-label={`${l.players ? 'Hide' : 'Show'} ${l.name} ${l.players ? 'from' : 'to'} the players`} title={l.players ? 'The players see this layer' : 'Only the GM sees this layer'} aria-pressed={!l.players} onClick={() => set(l, { players: !l.players })}>{l.players ? 'Players see' : 'GM only'}</button>
            <button className="btn ghost sm" aria-label={`${l.locked ? 'Unlock' : 'Lock'} ${l.name}`} aria-pressed={l.locked} onClick={() => set(l, { locked: !l.locked })}>{l.locked ? <Lock size={13} /> : <LockOpen size={13} />}</button>
            <button className="btn ghost sm" aria-label={`Delete the layer ${l.name}`} onClick={() => save(layers.filter((x) => x.id !== l.id))}><Trash2 size={12} /></button>
          </li>
        ))}
        {layers.length === 0 && <li className="muted tt-hint">Make a layer, then put tiles and tokens on it from their panels.</li>}
      </ul>
      <div className="tt-row"><button className="btn sm" onClick={add}>Add a layer</button></div>
    </div>
  )
}

export function TilesSection({ scene, wsId, centre }: { scene: Scene; wsId: string; centre: () => { x: number; y: number } }) {
  const tiles = useTable((s) => s.tiles)
  const selectedTile = useTable((s) => s.selectedTile)
  const add = async () => {
    const f = await pickImage()
    if (!f) return
    const url = await uploadImage(wsId, f)
    if (!url) return
    const c = centre()
    sendTable({ t: 'tile.add', sceneId: scene.id, image: url, x: Math.round(c.x), y: Math.round(c.y) })
  }
  return (
    <div className="tt-form">
      <LayersSection scene={scene} />
      <b>Props and overlays</b>
      <div className="tt-row"><button className="btn sm" onClick={add}><ImagePlus size={13} /> Add a tile</button></div>
      <ul className="tt-tokens" aria-label="Tiles on this scene">
        {tiles.map((t, i) => (
          <li key={t.id}><button className={`btn ghost sm${t.id === selectedTile ? ' on' : ''}`} onClick={() => useTable.setState({ selectedTile: t.id, selected: [] })}>Tile {i + 1} <small className="muted">{LAYERS.find((l) => l.id === t.layer)?.label}{t.hidden ? ', hidden' : ''}</small></button></li>
        ))}
        {tiles.length === 0 && <li className="muted tt-hint">Tiles are pictures on the map. Click one on the map to move it; drag with the select tool.</li>}
      </ul>
    </div>
  )
}

export function TilePanel() {
  const tile = useTable((s) => s.tiles.find((t) => t.id === s.selectedTile)) as Tile | undefined
  const scene = useTable((s) => s.scenes.find((x) => x.id === s.sceneId))
  if (!tile) return <p className="muted tt-hint">Select a tile.</p>
  const patch = (p: Record<string, unknown>) => sendTable({ t: 'tile.update', id: tile.id, patch: p })
  const num = (label: string, key: 'x' | 'y' | 'w' | 'h' | 'rotation', min: number) => (
    <label>{label}
      <input className="input tt-num" type="number" min={min} aria-label={`Tile ${label.toLowerCase()}`} defaultValue={Math.round(tile[key])} key={`${tile.id}${key}${Math.round(tile[key])}`}
        onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= min && Math.round(n) !== Math.round(tile[key])) patch({ [key]: n }) }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </label>
  )
  const scale = (f: number) => patch({ w: Math.max(8, Math.round(tile.w * f)), h: Math.max(8, Math.round(tile.h * f)) })
  return (
    <div className="tt-form">
      <b>Tile</b>
      <label>Layer
        <Select className="input" value={tile.layer} onChange={(v) => patch({ layer: v })}>
          {LAYERS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </Select>
      </label>
      {(scene?.layers ?? []).length > 0 && (
        <label>Named layer
          <Select className="input" value={tile.layerId ?? ''} onChange={(v) => patch({ layerId: v || null })} title="The named layer this tile belongs to">
            <option value="">None</option>
            {(scene?.layers ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </label>
      )}
      <div className="tt-row">{num('Width', 'w', 8)}{num('Height', 'h', 8)}</div>
      <div className="tt-row">
        <button className="btn sm" onClick={() => scale(0.8)}>Smaller</button>
        <button className="btn sm" onClick={() => scale(1.25)}>Bigger</button>
      </div>
      <div className="tt-row"><button className="btn sm" title="Turn the picture over, as in a mirror" onClick={() => patch({ flip: !tile.flip })}>{tile.flip ? 'Unflip' : 'Flip'}</button></div>
      <div className="tt-row">{num('Rotation', 'rotation', -3600)}<button className="btn sm" title="Turn 45 degrees" onClick={() => patch({ rotation: (tile.rotation + 45) % 360 })}><RotateCw size={13} /></button></div>
      <div className="tt-row">
        <button className="btn sm" onClick={() => patch({ locked: !tile.locked })}>{tile.locked ? <><LockOpen size={13} /> Unlock</> : <><Lock size={13} /> Lock</>}</button>
        <button className="btn sm" onClick={() => patch({ hidden: !tile.hidden })}>{tile.hidden ? <><Eye size={13} /> Reveal</> : <><EyeOff size={13} /> Hide</>}</button>
      </div>
      <div className="tt-row">
        <button className="btn sm" title="In front of the other tiles" onClick={() => patch({ z: tile.z + 1 })}><ArrowUp size={13} /> Forward</button>
        <button className="btn sm" title="Behind the other tiles" onClick={() => patch({ z: tile.z - 1 })}><ArrowDown size={13} /> Back</button>
      </div>
      <button className="btn sm danger" onClick={async () => { if (await confirmDialog('The tile is removed from the scene for everyone.', { title: 'Delete tile', okLabel: 'Delete', danger: true })) sendTable({ t: 'tile.delete', ids: [tile.id] }) }}><Trash2 size={13} /> Delete tile</button>
    </div>
  )
}
