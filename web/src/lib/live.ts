import { clientId } from '../api'
import { useStore } from '../store'
import { liveBus, pageSavedBus } from './bus'
import { useWorld } from './world'

// parts of the app that keep their own copy of world data besides the store
const WORLD_AREAS = new Set(['maps', 'layers', 'items', 'events', 'relations', 'calendar'])

/**
 * Keeps this tab in step with what other people do in the open world: new and renamed pages, saved text, who is online,
 * and changes to which worlds this account may open. Returns a function that closes the stream.
 */
export function openLive(wsId: string | null): () => void {
  const q = new URLSearchParams({ c: clientId })
  if (wsId) q.set('ws', wsId)
  const es = new EventSource(`/api/live?${q}`)
  let timer: number | undefined
  let opened = false
  const refreshSoon = () => {
    clearTimeout(timer)
    timer = window.setTimeout(() => useStore.getState().refresh(), 500)
  }

  es.onopen = () => {
    // after a dropped connection we may have missed changes
    if (opened) refreshSoon()
    opened = true
  }
  es.onmessage = (e) => {
    let ev: any
    try { ev = JSON.parse(e.data) } catch { return }
    const st = useStore.getState()
    if (ev.k === 'page-saved') {
      st.patchPageMeta(ev.id, {
        outline: ev.outline, text: ev.text, wordCount: ev.wordCount, hasStats: ev.hasStats, portrait: ev.portrait,
        updatedAt: ev.updatedAt, todos: ev.todos, type: ev.type,
      })
      st.setLinksFor(ev.id, ev.links)
      pageSavedBus.emit(ev.id)
    } else if (ev.k === 'refresh') {
      refreshSoon()
      if (WORLD_AREAS.has(ev.area) && wsId && useWorld.getState().wsId === wsId) useWorld.getState().load(wsId).catch(() => {})
      liveBus.emit({ k: 'refresh', area: ev.area, pageId: ev.pageId })
    } else if (ev.k === 'presence') {
      useStore.setState({ online: ev.users })
    } else if (ev.k === 'worlds') {
      st.refreshWorlds().catch(() => {})
    }
  }
  return () => { clearTimeout(timer); es.close() }
}
