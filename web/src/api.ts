import { get, set } from 'idb-keyval'
import type { Calendar } from './lib/calendar'
import type { BackupInfo, Bootstrap, EventRow, FullPage, MapFull, MapItem, MapLayer, CopyPreview, CopyResult, GameSession, MapMeta, PageType, Relation, StatsResult, StatTemplateRow, Template, TodoItem, User, Workspace } from './types'

export interface StatTemplateBody { name: string; sections: any[] }
export interface PageTypeBody { name: string; icon: string; tag: string; source: string; definition: Record<string, any> }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  let r: Response
  try {
    r = await fetch(url, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      keepalive: method !== 'GET' && body !== undefined && JSON.stringify(body).length < 60_000,
    })
  } catch {
    throw new ApiError(0, 'Network unreachable')
  }
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new ApiError(r.status, data?.error ?? data?.message ?? r.statusText)
  return data as T
}

const pageCache = new Map<string, FullPage>()

export const api = {
  me: () => req<User>('GET', '/api/auth/me'),
  login: (username: string, password: string) => req<User>('POST', '/api/auth/login', { username, password }),
  logout: () => req('POST', '/api/auth/logout', {}),
  workspaces: () => req<Workspace[]>('GET', '/api/workspaces'),
  createWorkspace: (name: string) => req<Workspace>('POST', '/api/workspaces', { name }),
  bootstrap: (ws: string) => req<Bootstrap>('GET', `/api/workspaces/${ws}/bootstrap`),
  createPage: (ws: string, b: any) => req<any>('POST', `/api/workspaces/${ws}/pages`, b),
  patchPage: async (id: string, b: any) => {
    const r = await req<any>('PATCH', `/api/pages/${id}`, b)
    const c = pageCache.get(id)
    if (c) pageCache.set(id, { ...c, ...b, ...(b.content ? { content: b.content } : {}) })
    return r
  },
  deletePage: (id: string) => req('DELETE', `/api/pages/${id}`),
  restorePage: (id: string) => req('POST', `/api/pages/${id}/restore`, {}),
  purgePage: (id: string) => req('DELETE', `/api/pages/${id}/purge`),
  trash: (ws: string) => req<any[]>('GET', `/api/workspaces/${ws}/trash`),
  versions: (id: string) => req<{ id: string; title: string; wordCount: number; createdAt: number }[]>('GET', `/api/pages/${id}/versions`),
  version: (vid: string) => req<{ content: any; title: string }>('GET', `/api/versions/${vid}`),
  createFolder: (ws: string, name: string, parentId: string | null) => req<any>('POST', `/api/workspaces/${ws}/folders`, { name, parentId }),
  patchFolder: (id: string, b: any) => req('PATCH', `/api/folders/${id}`, b),
  deleteFolder: (id: string) => req('DELETE', `/api/folders/${id}`),
  createZettel: (ws: string, body: string, tags: string[]) => req<any>('POST', `/api/workspaces/${ws}/zettels`, { body, tags }),
  patchZettel: (id: string, b: any) => req('PATCH', `/api/zettels/${id}`, b),
  deleteZettel: (id: string) => req('DELETE', `/api/zettels/${id}`),
  todos: (ws: string) => req<TodoItem[]>('GET', `/api/workspaces/${ws}/todos`),
  patchTodo: async (pageId: string, todoId: string, b: { done?: boolean; message?: string }) => {
    const r = await req('PATCH', `/api/pages/${pageId}/todos/${todoId}`, b)
    pageCache.delete(pageId)
    return r
  },
  deleteTodo: async (pageId: string, todoId: string) => {
    const r = await req('DELETE', `/api/pages/${pageId}/todos/${todoId}`)
    pageCache.delete(pageId)
    return r
  },
  createTemplate: (ws: string, b: { name: string; description?: string; content?: any }) => req<Template>('POST', `/api/workspaces/${ws}/templates`, b),
  patchTemplate: (id: string, b: { name?: string; description?: string; content?: any }) => req<Template>('PATCH', `/api/templates/${id}`, b),
  deleteTemplate: (id: string) => req('DELETE', `/api/templates/${id}`),
  createPageType: (ws: string, b: PageTypeBody) => req<PageType>('POST', `/api/workspaces/${ws}/page-types`, b),
  patchPageType: (id: string, b: PageTypeBody) => req<PageType>('PATCH', `/api/page-types/${id}`, b),
  deletePageType: (id: string) => req('DELETE', `/api/page-types/${id}`),
  createStatTemplate: (ws: string, b: StatTemplateBody) => req<StatTemplateRow>('POST', `/api/workspaces/${ws}/stat-templates`, b),
  patchStatTemplate: (id: string, b: StatTemplateBody) => req<StatTemplateRow>('PATCH', `/api/stat-templates/${id}`, b),
  deleteStatTemplate: (id: string) => req('DELETE', `/api/stat-templates/${id}`),
  users: () => req<any[]>('GET', '/api/users'),
  createUser: (b: any) => req('POST', '/api/users', b),
  changePassword: (current: string, next: string) => req('POST', '/api/auth/password', { current, next }),
  setUserPassword: (id: string, password: string) => req('POST', `/api/users/${id}/password`, { password }),
  deleteUser: (id: string) => req('DELETE', `/api/users/${id}`),
  maps: (ws: string) => req<MapMeta[]>('GET', `/api/workspaces/${ws}/maps`),
  map: (id: string) => req<MapFull>('GET', `/api/maps/${id}`),
  patchMap: (id: string, b: any) => req('PATCH', `/api/maps/${id}`, b),
  deleteMap: (id: string) => req('DELETE', `/api/maps/${id}`),
  createLayer: (mapId: string, name: string) => req<MapLayer>('POST', `/api/maps/${mapId}/layers`, { name }),
  patchLayer: (id: string, b: any) => req('PATCH', `/api/layers/${id}`, b),
  deleteLayer: (id: string) => req('DELETE', `/api/layers/${id}`),
  createItem: (mapId: string, b: any) => req<MapItem>('POST', `/api/maps/${mapId}/items`, b),
  patchItem: (id: string, b: any) => req<MapItem>('PATCH', `/api/items/${id}`, b),
  deleteItem: (id: string) => req('DELETE', `/api/items/${id}`),
  pagePins: (id: string) => req<{ id: string; mapId: string; mapName: string; kind: string }[]>('GET', `/api/pages/${id}/pins`),
  calendar: (ws: string) => req<{ custom: boolean; calendar: Calendar }>('GET', `/api/workspaces/${ws}/calendar`),
  saveCalendar: (ws: string, c: Calendar) => req('PUT', `/api/workspaces/${ws}/calendar`, c),
  events: (ws: string) => req<EventRow[]>('GET', `/api/workspaces/${ws}/events`),
  createEvent: (ws: string, b: any) => req<EventRow>('POST', `/api/workspaces/${ws}/events`, b),
  patchEvent: (id: string, b: any) => req<EventRow>('PATCH', `/api/events/${id}`, b),
  copyPreview: (pageIds: string[], targetWorkspaceId: string) => req<CopyPreview>('POST', '/api/copy/preview', { pageIds, targetWorkspaceId }),
  copyPages: (pageIds: string[], targetWorkspaceId: string) => req<CopyResult>('POST', '/api/copy', { pageIds, targetWorkspaceId }),
  shareStatus: (pageId: string) => req<{ token: string | null }>('GET', `/api/pages/${pageId}/share`),
  share: (pageId: string) => req<{ token: string }>('POST', `/api/pages/${pageId}/share`),
  unshare: (pageId: string) => req('DELETE', `/api/pages/${pageId}/share`),
  shares: (ws: string) => req<{ token: string; pageId: string; title: string; createdAt: number }[]>('GET', `/api/workspaces/${ws}/shares`),
  sessions: (ws: string) => req<GameSession[]>('GET', `/api/workspaces/${ws}/sessions`),
  createSession: (ws: string, b: any) => req<GameSession>('POST', `/api/workspaces/${ws}/sessions`, b),
  patchSession: (id: string, b: any) => req<GameSession>('PATCH', `/api/sessions/${id}`, b),
  deleteSession: (id: string) => req('DELETE', `/api/sessions/${id}`),
  stats: (ws: string, from?: string, to?: string) => {
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    return req<StatsResult>('GET', `/api/workspaces/${ws}/stats${q.size ? `?${q}` : ''}`)
  },
  relations: (ws: string) => req<Relation[]>('GET', `/api/workspaces/${ws}/relations`),
  createRelation: (ws: string, b: any) => req<Relation>('POST', `/api/workspaces/${ws}/relations`, b),
  patchRelation: (id: string, b: any) => req<Relation>('PATCH', `/api/relations/${id}`, b),
  deleteRelation: (id: string) => req('DELETE', `/api/relations/${id}`),
  deleteEvent: (id: string) => req('DELETE', `/api/events/${id}`),
  async uploadMap(ws: string, file: File, name: string, parentMapId: string | null): Promise<MapMeta> {
    const fd = new FormData()
    fd.append('name', name)
    if (parentMapId) fd.append('parentMapId', parentMapId)
    fd.append('file', file)
    let r: Response
    try { r = await fetch(`/api/workspaces/${ws}/maps`, { method: 'POST', body: fd }) } catch { throw new ApiError(0, 'Network unreachable') }
    const data = await r.json().catch(() => null)
    if (!r.ok) throw new ApiError(r.status, data?.error ?? r.statusText)
    return data
  },
  backups: () => req<string[]>('GET', '/api/backups'),
  backupInfo: () => req<BackupInfo[]>('GET', '/api/backups/info'),
  restoreBackup: (name: string) => req<{ ok: boolean; safety: string }>('POST', `/api/backups/${encodeURIComponent(name)}/restore`, {}),
  deleteBackup: (name: string) => req('DELETE', `/api/backups/${encodeURIComponent(name)}`),
  runBackup: () => req<{ name: string }>('POST', '/api/backups', {}),

  /** Full page content, cached in memory and IndexedDB so previously opened pages still open offline. */
  async getPage(id: string, fresh = false): Promise<FullPage> {
    if (!fresh && pageCache.has(id)) return pageCache.get(id)!
    try {
      const p = await req<FullPage>('GET', `/api/pages/${id}`)
      pageCache.set(id, p)
      set(`page:${id}`, p).catch(() => {})
      return p
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        const cached = await get<FullPage>(`page:${id}`)
        if (cached) { pageCache.set(id, cached); return cached }
      }
      throw e
    }
  },
  setCachedContent(id: string, content: any) {
    const c = pageCache.get(id)
    if (c) pageCache.set(id, { ...c, content })
  },
  invalidate(id: string) { pageCache.delete(id) },
}
