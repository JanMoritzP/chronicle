import { Extension } from '@tiptap/core'
import { NodeSelection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

const ITEMS = new Set(['listItem', 'taskItem'])

/** The block the cursor is in that moving should act on: the list item when inside a list, otherwise the block at the top of the page. */
function movable(state: EditorState): { pos: number; depth: number } | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.$from.depth === 0) return { pos: sel.from, depth: 0 }
  const $from = sel.$from
  for (let d = $from.depth; d > 0; d--) {
    if (ITEMS.has($from.node(d).type.name)) return { pos: $from.before(d), depth: d - 1 }
  }
  return $from.depth >= 1 ? { pos: $from.before(1), depth: 0 } : null
}

function move(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, dir: -1 | 1): boolean {
  const at = movable(state)
  if (!at) return false
  const $pos = state.doc.resolve(at.pos)
  const parent = $pos.parent
  const index = $pos.index()
  const node = parent.child(index)
  const other = index + dir
  if (other < 0 || other >= parent.childCount) return true // at the edge: swallow the key so the cursor does not jump
  if (!dispatch) return true
  const sibling = parent.child(other)
  const sel = state.selection
  const offset = sel.from - at.pos
  const tr = state.tr
  // swap the block with its neighbour
  const from = dir < 0 ? at.pos - sibling.nodeSize : at.pos
  tr.replaceWith(from, from + node.nodeSize + sibling.nodeSize, dir < 0 ? [node, sibling] : [sibling, node])
  const start = dir < 0 ? from : from + sibling.nodeSize
  if (sel instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, start))
  else tr.setSelection(TextSelection.create(tr.doc, start + offset, start + offset + Math.max(0, Math.min(sel.to, at.pos + node.nodeSize - 1) - sel.from)))
  dispatch(tr.scrollIntoView())
  return true
}

/** Alt+Up and Alt+Down move the current block (or list item) past its neighbour. */
export const BlockMove = Extension.create({
  name: 'blockMove',
  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp': () => move(this.editor.state, this.editor.view.dispatch, -1),
      'Alt-ArrowDown': () => move(this.editor.state, this.editor.view.dispatch, 1),
    }
  },
})
