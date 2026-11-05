import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { StatBlockBody } from '../editor/StatBlock'
import { findTemplate, TEMPLATES } from '../editor/templates'
import { currentTemplates } from '../editor/useTemplates'
import { sliceSection } from '../lib/linkSearch'
import { useStore } from '../store'
import type { FullPage } from '../types'

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

export function HoverPreview() {
  const [state, setState] = useState<{ id: string; anchor: string | null; x: number; y: number } | null>(null)
  const [page, setPage] = useState<FullPage | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const showT = useRef<number | undefined>(undefined)
  const hideT = useRef<number | undefined>(undefined)
  const overCard = useRef(false)
  const current = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (window.matchMedia('(hover: none)').matches) return
    const find = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.('[data-page-id]') as HTMLElement | null
    const scheduleHide = () => {
      clearTimeout(hideT.current)
      hideT.current = window.setTimeout(() => { if (!overCard.current) { setState(null); current.current = null } }, 180)
    }
    const over = (e: MouseEvent) => {
      const el = find(e.target)
      if (!el || !el.dataset.pageId) return
      if (el === current.current) { clearTimeout(hideT.current); return }
      clearTimeout(showT.current)
      clearTimeout(hideT.current)
      showT.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect()
        current.current = el
        setPage(null)
        setState({ id: el.dataset.pageId!, anchor: el.dataset.anchor || null, x: r.left, y: r.bottom })
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
    api.getPage(state.id).then((p) => alive && setPage(p)).catch(() => alive && setState(null))
    return () => { alive = false }
  }, [state?.id])

  useEffect(() => {
    const hide = () => { setState(null); current.current = null }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('keydown', hide)
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('keydown', hide) }
  }, [])

  if (!state || !page) return null
  const w = 360
  const left = Math.max(8, Math.min(state.x, window.innerWidth - w - 8))
  const h = card.current?.offsetHeight ?? 200
  const top = state.y + 8 + h > window.innerHeight ? Math.max(8, state.y - h - 30) : state.y + 6
  return (
    <div ref={card} className="hover-card" style={{ left, top }}
      onMouseEnter={() => { overCard.current = true; clearTimeout(hideT.current) }}
      onMouseLeave={() => { overCard.current = false; setState(null); current.current = null }}
      onClick={() => { useStore.getState().navigate({ type: 'page', id: page.id, anchor: state.anchor ?? undefined }); setState(null) }}>
      <PreviewBody page={page} anchor={state.anchor} />
    </div>
  )
}
