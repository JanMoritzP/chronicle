import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, type Transaction } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { ChevronDown, ChevronRight, Eye, Lock, PanelLeft, PanelRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useIsGm, worldRoleNow } from '../lib/access'
import { useStore } from '../store'
import type { Person } from '../types'

export const CALLOUT_KINDS = ['info', 'warning', 'aloud', 'secret'] as const
export type CalloutKind = typeof CALLOUT_KINDS[number]
export const CALLOUT_LABEL: Record<CalloutKind, string> = { info: 'Note', warning: 'Warning', aloud: 'Read aloud', secret: 'Secret' }

/** Who besides the GMs may read a secret box: a list of member ids, picked by a GM. */
function RevealPicker({ reveal, onChange }: { reveal: string[]; onChange: (ids: string[]) => void }) {
  const wsId = useStore((s) => s.wsId)
  const [open, setOpen] = useState(false)
  const [people, setPeople] = useState<Person[]>([])
  // the names are needed to show who may read it, and to pick from
  const need = open || reveal.length > 0
  useEffect(() => { if (need && wsId) api.people(wsId).then((p) => setPeople(p.filter((x) => x.role !== 'owner' && x.role !== 'gm'))).catch(() => {}) }, [need, wsId])
  const names = people.filter((p) => reveal.includes(p.id)).map((p) => p.username)
  return (
    <span className="reveal-picker">
      <button type="button" className="callout-reveal" aria-haspopup="menu" title="Who besides the GMs may read this" onClick={() => setOpen(!open)}>
        <Eye size={12} /> {reveal.length ? (names.length ? `GMs and ${names.join(', ')}` : `GMs and ${reveal.length} more`) : 'GMs only'}
      </button>
      {open && (
        <span className="menu reveal-menu" role="menu" onMouseLeave={() => setOpen(false)}>
          {!people.length && <span className="muted" style={{ padding: '6px 10px' }}>No players in this world yet.</span>}
          {people.map((p) => (
            <label key={p.id} className="row" style={{ padding: '4px 10px', gap: 8 }}>
              <input type="checkbox" checked={reveal.includes(p.id)} onChange={(e) => onChange(e.target.checked ? [...reveal, p.id] : reveal.filter((x) => x !== p.id))} />
              {p.username}
            </label>
          ))}
        </span>
      )}
    </span>
  )
}

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const gm = useIsGm()
  const kind: CalloutKind = CALLOUT_KINDS.includes(node.attrs.kind) ? node.attrs.kind : 'info'
  // secrets are the GM's: others neither make one nor turn one into an open box
  const kinds = gm ? CALLOUT_KINDS : CALLOUT_KINDS.filter((k) => k !== 'secret')
  const next = kinds[(kinds.indexOf(kind as never) + 1) % kinds.length]
  const canSwitch = editor.isEditable && (gm || kind !== 'secret')
  const label = CALLOUT_LABEL[kind]
  const reveal: string[] = Array.isArray(node.attrs.reveal) ? node.attrs.reveal : []
  return (
    <NodeViewWrapper className={`callout callout-${kind}`} data-callout="" data-kind={kind}>
      <div className="callout-head" contentEditable={false}>
        {canSwitch ? (
          <button type="button" className="callout-kind" title={`Change to ${CALLOUT_LABEL[next].toLowerCase()}`} onClick={() => updateAttributes({ kind: next })}>
            {kind === 'secret' && <Lock size={12} />}{label}
          </button>
        ) : <span className="callout-kind">{kind === 'secret' && <Lock size={12} />}{label}</span>}
        {kind === 'secret' && editor.isEditable && gm && <RevealPicker reveal={reveal} onChange={(ids) => updateAttributes({ reveal: ids })} />}
        {kind === 'secret' && !gm && <span className="muted">A GM shows you this</span>}
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  )
}

/** A highlighted box: a note, a warning, text to read aloud, or a secret that only GMs (and the players a GM names) read. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      kind: { default: 'info', parseHTML: (el) => el.getAttribute('data-kind') || 'info', renderHTML: (a) => ({ 'data-kind': a.kind }) },
      /** ids of the players who may read a secret besides the GMs */
      reveal: {
        default: [],
        parseHTML: (el) => { try { const v = JSON.parse(el.getAttribute('data-reveal') || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } },
        renderHTML: (a) => (Array.isArray(a.reveal) && a.reveal.length ? { 'data-reveal': JSON.stringify(a.reveal) } : {}),
      },
    }
  },
  parseHTML() { return [{ tag: 'div[data-callout]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0] },
  addNodeView() { return ReactNodeViewRenderer(CalloutView) },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      // A secret is kept from everyone but GMs. One a player writes (from /secret or a template) names that player,
      // so it does not lock them out of the page they are writing.
      appendTransaction: (trs, _old, state) => {
        if (!editor.isEditable || !trs.some((t) => t.docChanged) || worldRoleNow() === 'gm') return null
        const me = useStore.getState().user?.id
        if (!me) return null
        let tr: Transaction | null = null
        state.doc.descendants((n, pos) => {
          if (n.type.name !== 'callout' || n.attrs.kind !== 'secret') return
          const reveal: string[] = Array.isArray(n.attrs.reveal) ? n.attrs.reveal : []
          if (reveal.includes(me)) return
          tr = (tr ?? state.tr).setNodeMarkup(pos, undefined, { ...n.attrs, reveal: [...reveal, me] })
        })
        return tr
      },
    })]
  },
})

