import { create } from 'zustand'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { api, ApiError } from './api'
import { resolveTypes } from './lib/pageTypes'
import type { Bootstrap, Folder, LinkRow, PageMeta, PageType, StatTemplateRow, Template, User, Workspace, Zettel } from './types'
import { findPageByName } from './lib/data'
import { loadBindings, saveBindings, type Action } from './lib/keys'

export type View =
  | { type: 'home' }
  | { type: 'page'; id: string; anchor?: string }
  | { type: 'graph' }
  | { type: 'zettels' }
  | { type: 'tag'; tag: string }
  | { type: 'trash' }
  | { type: 'maps' }
  | { type: 'map'; id: string; item?: string; place?: string }
  | { type: 'timeline' }
  | { type: 'relations' }
  | { type: 'sessions' }
  | { type: 'todos' }
  | { type: 'templates' }
  | { type: 'template'; id: string }
  | { type: 'pagetypes' }
  | { type: 'pagetype'; id: string }
  | { type: 'stattemplates' }
  | { type: 'stattemplate'; id: string }
  | { type: 'settings' }

export interface Tab { id: string; history: View[]; index: number }

const tid = () => Math.random().toString(36).slice(2, 9)
const viewKey = (v: View) => JSON.stringify(v)

interface State {
  user: User | null
  authChecked: boolean
  workspaces: Workspace[]
  wsId: string | null
  data: Bootstrap
  loaded: boolean
  offline: boolean

  tabs: Tab[]
  activeTab: string
  splitTab: string | null

  sidebarOpen: boolean
  zen: boolean
  searchOpen: boolean
  searchInitial: string
  captureOpen: boolean
  copyPages: string[] | null
  bindings: Record<Action, string[]>

  init: () => Promise<void>
  login: (u: string, p: string) => Promise<void>
  logout: () => Promise<void>
  selectWorkspace: (id: string) => Promise<void>
  createWorkspace: (name: string) => Promise<void>
  refresh: () => Promise<void>

  navigate: (v: View, opts?: { newTab?: boolean; split?: boolean }) => void
  back: () => void
  forward: () => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  setSplit: (id: string | null) => void

  patchPageMeta: (id: string, patch: Partial<PageMeta>) => void
  setLinksFor: (sourceId: string, links: LinkRow[]) => void
  createPage: (opts?: { title?: string; folderId?: string | null; content?: any; props?: any; tags?: string[]; type?: string; sourceZettelId?: string; open?: boolean }) => Promise<PageMeta>
  createPageFromName: (name: string) => Promise<PageMeta>
  deletePage: (id: string) => Promise<void>
  addFolder: (name: string, parentId: string | null) => Promise<void>
  upsertFolder: (f: Folder) => void
  addZettel: (body: string, tags: string[]) => Promise<void>
  updateZettelLocal: (id: string, patch: Partial<Zettel>) => void
  removeZettelLocal: (id: string) => void
  upsertTemplate: (t: Template) => void
  removeTemplateLocal: (id: string) => void
  upsertPageType: (t: PageType) => void
  removePageTypeLocal: (id: string) => void
  upsertStatTemplate: (t: StatTemplateRow) => void
  removeStatTemplateLocal: (id: string) => void

  setUi: (p: Partial<Pick<State, 'sidebarOpen' | 'zen' | 'searchOpen' | 'searchInitial' | 'captureOpen' | 'copyPages'>>) => void
  setBindings: (b: Record<Action, string[]>) => void
}

const emptyData: Bootstrap = { pages: [], folders: [], links: [], zettels: [], templates: [], pageTypes: [], statTemplates: [] }
const initialTab = (): Tab => ({ id: tid(), history: [{ type: 'home' }], index: 0 })
const firstTab = initialTab()
const resolveActive = (s: Pick<State, 'tabs' | 'activeTab'>) => s.tabs.find((t) => t.id === s.activeTab) ?? s.tabs[0]

