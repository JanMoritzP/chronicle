import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { sendTable, useTable, type Token } from '../tabletop/state'
import { runMacro } from './TableMacros'
import { useStore } from '../store'
import { pickImage, uploadImage } from '../tabletop/upload'
import { Select } from './Select'

// How a token looks beyond its picture (shape, border, tint, flip, name plate, elevation, aura), the extra bars under its hit points, and the buttons
// on it that run a macro. All of it lives in the token's data.

const patchData = (token: Token, change: Record<string, unknown>) => {
  const data: Record<string, unknown> = { ...token.data, ...change }
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k]
  sendTable({ t: 'token.update', id: token.id, patch: { data } })
}

export function TokenLook({ token }: { token: Token }) {
  const wsId = useStore((s) => s.wsId)
  const variants = ((token.data.variants as string[] | undefined) ?? [])
  const unit = useTable((s) => s.scenes.find((x) => x.id === s.sceneId)?.unit ?? 'ft')
  const d = token.data as { shape?: string; border?: string; tint?: string; flip?: boolean; nameplate?: boolean; elevation?: number; aura?: { radius: number; color: string } }
  return (
    <div className="tt-form" role="group" aria-label="Token look">
      <b>Look</b>
      <label>Shape
        <Select className="input" value={d.shape ?? 'round'} onChange={(v) => patchData(token, { shape: v === 'round' ? undefined : v })} title="Shape of the token">
          <option value="round">Round</option><option value="square">Square</option><option value="hex">Hexagon</option>
        </Select>
      </label>
      <div className="tt-row">
        <label>Border<input className="tt-color" type="color" aria-label="Border colour" value={d.border ?? '#000000'} onChange={(e) => patchData(token, { border: e.target.value })} /></label>
        {d.border && <button className="btn sm" onClick={() => patchData(token, { border: undefined })}>Plain border</button>}
        <label>Tint<input className="tt-color" type="color" aria-label="Tint colour" value={d.tint ?? '#ffffff'} onChange={(e) => patchData(token, { tint: e.target.value })} /></label>
        {d.tint && <button className="btn sm" onClick={() => patchData(token, { tint: undefined })}>No tint</button>}
      </div>
      <div className="tt-row" role="group" aria-label="Picture variants">
        <button className="btn sm" title="Add another picture this token can wear" onClick={async () => { const f = await pickImage(); if (!f || !wsId) return; const url = await uploadImage(wsId, f); if (url) patchData(token, { variants: [...variants, url].slice(0, 8) }) }}>Add a variant</button>
        <button className="btn sm" disabled={variants.length < 1} title="Pick one of the variants at random" onClick={() => { const pool = [token.image, ...variants].filter(Boolean); sendTable({ t: 'token.update', id: token.id, patch: { image: pool[Math.floor(Math.random() * pool.length)] } }) }}>Shuffle the picture</button>
        {variants.length > 0 && <button className="btn sm" onClick={() => patchData(token, { variants: undefined })}>Forget the variants ({variants.length})</button>}
      </div>
      <label className="tt-check"><input type="checkbox" checked={!!d.flip} onChange={(e) => patchData(token, { flip: e.target.checked || undefined })} />Flip the picture</label>
      <label className="tt-check"><input type="checkbox" checked={d.nameplate !== false} onChange={(e) => patchData(token, { nameplate: e.target.checked ? undefined : false })} />Show the label under the token</label>
      <div className="tt-row">
        <label>Height ({unit})<input className="input tt-num" type="number" aria-label="Elevation" defaultValue={d.elevation ?? 0} key={`el${d.elevation}`} onBlur={(e) => { const n = Math.round(Number(e.target.value) || 0); if (n !== (d.elevation ?? 0)) patchData(token, { elevation: n || undefined }) }} /></label>
        <label>Aura ({unit})<input className="input tt-num" type="number" min={0} aria-label="Aura radius" defaultValue={d.aura?.radius ?? 0} key={`au${d.aura?.radius}`} onBlur={(e) => { const n = Math.max(0, Number(e.target.value) || 0); if (n !== (d.aura?.radius ?? 0)) patchData(token, { aura: n ? { radius: n, color: d.aura?.color ?? '#ff5555' } : undefined }) }} /></label>
        {d.aura && <input className="tt-color" type="color" aria-label="Aura colour" value={d.aura.color} onChange={(e) => patchData(token, { aura: { ...d.aura!, color: e.target.value } })} />}
      </div>
    </div>
  )
}