function FoldView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = editor.isEditable
  // writing happens with the section open; readers get it closed. Whether it is open is a view setting, not part of the page.
  const [open, setOpen] = useState(editable)
  const title: string = node.attrs.title ?? ''
  return (
    <NodeViewWrapper className={`fold${open ? ' open' : ''}`} data-fold="">
      <div className="fold-head" contentEditable={false}>
        <button type="button" className="icon-btn" aria-expanded={open} title={open ? 'Close section' : 'Open section'} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {editable ? (
          <input className="fold-title" value={title} placeholder="Section title" aria-label="Section title" onChange={(e) => updateAttributes({ title: e.target.value })} />
        ) : (
          <button type="button" className="fold-title" onClick={() => setOpen(!open)}>{title || 'Section'}</button>
        )}
      </div>
      <NodeViewContent className="fold-body" style={open ? undefined : { display: 'none' }} />
    </NodeViewWrapper>
  )
}

/** A section with a title that can be closed. */
export const Fold = Node.create({
  name: 'fold',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { title: { default: '', parseHTML: (el) => el.getAttribute('data-title') ?? '', renderHTML: (a) => ({ 'data-title': a.title }) } }
  },
  parseHTML() { return [{ tag: 'div[data-fold]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-fold': '' }), 0] },
  addNodeView() { return ReactNodeViewRenderer(FoldView) },
})

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,4}',
  isolating: true,
  parseHTML() { return [{ tag: 'div[data-columns]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-columns': '', class: 'columns' }), 0] },
})

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML() { return [{ tag: 'div[data-column]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-column': '', class: 'column' }), 0] },
})

interface Heading { text: string; level: number; pos: number }

function headingsOf(editor: NodeViewProps['editor']): Heading[] {
  const out: Heading[] = []
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'heading' && n.textContent.trim()) out.push({ text: n.textContent, level: n.attrs.level, pos })
  })
  return out
}

function TocView({ editor, selected }: NodeViewProps) {
  const [list, setList] = useState(() => headingsOf(editor))
  useEffect(() => {
    const update = () => setList(headingsOf(editor))
    editor.on('update', update)
    return () => { editor.off('update', update) }
  }, [editor])
  const go = (pos: number) => (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const base = Math.min(...list.map((h) => h.level), 4)
  return (
    <NodeViewWrapper className={`toc${selected ? ' selected' : ''}`} contentEditable={false} data-toc="">
      <div className="toc-title">Contents</div>
      {list.length ? list.map((h) => (
        <button key={h.pos} type="button" className="toc-item" style={{ paddingLeft: (h.level - base) * 14 }} onClick={() => go(h.pos)}>{h.text}</button>
      )) : <div className="muted">Headings on this page appear here.</div>}
    </NodeViewWrapper>
  )
}

/** A list of the page's headings that follows the page as it changes. */
export const Toc = Node.create({
  name: 'toc',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() { return [{ tag: 'div[data-toc]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-toc': '' })] },
  addNodeView() { return ReactNodeViewRenderer(TocView) },
})

const ASIDE_SIZES = [{ id: 's', label: 'S', title: 'Narrow' }, { id: 'm', label: 'M', title: 'Medium' }, { id: 'l', label: 'L', title: 'Wide' }] as const

function AsideView({ node, updateAttributes, editor }: NodeViewProps) {
  const side = node.attrs.side === 'left' ? 'left' : 'right'
  const size = ASIDE_SIZES.some((s) => s.id === node.attrs.size) ? node.attrs.size : 'm'
  return (
    <NodeViewWrapper className={`aside aside-${side} aside-${size}`} data-aside="" data-side={side} data-size={size}>
      {editor.isEditable && (
        <div className="aside-tools" contentEditable={false}>
          <button type="button" className={`icon-btn${side === 'left' ? ' on' : ''}`} title="Box on the left, text on the right" aria-pressed={side === 'left'} onMouseDown={(e) => e.preventDefault()} onClick={() => updateAttributes({ side: 'left' })}><PanelLeft size={14} /></button>
          <button type="button" className={`icon-btn${side === 'right' ? ' on' : ''}`} title="Box on the right, text on the left" aria-pressed={side === 'right'} onMouseDown={(e) => e.preventDefault()} onClick={() => updateAttributes({ side: 'right' })}><PanelRight size={14} /></button>
          {ASIDE_SIZES.map((s) => (
            <button key={s.id} type="button" className={`icon-btn text${size === s.id ? ' on' : ''}`} title={s.title} aria-pressed={size === s.id} onMouseDown={(e) => e.preventDefault()} onClick={() => updateAttributes({ size: s.id })}>{s.label}</button>
          ))}
        </div>
      )}
      <NodeViewContent className="aside-body" />
    </NodeViewWrapper>
  )
}

/** A box beside the text, like an infobox: a picture, a few facts, a quote. The text flows around it. */
export const Aside = Node.create({
  name: 'aside',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      side: { default: 'right', parseHTML: (el) => (el.getAttribute('data-side') === 'left' ? 'left' : 'right'), renderHTML: (a) => ({ 'data-side': a.side }) },
      size: { default: 'm', parseHTML: (el) => el.getAttribute('data-size') || 'm', renderHTML: (a) => ({ 'data-size': a.size }) },
    }
  },
  parseHTML() { return [{ tag: 'div[data-aside]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-aside': '' }), 0] },
  addNodeView() { return ReactNodeViewRenderer(AsideView) },
})
