import { useSyncExternalStore } from 'react'

/** How wide pages are drawn: a reading column, a wider one for pages with a side column, or the whole pane. A choice of this device. */
export type PageWidth = 'normal' | 'wide' | 'full'
export const PAGE_WIDTHS: { id: PageWidth; label: string }[] = [
  { id: 'normal', label: 'Normal width' },
  { id: 'wide', label: 'Wide' },
  { id: 'full', label: 'Full width' },
]

const KEY = 'pageWidth'
const listeners = new Set<() => void>()

function read(): PageWidth {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'wide' || v === 'full' ? v : 'normal'
  } catch { return 'normal' }
}

let current = read()

export function setPageWidth(w: PageWidth) {
  current = w
  try { localStorage.setItem(KEY, w) } catch { /* private mode: the choice lasts this visit */ }
  listeners.forEach((l) => l())
}

export function usePageWidth(): PageWidth {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => current)
}
