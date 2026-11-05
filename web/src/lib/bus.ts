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

export interface TodoChange { pageId: string; todoId: string; change: { done?: boolean; message?: string } | null }
const todoHandlers = new Set<(c: TodoChange) => void>()

/** Fired when a todo is changed or deleted from the Todos tab, so an editor that has the page open can apply the same change (otherwise its next autosave would undo it). */
export const todoBus = {
  emit: (c: TodoChange) => todoHandlers.forEach((h) => h(c)),
  on: (h: (c: TodoChange) => void) => {
    todoHandlers.add(h)
    return () => {
      todoHandlers.delete(h)
    }
  },
}
