import { Cloud, Eye, EyeOff, Lightbulb, LightbulbOff, Moon, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { confirmDialog } from '../lib/dialog'
import { isLightSource, sendTable, useTable, type Scene, type Token } from '../tabletop/state'
import { Select } from './Select'

// Light at the table: the controls of one light (a lamp the GM placed, or a token that carries light),
// and the list of every light on a scene. Distances are in the scene's unit, like everything else on a token.

export interface LightData { bright?: number; dim?: number; color?: string; animation?: 'flicker' | 'pulse'; angle?: number; dir?: number; off?: boolean }

/** Common lights of 5e, as bright and dim reach in feet (dim is how far the light goes in all). */
export const LIGHT_PRESETS: { id: string; label: string; light: LightData }[] = [
  { id: 'candle', label: 'Candle', light: { bright: 5, dim: 10, color: '#ffc46b', animation: 'flicker' } },
  { id: 'torch', label: 'Torch', light: { bright: 20, dim: 40, color: '#ffb25c', animation: 'flicker' } },
  { id: 'lamp', label: 'Lamp', light: { bright: 15, dim: 45, color: '#ffd27a' } },
  { id: 'lantern', label: 'Hooded lantern', light: { bright: 30, dim: 60, color: '#ffd27a' } },
  { id: 'bullseye', label: 'Bullseye lantern', light: { bright: 60, dim: 120, color: '#ffe3a3', angle: 60 } },
  { id: 'light', label: 'Light cantrip', light: { bright: 20, dim: 40, color: '#fff4d6' } },
  { id: 'daylight', label: 'Daylight spell', light: { bright: 60, dim: 120, color: '#fffbea' } },
  { id: 'fire', label: 'Campfire', light: { bright: 20, dim: 40, color: '#ff9a3c', animation: 'flicker' } },
  { id: 'magic', label: 'Arcane glow', light: { bright: 10, dim: 20, color: '#8fb8ff', animation: 'pulse' } },
]

export interface AreaData { kind: 'darkness' | 'fog'; radius: number; off?: boolean }

/** Places that block sight, placed with the light tool like a lamp: the eye does not pass into them or through them. */
export const AREA_PRESETS: { id: string; label: string; area: AreaData }[] = [
  { id: 'darkness', label: 'Magical darkness', area: { kind: 'darkness', radius: 15 } },
  { id: 'fogcloud', label: 'Fog cloud', area: { kind: 'fog', radius: 20 } },
]
const AREA_HINTS: Record<AreaData['kind'], string> = {
  darkness: 'Darkvision and light do not reach into it. Blindsight and truesight see through it.',
  fog: 'Nothing is seen into it or through it. Only blindsight sees through it.',
}

const lightOf = (t: Token) => (t.data.light ?? {}) as LightData
const areaOf = (t: Token) => t.data.obscure as AreaData | undefined
const shines = (l: LightData) => !l.off && ((l.bright ?? 0) > 0 || (l.dim ?? 0) > 0)
/** A light written back to a token: no light at all is no `light` key, so the server stops counting it. */
function saveLight(token: Token, light: LightData | null) {
  const data = { ...token.data }
  const clean = light && Object.fromEntries(Object.entries(light).filter(([, v]) => v !== undefined && v !== '')) as LightData
  if (clean && ((clean.bright ?? 0) > 0 || (clean.dim ?? 0) > 0)) data.light = clean
  else delete data.light
  sendTable({ t: 'token.update', id: token.id, patch: { data } })
}

/** A number in the scene's unit, written when the field is left. */
function Distance({ label, value, onCommit, min = 0, max = 2000 }: { label: string; value: number; onCommit: (n: number) => void; min?: number; max?: number }) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => setRaw(String(value)), [value])
  const commit = () => { const n = Number(raw); if (Number.isFinite(n) && n >= min && n <= max && n !== value) onCommit(Math.round(n)); else setRaw(String(value)) }
  return (
    <label>{label}
      <input className="input tt-num" type="number" min={min} max={max} aria-label={label} value={raw} onChange={(e) => setRaw(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </label>
  )
}

/** Everything about one light: a preset, on or off, how far it reaches, its colour, how it moves and whether it is a cone. */
export function LightFields({ token, unit }: { token: Token; unit: string }) {
  const light = lightOf(token)
  const has = (light.bright ?? 0) > 0 || (light.dim ?? 0) > 0
  const set = (patch: Partial<LightData>) => saveLight(token, { ...light, ...patch })
  const cone = light.angle != null && light.angle < 360
  return (
    <div className="tt-light">
      <div className="tt-row tt-light-head">
        <Select className="input" value="" placeholder={has ? 'Use a preset…' : 'Give off light…'} title="A common light, with its reach and colour" onChange={(id) => { const p = LIGHT_PRESETS.find((x) => x.id === id); if (p) saveLight(token, { ...p.light, off: false }) }}>
          {LIGHT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.light.bright}/{p.light.dim} {unit})</option>)}
        </Select>
        {has && (
          <button className={`btn sm square${light.off ? '' : ' on'}`} aria-pressed={!light.off} aria-label={light.off ? 'Light it' : 'Put it out'} title={light.off ? 'Light it' : 'Put it out (the settings are kept)'} onClick={() => set({ off: !light.off })}>
            {light.off ? <LightbulbOff size={14} /> : <Lightbulb size={14} />}
          </button>
        )}
      </div>
      <div className="tt-row">
        <Distance label="Bright light" value={light.bright ?? 0} onCommit={(n) => set({ bright: n, dim: Math.max(n, light.dim ?? 0) })} />
        <Distance label="Dim light" value={light.dim ?? 0} onCommit={(n) => set({ dim: n })} />
      </div>
      {has && (
        <>
          <div className="tt-row">
            <label className="tt-light-colour">Colour
              <input className="tt-color" type="color" aria-label="Light colour" value={/^#[0-9a-fA-F]{6}$/.test(light.color ?? '') ? light.color : '#ffd9a0'} onChange={(e) => set({ color: e.target.value })} />
            </label>
            {light.color && <button className="btn ghost sm" onClick={() => set({ color: undefined })}>White light</button>}
            <label>Moves
              <Select className="input" value={light.animation ?? ''} onChange={(v) => set({ animation: (v || undefined) as LightData['animation'] })} title="How the light moves">
                <option value="">Steady</option><option value="flicker">Flickers like a flame</option><option value="pulse">Pulses</option>
              </Select>
            </label>
          </div>
          <label className="tt-check"><input type="checkbox" checked={cone} onChange={(e) => set(e.target.checked ? { angle: 60, dir: light.dir ?? 0 } : { angle: undefined, dir: undefined })} />Shines in a cone</label>
          {cone && (
            <div className="tt-row">
              <Distance label="Light angle" value={light.angle ?? 360} min={1} max={359} onCommit={(n) => set({ angle: n })} />
              <Distance label="Light faces" value={light.dir ?? 0} max={360} onCommit={(n) => set({ dir: n % 360 })} />
            </div>
          )}
          <button className="btn ghost sm" onClick={() => saveLight(token, null)}>Give off no light</button>
        </>
      )}
    </div>
  )
}

