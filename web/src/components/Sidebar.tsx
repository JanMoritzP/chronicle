import { useUnreadComments } from './Comments'
import {
  BookOpen, CalendarDays, Check, ChevronDown, ChevronRight, ChevronsUpDown, CircleHelp, FilePlus2, FolderPlus, Hash, Home, Inbox, LayoutTemplate, Library, ListTodo, Map as MapIcon, MessageSquare, Network, Plus, ScrollText, Search, Settings, Shapes, Trash2, Users, Zap,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { alertDialog, askText, confirmDialog } from '../lib/dialog'
import { buildTagTree, type TagNode } from '../lib/data'
import { currentView, useStore, type View } from '../store'
import type { PageMeta } from '../types'
import { PageIcon, TypeIcon, useTypes } from './TypeIcon'

function TagItem({ node, depth }: { node: TagNode; depth: number }) {
  const [open, setOpen] = useState(false)
  const navigate = useStore((s) => s.navigate)
  return (
    <>
      <div className="side-item" style={{ paddingLeft: 8 + depth * 14 }} tabIndex={0} role="button" aria-label={`Tag ${node.name}`} onClick={() => navigate({ type: 'tag', tag: node.full })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate({ type: 'tag', tag: node.full }) } }}>
        {node.children.length ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open) }} aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center' }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        ) : <Hash size={13} className="muted" />}
        <span className="grow ellipsis">{node.name}</span>
        <span className="muted" style={{ fontSize: 12 }}>{node.count}</span>
      </div>
      {open && node.children.map((c) => <TagItem key={c.full} node={c} depth={depth + 1} />)}
    </>
  )
}

// Editor views belong to the list they were opened from, so the list stays highlighted.
const NAV_PARENT: Partial<Record<View['type'], View['type']>> = { template: 'templates', pagetype: 'pagetypes', stattemplate: 'stattemplates' }

function NavItem({ icon, label, to, badge = 0, badgeTitle }: { icon: React.ReactNode; label: string; to: View; badge?: number; badgeTitle?: string }) {
  const navigate = useStore((s) => s.navigate)
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeTab) ?? s.tabs[0])
  const type = currentView(tab).type
  const active = (NAV_PARENT[type] ?? type) === to.type
  return (
    <div className={`side-item nav ${active ? 'active' : ''}`} tabIndex={0} role="button" aria-label={label} aria-current={active ? 'page' : undefined}
      onClick={() => navigate(to)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(to) } }}>
      {icon} <span className="grow">{label}</span>
      {badge > 0 && <span className="chip" title={badgeTitle}>{badge}</span>}
    </div>
  )
}

