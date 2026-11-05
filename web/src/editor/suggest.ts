import { create } from 'zustand'
import type { ReactNode } from 'react'

export interface SuggestItem {
  key: string
  label: string
  sub?: string
  group?: string
  indices?: number[]
  icon?: ReactNode
  run: (range: { from: number; to: number }) => void
}

interface SuggestState {
  open: boolean
  items: SuggestItem[]
  index: number
  rect: { left: number; top: number; bottom: number } | null
  range: { from: number; to: number } | null
  set: (p: Partial<Omit<SuggestState, 'set'>>) => void
}

export const useSuggest = create<SuggestState>((set) => ({
  open: false, items: [], index: 0, rect: null, range: null, set: (p) => set(p),
}))

type Props = { items: SuggestItem[]; range: { from: number; to: number }; clientRect?: (() => DOMRect | null) | null }

/** Adapter between TipTap's suggestion plugin and the shared popup store. */
export function suggestRender() {
  const sync = (p: Props, resetIndex: boolean) => {
    const r = p.clientRect?.()
    useSuggest.getState().set({
      open: true, items: p.items, range: p.range,
      rect: r ? { left: r.left, top: r.top, bottom: r.bottom } : null,
      ...(resetIndex ? { index: 0 } : {}),
    })
  }
  return {
    onStart: (p: Props) => sync(p, true),
    onUpdate: (p: Props) => {
      const prev = useSuggest.getState()
      const same = prev.items.length === p.items.length && prev.items.every((it, i) => it.key === p.items[i].key)
      sync(p, !same)
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      const s = useSuggest.getState()
      if (!s.open || !s.items.length) return false
      if (event.key === 'ArrowDown') { s.set({ index: (s.index + 1) % s.items.length }); return true }
      if (event.key === 'ArrowUp') { s.set({ index: (s.index - 1 + s.items.length) % s.items.length }); return true }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const it = s.items[s.index]
        if (it && s.range) { it.run(s.range); return true }
      }
      return false
    },
    onExit: () => useSuggest.getState().set({ open: false, items: [], rect: null, range: null }),
  }
}
