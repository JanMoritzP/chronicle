import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Select } from './Select'
import type { CopyPreview, CopyResult } from '../types'

/** Copies pages into another world. Links to pages that are not copied become ghost links. */
export function CopyDialog() {
  const ids = useStore((s) => s.copyPages)
  const workspaces = useStore((s) => s.workspaces)
  const wsId = useStore((s) => s.wsId)
  const pages = useStore((s) => s.data.pages)
  const others = workspaces.filter((w) => w.id !== wsId)
  const [target, setTarget] = useState('')
  const [pv, setPv] = useState<CopyPreview | null>(null)
  const [extra, setExtra] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<CopyResult | null>(null)
  const close = () => useStore.getState().setUi({ copyPages: null })

  useEffect(() => {
    if (ids) { setTarget(others[0]?.id ?? ''); setPv(null); setExtra(new Set()); setErr(''); setDone(null) }
  }, [ids])
  useEffect(() => {
    if (!ids || !target) return
    let alive = true
    setPv(null)
    api.copyPreview(ids, target).then((r) => { if (alive) { setPv(r); setExtra(new Set()) } }).catch((e) => alive && setErr(e.message))
    return () => { alive = false }
  }, [ids, target])

  const names = useMemo(() => new Map(pages.map((p) => [p.id, p.title || 'Untitled'])), [pages])
  if (!ids) return null

  const toggle = (id: string) => setExtra((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const run = async () => {
    setBusy(true); setErr('')
    try { setDone(await api.copyPages([...ids, ...extra], target)) } catch (e: any) { setErr(e.message) }
    setBusy(false)
  }
  const targetName = workspaces.find((w) => w.id === target)?.name

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog" style={{ padding: 16, gap: 12, maxHeight: '85vh', overflow: 'auto' }} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') close() }}>
        {done ? (
          <>
            <b>Copied {done.pages.length} {done.pages.length === 1 ? 'page' : 'pages'} to “{targetName}”</b>
            <ul className="copy-list">
              {done.pages.slice(0, 12).map((p) => <li key={p.to}>{p.title || 'Untitled'}{p.renamed && <span className="muted"> (renamed, that title already existed)</span>}</li>)}
              {done.pages.length > 12 && <li className="muted">and {done.pages.length - 12} more</li>}
            </ul>
            {done.unresolvedNames > 0 && <div className="muted">{done.unresolvedNames} linked {done.unresolvedNames === 1 ? 'name has' : 'names have'} no page there yet. They show as red ghost links and connect automatically once you create or copy a page with that name.</div>}
            {done.images > 0 && <div className="muted">{done.images} {done.images === 1 ? 'image was' : 'images were'} copied too.</div>}
            <div className="row">
              <button className="btn primary" onClick={async () => { close(); await useStore.getState().selectWorkspace(target); useStore.getState().navigate({ type: 'page', id: done.pages[0].to }) }}>Open in “{targetName}”</button>
              <button className="btn" onClick={close}>Stay here</button>
            </div>
          </>
        ) : !others.length ? (
          <>
            <b>Copy to another world</b>
            <div className="muted">There is only one world. Create another one first (the world menu at the top of the sidebar).</div>
            <div className="row"><button className="btn" onClick={close}>Close</button></div>
          </>
        ) : (
          <>
            <b>Copy {ids.length === 1 ? `“${names.get(ids[0]) || 'Untitled'}”` : `${ids.length} pages`} to another world</b>
            <label className="field"><span>Target world</span>
              <Select className="input" value={target} onChange={setTarget}>
                {others.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </label>
            {!pv && !err && <div className="muted">Checking links…</div>}
            {pv && pv.pages.some((p) => p.exists) && (
              <div className="muted">A page with the same title already exists there for: {pv.pages.filter((p) => p.exists).map((p) => p.title).join(', ')}. Copies get “(copy)” added to the title, nothing is overwritten.</div>
            )}
            {pv && pv.linked.length > 0 && (
              <div>
                <div style={{ marginBottom: 4 }}>These pages are linked from what you are copying. Links to pages you leave out become <b>ghost links</b>: they keep their name and connect later.</div>
                <div className="row" style={{ marginBottom: 4 }}>
                  <button className="btn sm" onClick={() => setExtra(new Set(pv.linked.map((l) => l.id)))}>Copy all</button>
                  <button className="btn sm" onClick={() => setExtra(new Set())}>None</button>
                  <span className="muted">{extra.size} of {pv.linked.length} selected</span>
                </div>
                <div className="copy-linked">
                  {pv.linked.map((l) => (
                    <label key={l.id} className="row">
                      <input type="checkbox" checked={extra.has(l.id)} onChange={() => toggle(l.id)} />
                      <span className="grow ellipsis">{l.title || 'Untitled'}</span>
                      {l.exists && <span className="muted" style={{ fontSize: 12 }}>name exists there</span>}
                      <span className="muted" style={{ fontSize: 12 }}>{l.mentions}×</span>
                    </label>
                  ))}
                </div>
                <small className="muted">Pages you tick here are copied as well, but their own links are not followed further.</small>
              </div>
            )}
            {pv && !pv.linked.length && <div className="muted">These pages do not link to other pages.</div>}
            {err && <div className="error">{err}</div>}
            <div className="row">
              <button className="btn primary" disabled={busy || !pv} onClick={run}>{busy ? 'Copying…' : `Copy ${ids.length + extra.size} ${ids.length + extra.size === 1 ? 'page' : 'pages'}`}</button>
              <button className="btn" onClick={close}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
