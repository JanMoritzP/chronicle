import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { sendTable, useTable, type Scene, type Trigger } from '../tabletop/state'
import { Select } from './Select'

// Things that happen by themselves: a player's token steps into a place, a round of combat begins, a token goes down. Each says something at the
// table, shows a handout to everyone or starts a track from the jukebox. Only the GM sees them (on the map they are orange circles).

const EVENTS: Record<Trigger['event'], string> = { enter: 'A player token comes into the place', round: 'A new round of combat begins', down: 'A token goes down to 0 hit points' }
const ACTIONS: Record<Trigger['action'], string> = { say: 'Say something at the table', handout: 'Show a handout to everyone', play: 'Play a track' }

export function TriggersSection({ scene }: { scene: Scene }) {
  const triggers = useTable((s) => s.triggers)
  const handouts = useTable((s) => s.handouts)
  const tracks = useTable((s) => s.jukebox.tracks)
  const tokens = useTable((s) => s.tokens)
  const selected = useTable((s) => s.selected)
  const [editing, setEditing] = useState<Trigger | 'new' | null>(null)
  const [name, setName] = useState('')
  const [event, setEvent] = useState<Trigger['event']>('enter')
  const [action, setAction] = useState<Trigger['action']>('say')
  const [arg, setArg] = useState('')
  const [radius, setRadius] = useState('1.5')
  const [once, setOnce] = useState(true)
  const [here, setHere] = useState(true)
  const [place, setPlace] = useState<{ x: number; y: number } | null>(null)

  const mine = triggers.filter((t) => !t.scene || t.scene === scene.id)
  const start = (t: Trigger | 'new') => {
    setEditing(t)
    setName(t === 'new' ? '' : t.name); setEvent(t === 'new' ? 'enter' : t.event); setAction(t === 'new' ? 'say' : t.action); setArg(t === 'new' ? '' : t.arg)
    setRadius(String(t === 'new' ? 1.5 : t.radius)); setOnce(t === 'new' ? true : t.once); setHere(t === 'new' ? true : !!t.scene)
    setPlace(t === 'new' ? null : { x: t.x, y: t.y })
  }
  const useSelected = () => { const t = tokens.find((x) => x.id === selected[0]); if (t) setPlace({ x: Math.round(t.x), y: Math.round(t.y) }) }
  const valid = name.trim() && (action === 'say' ? arg.trim() : arg) && (event !== 'enter' || place) && Number(radius) >= 0.5
  const save = () => {
    sendTable({ t: 'trigger.save', ...(editing && editing !== 'new' ? { id: editing.id } : {}), name: name.trim(), scene: here ? scene.id : null, event, x: place?.x ?? 0, y: place?.y ?? 0, radius: Math.min(50, Math.max(0.5, Number(radius) || 1)), action, arg: action === 'say' ? arg.trim() : arg, once })
    setEditing(null)
  }
  const say = (t: Trigger) => (t.action === 'say' ? `says “${t.arg}”` : t.action === 'handout' ? `shows ${handouts.find((h) => h.id === t.arg)?.title ?? 'a handout'}` : `plays ${tracks.find((x) => x.id === t.arg)?.name ?? 'a track'}`)

  return (
    <div className="tt-form" role="region" aria-label="Triggers">
      <b>Triggers</b>
      <ul className="tt-people" aria-label="Trigger list">
        {mine.map((t) => (
          <li key={t.id} className="tt-handout-row">
            <span className="grow"><b>{t.name}</b><br /><small className="muted">{EVENTS[t.event]}, then {say(t)}{t.once ? (t.fired ? ' (used)' : ' (once)') : ''}</small></span>
            {t.once && t.fired && <button className="btn ghost sm" aria-label={`Arm ${t.name} again`} title="Let it fire again" onClick={() => sendTable({ t: 'trigger.reset', id: t.id })}><RotateCcw size={12} /></button>}
            <button className="btn ghost sm" aria-label={`Edit ${t.name}`} onClick={() => start(t)}><Pencil size={12} /></button>
            <button className="btn ghost sm" aria-label={`Delete ${t.name}`} onClick={() => sendTable({ t: 'trigger.delete', id: t.id })}><Trash2 size={12} /></button>
          </li>
        ))}
        {!mine.length && <li className="muted">No triggers yet.</li>}
      </ul>
      {!editing && <button className="btn sm" onClick={() => start('new')}><Plus size={12} /> New trigger</button>}
      {editing && (
        <>
          <input className="input" aria-label="Trigger name" placeholder="Name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <label>When
            <Select className="input" value={event} onChange={(v) => setEvent(v as Trigger['event'])} title="When it happens">
              {(Object.keys(EVENTS) as Trigger['event'][]).map((k) => <option key={k} value={k}>{EVENTS[k]}</option>)}
            </Select>
          </label>
          {event === 'enter' && (
            <div className="tt-row">
              <button className="btn sm" onClick={useSelected} disabled={!selected.length}>Put it where the selected token is</button>
              <span className="muted">{place ? `at ${place.x}, ${place.y}` : 'no place yet'}</span>
              <label>Radius (cells)<input className="input tt-num" type="number" min={0.5} max={50} step={0.5} aria-label="Radius in cells" value={radius} onChange={(e) => setRadius(e.target.value)} /></label>
            </div>
          )}
          <label>Then
            <Select className="input" value={action} onChange={(v) => { setAction(v as Trigger['action']); setArg('') }} title="What it does">
              {(Object.keys(ACTIONS) as Trigger['action'][]).map((k) => <option key={k} value={k}>{ACTIONS[k]}</option>)}
            </Select>
          </label>
          {action === 'say' && <textarea className="input" aria-label="What is said" rows={2} maxLength={300} placeholder="{name} hears a click." value={arg} onChange={(e) => setArg(e.target.value)} />}
          {action === 'handout' && (
            <Select className="input" value={arg} onChange={setArg} title="Handout to show">
              <option value="">Choose a handout</option>
              {handouts.map((h) => <option key={h.id} value={h.id}>{h.title}</option>)}
            </Select>
          )}
          {action === 'play' && (
            <Select className="input" value={arg} onChange={setArg} title="Track to play">
              <option value="">Choose a track</option>
              {tracks.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          )}
          <label className="tt-check"><input type="checkbox" checked={once} onChange={(e) => setOnce(e.target.checked)} />Only the first time</label>
          <label className="tt-check"><input type="checkbox" checked={here} onChange={(e) => setHere(e.target.checked)} />Only on this scene</label>
          <div className="tt-row">
            <button className="btn sm primary" disabled={!valid} onClick={save}>Save trigger</button>
            <button className="btn sm" onClick={() => setEditing(null)}>Cancel</button>
          </div>
          {action === 'say' && <p className="muted" style={{ fontSize: 12, margin: 0 }}>{'{name}'} is replaced by the name of the token.</p>}
        </>
      )}
    </div>
  )
}
