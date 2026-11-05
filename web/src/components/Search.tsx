import { FileText, Hash, Inbox, Terminal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { highlight } from '../lib/fuzzy'
import { fuzzy } from '../lib/fuzzy'
import { searchPages } from '../lib/linkSearch'
import { ACTION_LABELS, prettyCombo } from '../lib/keys'
import { THEMES, applyTheme } from '../themes'
import { useStore } from '../store'
import { PageIcon } from './TypeIcon'

interface Row { key: string; label: string; sub?: string; indices?: number[]; icon: React.ReactNode; group: string; run: () => void }

export function SearchDialog() {
  const { searchOpen, searchInitial, data, bindings } = useStore()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const close = () => useStore.getState().setUi({ searchOpen: false })

  useEffect(() => { if (searchOpen) { setQ(searchInitial); setIdx(0); setTimeout(() => input.current?.focus(), 0) } }, [searchOpen, searchInitial])

  const rows = useMemo<Row[]>(() => {
    if (!searchOpen) return []
    const st = useStore.getState()
    const nav = (v: any, o?: any) => () => { close(); st.navigate(v, o) }

    if (q.startsWith('/')) {
      const cq = q.slice(1)
      const commands: { id: string; label: string; run: () => void; hint?: string }[] = [
        { id: 'new', label: 'New page', hint: bindings.newPage[0], run: () => st.createPage() },
        { id: 'capture', label: 'Quick capture', hint: bindings.capture[0], run: () => st.setUi({ captureOpen: true }) },
        { id: 'zen', label: 'Toggle zen mode', hint: bindings.zen[0], run: () => st.setUi({ zen: !st.zen }) },
        { id: 'graph', label: 'Open graph', hint: bindings.graph[0], run: () => st.navigate({ type: 'graph' }) },
        { id: 'zettel', label: 'Open zettelkasten', hint: bindings.zettels[0], run: () => st.navigate({ type: 'zettels' }) },
        { id: 'maps', label: 'Open maps', run: () => st.navigate({ type: 'maps' }) },
        { id: 'timeline', label: 'Open timeline', run: () => st.navigate({ type: 'timeline' }) },
        { id: 'sessions', label: 'Open sessions and statistics', run: () => st.navigate({ type: 'sessions' }) },
        { id: 'templates', label: 'Open templates', run: () => st.navigate({ type: 'templates' }) },
        { id: 'todos', label: 'Open todos', hint: bindings.todos[0], run: () => st.navigate({ type: 'todos' }) },
        ...(() => {
          const tab = st.tabs.find((t) => t.id === st.activeTab) ?? st.tabs[0]
          const v = tab.history[tab.index]
          return v?.type === 'page' && st.workspaces.length > 1 && st.user?.role !== 'viewer'
            ? [{ id: 'copyworld', label: 'Copy this page to another world', run: () => st.setUi({ copyPages: [v.id] }) }] : []
        })(),
        { id: 'trash', label: 'Open trash', run: () => st.navigate({ type: 'trash' }) },
        { id: 'settings', label: 'Open settings', run: () => st.navigate({ type: 'settings' }) },
        { id: 'sidebar', label: 'Toggle sidebar', hint: bindings.toggleSidebar[0], run: () => st.setUi({ sidebarOpen: !st.sidebarOpen }) },
        { id: 'split', label: 'Close split view', run: () => st.setSplit(null) },
        { id: 'logout', label: 'Log out', run: () => st.logout() },
        ...THEMES.map((t) => ({ id: `theme-${t.id}`, label: `Theme: ${t.name}`, run: () => applyTheme(t.id) })),
        ...st.workspaces.map((w) => ({ id: `ws-${w.id}`, label: `Switch workspace: ${w.name}`, run: () => st.selectWorkspace(w.id) })),
      ]
      return commands
        .map((c) => ({ c, h: fuzzy(cq, c.label) }))
        .filter((x) => x.h)
        .sort((a, b) => b.h!.score - a.h!.score)
        .map(({ c, h }) => ({ key: c.id, label: c.label, sub: c.hint ? prettyCombo(c.hint) : undefined, indices: h!.indices, icon: <Terminal size={15} />, group: 'Commands', run: () => { close(); c.run() } }))
    }

    const out: Row[] = []
    const query = q.startsWith('#') ? '' : q
    for (const h of searchPages(query, q ? 10 : 8)) {
      out.push({ key: `p:${h.page.id}`, group: q ? 'Pages' : 'Recent', label: h.page.title || 'Untitled', sub: h.via === 'alias' ? 'alias' : h.page.tags.map((t) => `#${t}`).join(' '),
        indices: h.via === 'title' ? h.hit.indices : [], icon: <PageIcon page={h.page} size={15} />, run: nav({ type: 'page', id: h.page.id }) })
    }
    if (!q) return out

    if (q.startsWith('#')) {
      const tags = new Set(data.pages.flatMap((p) => p.tags))
      return [...tags].map((t) => ({ t, h: fuzzy(q.slice(1), t) })).filter((x) => x.h).sort((a, b) => b.h!.score - a.h!.score).slice(0, 20)
        .map(({ t }) => ({ key: `t:${t}`, group: 'Tags', label: `#${t}`, icon: <Hash size={15} />, run: nav({ type: 'tag', tag: t }) }))
    }

    const lower = q.toLowerCase()
    const seen = new Set(out.map((o) => o.key))
    for (const p of data.pages) {
      for (const h of p.outline) {
        const hit = fuzzy(q, h.text)
        if (hit && hit.score > 40) out.push({ key: `h:${p.id}:${h.id}`, group: 'Sections', label: h.text, sub: p.title, indices: hit.indices, icon: <Hash size={15} />, run: nav({ type: 'page', id: p.id, anchor: h.id }) })
      }
    }
    if (q.length >= 2) {
      let n = 0
      for (const p of data.pages) {
        if (n >= 8) break
        const i = p.text.toLowerCase().indexOf(lower)
        if (i < 0 || seen.has(`p:${p.id}`)) continue
        const s = Math.max(0, i - 30)
        out.push({ key: `x:${p.id}`, group: 'Full text', label: p.title || 'Untitled', sub: `…${p.text.slice(s, i + 70).replace(/\s+/g, ' ')}…`, icon: <FileText size={15} />, run: nav({ type: 'page', id: p.id }) })
        n++
      }
      for (const z of data.zettels) {
        if (z.body.toLowerCase().includes(lower) || z.tags.some((t) => t.includes(lower))) {
          out.push({ key: `z:${z.id}`, group: 'Zettels', label: z.body.slice(0, 90), sub: z.pageId ? 'Processed' : z.tags.map((t) => `#${t}`).join(' '), icon: <Inbox size={15} />, run: nav({ type: 'zettels' }) })
        }
      }
    }
    return out.slice(0, 40)
  }, [q, searchOpen, data, bindings])

  if (!searchOpen) return null
  const pick = (r?: Row) => r?.run()
  let last = ''
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={input} className="big" placeholder="Search pages, text, #tags… or type / for commands" value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(rows.length - 1, i + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
            else if (e.key === 'Enter') {
              if (e.ctrlKey && rows[idx]?.key.startsWith('p:')) { close(); useStore.getState().navigate({ type: 'page', id: rows[idx].key.slice(2) }, { newTab: true }) }
              else if (!rows.length && q.trim() && !q.startsWith('/') && useStore.getState().user?.role !== 'viewer') { close(); useStore.getState().createPage({ title: q.trim() }) }
              else pick(rows[idx])
            }
          }} />
        <div className="results">
          {rows.map((r, i) => {
            const head = r.group !== last ? r.group : null
            last = r.group
            return (
              <div key={r.key}>
                {head && <div className="side-label" style={{ padding: '8px 10px 2px' }}>{head}</div>}
                <div className={`result ${i === idx ? 'sel' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => pick(r)}>
                  <span className="muted row">{r.icon}</span>
                  <div className="grow">
                    <div className="ellipsis">{r.indices?.length ? highlight(r.label, r.indices).map((p, k) => typeof p === 'string' ? p : <mark key={k}>{p.m}</mark>) : r.label}</div>
                    {r.sub && <div className="sub ellipsis">{r.sub}</div>}
                  </div>
                </div>
              </div>
            )
          })}
          {!rows.length && <div className="muted" style={{ padding: 14 }}>{q.startsWith('/') ? 'No matching command.' : <>No results. Press <kbd>Enter</kbd> to create “{q}”.</>}</div>}
        </div>
        <div className="muted" style={{ padding: '6px 14px', fontSize: 12, borderTop: '1px solid var(--border)' }}>
          {Object.entries(ACTION_LABELS).length && '↑↓ navigate · Enter open · Ctrl+Enter new tab · # tags · / commands'}
        </div>
      </div>
    </div>
  )
}