interface Bar { name: string; value: number; max: number; color: string }
const BAR_COLOURS = ['#4aa3ff', '#e0a030', '#9b59b6']

export function TokenBars({ token, can }: { token: Token; can: boolean }) {
  const bars = (token.data.bars ?? []) as Bar[]
  const set = (next: Bar[]) => patchData(token, { bars: next.length ? next : undefined })
  if (!can && !bars.length) return null
  return (
    <div className="tt-form" role="group" aria-label="More bars">
      {bars.map((b, i) => (
        <div key={i} className="tt-row">
          <input className="input" aria-label={`Bar ${i + 1} label`} defaultValue={b.name} maxLength={20} disabled={!can} key={`n${i}${b.name}`} onBlur={(e) => e.target.value !== b.name && set(bars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input className="input tt-num" type="number" aria-label={`${b.name || 'Bar'} value`} defaultValue={b.value} disabled={!can} key={`v${i}${b.value}`} onBlur={(e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n) && n !== b.value) set(bars.map((x, j) => (j === i ? { ...x, value: n } : x))) }} />
          <span>/</span>
          <input className="input tt-num" type="number" min={0} aria-label={`${b.name || 'Bar'} maximum`} defaultValue={b.max} disabled={!can} key={`m${i}${b.max}`} onBlur={(e) => { const n = Math.max(0, Math.round(Number(e.target.value))); if (Number.isFinite(n) && n !== b.max) set(bars.map((x, j) => (j === i ? { ...x, max: n } : x))) }} />
          {can && <input className="tt-color" type="color" aria-label={`${b.name || 'Bar'} colour`} value={b.color} onChange={(e) => set(bars.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />}
          {can && <button className="btn ghost sm" aria-label={`Remove ${b.name || 'bar'}`} onClick={() => set(bars.filter((_, j) => j !== i))}><Trash2 size={12} /></button>}
        </div>
      ))}
      {can && bars.length < 3 && <button className="btn sm" onClick={() => set([...bars, { name: ['Mana', 'Charges', 'Ammo'][bars.length], value: 10, max: 10, color: BAR_COLOURS[bars.length] }])}><Plus size={12} /> New bar</button>}
    </div>
  )
}

interface Action { name: string; text: string }

/** Buttons on a token that run a macro: an attack, a spell, a bit of talk. The GM writes them; anyone who can use the token presses them. */
export function TokenActions({ token, gm }: { token: Token; gm: boolean }) {
  const actions = (token.data.actions ?? []) as Action[]
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const set = (next: Action[]) => patchData(token, { actions: next.length ? next : undefined })
  if (!gm && !actions.length) return null
  return (
    <div className="tt-form" role="group" aria-label="Token actions">
      <b>Actions</b>
      <div className="tt-chips">
        {actions.map((a, i) => (
          <span key={i} className="tt-chip on">
            <button className="tt-roll" title={a.text} onClick={() => void runMacro(a.text.replace(/@\{token\|name\}/g, token.name))}>{a.name}</button>
            {gm && <button className="tt-x" aria-label={`Remove action ${a.name}`} onClick={() => set(actions.filter((_, j) => j !== i))}>×</button>}
          </span>
        ))}
      </div>
      {gm && actions.length < 8 && (
        <>
          <input className="input" aria-label="Button label" placeholder="Action, for example Bite" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="input" aria-label="Button macro" rows={2} maxLength={600} placeholder={'/roll 1d20+4 bite\n/roll 1d6+2 piercing damage'} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn sm" disabled={!name.trim() || !text.trim()} onClick={() => { set([...actions, { name: name.trim(), text: text.trim() }]); setName(''); setText('') }}><Plus size={12} /> Make the button</button>
        </>
      )}
    </div>
  )
}
