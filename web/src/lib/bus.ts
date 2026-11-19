type Handler = (id: string) => void
const handlers = new Set<Handler>()

/** Fired after a page's content was saved, so embeds / previews showing it can refresh. */
export const pageSavedBus = {
  emit: (id: string) => handlers.forEach((h) => h(id)),
  on: (h: Handler) => {
    handlers.add(h)
    return () => {
      handlers.delete(h)
    }
  },
}

/** A change made by someone else in the current world: `area` is the part of the app it touched (pages, maps, folders...), `pageId` the page when it was one. */
export interface LiveChange { k: 'refresh'; area: string; pageId?: string }
const liveHandlers = new Set<(c: LiveChange) => void>()

export const liveBus = {
  emit: (c: LiveChange) => liveHandlers.forEach((h) => h(c)),
  on: (h: (c: LiveChange) => void) => {
    liveHandlers.add(h)
    return () => {
      liveHandlers.delete(h)
    }
  },
}