export const useStore = create<State>((set, get) => ({
  user: null, authChecked: false, workspaces: [], wsId: null, data: emptyData, loaded: false, offline: false,
  tabs: [firstTab], activeTab: firstTab.id, splitTab: null,
  sidebarOpen: window.innerWidth > 900, zen: false, searchOpen: false, searchInitial: '', captureOpen: false, copyPages: null,
  bindings: loadBindings(),

  async init() {
    try {
      const user = await api.me()
      set({ user, authChecked: true })
      const workspaces = await api.workspaces()
      set({ workspaces })
      if (workspaces.length) {
        const last = localStorage.getItem('workspace')
        await get().selectWorkspace(workspaces.find((w) => w.id === last)?.id ?? workspaces[0].id)
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // offline start: reuse the last known session + data
        const cached = await idbGet<{ user: User; workspaces: Workspace[] }>('session')
        if (cached) {
          set({ user: cached.user, workspaces: cached.workspaces, authChecked: true, offline: true })
          const last = localStorage.getItem('workspace')
          if (last) await get().selectWorkspace(last)
          return
        }
      }
      set({ authChecked: true })
    }
  },

  async login(username, password) {
    const user = await api.login(username, password)
    set({ user })
    await get().init()
  },

  async logout() {
    await api.logout().catch(() => {})
    await idbSet('session', null)
    set({ user: null, wsId: null, data: emptyData, loaded: false, workspaces: [] })
  },

  async selectWorkspace(id) {
    localStorage.setItem('workspace', id)
    const cacheKey = `bootstrap:${id}`
    const cached = await idbGet<Bootstrap>(cacheKey)
    const saved = (() => { try { return JSON.parse(localStorage.getItem(`tabs:${id}`) ?? 'null') } catch { return null } })()
    const tabs: Tab[] = saved?.tabs?.length ? saved.tabs : [initialTab()]
    set({
      wsId: id, tabs, activeTab: saved?.active && tabs.some((t) => t.id === saved.active) ? saved.active : tabs[0].id,
      splitTab: null, data: cached ?? emptyData, loaded: !!cached,
    })
    try {
      const data = await api.bootstrap(id)
      set({ data, loaded: true, offline: false })
      idbSet(cacheKey, data).catch(() => {})
      const { user, workspaces } = get()
      idbSet('session', { user, workspaces }).catch(() => {})
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) set({ offline: true })
      else throw e
    }
  },

  async createWorkspace(name) {
    const ws = await api.createWorkspace(name)
    set((s) => ({ workspaces: [...s.workspaces, ws] }))
    await get().selectWorkspace(ws.id)
  },

  async refresh() {
    const id = get().wsId
    if (!id) return
    try {
      const data = await api.bootstrap(id)
      set({ data, offline: false })
      idbSet(`bootstrap:${id}`, data).catch(() => {})
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) set({ offline: true })
    }
  },

  navigate(v, opts = {}) {
    set((s) => {
      const active = resolveActive(s).id
      if (opts.newTab || opts.split) {
        const t: Tab = { id: tid(), history: [v], index: 0 }
        return { tabs: [...s.tabs, t], activeTab: t.id, splitTab: opts.split ? t.id : s.splitTab }
      }
      const target = s.tabs.find((t) => t.id === active) ?? s.tabs[0]
      const cur = target.history[target.index]
      if (cur && viewKey(cur) === viewKey(v)) return {}
      const history = [...target.history.slice(0, target.index + 1), v].slice(-100)
      return { tabs: s.tabs.map((t) => (t.id === target.id ? { ...t, history, index: history.length - 1 } : t)), activeTab: target.id }
    })
  },

  back() {
    set((s) => { const a = resolveActive(s).id; return { activeTab: a, tabs: s.tabs.map((t) => (t.id === a && t.index > 0 ? { ...t, index: t.index - 1 } : t)) } })
  },
  forward() {
    set((s) => { const a = resolveActive(s).id; return { activeTab: a, tabs: s.tabs.map((t) => (t.id === a && t.index < t.history.length - 1 ? { ...t, index: t.index + 1 } : t)) } })
  },
  closeTab(id) {
    set((s) => {
      if (s.tabs.length === 1) { const t = initialTab(); return { tabs: [t], activeTab: t.id, splitTab: null } }
      const i = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeTab = s.activeTab === id ? tabs[Math.max(0, i - 1)].id : s.activeTab
      return { tabs, activeTab, splitTab: s.splitTab === id ? null : s.splitTab }
    })
  },
  setActiveTab: (id) => set({ activeTab: id }),
  setSplit: (id) => set({ splitTab: id }),

  patchPageMeta(id, patch) {
    set((s) => ({ data: { ...s.data, pages: s.data.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) } }))
  },
  setLinksFor(sourceId, links) {
    set((s) => ({ data: { ...s.data, links: [...s.data.links.filter((l) => l.sourceId !== sourceId), ...links] } }))
  },

  async createPage(opts = {}) {
    const ws = get().wsId!
    const type = opts.type ? resolveTypes(get().data.pageTypes).find((t) => t.id === opts.type) : undefined
    const tags = [...new Set([...(opts.tags ?? []), ...(type?.tag ? [type.tag] : [])])]
    const created = await api.createPage(ws, {
      title: opts.title ?? '', folderId: opts.folderId ?? null, content: opts.content,
      props: type ? { ...opts.props, type: type.id } : opts.props,
      tags: tags.length ? tags : undefined, sourceZettelId: opts.sourceZettelId,
    })
    const meta: PageMeta = {
      id: created.id, folderId: created.folderId, title: created.title, icon: created.icon, aliases: created.aliases ?? [],
      tags: created.tags ?? [], outline: [], text: '', hasStats: false, portrait: null, type: type?.id ?? null,
      wordCount: 0, createdAt: created.createdAt, updatedAt: created.updatedAt,
    }
    await get().refresh()
    if (opts.open !== false) get().navigate({ type: 'page', id: meta.id })
    return meta
  },

  async createPageFromName(name) {
    const existing = findPageByName(get().data.pages, name)
    if (existing) return existing
    return get().createPage({ title: name.trim(), open: false })
  },

  async deletePage(id) {
    await api.deletePage(id)
    api.invalidate(id)
    set((s) => ({
      tabs: s.tabs.map((t) => {
        const history = t.history.filter((v) => !(v.type === 'page' && v.id === id))
        const h = history.length ? history : [{ type: 'home' } as View]
        return { ...t, history: h, index: Math.min(t.index, h.length - 1) }
      }),
    }))
    await get().refresh()
  },

  async addFolder(name, parentId) {
    const f = await api.createFolder(get().wsId!, name, parentId)
    set((s) => ({ data: { ...s.data, folders: [...s.data.folders, f] } }))
  },
  upsertFolder(f) {
    set((s) => ({ data: { ...s.data, folders: s.data.folders.some((x) => x.id === f.id) ? s.data.folders.map((x) => (x.id === f.id ? f : x)) : [...s.data.folders, f] } }))
  },

  async addZettel(body, tags) {
    const z = await api.createZettel(get().wsId!, body, tags)
    set((s) => ({ data: { ...s.data, zettels: [z, ...s.data.zettels] } }))
  },
  updateZettelLocal(id, patch) {
    set((s) => ({ data: { ...s.data, zettels: s.data.zettels.map((z) => (z.id === id ? { ...z, ...patch } : z)) } }))
  },
  removeZettelLocal(id) {
    set((s) => ({ data: { ...s.data, zettels: s.data.zettels.filter((z) => z.id !== id) } }))
  },

  upsertTemplate(t) {
    set((s) => {
      const list = s.data.templates ?? []
      const next = list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t]
      return { data: { ...s.data, templates: next.sort((a, b) => a.name.localeCompare(b.name)) } }
    })
  },
  removeTemplateLocal(id) {
    set((s) => ({ data: { ...s.data, templates: (s.data.templates ?? []).filter((t) => t.id !== id) } }))
  },

  upsertPageType(t) {
    set((s) => {
      const list = s.data.pageTypes ?? []
      const next = list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t]
      return { data: { ...s.data, pageTypes: next.sort((a, b) => a.name.localeCompare(b.name)) } }
    })
  },
  upsertStatTemplate(t) {
    set((s) => {
      const list = s.data.statTemplates ?? []
      const next = list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t]
      return { data: { ...s.data, statTemplates: next.sort((a, b) => a.name.localeCompare(b.name)) } }
    })
  },
  removeStatTemplateLocal(id) {
    set((s) => ({ data: { ...s.data, statTemplates: (s.data.statTemplates ?? []).filter((t) => t.id !== id) } }))
  },
  removePageTypeLocal(id) {
    set((s) => ({ data: { ...s.data, pageTypes: (s.data.pageTypes ?? []).filter((t) => t.id !== id), pages: s.data.pages.map((p) => (p.type === id ? { ...p, type: null } : p)) } }))
  },

  setUi: (p) => set(p),
  setBindings(b) { saveBindings(b); set({ bindings: b }) },
}))

// Persist tab layout per workspace.
let saveTimer: number | undefined
useStore.subscribe((s, prev) => {
  if (!s.wsId || (s.tabs === prev.tabs && s.activeTab === prev.activeTab)) return
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    localStorage.setItem(`tabs:${s.wsId}`, JSON.stringify({ tabs: s.tabs, active: s.activeTab }))
  }, 300)
})

export const currentView = (t: Tab | undefined): View => (t ? t.history[t.index] : { type: 'home' })

