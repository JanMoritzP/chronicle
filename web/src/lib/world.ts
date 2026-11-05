import { create } from 'zustand'
import { api } from '../api'
import { DEFAULT_CALENDAR, type Calendar } from './calendar'
import type { EventRow, MapMeta, Relation } from '../types'

interface World {
  wsId: string | null
  maps: MapMeta[]
  events: EventRow[]
  relations: Relation[]
  calendar: Calendar
  customCalendar: boolean
  load: (wsId: string) => Promise<void>
  reloadMaps: () => Promise<void>
  reloadEvents: () => Promise<void>
  reloadRelations: () => Promise<void>
  setCalendar: (c: Calendar) => Promise<void>
}

/** Maps, timeline events and the calendar. Loaded lazily the first time a map/timeline feature is used. */
export const useWorld = create<World>((set, get) => ({
  wsId: null, maps: [], events: [], relations: [], calendar: DEFAULT_CALENDAR, customCalendar: false,

  async load(wsId) {
    if (get().wsId !== wsId) set({ wsId, maps: [], events: [], relations: [], calendar: DEFAULT_CALENDAR, customCalendar: false })
    const [maps, events, relations, cal] = await Promise.all([api.maps(wsId), api.events(wsId), api.relations(wsId), api.calendar(wsId)])
    if (get().wsId === wsId) set({ maps, events, relations, calendar: cal.calendar, customCalendar: cal.custom })
  },
  async reloadMaps() { const ws = get().wsId; if (ws) set({ maps: await api.maps(ws) }) },
  async reloadEvents() { const ws = get().wsId; if (ws) set({ events: await api.events(ws) }) },
  async reloadRelations() { const ws = get().wsId; if (ws) set({ relations: await api.relations(ws) }) },
  async setCalendar(c) {
    const ws = get().wsId
    if (!ws) return
    await api.saveCalendar(ws, c)
    set({ calendar: c, customCalendar: true })
  },
}))
