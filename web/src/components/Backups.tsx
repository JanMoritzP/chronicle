import { Download, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { alertDialog, confirmDialog } from '../lib/dialog'
import type { BackupInfo } from '../types'

const mb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const KIND: Record<BackupInfo['kind'], string> = { daily: 'daily', 'pre-restore': 'before a restore', other: '' }

/** Owner only: snapshots of the database, download of them, whole-instance export, and restore. */
export function BackupsSection() {
  const [list, setList] = useState<BackupInfo[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const load = () => api.backupInfo().then(setList).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr(''); setMsg('')
    try { await fn() } catch (e: any) { setErr(e.message) }
    setBusy('')
  }

  const restore = async (b: BackupInfo) => {
    const when = new Date(b.createdAt).toLocaleString()
    if (!(await confirmDialog(`All worlds, pages, maps and everything else go back to that moment. Accounts stay as they are. A backup of the current state is made first, so this can be undone.`, { title: `Restore the backup from ${when}?`, okLabel: 'Restore', danger: true }))) return
    run('restore', async () => {
      const r = await api.restoreBackup(b.name)
      await alertDialog(`The state before is saved as ${r.safety}. The page reloads now.`, 'Restored')
      location.reload()
    })
  }

  return (
    <>
      <h3 className="muted" style={{ marginTop: 28 }}>Backups</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        A snapshot of the database is written daily and the newest 14 are kept. Snapshots hold all text, links, maps and settings; uploaded images and map images are not in them, so use the full download to move or archive everything.
      </p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn" disabled={!!busy} onClick={() => run('backup', async () => { await api.runBackup(); await load(); setMsg('Backup written.') })}><Download size={14} style={{ verticalAlign: -2 }} /> Back up now</button>
        <a className="btn" href="/api/export/full" download>Download everything (.zip)</a>
      </div>
      {list.length > 0 && (
        <table className="simple" style={{ marginTop: 10 }}><tbody>
          {list.slice(0, 20).map((b) => (
            <tr key={b.name}>
              <td>{new Date(b.createdAt).toLocaleString()}</td>
              <td className="muted" style={{ fontSize: 12 }}>{mb(b.size)}{KIND[b.kind] ? ` · ${KIND[b.kind]}` : ''}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <a className="btn sm" href={`/api/backups/${encodeURIComponent(b.name)}/download`} download>Download</a>{' '}
                <button className="btn sm" disabled={!!busy} onClick={() => restore(b)}><RotateCcw size={12} style={{ verticalAlign: -1 }} /> Restore</button>{' '}
                <button className="icon-btn" title="Delete this backup" disabled={!!busy} onClick={async () => { if (await confirmDialog('Delete this backup file?', { okLabel: 'Delete', danger: true })) run('delete', async () => { await api.deleteBackup(b.name); await load() }) }}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody></table>
      )}
      {busy === 'restore' && <div className="muted" style={{ marginTop: 8 }}>Restoring…</div>}
      {msg && <div className="muted" style={{ marginTop: 8 }}>{msg}</div>}
      {err && <div className="error">{err}</div>}
    </>
  )
}
