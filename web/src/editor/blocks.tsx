import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'

export const CALLOUT_KINDS = ['info', 'warning', 'aloud', 'secret'] as const
export type CalloutKind = typeof CALLOUT_KINDS[number]
export const CALLOUT_LABEL: Record<CalloutKind, string> = { info: 'Note', warning: 'Warning', aloud: 'Read aloud', secret: 'Secret' }

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const kind: CalloutKind = CALLOUT_KINDS.includes(node.attrs.kind) ? node.attrs.kind : 'info'
  const next = CALLOUT_KINDS[(CALLOUT_KINDS.indexOf(kind) + 1) % CALLOUT_KINDS.length]
  const label = CALLOUT_LABEL[kind]
  return (
    <NodeViewWrapper className={`callout callout-${kind}`} data-callout="" data-kind={kind}>
      <div className="callout-head" contentEditable={false}>
        {editor.isEditable ? (
          <button type="button" className="callout-kind" title={`Change to ${CALLOUT_LABEL[next].toLowerCase()}`} onClick={() => updateAttributes({ kind: next })}>
            {kind === 'secret' && <Lock size={12} />}{label}
          </button>
        ) : <span className="callout-kind">{kind === 'secret' && <Lock size={12} />}{label}</span>}
        {kind === 'secret' && editor.isEditable && <span className="muted">Stays closed in shared pages</span>}
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  )
}

/** A highlighted box: a note, a warning, text to read aloud, or a secret that shared pages never show. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { kind: { default: 'info', parseHTML: (el) => el.getAttribute('data-kind') || 'info', renderHTML: (a) => ({ 'data-kind': a.kind }) } }
  },
  parseHTML() { return [{ tag: 'div[data-callout]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0] },
  addNodeView() { return ReactNodeViewRenderer(CalloutView) },
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
