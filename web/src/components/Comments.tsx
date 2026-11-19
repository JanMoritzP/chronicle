import { MessageSquare, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { alertDialog } from '../lib/dialog'
import { pageSavedBus } from '../lib/bus'
import { ago } from '../lib/data'
import { useStore } from '../store'
import type { CommentItem } from '../types'

type Scope = 'me' | 'from' | 'all'
type Filter = 'open' | 'done' | 'all'

/** Loads the world's comments and keeps them current while pages are saved, here or by other people. */
function useComments(wsId: string | null) {
  const [items, setItems] = useState<CommentItem[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    if (!wsId) return
    api.comments(wsId).then((r) => { setItems(r); setError('') }).catch((e) => setError(e.message))
  }, [wsId])
  useEffect(() => {
    load()
    const off = pageSavedBus.on(() => load())
    window.addEventListener('focus', load)
    return () => { off(); window.removeEventListener('focus', load) }
  }, [load])
  return { items, error, load }
}

/** How many open comments are addressed to the signed-in person, for the sidebar. */
export function useUnreadComments(): number {
  const wsId = useStore((s) => s.wsId)
  const me = useStore((s) => s.account?.username)
  const { items } = useComments(wsId)
  return items?.filter((c) => !c.done && c.to === me).length ?? 0
}

function Row({ c, readOnly, onChange }: { c: CommentItem; readOnly: boolean; onChange: () => void }) {
  const navigate = useStore((s) => s.navigate)
  const fail = (e: Error) => alertDialog(e.message)
  return (
    <div className={`todo-row comment-row${c.done ? ' done' : ''}`}>
      <input type="checkbox" checked={c.done} disabled={readOnly} title={c.done ? 'Reopen this comment' : 'Mark as resolved'} aria-label="Resolved"
        onChange={(e) => api.patchComment(c.pageId, c.id, { done: e.target.checked }).then(onChange).catch(fail)} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="comment-line"><b>@{c.to}</b> {c.message}</div>
        <div className="muted todo-context">from {c.from || 'someone'}, {ago(c.createdAt)}{c.context ? ` · “${c.context}”` : ''}</div>
      </div>
      <button className="btn sm" title="Open the page at this comment" onClick={() => navigate({ type: 'page', id: c.pageId, anchor: c.id })}>Go to</button>
      {!readOnly && (
        <button className="icon-btn" title="Delete this comment" aria-label="Delete this comment" onClick={() => api.deleteComment(c.pageId, c.id).then(onChange).catch(fail)}><Trash2 size={15} /></button>
      )}
    </div>
  )
}

export function CommentsView() {
  const wsId = useStore((s) => s.wsId)
  const me = useStore((s) => s.account?.username) ?? ''
  const readOnly = useStore((s) => s.user?.role === 'viewer')
  const navigate = useStore((s) => s.navigate)
  const { items, error, load } = useComments(wsId)
  const [scope, setScope] = useState<Scope>('me')
  const [filter, setFilter] = useState<Filter>('open')
  const [q, setQ] = useState('')

  const forMe = items?.filter((c) => !c.done && c.to === me).length ?? 0
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const shown = (items ?? []).filter((c) =>
      (scope === 'all' || (scope === 'me' ? c.to === me : c.from === me)) &&
      (filter === 'all' || (filter === 'open') === !c.done) &&
      (!needle || `${c.message} ${c.context} ${c.pageTitle} ${c.from} ${c.to}`.toLowerCase().includes(needle)))
    const byPage = new Map<string, { title: string; icon: string | null; items: CommentItem[] }>()
    for (const c of shown) {
      const g = byPage.get(c.pageId) ?? byPage.set(c.pageId, { title: c.pageTitle, icon: c.pageIcon, items: [] }).get(c.pageId)!
      g.items.push(c)
    }
    return [...byPage.entries()]
  }, [items, scope, filter, q, me])

  return (
    <div className="view">
      <h1 style={{ marginTop: 0 }}><MessageSquare size={26} style={{ verticalAlign: -3 }} /> Comments</h1>
      <p className="muted">Type <kbd>@</kbd> and a name in a page to leave that person a comment. They find it here until they tick it off.</p>
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        <div className="seg">
          <button className={scope === 'me' ? 'on' : ''} onClick={() => setScope('me')}>For me{items ? ` (${forMe})` : ''}</button>
          <button className={scope === 'from' ? 'on' : ''} onClick={() => setScope('from')}>From me</button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Everyone</button>
        </div>
        <div className="seg">
          {(['open', 'done', 'all'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'open' ? 'Open' : f === 'done' ? 'Resolved' : 'All'}</button>
          ))}
        </div>
      </div>
      <input className="input" style={{ marginBottom: 14 }} placeholder="Filter by text, person or page" aria-label="Filter comments" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <div className="error">{error}</div>}
      {!items && !error && <div className="muted">Loading…</div>}
      {items && !groups.length && (
        <div className="muted">{items.length ? 'Nothing matches.' : 'No comments yet. Put the cursor in a page, type @ and pick a person.'}</div>
      )}
      {groups.map(([pageId, g]) => (
        <div key={pageId} className="todo-group">
          <a className="todo-page" onClick={() => navigate({ type: 'page', id: pageId })}>{g.icon} {g.title || 'Untitled'}</a>
          {g.items.map((c) => <Row key={c.id} c={c} readOnly={readOnly} onChange={load} />)}
        </div>
      ))}
    </div>
  )
}
