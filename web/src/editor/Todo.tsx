import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useEffect, useRef } from 'react'

function TodoView({ node, updateAttributes, editor, getPos, deleteNode, selected }: NodeViewProps) {
  const { message, done } = node.attrs as { message: string; done: boolean }
  const editable = editor.isEditable
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editable && !message) input.current?.focus() }, [])
  const leave = () => {
    const pos = getPos()
    if (typeof pos === 'number') editor.chain().focus().setTextSelection(pos + node.nodeSize).run()
  }
  return (
    <NodeViewWrapper as="span" contentEditable={false} className={`todo-marker${done ? ' done' : ''}${selected ? ' selected' : ''}`} data-todo data-id={node.attrs.id ?? undefined}>
      <input type="checkbox" checked={done} disabled={!editable} onChange={(e) => updateAttributes({ done: e.target.checked })} title="Mark as done" />
      {editable ? (
        <input
          ref={input}
          className="todo-text"
          value={message}
          size={Math.max(8, Math.min(48, (message || 'What needs doing?').length))}
          placeholder="What needs doing?"
          onChange={(e) => updateAttributes({ message: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); if (!message.trim()) deleteNode(); else leave() }
            if (e.key === 'Backspace' && !message) { e.preventDefault(); deleteNode() }
          }}
          onBlur={() => { if (!message.trim()) deleteNode() }}
        />
      ) : (
        <span className="todo-text">{message}</span>
      )}
    </NodeViewWrapper>
  )
}

export const Todo = Node.create({
  name: 'todo',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      message: { default: '', parseHTML: (el) => el.getAttribute('data-message') ?? '', renderHTML: (a) => ({ 'data-message': a.message }) },
      done: { default: false, parseHTML: (el) => el.getAttribute('data-done') === 'true', renderHTML: (a) => ({ 'data-done': String(!!a.done) }) },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-todo]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-todo': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(TodoView)
  },
})
