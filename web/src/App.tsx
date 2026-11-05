import { ArrowLeft, ArrowRight, Menu, Plus, SplitSquareHorizontal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CaptureDialog } from './components/Capture'
import { CopyDialog } from './components/CopyDialog'
import { GraphView } from './components/Graph'
import { HoverPreview } from './components/HoverPreview'
import { MapView } from './components/MapView'
import { MapsView, TimelineView } from './components/MapsViews'
import { RelationsView } from './components/Relations'
import { SessionsView } from './components/Sessions'
import { TemplateEditor, TemplatesView } from './components/Templates'
import { DialogHost } from './components/DialogHost'
import { PageTypeEditor, PageTypesView } from './components/PageTypes'
import { StatTemplateEditor, StatTemplatesView } from './components/StatTemplates'
import { resolveTemplates } from './editor/templates'
import { TodosView } from './components/Todos'
import { useWorld } from './lib/world'
import { PageView } from './components/PageView'
import { SearchDialog } from './components/Search'
import { Sidebar } from './components/Sidebar'
import { HomeView, SettingsView, TagView, TrashView, ZettelView } from './components/Views'
import { SuggestPopup } from './editor/SuggestPopup'
import { eventToCombo, matchAction } from './lib/keys'
import { currentView, useStore, type Tab, type View } from './store'

function Login() {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="login">
      <form onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true); setErr('')
        try { await useStore.getState().login(u, p) } catch (x: any) { setErr(x.message) } finally { setBusy(false) }
      }}>
        <h1>Chronicle</h1>
        <input className="input" placeholder="Username" autoFocus autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} />
        <input className="input" type="password" placeholder="Password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} />
        {err && <div className="error">{err}</div>}
        <button className="btn primary" disabled={busy || !u || !p}>Sign in</button>
      </form>
    </div>
  )
}

function viewTitle(v: View, pages: { id: string; title: string }[]) {
  switch (v.type) {
    case 'page': return pages.find((p) => p.id === v.id)?.title || 'Untitled'
    case 'home': return 'Home'
    case 'graph': return 'Graph'
    case 'zettels': return 'Zettelkasten'
    case 'tag': return `#${v.tag}`
    case 'trash': return 'Trash'
    case 'settings': return 'Settings'
    case 'maps': return 'Maps'
    case 'timeline': return 'Timeline'
    case 'relations': return 'Relations'
    case 'sessions': return 'Sessions'
    case 'todos': return 'Todos'
    case 'templates': return 'Templates'
    case 'template': return useStore.getState().data.templates?.find((t) => t.id === v.id)?.name ?? 'Template'
    case 'pagetypes': return 'Special pages'
    case 'pagetype': return useStore.getState().data.pageTypes?.find((t) => t.id === v.id)?.name ?? ['Person', 'Monster', 'Location'].find((n) => n.toLowerCase() === v.id) ?? 'Page type'
    case 'stattemplates': return 'Stat block forms'
    case 'stattemplate': return resolveTemplates(useStore.getState().data.statTemplates).find((t) => t.id === v.id)?.name ?? 'Stat block form'
    case 'map': return useWorld.getState().maps.find((m) => m.id === v.id)?.name ?? 'Map'
  }
}

function ViewRouter({ view }: { view: View }) {
  switch (view.type) {
    case 'home': return <HomeView />
    case 'page': return <PageView id={view.id} anchor={view.anchor} />
    case 'graph': return <GraphView />
    case 'zettels': return <ZettelView />
    case 'tag': return <TagView tag={view.tag} />
    case 'trash': return <TrashView />
    case 'settings': return <SettingsView />
    case 'maps': return <MapsView />
    case 'timeline': return <TimelineView />
    case 'relations': return <RelationsView />
    case 'sessions': return <SessionsView />
    case 'todos': return <TodosView />
    case 'templates': return <TemplatesView />
    case 'template': return <TemplateEditor id={view.id} />
    case 'pagetypes': return <PageTypesView />
    case 'pagetype': return <PageTypeEditor id={view.id} />
    case 'stattemplates': return <StatTemplatesView />
    case 'stattemplate': return <StatTemplateEditor id={view.id} />
    case 'map': return <MapRoute id={view.id} item={view.item} place={view.place} />
  }
}

function MapRoute({ id, item, place }: { id: string; item?: string; place?: string }) {
  const wsId = useStore((s) => s.wsId)
  const loadedFor = useWorld((s) => s.wsId)
  useEffect(() => { if (wsId) useWorld.getState().load(wsId).catch(() => {}) }, [wsId])
  if (loadedFor !== wsId) return <div className="view muted">Loading…</div>
  return <MapView id={id} itemId={item} place={place} />
}

function Pane({ tab, active }: { tab: Tab; active: boolean }) {
  const view = currentView(tab)
  return (
    <div className={`pane ${active ? '' : 'inactive'}`} onMouseDownCapture={() => !active && useStore.getState().setActiveTab(tab.id)}>
      <ViewRouter key={tab.id + (view.type === 'page' || view.type === 'map' || view.type === 'pagetype' || view.type === 'stattemplate' ? view.id : view.type)} view={view} />
    </div>
  )
}

