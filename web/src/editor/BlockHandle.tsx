import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { GripVertical, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'

interface Hit { pos: number; top: number; left: number; dom: HTMLElement }

/** The top-level block under the pointer. Floating pictures and side boxes share their line with the text beside them, so the one under x wins. */
function blockAt(editor: Editor, x: number, y: number): { pos: number; dom: HTMLElement } | null {
  const view = editor.view
  let best: { pos: number; dom: HTMLElement } | null = null
  view.state.doc.forEach((_node, offset) => {
    const dom = view.nodeDOM(offset)
    if (!(dom instanceof HTMLElement)) return
    const r = dom.getBoundingClientRect()
    if (y < r.top - 4 || y > r.bottom + 4) return
    const inX = x >= r.left - 40 && x <= r.right
    if (!best || (inX && getComputedStyle(dom).float !== 'none')) best = { pos: offset, dom }
  })
  return best
}

/**
 * The handle left of the block under the pointer: drag it to move the block, click it to select the block,
 * or press + to add a block below with the command menu open.
 */
export function BlockHandle({ editor }: { editor: Editor | null }) {
  const [hit, setHit] = useState<Hit | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editor) return
    const layer = box.current
    const surface = layer?.parentElement
    if (!layer || !surface) return
    const onMove = (e: MouseEvent) => {
      if (!editor.isEditable) return
      if ((e.target as HTMLElement).closest('.block-handle')) return
      const b = blockAt(editor, e.clientX, e.clientY)
      if (!b) { setHit(null); return }
      // the layer sits at the top left of the text; the handle is placed relative to it
      const s = layer.getBoundingClientRect()
      const r = b.dom.getBoundingClientRect()
      // line the handle up with the first line of text, not the block's top margin
      const line = parseFloat(getComputedStyle(b.dom).lineHeight) || 24
      const first = Math.min(r.height, line)
      setHit({ pos: b.pos, dom: b.dom, top: r.top - s.top + Math.max(0, (first - 24) / 2), left: r.left - s.left })
    }
    const onLeave = (e: MouseEvent) => { if (!surface.contains(e.relatedTarget as Node | null)) setHit(null) }
    surface.addEventListener('mousemove', onMove)
    surface.addEventListener('mouseleave', onLeave)
    const clear = () => setHit(null)
    editor.on('update', clear)
    return () => { surface.removeEventListener('mousemove', onMove); surface.removeEventListener('mouseleave', onLeave); editor.off('update', clear) }
  }, [editor])

  const select = () => {
    if (!editor || !hit) return null
    const sel = NodeSelection.create(editor.state.doc, hit.pos)
    editor.view.dispatch(editor.state.tr.setSelection(sel))
    return sel
  }

  const onDragStart = (e: DragEvent) => {
    if (!editor || !hit) return
    const sel = select()
    if (!sel) return
    const slice = sel.content()
    const { dom, text } = editor.view.serializeForClipboard(slice)
    e.dataTransfer.clearData()
    e.dataTransfer.setData('text/html', dom.innerHTML)
    e.dataTransfer.setData('text/plain', text)
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setDragImage(hit.dom, 0, 0)
    // ProseMirror's own drop handling moves the selected block when it finds this
    editor.view.dragging = { slice, move: true }
  }

  const add = () => {
    if (!editor || !hit) return
    const node = editor.state.doc.nodeAt(hit.pos)
    if (!node) return
    if (node.type.name === 'paragraph' && node.content.size === 0) {
      editor.chain().focus().setTextSelection(hit.pos + 1).insertContent('/').run()
      return
    }
    const at = hit.pos + node.nodeSize
    editor.chain().focus().insertContentAt(at, { type: 'paragraph' }).setTextSelection(at + 1).insertContent('/').run()
  }

  return (
    <div ref={box} className="block-handle-layer">
      {hit && editor?.isEditable && (
        <div className="block-handle" style={{ top: hit.top, left: hit.left }} contentEditable={false}>
          <button type="button" className="icon-btn" title="Add a block below" onMouseDown={(e) => e.preventDefault()} onClick={add}><Plus size={15} /></button>
          <button type="button" className="icon-btn grip" title="Drag to move. Click to select the block." draggable
            onDragStart={onDragStart} onDragEnd={() => setHit(null)}
            onClick={() => { select(); editor?.commands.focus() }}><GripVertical size={15} /></button>
        </div>
      )}
    </div>
  )
}