export function Sidebar() {
  const { data, tabs, activeTab, user, workspaces, wsId } = useStore()
  const navigate = useStore((s) => s.navigate)
  const readOnly = user?.role === 'viewer'
  const world = workspaces.find((w) => w.id === wsId)
  const [worldMenu, setWorldMenu] = useState<{ x: number; y: number; w: number } | null>(null)
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
  const unreadComments = useUnreadComments()

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
            tabIndex={0} role="button" aria-label={f.name}
            draggable={!readOnly}
            onDragStart={startDrag('folder', f.id)}
            onDragEnd={endDrag}
            onClick={() => toggle(f.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(f.id) } }}
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
      tabIndex={0} role="button" aria-label={p.title || 'Untitled'} aria-current={activeId === p.id ? 'page' : undefined}
      style={{ paddingLeft: 22 + depth * 14 }}
      data-page-id={p.id}
      draggable={!readOnly}
      onDragStart={startDrag('page', p.id)}
      onDragEnd={endDrag}
      {...dragProps(p.folderId && data.folders.some((f) => f.id === p.folderId) ? p.folderId : null)}
      onClick={() => navigate({ type: 'page', id: p.id })}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate({ type: 'page', id: p.id }) } }}
      onAuxClick={(e) => { if (e.button === 1) navigate({ type: 'page', id: p.id }, { newTab: true }) }}
    >
      <PageIcon page={p} />
      <span className="grow ellipsis">{p.title || 'Untitled'}</span>
    </div>
  )

  const newFolder = async (parentId: string | null) => {
    const name = await askText('New folder', { label: 'Folder name', okLabel: 'Create' })
    if (name?.trim()) await useStore.getState().addFolder(name.trim(), parentId).catch((e) => alertDialog(e.message))
  }

  return (
    <>
      <div className="sidebar-head head">
        <button className="world-head" aria-label={`World: ${world?.name ?? 'none'}. Switch world`} aria-haspopup="menu"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setWorldMenu({ x: r.left, y: r.bottom + 4, w: r.width }) }}>
          <span className="world-mark" aria-hidden="true">{(world?.name ?? 'C').trim().charAt(0).toUpperCase()}</span>
          <span className="grow ellipsis world-name">{world?.name ?? 'Chronicle'}</span>
          <ChevronsUpDown size={14} className="muted" />
        </button>
        <button className="search-trigger" onClick={() => useStore.getState().setUi({ searchOpen: true, searchInitial: '' })}>
          <Search size={15} /> <span className="grow">Search</span> <kbd className="kbd">Ctrl K</kbd>
        </button>
        {!readOnly && (
          <div className="side-actions">
            <button className="btn primary new-page" onClick={() => useStore.getState().createPage()}><FilePlus2 size={15} /> New page</button>
            <button className="btn square" title="New special page (person, monster, location…)" aria-label="New special page" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTypeMenu({ x: r.left, y: r.bottom + 4, folderId: null }) }}><Shapes size={15} /></button>
            <button className="btn square" title="New folder" aria-label="New folder" onClick={() => newFolder(null)}><FolderPlus size={15} /></button>
            <button className="btn square" title="Quick capture (Alt+C)" aria-label="Quick capture" onClick={() => useStore.getState().setUi({ captureOpen: true })}><Zap size={15} /></button>
          </div>
        )}
      </div>
      <div className="scroll">
        <nav className="nav-group" aria-label="Play">
          <NavItem icon={<Inbox size={15} />} label="Zettelkasten" badge={unprocessed} to={{ type: 'zettels' }} />
          <NavItem icon={<BookOpen size={15} />} label="Sessions" to={{ type: 'sessions' }} />
          <NavItem icon={<ListTodo size={15} />} label="Todos" badge={openTodos} to={{ type: 'todos' }} />
          <NavItem icon={<MessageSquare size={15} />} label="Comments" badge={unreadComments} badgeTitle="Open comments for you" to={{ type: 'comments' }} />
        </nav>
        <nav className="nav-group" aria-label="World">
          <NavItem icon={<Network size={15} />} label="Graph" to={{ type: 'graph' }} />
          <NavItem icon={<MapIcon size={15} />} label="Maps" to={{ type: 'maps' }} />
          <NavItem icon={<CalendarDays size={15} />} label="Timeline" to={{ type: 'timeline' }} />
          <NavItem icon={<Users size={15} />} label="Relations" to={{ type: 'relations' }} />
        </nav>
        <nav className="nav-group" aria-label="Toolkit">
          <NavItem icon={<Library size={15} />} label="Library" to={{ type: 'library' }} />
          <NavItem icon={<LayoutTemplate size={15} />} label="Templates" to={{ type: 'templates' }} />
          <NavItem icon={<Shapes size={15} />} label="Special pages" to={{ type: 'pagetypes' }} />
          <NavItem icon={<ScrollText size={15} />} label="Stat block forms" to={{ type: 'stattemplates' }} />
        </nav>

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
        <button className="icon-btn" title="Trash" aria-label="Trash" onClick={() => navigate({ type: 'trash' })}><Trash2 size={16} /></button>
        <button className="icon-btn" title="Manual" aria-label="Manual" onClick={() => navigate({ type: 'manual' })}><CircleHelp size={16} /></button>
        <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => navigate({ type: 'settings' })}><Settings size={16} /></button>
      </div>
      {worldMenu && (
        <div className="overlay" style={{ background: 'transparent', padding: 0 }} onMouseDown={() => setWorldMenu(null)}>
          <div className="menu world-menu" role="menu" style={{ left: worldMenu.x, top: worldMenu.y, minWidth: worldMenu.w }} onMouseDown={(e) => e.stopPropagation()}>
            {workspaces.map((w) => (
              <button key={w.id} role="menuitemradio" aria-checked={w.id === wsId} onClick={() => { setWorldMenu(null); if (w.id !== wsId) useStore.getState().selectWorkspace(w.id) }}>
                <span className="grow ellipsis">{w.name}</span>{w.id === wsId && <Check size={14} />}
              </button>
            ))}
            <div className="menu-sep" />
            <button role="menuitem" onClick={() => { setWorldMenu(null); navigate({ type: 'home' }) }}><Home size={14} /> Home</button>
            {!readOnly && (
              <button role="menuitem" onClick={async () => {
                setWorldMenu(null)
                const n = await askText('New world', { label: 'World name', okLabel: 'Create' })
                if (n?.trim()) useStore.getState().createWorkspace(n.trim()).catch((e) => alertDialog(e.message))
              }}><Plus size={14} /> New world</button>
            )}
          </div>
        </div>
      )}
      {typeMenu && (
        <div className="overlay" style={{ background: 'transparent', padding: 0 }} onMouseDown={() => setTypeMenu(null)}>
          <div className="menu" style={{ left: typeMenu.x, top: typeMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
            {types.map((t) => (
              <button key={t.id} onClick={() => { const folderId = typeMenu.folderId; setTypeMenu(null); useStore.getState().createPage({ type: t.id, folderId }).catch((e) => alertDialog(e.message)) }}>
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
