import { Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { folderRule, hasRule, LEVEL_LABEL, roleLabel, ruleSummary } from '../lib/access'
import { useStore } from '../store'
import type { AccessLevel, AccessRule, Member } from '../types'
import { Select } from './Select'

/**
 * Who may see and change one page or one folder. GMs always reach everything; the rule decides for everyone else.
 * A page without a rule of its own follows its folder.
 */
export function AccessDialog({ kind, id, onClose }: { kind: 'page' | 'folder'; id: string; onClose: () => void }) {
  const wsId = useStore((s) => s.wsId)
  const page = useStore((s) => (kind === 'page' ? s.data.pages.find((p) => p.id === id) : undefined))
  const folder = useStore((s) => (kind === 'folder' ? s.data.folders.find((f) => f.id === id) : undefined))
  const folders = useStore((s) => s.data.folders)
  const own = (kind === 'page' ? page?.access : folder?.access) ?? null
  const above = folderRule(folders, kind === 'page' ? page?.folderId ?? null : folder?.parentId ?? null)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [everyone, setEveryone] = useState<AccessLevel | 'role'>(own?.everyone ?? 'role')
  const [people, setPeople] = useState<Record<string, AccessLevel>>(own?.people ?? {})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { if (wsId) api.members(wsId).then(setMembers).catch((e) => setErr(e.message)) }, [wsId])

  const name = kind === 'page' ? page?.title || 'Untitled' : folder?.name ?? ''
  const others = (members ?? []).filter((m) => m.role !== 'owner' && m.role !== 'gm')
  const gms = (members ?? []).filter((m) => m.role === 'owner' || m.role === 'gm')
  const rule: AccessRule | null = everyone === 'role' && !Object.keys(people).length ? null : { ...(everyone !== 'role' ? { everyone } : {}), ...(Object.keys(people).length ? { people } : {}) }

  const save = async (next: AccessRule | null) => {
    setBusy(true); setErr('')
    try {
      if (kind === 'page') await api.setPageAccess(id, next)
      else await api.setFolderAccess(id, next)
      await useStore.getState().refresh()
      onClose()
    } catch (e: any) { setErr(e.message); setBusy(false) }
  }

  const setPerson = (uid: string, v: string) => setPeople((p) => {
    const next = { ...p }
    if (v === 'same') delete next[uid]; else next[uid] = v as AccessLevel
    return next
  })

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog access-dialog" role="dialog" aria-label={`Who can see ${name}`} style={{ padding: 16, gap: 12 }} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <b className="row"><Lock size={16} /> Who can see “{name}”</b>
        <div className="muted" style={{ fontSize: 13 }}>
          GMs always see and change everything{gms.length ? ` (${gms.map((g) => g.username).join(', ')})` : ''}.
          {kind === 'folder' ? ' Pages and folders inside follow this, unless they have a setting of their own.' : ''}
        </div>
        {!hasRule(own) && above.from && (
          <div className="access-inherited">Now follows the folder “{above.from.name}”: {ruleSummary(above.rule, members ?? [])}.</div>
        )}
        <label className="field"><span>Everyone in the world</span>
          <Select className="input" value={everyone} onChange={(v) => setEveryone(v as AccessLevel | 'role')}>
            <option value="role">By their role</option>
            <option value="edit">{LEVEL_LABEL.edit}</option>
            <option value="view">{LEVEL_LABEL.view}</option>
            <option value="none">Hidden (only GMs)</option>
          </Select>
        </label>
        {members === null && !err && <div className="muted">Loading people…</div>}
        {others.length > 0 && (
          <div className="access-people">
            <div className="muted" style={{ fontSize: 13 }}>Single people</div>
            {others.map((m) => (
              <div key={m.id} className="row access-person">
                <span className="grow ellipsis">{m.username} <span className="muted">· {roleLabel(m)}</span></span>
                <Select value={people[m.id] ?? 'same'} onChange={(v) => setPerson(m.id, v)} title={`What ${m.username} may do`}>
                  <option value="same">Like everyone</option>
                  {/* a read-only account can never write */}
                  {!m.readOnlyAccount && <option value="edit">{LEVEL_LABEL.edit}</option>}
                  <option value="view">{LEVEL_LABEL.view}</option>
                  <option value="none">{LEVEL_LABEL.none}</option>
                </Select>
              </div>
            ))}
          </div>
        )}
        {members !== null && !others.length && <div className="muted" style={{ fontSize: 13 }}>Nobody but GMs is in this world yet.</div>}
        <div className="muted" style={{ fontSize: 13 }}>{rule ? `This ${kind}: ${ruleSummary(rule, members ?? [])}.` : kind === 'page' && above.from ? 'This page follows its folder.' : 'Everyone sees this by their role.'}</div>
        {err && <div className="error">{err}</div>}
        <div className="row">
          {hasRule(own) && <button className="btn" disabled={busy} onClick={() => save(null)}>{kind === 'page' && above.from ? 'Follow the folder' : 'Clear'}</button>}
          <span className="grow" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={() => save(rule)}>Save</button>
        </div>
      </div>
    </div>
  )
}
