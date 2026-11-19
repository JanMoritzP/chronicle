import * as Y from 'yjs'
import type { DocNode } from './doc.js'

/**
 * Converts between stored TipTap JSON and the Yjs structure the editor's collaboration extension keeps
 * (an XmlFragment named "default": nodes are XmlElements with attributes, runs of text are XmlTexts with marks as formatting).
 * Mirrors @tiptap/y-tiptap without needing a ProseMirror schema on the server.
 */
export const FRAGMENT = 'default'

function textRun(run: DocNode[]): Y.XmlText {
  const t = new Y.XmlText()
  t.applyDelta(run.map((n) => {
    const attributes: Record<string, Record<string, unknown>> = {}
    for (const m of n.marks ?? []) attributes[m.type] = m.attrs ?? {}
    return { insert: n.text ?? '', attributes }
  }))
  return t
}

function toY(list: DocNode[]): (Y.XmlElement | Y.XmlText)[] {
  const out: (Y.XmlElement | Y.XmlText)[] = []
  let run: DocNode[] = []
  const flush = () => { if (run.length) out.push(textRun(run)); run = [] }
  for (const n of list) {
    if (n.type === 'text') { if (n.text) run.push(n); continue }
    flush()
    const el = new Y.XmlElement(n.type ?? 'paragraph')
    for (const [k, v] of Object.entries(n.attrs ?? {})) if (v !== null && v !== undefined) el.setAttribute(k, v)
    const kids = toY(n.content ?? [])
    if (kids.length) el.insert(0, kids)
    out.push(el)
  }
  flush()
  return out
}

export function seedFragment(doc: Y.Doc, json: DocNode) {
  const frag = doc.getXmlFragment(FRAGMENT)
  doc.transact(() => {
    const kids = toY(json.content ?? [])
    if (kids.length) frag.insert(0, kids)
  })
}

function fromY(parent: Y.XmlFragment | Y.XmlElement): DocNode[] {
  const out: DocNode[] = []
  for (const c of parent.toArray()) {
    if (c instanceof Y.XmlText) {
      for (const d of c.toDelta() as { insert: unknown; attributes?: Record<string, any> }[]) {
        if (typeof d.insert !== 'string' || !d.insert) continue
        const node: DocNode = { type: 'text', text: d.insert }
        const marks = Object.entries(d.attributes ?? {}).map(([k, v]) => ({
          type: k.split('--')[0],
          ...(v && typeof v === 'object' && Object.keys(v).length ? { attrs: v as Record<string, any> } : {}),
        }))
        if (marks.length) node.marks = marks
        out.push(node)
      }
    } else if (c instanceof Y.XmlElement) {
      const node: DocNode = { type: c.nodeName }
      const attrs = c.getAttributes()
      if (Object.keys(attrs).length) node.attrs = attrs
      const content = fromY(c)
      if (content.length) node.content = content
      out.push(node)
    }
  }
  return out
}

export function fragmentToDoc(doc: Y.Doc): DocNode {
  return { type: 'doc', content: fromY(doc.getXmlFragment(FRAGMENT)) }
}

/** Finds the marker (a todo, or a comment with `type`) with this id in a live document and changes its attributes, or removes it with `change` null. */
export function editTodoIn(doc: Y.Doc, todoId: string, change: Record<string, any> | null, type = 'todo'): boolean {
  let hit = false
  const walk = (parent: Y.XmlFragment | Y.XmlElement) => {
    const kids = parent.toArray()
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i]
      if (!(c instanceof Y.XmlElement)) continue
      if (c.nodeName === type && c.getAttribute('id') === todoId) {
        hit = true
        if (change) for (const [k, v] of Object.entries(change)) c.setAttribute(k, v)
        else parent.delete(i, 1)
      } else walk(c)
    }
  }
  doc.transact(() => walk(doc.getXmlFragment(FRAGMENT)))
  return hit
}