/** A cloud of fog or magical darkness: which of the two, how far it reaches, and a switch that lifts it without losing it. */
function AreaFields({ token, area, unit }: { token: Token; area: AreaData; unit: string }) {
  const set = (patch: Partial<AreaData>) => sendTable({ t: 'token.update', id: token.id, patch: { data: { ...token.data, obscure: { ...area, ...patch } } } })
  return (
    <div className="tt-light">
      <div className="tt-row tt-light-head">
        <Select className="input" value={area.kind} title="What the area is" onChange={(v) => set({ kind: v === 'fog' ? 'fog' : 'darkness' })}>
          <option value="darkness">Magical darkness</option><option value="fog">Fog</option>
        </Select>
        <button className={`btn sm square${area.off ? '' : ' on'}`} aria-pressed={!area.off} aria-label={area.off ? 'Bring it back' : 'Lift it'} title={area.off ? 'Bring it back' : 'Lift it for now (the settings are kept)'} onClick={() => set({ off: !area.off })}>
          {area.off ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <Distance label="Radius" value={area.radius} min={1} onCommit={(n) => set({ radius: n })} />
      <p className="muted tt-hint">{AREA_HINTS[area.kind]} Works on scenes with fog of war or darkness.{unit === 'ft' ? ' The Darkness spell is 15 ft, Fog Cloud 20 ft.' : ''}</p>
    </div>
  )
}

/** The panel of a light the GM placed (or an area of fog or darkness): a name, the light itself, and a way to remove it. Players never see the lamp, only its light. */
export function LightSourcePanel({ token }: { token: Token }) {
  const unit = useTable((s) => s.scenes.find((x) => x.id === s.sceneId)?.unit ?? 'ft')
  const [name, setName] = useState(token.name)
  useEffect(() => setName(token.name), [token.id, token.name])
  const area = areaOf(token)
  const what = area ? 'area' : 'light'
  return (
    <div className="tt-form">
      <p className="muted tt-hint">{area ? 'An area that blocks sight. Players see the cloud where their eyes reach it, never the marker.' : 'A light on the map. Players see its light, never the lamp.'} Drag it to move it.</p>
      <label>Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== token.name && sendTable({ t: 'token.update', id: token.id, patch: { name: name.trim() } })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>
      {area ? <AreaFields token={token} area={area} unit={unit} /> : <LightFields token={token} unit={unit} />}
      <button className="btn sm danger" onClick={async () => { if (await confirmDialog(`“${token.name || `This ${what}`}” is taken off the map.`, { title: `Remove ${what}`, okLabel: 'Remove', danger: true })) sendTable({ t: 'token.delete', ids: [token.id] }) }}><Trash2 size={13} /> Remove {what}</button>
    </div>
  )
}

/** Every light on the scene, placed lights and tokens that carry one, to pick or put out without hunting on the map. */
export function SceneLights({ scene, onPlace }: { scene: Scene; onPlace: () => void }) {
  const tokens = useTable((s) => s.tokens)
  const lights = tokens.filter((t) => t.sceneId === scene.id && (isLightSource(t) || (t.data.light && ((t.data.light.bright ?? 0) > 0 || (t.data.light.dim ?? 0) > 0))))
  const select = (t: Token) => useTable.setState({ selected: [t.id], selectedTile: null })
  return (
    <div className="tt-form" role="group" aria-label="Lights on this scene">
      <div className="tt-row tt-between">
        <b>Lights</b>
        <button className="btn sm" title="Then click the map where the light should be" onClick={onPlace}><Lightbulb size={13} /> Place a light</button>
      </div>
      {!lights.length && <p className="muted tt-hint">No lights yet. Place lamps and braziers here, or give a token a torch in its own panel. The light tool also places fog clouds and magical darkness.</p>}
      <ul className="tt-lights">
        {lights.map((t) => {
          const area = areaOf(t)
          if (area) return (
            <li key={t.id}>
              <span className="tt-swatch-dot">{area.kind === 'fog' ? <Cloud size={10} /> : <Moon size={10} />}</span>
              <button className="btn ghost sm grow" onClick={() => select(t)}>{t.name || 'Area'}<small className="muted"> {area.kind === 'fog' ? 'fog' : 'darkness'}, {area.radius} {scene.unit}</small></button>
              <button className={`btn ghost sm square${area.off ? '' : ' on'}`} aria-label={`${area.off ? 'Bring back' : 'Lift'} ${t.name || 'the area'}`} title={area.off ? 'Bring it back' : 'Lift it'} onClick={() => sendTable({ t: 'token.update', id: t.id, patch: { data: { ...t.data, obscure: { ...area, off: !area.off } } } })}>{area.off ? <EyeOff size={13} /> : <Eye size={13} />}</button>
            </li>
          )
          const l = lightOf(t)
          return (
            <li key={t.id}>
              <span className="tt-swatch-dot" style={{ background: shines(l) ? l.color || '#ffd27a' : 'transparent' }} />
              <button className="btn ghost sm grow" onClick={() => select(t)}>{t.name || 'Light'}<small className="muted"> {isLightSource(t) ? '' : 'token, '}{l.bright ?? 0}/{l.dim ?? 0} {scene.unit}</small></button>
              <button className={`btn ghost sm square${l.off ? '' : ' on'}`} aria-label={`${l.off ? 'Light' : 'Put out'} ${t.name || 'the light'}`} title={l.off ? 'Light it' : 'Put it out'} onClick={() => saveLight(t, { ...l, off: !l.off })}>{l.off ? <LightbulbOff size={13} /> : <Lightbulb size={13} />}</button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
