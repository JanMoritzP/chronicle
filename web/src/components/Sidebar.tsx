import {
  BookOpen, CalendarDays, ChevronDown, ChevronRight, FilePlus2, FolderPlus, Hash, Inbox, LayoutTemplate, ListTodo, Map as MapIcon, Network, ScrollText, Search, Settings, Shapes, Trash2, Users, Zap,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { alertDialog, askText, confirmDialog } from '../lib/dialog'
import { buildTagTree, type TagNode } from '../lib/data'
import { currentView, useStore } from '../store'
import type { PageMeta } from '../types'
import { PageIcon, TypeIcon, useTypes } from './TypeIcon'

function TagItem({ node, depth }: { node: TagNode; depth: number }) {
  const [open, setOpen] = useState(false)
  const navigate = useStore((s) => s.navigate)
  return (
    <>
      <div className="side-item" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => navigate({ type: 'tag', tag: node.full })}>
        {node.children.length ? (
          <span onClick={(e) => { e.stopPropagation(); setOpen(!open) }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        ) : <Hash size={13} className="muted" />}
        <span className="grow ellipsis">{node.name}</span>
        <span className="muted" style={{ fontSize: 12 }}>{node.count}</span>
      </div>
      {open && node.children.map((c) => <TagItem key={c.full} node={c} depth={depth + 1} />)}
    </>
  )
}

export function Sidebar() {
  const { data, tabs, activeTab, user } = useStore()
  const navigate = useStore((s) => s.navigate)
  const readOnly = user?.role === 'viewer'
  const types = useTypes()
  const [open, setOpen] = useState<Record<string, boolean>>(() => JSON.parse(localStorage.getItem('folders-open') ?? '{}'))
  const [dropFolder, setDropFolder] = useState<string | null | undefined>(undefined)
  const [menu, setMenu] = useState<{ x: number; y: number; folderId: string } | null>(null)
  const [typeMenu, setTypeMenu] = useState<{ x: number; y: number; folderId: string | null } | null>(null)
  const tab = tabs.find((t) => t.id === activeTab) ?? tabs[0]
  const view = currentView(tab)
  const activeId = view.type === 'page' ? view.id : null
  const unprocessed = data.zettels.filter((z) => !z.processedAt).length
  const openTodos = data.pages.reduce((n, p) => n + (p.todos ?? 0), 0)

  const tagTree = useMemo(() => buildTagTree(data.pages), [data.pages])
  const byFolder = useMemo(() => {
    const m = new Map<string | null, PageMeta[]>()
    for (const p of data.pages) {
      const k = p.folderId && data.folders.some((f) => f.id === p.folderId) ? p.folderId : null
      ;(m.get(k) ?? m.set(k, []).get(k)!).push(p)
    }
    for (const list of m.values()) list.sort((a, b) => (a.title || 'zzz').localeCompare(b.title || 'zzz'))
    return m
  }, [data.pages, data.folders])

  const toggle = (id: string) => {
    const next = { ...open, [id]: !open[id] }
    setOpen(next)
    localStorage.setItem('folders-open', JSON.stringify(next))
  }

  const movePage = async (pageId: string, folderId: string | null) => {
    const cur = useStore.getState().data.pages.find((p) => p.id === pageId)
    if (!cur || (cur.folderId ?? null) === folderId) return
    useStore.getState().patchPageMeta(pageId, { folderId })
    try { await api.patchPage(pageId, { folderId }) } catch (e: any) { alertDialog(e.message ?? 'Could not move the page'); await useStore.getState().refresh() }
  }
  const moveFolder = async (folderId: string, parentId: string | null) => {
    const cur = useStore.getState().data.folders.find((f) => f.id === folderId)
    if (!cur || (cur.parentId ?? null) === parentId || folderId === parentId) return
    try { await api.patchFolder(folderId, { parentId }) } catch (e: any) { alertDialog(e.message ?? 'Could not move the folder') }
    await useStore.getState().refresh()
  }

  // What is being dragged is remembered here: dataTransfer contents are unreadable during dragover.
  const dragging = useRef<{ kind: 'page' | 'folder'; id: string } | null>(null)
  const startDrag = (kind: 'page' | 'folder', id: string) => (e: React.DragEvent) => {
    e.stopPropagation()
    dragging.current = { kind, id }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(kind, id)
    e.dataTransfer.setData('text/plain', id)
  }
  const endDrag = () => { dragging.current = null; setDropFolder(undefined) }
  // Rows and the top-level list are drop targets for "a folder id, or null for the top level". Handlers stop
  // propagation so a drop on a folder is not also handled by the surrounding top-level zone, which used to undo the move.
  const dragProps = (folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (readOnly || !dragging.current) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      if (dropFolder !== folderId) setDropFolder(folderId)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setDropFolder((cur) => (cur === folderId ? undefined : cur))
    },
    onDrop: (e: React.DragEvent) => {
      const d = dragging.current
      if (!d || readOnly) return
      e.preventDefault()
      e.stopPropagation()
      endDrag()
      if (d.kind === 'page') movePage(d.id, folderId)
      else moveFolder(d.id, folderId)
    },
  })

  const renderFolder = (parent: string | null, depth: number): React.ReactNode =>
    data.folders.filter((f) => f.parentId === parent).map((f) => {
      const isOpen = open[f.id]
      return (
        <div key={f.id}>
          <div
            className={`side-item ${dropFolder === f.id ? 'drop' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            draggable={!readOnly}
            onDragStart={startDrag('folder', f.id)}
            onDragEnd={endDrag}
            onClick={() => toggle(f.id)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, folderId: f.id }) }}
            {...dragProps(f.id)}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="grow ellipsis">{f.name}</span>
            {!readOnly && (
              <span className="actions">
                <button className="icon-btn" style={{ width: 22, height: 22 }} title="New page here" onClick={(e) => { e.stopPropagation(); setOpen({ ...open, [f.id]: true }); useStore.getState().createPage({ folderId: f.id }) }}><FilePlus2 size={14} /></button>
              </span>
            )}
          </div>
          {isOpen && (
            <>
              {renderFolder(f.id, depth + 1)}
              {(byFolder.get(f.id) ?? []).map((p) => pageRow(p, depth + 1))}
            </>
          )}
        </div>
      )
    })

  const pageRow = (p: PageMeta, depth: number) => (
    <div
      key={p.id}
      className={`side-item ${activeId === p.id ? 'active' : ''}`}
      style={{ paddingLeft: 22 + depth * 14 }}
      data-page-id={p.id}
      draggable={!readOnly}
      onDragStart={startDrag('page', p.id)}
      onDragEnd={endDrag}
      {...dragProps(p.folderId && data.folders.some((f) => f.id === p.folderId) ? p.folderId : null)}
      onClick={() => navigate({ type: 'page', id: p.id })}
      onAuxClick={(e) => { if (e.button === 1) navigate({ type: 'page', id: p.id }, { newTab: true }) }}
    >
      <PageIcon page={p} />
      <span className="grow ellipsis">{p.title || 'Untitled'}</span>
    </div>
  )

  const newFolder = async (parentId: string | null) => {
    const name = await askText('New folder', { label: 'Folder name', okLabel: 'Create' })
    if (name?.trim()) await useStore.getState().addFolder(name.trim(), parentId)
  }

  return (
    <>
      <div className="sidebar-head head">
        <button className="btn row" style={{ justifyContent: 'flex-start', color: 'var(--muted)' }} onClick={() => useStore.getState().setUi({ searchOpen: true, searchInitial: '' })}>
          <Search size={15} /> <span className="grow" style={{ textAlign: 'left' }}>Search</span> <kbd>Ctrl K</kbd>
        </button>
        {!readOnly && (
          <div className="row">
            <button className="btn primary grow row" style={{ justifyContent: 'center' }} onClick={() => useStore.getState().createPage()}><FilePlus2 size={15} /> New page</button>
            <button className="btn" title="New special page (person, monster, location…)" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTypeMenu({ x: r.left, y: r.bottom + 4, folderId: null }) }}><Shapes size={15} /></button>
            <button className="btn" title="New folder" onClick={() => newFolder(null)}><FolderPlus size={15} /></button>
            <button className="btn" title="Quick capture (Alt+C)" onClick={() => useStore.getState().setUi({ captureOpen: true })}><Zap size={15} /></button>
          </div>
        )}
      </div>
      <div className="scroll">
        <div className="side-item" onClick={() => navigate({ type: 'zettels' })}>
          <Inbox size={15} /> <span className="grow">Zettelkasten</span>
          {unprocessed > 0 && <span className="chip">{unprocessed}</span>}
        </div>
        <div className="side-item" onClick={() => navigate({ type: 'graph' })}><Network size={15} /> <span className="grow">Graph</span></div>
        <div className="side-item" onClick={() => navigate({ type: 'maps' })}><MapIcon size={15} /> <span className="grow">Maps</span></div>
        <div className="side-item" onClick={() => navigate({ type: 'timeline' })}><CalendarDays size={15} /> <span className="grow">Timeline</span></div>
        <div className="side-item" onClick={() => navigate({ type: 'relations' })}><Users size={15} /> <span className="grow">Relations</span></div>
        <div className="side-item" onClick={() => navigate({ type: 'sessions' })}><BookOpen size={15} /> <span className="grow">Sessions</span></div>
        <div className="side-item" onClick={() => navigate({ type: 'todos' })}>
          <ListTodo size={15} /> <span className="grow">Todos</span>
          {openTodos > 0 && <span className="chip">{openTodos}</span>}
        </div>
        <div className="side-item" onClick={() => navigate({ type: 'templates' })}><LayoutTemplate size={15} /> <span className="grow">Templates</span></div>
        <div className="side-item" onClick={() => navigate({ type: 'pagetypes' })}><Shapes size={15} /> <span className="grow">Special pages</span></div>
        <div className="side-item" onClick={() => navigate({ type: 'stattemplates' })}><ScrollText size={15} /> <span className="grow">Stat block forms</span></div>

        <div className="side-label">Pages</div>
        <div {...dragProps(null)} className={dropFolder === null ? 'side-item drop' : ''} style={{ display: 'block', padding: 0, minHeight: 40 }}>
          {renderFolder(null, 0)}
          {(byFolder.get(null) ?? []).map((p) => pageRow(p, -0.5))}
          {!data.pages.length && <div className="muted" style={{ padding: '6px 10px', fontSize: 13 }}>No pages yet.</div>}
        </div>

        {tagTree.length > 0 && (
          <>
            <div className="side-label">Tags</div>
            {tagTree.map((n) => <TagItem key={n.full} node={n} depth={0} />)}
          </>
        )}
      </div>
      <div className="foot">
        <button className="icon-btn" title="Trash" onClick={() => navigate({ type: 'trash' })}><Trash2 size={16} /></button>
        <button className="icon-btn" title="Settings" onClick={() => navigate({ type: 'settings' })}><Settings size={16} /></button>
      </div>
      {typeMenu && (
        <div className="overlay" style={{ background: 'transparent', padding: 0 }} onMouseDown={() => setTypeMenu(null)}>
          <div className="menu" style={{ left: typeMenu.x, top: typeMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
            {types.map((t) => (
              <button key={t.id} onClick={() => { const folderId = typeMenu.folderId; setTypeMenu(null); useStore.getState().createPage({ type: t.id, folderId }) }}>
                <TypeIcon name={t.icon} size={15} /> {t.name}
              </button>
            ))}
            <button onClick={() => { setTypeMenu(null); navigate({ type: 'pagetypes' }) }} style={{ color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>Manage types…</button>
          </div>
        </div>
      )}
      {menu && (
        <div className="overlay" style={{ background: 'transparent', padding: 0 }} onMouseDown={() => setMenu(null)}>
          <div className="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
            {!readOnly && <>
              <button onClick={() => { const id = menu.folderId; setTypeMenu({ x: menu.x, y: menu.y, folderId: id }); setMenu(null) }}>New special page here…</button>
              <button onClick={() => { newFolder(menu.folderId); setMenu(null) }}>New subfolder</button>
              <button onClick={() => {
                const inside = new Set([menu.folderId])
                for (let grew = true; grew;) { grew = false; for (const f of data.folders) if (f.parentId && inside.has(f.parentId) && !inside.has(f.id)) { inside.add(f.id); grew = true } }
                const ids = data.pages.filter((p) => p.folderId && inside.has(p.folderId)).map((p) => p.id)
                setMenu(null)
                if (ids.length) useStore.getState().setUi({ copyPages: ids }); else alertDialog('This folder has no pages.')
              }}>Copy folder to another world…</button>
              <button onClick={async () => {
                const id = menu.folderId
                setMenu(null)
                const n = await askText('Rename folder', { label: 'Folder name', initial: data.folders.find((f) => f.id === id)?.name ?? '', okLabel: 'Rename' })
                if (n?.trim()) { await api.patchFolder(id, { name: n.trim() }); await useStore.getState().refresh() }
              }}>Rename</button>
              <button onClick={async () => {
                const id = menu.folderId
                setMenu(null)
                if (await confirmDialog('Its pages and subfolders move up one level.', { title: 'Delete folder?', okLabel: 'Delete', danger: true })) { await api.deleteFolder(id); await useStore.getState().refresh() }
              }}>Delete</button>
            </>}
          </div>
        </div>
      )}
    </>
  )
}
