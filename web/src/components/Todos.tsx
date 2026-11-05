import { ListTodo, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { pageSavedBus, todoBus } from '../lib/bus'
import { ago } from '../lib/data'
import { useStore } from '../store'
import type { TodoItem } from '../types'

type Filter = 'open' | 'done' | 'all'

function Row({ t, readOnly, onChange }: { t: TodoItem; readOnly: boolean; onChange: () => void }) {
  const navigate = useStore((s) => s.navigate)
  const [text, setText] = useState(t.message)
  useEffect(() => setText(t.message), [t.message])
  const save = async () => {
    const m = text.trim()
    if (m === t.message || !m) return setText(t.message)
    await api.patchTodo(t.pageId, t.id, { message: m })
    todoBus.emit({ pageId: t.pageId, todoId: t.id, change: { message: m } })
    onChange()
  }
  return (
    <div className={`todo-row${t.done ? ' done' : ''}`}>
      <input type="checkbox" checked={t.done} disabled={readOnly} onChange={async (e) => {
        const done = e.target.checked
        await api.patchTodo(t.pageId, t.id, { done })
        todoBus.emit({ pageId: t.pageId, todoId: t.id, change: { done } })
        onChange()
      }} />
      <div className="grow" style={{ minWidth: 0 }}>
        <input className="todo-edit" value={text} readOnly={readOnly} onChange={(e) => setText(e.target.value)} onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(t.message); (e.target as HTMLInputElement).blur() } }} />
        {t.context && <div className="muted todo-context">“{t.context}”</div>}
      </div>
      <button className="btn sm" title="Open the page at this todo" onClick={() => navigate({ type: 'page', id: t.pageId, anchor: t.id })}>Go to</button>
      {!readOnly && (
        <button className="icon-btn" title="Delete this todo" onClick={async () => {
          await api.deleteTodo(t.pageId, t.id)
          todoBus.emit({ pageId: t.pageId, todoId: t.id, change: null })
          onChange()
        }}><Trash2 size={15} /></button>
      )}
    </div>
  )
}

export function TodosView() {
  const wsId = useStore((s) => s.wsId)!
  const readOnly = useStore((s) => s.user?.role === 'viewer')
  const navigate = useStore((s) => s.navigate)
  const [items, setItems] = useState<TodoItem[] | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.todos(wsId).then((r) => { setItems(r); setError('') }).catch((e) => setError(e.message))
    useStore.getState().refresh()
  }, [wsId])
  useEffect(() => {
    load()
    const off = pageSavedBus.on(() => load())
    window.addEventListener('focus', load)
    return () => { off(); window.removeEventListener('focus', load) }
  }, [load])

  const open = items?.filter((t) => !t.done).length ?? 0
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const shown = (items ?? []).filter((t) =>
      (filter === 'all' || (filter === 'open') === !t.done) &&
      (!needle || `${t.message} ${t.context} ${t.pageTitle}`.toLowerCase().includes(needle)))
    const byPage = new Map<string, { title: string; icon: string | null; items: TodoItem[] }>()
    for (const t of shown) {
      const g = byPage.get(t.pageId) ?? byPage.set(t.pageId, { title: t.pageTitle, icon: t.pageIcon, items: [] }).get(t.pageId)!
      g.items.push(t)
    }
    return [...byPage.entries()]
  }, [items, filter, q])

  return (
    <div className="view">
      <h1 style={{ marginTop: 0 }}><ListTodo size={26} style={{ verticalAlign: -3 }} /> Todos</h1>
      <p className="muted">Type <kbd>/todo</kbd> anywhere in a page to leave a marker. Every marker in this world is listed here until you tick it off.</p>
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="seg">
          {(['open', 'done', 'all'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'open' ? `Open${items ? ` (${open})` : ''}` : f === 'done' ? 'Done' : 'All'}</button>
          ))}
        </div>
        <input className="input grow" style={{ minWidth: 160 }} placeholder="Filter by text or page" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <div className="error">{error}</div>}
      {!items && !error && <div className="muted">Loading…</div>}
      {items && !groups.length && (
        <div className="muted">{items.length ? 'Nothing matches.' : 'No todos yet. Put the cursor in a page, type /todo, and write what needs doing.'}</div>
      )}
      {groups.map(([pageId, g]) => (
        <div key={pageId} className="todo-group">
          <a className="todo-page" data-page-id={pageId} onClick={() => navigate({ type: 'page', id: pageId })}>{g.icon} {g.title || 'Untitled'}</a>
          {g.items.map((t) => <Row key={t.id} t={t} readOnly={readOnly} onChange={load} />)}
        </div>
      ))}
    </div>
  )
}
