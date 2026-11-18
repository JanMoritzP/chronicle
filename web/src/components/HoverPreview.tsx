import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { StatBlockBody } from '../editor/StatBlock'
import { findTemplate, TEMPLATES } from '../editor/templates'
import { currentTemplates } from '../editor/useTemplates'
import { fetchLibraryEntry } from '../lib/library'
import { sliceSection } from '../lib/linkSearch'
import { useStore } from '../store'
import type { FullPage, LibraryEntry } from '../types'
import { EntryPreview } from './LibraryEntry'

function firstParagraph(doc: any): string {
  for (const n of doc?.content ?? []) {
    if (n.type === 'paragraph' || n.type === 'blockquote' || n.type === 'bulletList') {
      const t = textOf(n).trim()
      if (t) return t.length > 400 ? `${t.slice(0, 400)}…` : t
    }
  }
  return ''
}
function textOf(n: any): string {
  if (n.type === 'text') return n.text ?? ''
  if (n.type === 'wikilink') return n.attrs?.alias || n.attrs?.name || ''
  return (n.content ?? []).map(textOf).join(n.type === 'bulletList' ? '\n' : '')
}
function findNode(doc: any, type: string): any | null {
  for (const n of doc?.content ?? []) {
    if (n.type === type) return n
    const inner = findNode(n, type)
    if (inner) return inner
  }
  return null
}

/** Statblock → show it (plus portrait if any). Portrait only → portrait. Neither → first paragraph. */
export function PreviewBody({ page, anchor }: { page: FullPage; anchor?: string | null }) {
  const doc = sliceSection(page.content, anchor)
  const stat = findNode(doc, 'statblock')
  const image = page.props?.portrait ?? findNode(doc, 'image')?.attrs?.src ?? null
  const para = !stat && !image ? firstParagraph(doc) : ''
  const template = stat ? findTemplate(currentTemplates(), stat.attrs?.template) ?? TEMPLATES[0] : null
  return (
    <>
      <h4>{page.icon} {page.title || 'Untitled'}</h4>
      {image && <img src={image} alt="" />}
      {stat && template && <StatBlockBody template={template} data={stat.attrs?.data ?? {}} />}
      {para && <div>{para}</div>}
      {!stat && !image && !para && <span className="muted">Empty page</span>}
    </>
  )
}

type Shown = { kind: 'page' | 'lib'; id: string; anchor: string | null; x: number; y: number }

/** Preview card for a page link (data-page-id) or a library entry (data-lib-key) while the mouse rests on it. */
export function HoverPreview() {
  const [state, setState] = useState<Shown | null>(null)
  const [page, setPage] = useState<FullPage | null>(null)
  const [entry, setEntry] = useState<LibraryEntry | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const showT = useRef<number | undefined>(undefined)
  const hideT = useRef<number | undefined>(undefined)
  const overCard = useRef(false)
  const current = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (window.matchMedia('(hover: none)').matches) return
    const find = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.('[data-page-id], [data-lib-key]') as HTMLElement | null
    const hideNow = () => { clearTimeout(showT.current); setState(null); current.current = null }
    const scheduleHide = () => {
      clearTimeout(hideT.current)
      hideT.current = window.setTimeout(() => { if (!overCard.current) hideNow() }, 180)
    }
    const over = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      // links inside the card itself do not open further cards
      if (target?.closest?.('.hover-card')) return
      const el = find(target)
      const id = el?.dataset.pageId || el?.dataset.libKey
      if (!el || !id) {
        // moving over something else also ends a card whose link has disappeared, so no "mouse left" event will come for it
        if (current.current) scheduleHide()
        return
      }
      if (el === current.current) { clearTimeout(hideT.current); return }
      clearTimeout(showT.current)
      clearTimeout(hideT.current)
      showT.current = window.setTimeout(() => {
        // the list may have been redrawn in the meantime (a page opened, links refreshed); a detached element has no position
        const r = el.getBoundingClientRect()
        if (!el.isConnected || (r.width === 0 && r.height === 0)) return
        current.current = el
        setPage(null)
        setEntry(null)
        setState({ kind: el.dataset.pageId ? 'page' : 'lib', id, anchor: el.dataset.anchor || null, x: r.left, y: r.bottom })
      }, 350)
    }
    const out = (e: MouseEvent) => {
      const el = find(e.target)
      if (!el) return
      clearTimeout(showT.current)
      scheduleHide()
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mouseout', out)
    return () => { document.removeEventListener('mouseover', over); document.removeEventListener('mouseout', out) }
  }, [])

  useEffect(() => {
    if (!state) return
    let alive = true
    if (state.kind === 'page') api.getPage(state.id).then((p) => alive && setPage(p)).catch(() => alive && setState(null))
    else fetchLibraryEntry(state.id).then((e) => alive && setEntry(e)).catch(() => alive && setState(null))
    return () => { alive = false }
  }, [state?.kind, state?.id])

  useEffect(() => {
    const hide = () => { clearTimeout(showT.current); setState(null); current.current = null }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('keydown', hide)
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('keydown', hide) }
  }, [])

  // a card whose link was removed from the page (the list redrew under it) goes away on its own
  useEffect(() => {
    if (!state) return
    const t = window.setInterval(() => {
      if (current.current && !current.current.isConnected && !overCard.current) { setState(null); current.current = null }
    }, 400)
    return () => clearInterval(t)
  }, [state])

  if (!state || (state.kind === 'page' ? !page : !entry)) return null
  const w = 360
  const left = Math.max(8, Math.min(state.x, window.innerWidth - w - 8))
  const h = card.current?.offsetHeight ?? 200
  const top = state.y + 8 + h > window.innerHeight ? Math.max(8, state.y - h - 30) : state.y + 6
  const open = () => {
    const st = useStore.getState()
    if (state.kind === 'page') st.navigate({ type: 'page', id: state.id, anchor: state.anchor ?? undefined })
    else st.navigate({ type: 'library', key: state.id })
    setState(null)
  }
  return (
    <div ref={card} className="hover-card" style={{ left, top }}
      onMouseEnter={() => { overCard.current = true; clearTimeout(hideT.current) }}
      onMouseLeave={() => { overCard.current = false; setState(null); current.current = null }}
      onClick={open}>
      {state.kind === 'page' ? <PreviewBody page={page!} anchor={state.anchor} /> : <EntryPreview entry={entry!} />}
    </div>
  )
}
