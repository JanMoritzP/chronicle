import { Check, Copy, Globe } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'

export const shareUrl = (token: string) => `${location.origin}/s/${token}`

/** Public read-only link for one page. Links and embeds only reach other pages that are shared as well. */
export function ShareDialog({ pageId, title, onClose }: { pageId: string; title: string; onClose: () => void }) {
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { api.shareStatus(pageId).then((r) => setToken(r.token)).catch((e) => setErr(e.message)) }, [pageId])

  const act = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn() } catch (e: any) { setErr(e.message) } setBusy(false) }
  const url = token ? shareUrl(token) : ''

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" style={{ padding: 16, gap: 12 }} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <b className="row"><Globe size={16} /> Share “{title || 'Untitled'}”</b>
        {token === undefined && !err && <div className="muted">Checking…</div>}
        {token === null && (
          <>
            <div className="muted">Anyone with the link can read this page without logging in. They cannot edit, search or see anything else in your world.</div>
            <ul className="muted share-notes">
              <li>Links to pages that are not shared show as plain text.</li>
              <li>Embeds of pages that are not shared are left out.</li>
              <li>Images on the page become visible to people with the link.</li>
            </ul>
            <div className="row"><button className="btn primary" disabled={busy} onClick={() => act(async () => setToken((await api.share(pageId)).token))}>Create public link</button><button className="btn" onClick={onClose}>Cancel</button></div>
          </>
        )}
        {token && (
          <>
            <div className="row">
              <input className="input grow" readOnly value={url} onFocus={(e) => e.target.select()} />
              <button className="btn" onClick={async () => { await navigator.clipboard?.writeText(url).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>This page is public. Share the pages it links to as well if readers should be able to follow those links.</div>
            <div className="row">
              <a className="btn" href={url} target="_blank" rel="noreferrer">Open</a>
              <button className="btn danger" disabled={busy} onClick={() => act(async () => { await api.unshare(pageId); setToken(null) })}>Stop sharing</button>
              <span className="grow" />
              <button className="btn" onClick={onClose}>Close</button>
            </div>
            <small className="muted">Stopping kills this link for good. Sharing again makes a new one.</small>
          </>
        )}
        {err && <div className="error">{err}</div>}
      </div>
    </div>
  )
}
