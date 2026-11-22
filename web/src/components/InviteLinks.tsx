import { useEffect, useState } from 'react'
import { api } from '../api'
import { alertDialog, confirmDialog } from '../lib/dialog'
import { inviteMail } from '../lib/inviteMail'
import { useStore } from '../store'
import type { Invite } from '../types'
import { Select } from './Select'

// Invite links of a world, for the owner account. The link itself is shown once, when it is made: only a hash of it is kept.

const when = (t: number | null) => (t == null ? 'no end' : new Date(t).toLocaleDateString())

export function InviteLinks({ id, name, on }: { id: string; name: string; on: boolean }) {
  const [list, setList] = useState<Invite[]>([])
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [days, setDays] = useState('7')
  const [people, setPeople] = useState('5')
  const [label, setLabel] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const load = () => api.listInvites(id).then(setList).catch(() => setList([]))
  useEffect(() => { setFresh(null); if (on) void load(); else setList([]) }, [id, on])

  const make = async () => {
    try {
      const r = await api.createInvite(id, { role, days: days === 'never' ? null : Number(days), maxUses: people === 'any' ? null : Number(people), label: label.trim() })
      setFresh(`${location.origin}${r.path}`)
      setCopied(false)
      setLabel('')
      void load()
    } catch (e: any) { alertDialog(e.message) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(fresh!); setCopied(true) } catch { setCopied(false) }
  }

  return (
    <div className="invites">
      <label className="tt-check">
        <input type="checkbox" checked={on} onChange={(e) => useStore.getState().setWorldSettings(id, { invites: e.target.checked }).catch((er) => alertDialog(er.message))} />
        Let people join “{name}” with an invite link
      </label>
      <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>Anyone who opens a link can make an account and is let into this world only. Switching this off closes every link at once.</p>
      {on && (
        <>
          <div className="invites-new">
            <label className="field"><span>They join as</span>
              <Select className="input" value={role} onChange={(v) => setRole(v as 'editor' | 'viewer')}><option value="editor">A player, who can write</option><option value="viewer">A spectator, who can only read</option></Select>
            </label>
            <label className="field"><span>The link works for</span>
              <Select className="input" value={days} onChange={setDays}><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="never">No end</option></Select>
            </label>
            <label className="field"><span>It lets in</span>
              <Select className="input" value={people} onChange={setPeople}><option value="1">1 person</option><option value="5">5 people</option><option value="20">20 people</option><option value="any">Any number</option></Select>
            </label>
            <label className="field"><span>Name (only you see it)</span>
              <input className="input" maxLength={40} placeholder="Tuesday group" value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
            <button className="btn primary" onClick={make}>Create link</button>
          </div>
          {fresh && (
            <div className="invites-fresh" role="status">
              <input className="input" readOnly aria-label="Invite link" value={fresh} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
              <a className="btn" href={inviteMail(name, fresh, role)} title="Opens your mail program with the link in a message">Send by e-mail</a>
              <p className="muted" style={{ fontSize: 13, margin: '4px 0 0', flexBasis: '100%' }}>Send this link to your players. It is shown only now; make another if you lose it.</p>
            </div>
          )}
          <ul className="invites-list" aria-label="Invite links">
            {list.map((i) => (
              <li key={i.id}>
                <span className="grow">{i.label ? <b>{i.label} · </b> : null}{i.role === 'editor' ? 'Player' : 'Spectator'} link · {i.uses}{i.maxUses != null ? ` of ${i.maxUses}` : ''} joined · ends {when(i.expiresAt)} · <b>{i.status}</b></span>
                {i.status === 'open' && <button className="btn sm danger" onClick={async () => { if (await confirmDialog('Nobody can join with this link any more. People who already joined stay.', { title: 'Close this link', okLabel: 'Close link', danger: true })) { await api.revokeInvite(i.id).catch((e) => alertDialog(e.message)); void load() } }}>Close</button>}
              </li>
            ))}
            {!list.length && <li className="muted">No links yet.</li>}
          </ul>
        </>
      )}
    </div>
  )
}
