import { useEffect, useState } from 'react'
import { api } from '../api'
import { roleLabel, useIsGm } from '../lib/access'
import { alertDialog } from '../lib/dialog'
import { useStore } from '../store'
import type { Member, WorldRole } from '../types'
import { Select } from './Select'

/**
 * Who is in the open world and what each of them is: GM (sees and changes everything, secrets included), a player who
 * writes, or a player who reads. A GM changes the roles here; adding and removing people stays with invite links and the
 * admin dashboard.
 */
export function WorldPeople() {
  const wsId = useStore((s) => s.wsId)
  const me = useStore((s) => s.user?.id)
  const gm = useIsGm()
  const [rows, setRows] = useState<Member[] | null>(null)
  const load = () => { if (wsId) api.members(wsId).then(setRows).catch((e) => alertDialog(e.message)) }
  useEffect(load, [wsId])

  const change = async (m: Member, role: WorldRole) => {
    try { await api.setMemberRole(wsId!, m.id, role); load() } catch (e: any) { alertDialog(e.message) }
  }

  if (!wsId) return <p className="muted">Open a world first.</p>
  return (
    <>
      <p className="muted" style={{ fontSize: 13 }}>
        GMs see and change everything, secret boxes and hidden pages included. Players see what their role and the page settings allow.
        To hide a page or a folder, open its menu and choose “Who can see this”.
      </p>
      {rows === null && <p className="muted">Loading…</p>}
      <table className="simple"><tbody>
        {(rows ?? []).map((m) => (
          <tr key={m.id}>
            <td>{m.username}{m.id === me ? <span className="muted"> (you)</span> : null}</td>
            <td style={{ textAlign: 'right' }}>
              {gm && m.role !== 'owner' && m.id !== me ? (
                <Select value={m.role} onChange={(v) => change(m, v as WorldRole)} title={`What ${m.username} is in this world`}>
                  {!m.readOnlyAccount && <option value="gm">GM</option>}
                  {!m.readOnlyAccount && <option value="editor">Player who writes</option>}
                  <option value="viewer">Player who reads</option>
                </Select>
              ) : <span className="muted">{m.role === 'owner' ? 'Owner, GM of every world' : roleLabel(m)}{m.readOnlyAccount ? ' (read-only account)' : ''}</span>}
            </td>
          </tr>
        ))}
      </tbody></table>
    </>
  )
}
