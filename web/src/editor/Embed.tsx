import { Node, mergeAttributes } from '@tiptap/core'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { pageSavedBus } from '../lib/bus'
import { findPageByName } from '../lib/data'
import { sliceSection } from '../lib/linkSearch'
import { useStore } from '../store'
import { buildExtensions } from './extensions'

/** Read-only render of a document (or one section of it). */
export function ReadOnlyDoc({ doc }: { doc: any }) {
  const editor = useEditor({ extensions: buildExtensions({ readOnly: true }), content: doc, editable: false }, [])
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.commands.setContent(doc, { emitUpdate: false })
  }, [doc, editor])
  return <EditorContent editor={editor} />
}

function EmbedView({ node, editor }: NodeViewProps) {
  const { pageId: savedId, name, anchor } = node.attrs
  const page = useStore((s) => (savedId ? s.data.pages.find((p) => p.id === savedId) : name ? findPageByName(s.data.pages, name) : undefined))
  const pageId: string | null = page?.id ?? null
  const [doc, setDoc] = useState<any>(null)
  const [open, setOpen] = useState(true)
  const [error, setError] = useState('')
  // Read-only docs only exist inside embeds/previews, so an embed there is nested. Not rendering it prevents A -> B -> A cycles.
  const nested = !editor.isEditable

  useEffect(() => {
    if (!pageId) return
    let alive = true
    const load = (fresh: boolean) =>
      api.getPage(pageId, fresh).then((p) => alive && setDoc(p.content)).catch((e) => alive && setError(e.message))
    load(false)
    const off = pageSavedBus.on((id) => { if (id === pageId) load(true) })
    return () => { alive = false; off() }
  }, [pageId])

  const heading = page && anchor ? page.outline.find((h) => h.id === anchor)?.text : null
  return (
    <NodeViewWrapper className="embed" contentEditable={false}>
      <div className="embed-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span className="grow ellipsis">{page?.title || name || 'Missing page'}{heading ? ` › ${heading}` : ''}</span>
        {page && (
          <button
            className="icon-btn"
            title="Open page"
            onClick={(e) => { e.stopPropagation(); useStore.getState().navigate({ type: 'page', id: page.id, anchor: anchor || undefined }) }}
          >
            <ExternalLink size={14} />
          </button>
        )}
      </div>
      {open && (
        <div className="embed-body">
          {!page ? <span className="muted">{name ? `“${name}” does not exist in this world yet. This embed fills in once a page with that name is created or copied here.` : 'This page no longer exists.'}</span>
            : nested ? <span className="muted">Nested embed hidden</span>
            : error ? <span className="muted">{error}</span>
            : doc ? <ReadOnlyDoc doc={sliceSection(doc, anchor)} /> : <span className="muted">Loading…</span>}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { pageId: { default: null }, name: { default: '' }, anchor: { default: null } }
  },
  parseHTML() {
    return [{ tag: 'div[data-embed]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-embed': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedView)
  },
})
