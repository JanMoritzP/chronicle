import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Lock, LockOpen, RotateCw, Trash2 } from 'lucide-react'
import { confirmDialog } from '../lib/dialog'
import { sendTable, useTable, type Scene, type Tile, type TileLayer } from '../tabletop/state'
import { pickImage, uploadImage } from '../tabletop/upload'
import { Select } from './Select'

// Tiles are pictures laid on a scene: furniture, rubble, a roof that hides a room. The GM places them on one of three layers.
const LAYERS: { id: TileLayer; label: string }[] = [
  { id: 'bg', label: 'Below the tokens' },
  { id: 'overhead', label: 'Above the tokens' },
  { id: 'gm', label: 'GM only' },
]

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
      <div className="tt-row">{num('Width', 'w', 8)}{num('Height', 'h', 8)}</div>
      <div className="tt-row">
        <button className="btn sm" onClick={() => scale(0.8)}>Smaller</button>
        <button className="btn sm" onClick={() => scale(1.25)}>Bigger</button>
      </div>
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
