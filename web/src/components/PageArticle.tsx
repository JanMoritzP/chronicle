import type { Editor } from '@tiptap/react'
import { ImagePlus, X } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'

/** How much room the page has: the article adds the contents column and the side rail as the pane grows (split view, a narrow window, a wide screen). */
export type ArticleSize = 's' | 'm' | 'l' | 'xl' | 'xxl'

const sizeFor = (w: number): ArticleSize => (w >= 2080 ? 'xxl' : w >= 1560 ? 'xl' : w >= 1180 ? 'l' : w >= 760 ? 'm' : 's')

export function useArticleSize(ref: RefObject<HTMLElement | null>): ArticleSize {
  const [size, setSize] = useState<ArticleSize>('m')
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize(sizeFor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

type Heading = { pos: number; level: number; text: string }

function headingsOf(editor: Editor): Heading[] {
  const out: Heading[] = []
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'heading') {
      const text = n.textContent.trim()
      if (text) out.push({ pos, level: n.attrs.level, text })
      return false
    }
    return !n.isTextblock
  })
  return out
}

const same = (a: Heading[], b: Heading[]) => a.length === b.length && a.every((h, i) => h.pos === b[i].pos && h.level === b[i].level && h.text === b[i].text)

/** The page's headings as a table of contents that follows the reader down the page. */
export function PageOutline({ editor }: { editor: Editor | null }) {
  const [items, setItems] = useState<Heading[]>([])
  const [active, setActive] = useState(-1)

  useEffect(() => {
    if (!editor) return
    let frame = 0
    const read = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { if (!editor.isDestroyed) setItems((prev) => { const next = headingsOf(editor); return same(prev, next) ? prev : next }) })
    }
    read()
    editor.on('update', read)
    editor.on('create', read)
    return () => { cancelAnimationFrame(frame); editor.off('update', read); editor.off('create', read) }
  }, [editor])

  useEffect(() => {
    if (!editor || editor.isDestroyed || !items.length) return
    const scroller = editor.view.dom.closest('.pane')
    if (!scroller) return
    let frame = 0
    const spy = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return
        const line = scroller.getBoundingClientRect().top + 110
        let cur = -1
        items.forEach((h, i) => {
          const el = editor.view.nodeDOM(h.pos)
          if (el instanceof HTMLElement && el.getBoundingClientRect().top <= line) cur = i
        })
        setActive(cur)
      })
    }
    spy()
    scroller.addEventListener('scroll', spy, { passive: true })
    return () => { cancelAnimationFrame(frame); scroller.removeEventListener('scroll', spy) }
  }, [editor, items])

  const top = items.reduce((m, h) => Math.min(m, h.level), 6)
  const go = (h: Heading) => {
    if (!editor || editor.isDestroyed) return
    const el = editor.view.nodeDOM(h.pos)
    if (el instanceof HTMLElement) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <nav className="page-outline" aria-label="Contents of this page">
      <div className="rail-label">Contents</div>
      {items.length ? (
        <ol>
          {items.map((h, i) => (
            <li key={`${h.pos}-${h.text}`} style={{ ['--depth' as any]: Math.min(3, h.level - top) }}>
              <button className={i === active ? 'on' : ''} aria-current={i === active ? 'location' : undefined} onClick={() => go(h)}>{h.text}</button>
            </li>
          ))}
        </ol>
      ) : <p className="muted">Headings in the text show up here.</p>}
    </nav>
  )
}

/** A picture across the whole page above the title. It fades into the page, so the title can sit on its lower edge. */
export function PageCover({ url, label, readOnly, set, pick }: { url: string; label: string; readOnly: boolean; set: (v: string | null) => void; pick: () => Promise<string | null> }) {
  return (
    <div className="page-cover">
      <img src={url} alt="" draggable={false} />
      {!readOnly && (
        <div className="page-cover-actions">
          <button className="btn sm" onClick={async () => { const u = await pick(); if (u) set(u) }}><ImagePlus size={14} /> Change {label}</button>
          <button className="btn sm" title={`Remove the ${label}`} aria-label={`Remove the ${label}`} onClick={() => set(null)}><X size={14} /></button>
        </div>
      )}
    </div>
  )
}
