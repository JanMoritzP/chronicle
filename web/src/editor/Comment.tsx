import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useEffect, useRef } from 'react'

function CommentView({ node, updateAttributes, editor, getPos, deleteNode, selected }: NodeViewProps) {
  const { message, done, to, from } = node.attrs as { message: string; done: boolean; to: string; from: string }
  const editable = editor.isEditable
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editable && !message) input.current?.focus() }, [])
  const leave = () => {
    const pos = getPos()
    if (typeof pos === 'number') editor.chain().focus().setTextSelection(pos + node.nodeSize).run()
  }
  return (
    <NodeViewWrapper as="span" contentEditable={false} className={`comment-marker${done ? ' done' : ''}${selected ? ' selected' : ''}`} data-comment data-id={node.attrs.id ?? undefined} title={from ? `From ${from}` : undefined}>
      <span className="comment-to">@{to}</span>
      {editable ? (
        <input
          ref={input}
          className="comment-text"
          value={message}
          size={Math.max(10, Math.min(48, (message || 'Write a comment').length))}
          placeholder="Write a comment"
          onChange={(e) => updateAttributes({ message: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); if (!message.trim()) deleteNode(); else leave() }
            if (e.key === 'Backspace' && !message) { e.preventDefault(); deleteNode() }
          }}
          onBlur={() => { if (!message.trim()) deleteNode() }}
        />
      ) : (
        <span className="comment-text">{message}</span>
      )}
      <input type="checkbox" checked={done} disabled={!editable} onChange={(e) => updateAttributes({ done: e.target.checked })} title={done ? 'Reopen this comment' : 'Mark as resolved'} aria-label="Resolved" />
    </NodeViewWrapper>
  )
}

/** A comment for one person, typed with @name. Collected in the Comments tab, never part of a shared page. */
export const Comment = Node.create({
  name: 'comment',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      to: { default: '', parseHTML: (el) => el.getAttribute('data-to') ?? '', renderHTML: (a) => ({ 'data-to': a.to }) },
      from: { default: '', parseHTML: (el) => el.getAttribute('data-from') ?? '', renderHTML: (a) => ({ 'data-from': a.from }) },
      message: { default: '', parseHTML: (el) => el.getAttribute('data-message') ?? '', renderHTML: (a) => ({ 'data-message': a.message }) },
      done: { default: false, parseHTML: (el) => el.getAttribute('data-done') === 'true', renderHTML: (a) => ({ 'data-done': String(!!a.done) }) },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-comment]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-comment': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(CommentView)
  },
})
