import { Eye, EyeOff, ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { confirmDialog } from '../lib/dialog'
import { useStore } from '../store'
import { pickImage, uploadImage } from '../tabletop/upload'
import { sendTable, useTable, type Handout } from '../tabletop/state'

// Handouts: a letter, a map, a riddle. The GM writes them and chooses who may read each; what is revealed opens on the players' screens and
// stays in their list. Plain text only, so nothing a person types can run on another person's screen.

/** The handout open on this screen, if one was shown to this person. */
export function HandoutViewer() {
  const shown = useTable((s) => s.shown)
  const close = () => useTable.setState({ shown: null })
  useEffect(() => {
    if (!shown) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [shown])
  if (!shown) return null
  return (
    <div className="tt-handout-overlay" role="dialog" aria-label={`Handout: ${shown.title}`} onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="tt-handout">
        <button className="btn ghost sm tt-handout-x" aria-label="Close handout" onClick={close}><X size={14} /></button>
        <h3>{shown.title}</h3>
        {shown.image && <img src={shown.image} alt={shown.title} />}
        {shown.text && <p className="tt-handout-text">{shown.text}</p>}
      </div>
    </div>
  )
}

const who = (h: Handout, names: Map<string, string>) => (h.revealed === 'all' ? 'Shown to everyone' : h.revealed && h.revealed.length ? `Shown to ${h.revealed.map((id) => names.get(id) ?? 'someone').join(', ')}` : 'Hidden from the players')

export function HandoutsPanel() {
  const handouts = useTable((s) => s.handouts)
  const role = useTable((s) => s.role)
  const members = useTable((s) => s.members)
  const you = useTable((s) => s.you)
  const wsId = useStore((s) => s.wsId)
  const gm = role === 'gm'
  const names = new Map(members.map((m) => [m.id, m.username]))
  const [editing, setEditing] = useState<Handout | 'new' | null>(null)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [image, setImage] = useState('')
  const [choosing, setChoosing] = useState<string | null>(null)

  const edit = (h: Handout | 'new') => { setEditing(h); setTitle(h === 'new' ? '' : h.title); setText(h === 'new' ? '' : h.text); setImage(h === 'new' ? '' : h.image) }
  const save = () => {
    if (!title.trim()) return
    sendTable({ t: 'handout.save', ...(editing && editing !== 'new' ? { id: editing.id } : {}), title: title.trim(), text, image })
    setEditing(null)
  }
  const addImage = async () => {
    const f = await pickImage()
    if (f && wsId) { const url = await uploadImage(wsId, f); if (url) setImage(url) }
  }

  if (!gm) {
    return (
      <div className="tt-form">
        <b>Handouts</b>
        {!handouts.length && <p className="muted tt-hint">Nothing has been shown to you yet.</p>}
        <ul className="tt-people" aria-label="Handouts">
          {handouts.map((h) => <li key={h.id}><button className="btn ghost sm grow" style={{ textAlign: 'left' }} onClick={() => useTable.setState({ shown: h })}>{h.title}</button></li>)}
        </ul>
      </div>
    )
  }
  return (
    <div className="tt-form">
      <b>Handouts</b>
      <ul className="tt-people" aria-label="Handouts">
        {handouts.map((h) => (
          <li key={h.id} className="tt-handout-row">
            <span className="grow"><b>{h.title}</b><br /><small className="muted">{who(h, names)}</small></span>
            <button className="btn ghost sm" title="Show to everyone" aria-label={`Show ${h.title} to everyone`} onClick={() => sendTable({ t: 'handout.reveal', id: h.id, to: 'all' })}><Eye size={12} /></button>
            <button className="btn ghost sm" title="Choose who can read it" aria-label={`Choose who reads ${h.title}`} onClick={() => setChoosing(choosing === h.id ? null : h.id)}>People</button>
            <button className="btn ghost sm" title="Hide from the players" aria-label={`Hide ${h.title}`} onClick={() => sendTable({ t: 'handout.reveal', id: h.id, to: 'none' })}><EyeOff size={12} /></button>
            <button className="btn ghost sm" title="Open it on the players' screens again" aria-label={`Show ${h.title} again`} disabled={!h.revealed || (Array.isArray(h.revealed) && !h.revealed.length)} onClick={() => sendTable({ t: 'handout.show', id: h.id })}>Again</button>
            <button className="btn ghost sm" aria-label={`Edit ${h.title}`} onClick={() => edit(h)}><Pencil size={12} /></button>
            <button className="btn ghost sm" aria-label={`Delete ${h.title}`} onClick={async () => { if (await confirmDialog(`Delete the handout “${h.title}”?`, { title: 'Delete handout', okLabel: 'Delete', danger: true })) sendTable({ t: 'handout.delete', id: h.id }) }}><Trash2 size={12} /></button>
            {choosing === h.id && (
              <div className="tt-choose" role="group" aria-label={`Who reads ${h.title}`}>
                {members.filter((m) => m.id !== you?.id).map((m) => {
                  const on = h.revealed === 'all' || (Array.isArray(h.revealed) && h.revealed.includes(m.id))
                  return (
                    <label key={m.id} className="tt-check"><input type="checkbox" checked={on} onChange={(e) => {
                      const now = h.revealed === 'all' ? members.filter((x) => x.id !== you?.id).map((x) => x.id) : Array.isArray(h.revealed) ? h.revealed : []
                      sendTable({ t: 'handout.reveal', id: h.id, to: e.target.checked ? [...new Set([...now, m.id])] : now.filter((x) => x !== m.id) })
                    }} />{m.username}</label>
                  )
                })}
              </div>
            )}
          </li>
        ))}
        {!handouts.length && <li className="muted">No handouts yet.</li>}
      </ul>
      {!editing && <button className="btn sm" onClick={() => edit('new')}><Plus size={12} /> New handout</button>}
      {editing && (
        <>
          <input className="input" aria-label="Handout title" placeholder="Title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input" aria-label="Handout text" rows={6} maxLength={20000} placeholder="What the players read" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="tt-row">
            <button className="btn sm" onClick={addImage}><ImagePlus size={12} /> {image ? 'Change image' : 'Add an image'}</button>
            {image && <button className="btn sm" onClick={() => setImage('')}>Remove image</button>}
          </div>
          {image && <img className="tt-handout-preview" src={image} alt="" />}
          <div className="tt-row">
            <button className="btn sm primary" disabled={!title.trim()} onClick={save}>Save handout</button>
            <button className="btn sm" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}