function Shell() {
  const { tabs, activeTab, splitTab, sidebarOpen, zen, data, offline, user } = useStore()
  useWorld((s) => s.maps)
  const current = tabs.find((t) => t.id === activeTab) ?? tabs[0]
  const split = tabs.find((t) => t.id === splitTab)
  const canBack = current.index > 0
  const canFwd = current.index < current.history.length - 1
  const mobile = window.matchMedia('(max-width: 900px)').matches

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useStore.getState().zen && !useStore.getState().searchOpen) { useStore.getState().setUi({ zen: false }); return }
      const combo = eventToCombo(e)
      if (!combo) return
      const st = useStore.getState()
      const action = matchAction(combo, st.bindings)
      if (!action) return
      const readOnly = st.user?.role === 'viewer'
      e.preventDefault()
      switch (action) {
        case 'search': st.setUi({ searchOpen: !st.searchOpen, searchInitial: '' }); break
        case 'newPage': if (!readOnly) st.createPage(); break
        case 'capture': if (!readOnly) st.setUi({ captureOpen: true }); break
        case 'zen': st.setUi({ zen: !st.zen }); break
        case 'back': st.back(); break
        case 'forward': st.forward(); break
        case 'closeTab': st.closeTab(st.activeTab); break
        case 'toggleSidebar': st.setUi({ sidebarOpen: !st.sidebarOpen }); break
        case 'graph': st.navigate({ type: 'graph' }); break
        case 'zettels': st.navigate({ type: 'zettels' }); break
        case 'todos': st.navigate({ type: 'todos' }); break
      }
    }
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) { e.preventDefault(); useStore.getState().back() }
      if (e.button === 4) { e.preventDefault(); useStore.getState().forward() }
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mouseup', onMouse)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('mouseup', onMouse) }
  }, [])

  useEffect(() => {
    document.title = `${viewTitle(currentView(current), data.pages)} · Chronicle`
  }, [current, data.pages])

  useEffect(() => {
    const p = new URLSearchParams(location.search)
    if (location.pathname === '/share') {
      const text = [p.get('title'), p.get('text'), p.get('url')].filter(Boolean).join('\n')
      history.replaceState(null, '', '/')
      if (text && user?.role !== 'viewer') useStore.getState().addZettel(text, ['shared'])
    }
  }, [user])

  useEffect(() => {
    const onFocus = () => useStore.getState().refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus) }
  }, [])

  const show = sidebarOpen && !zen
  return (
    <div className="shell">
      {show && mobile && <div className="scrim" onClick={() => useStore.getState().setUi({ sidebarOpen: false })} />}
      {!zen && (
        <aside className={`sidebar ${show ? 'open' : ''}`} style={!mobile && !show ? { display: 'none' } : undefined}
          onClick={(e) => { if (mobile && (e.target as HTMLElement).closest('.side-item:not(.actions *)')) useStore.getState().setUi({ sidebarOpen: false }) }}>
          <Sidebar />
        </aside>
      )}
      <main className="main">
        {offline && <div className="offline">Offline. Showing cached data; edits to open pages will sync when you reconnect.</div>}
        {!zen && (
          <div className="tabbar">
            <button className="icon-btn" onClick={() => useStore.getState().setUi({ sidebarOpen: !sidebarOpen })}><Menu size={17} /></button>
            <button className="icon-btn" disabled={!canBack} title="Back (Ctrl+Alt+←)" onClick={() => useStore.getState().back()}><ArrowLeft size={16} /></button>
            <button className="icon-btn" disabled={!canFwd} title="Forward (Ctrl+Alt+→)" onClick={() => useStore.getState().forward()}><ArrowRight size={16} /></button>
            {tabs.map((t) => (
              <div key={t.id} className={`tab ${t.id === current.id ? 'active' : ''}`} onClick={() => useStore.getState().setActiveTab(t.id)}
                onAuxClick={(e) => { if (e.button === 1) useStore.getState().closeTab(t.id) }}>
                <span className="grow ellipsis">{viewTitle(currentView(t), data.pages)}{t.id === splitTab ? ' ◧' : ''}</span>
                <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={(e) => { e.stopPropagation(); useStore.getState().closeTab(t.id) }}><X size={13} /></button>
              </div>
            ))}
            <button className="icon-btn" title="New tab" onClick={() => useStore.getState().navigate({ type: 'home' }, { newTab: true })}><Plus size={16} /></button>
            {!mobile && tabs.length > 1 && (
              <button className="icon-btn" title={split ? 'Close split' : 'Show active tab beside another'} style={{ marginLeft: 'auto' }}
                onClick={() => {
                  if (split) return useStore.getState().setSplit(null)
                  const other = tabs.find((t) => t.id !== current.id)
                  if (other) useStore.getState().setSplit(other.id)
                }}>
                <SplitSquareHorizontal size={16} />
              </button>
            )}
          </div>
        )}
        <div className="panes">
          <Pane tab={current} active />
          {split && !mobile && split.id !== current.id && !zen && <Pane tab={split} active={false} />}
        </div>
      </main>
      <SearchDialog />
      <CaptureDialog />
      <CopyDialog />
      <SuggestPopup />
      <HoverPreview />
    </div>
  )
}

export function App() {
  const { user, authChecked } = useStore()
  useEffect(() => { useStore.getState().init() }, [])
  useEffect(() => { if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {}) }, [])
  if (!authChecked) return null
  if (!user) return <><Login /><DialogHost /></>
  return <><Shell /><DialogHost /></>
}
