import crypto from 'node:crypto'
export interface DocNode {
  type?: string
  text?: string
  attrs?: Record<string, any>
  content?: DocNode[]
  marks?: { type: string; attrs?: Record<string, any> }[]
}

export interface ExtractedLink {
  targetId: string | null
  targetName: string
  anchor: string | null
  embed: boolean
}

export interface Extracted {
  text: string
  outline: { id: string; level: number; text: string }[]
  links: ExtractedLink[]
  wordCount: number
  hasStats: boolean
  firstImage: string | null
}

// Blocks that directly hold inline content; containers (lists, quotes, tables) are recursed into instead.
const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])

function plain(node: DocNode, skipTodos = false): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'wikilink') return node.attrs?.alias || node.attrs?.name || ''
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'todo') return skipTodos ? '' : String(node.attrs?.message ?? '')
  return (node.content ?? []).map((c) => plain(c, skipTodos)).join('')
}

/** Copy of a document that can be stored as a template: heading and todo ids are dropped (every insertion gets fresh ones) and todos are reset to open. */
export function templateDoc(doc: DocNode): DocNode {
  const walk = (n: DocNode): DocNode => {
    const out: DocNode = { ...n }
    if (n.attrs) {
      out.attrs = { ...n.attrs }
      if (n.type === 'heading' || n.type === 'todo') delete out.attrs.id
      if (n.type === 'todo') out.attrs.done = false
    }
    if (n.content) out.content = n.content.map(walk)
    return out
  }
  return walk(doc)
}

export interface ExtractedTodo { id: string; message: string; done: boolean; context: string }

/** Todo markers in document order, each with the text of the paragraph it sits in (minus the marker itself). */
export function extractTodos(doc: DocNode): ExtractedTodo[] {
  const out: ExtractedTodo[] = []
  const seen = new Set<string>()
  const walk = (n: DocNode, block?: DocNode) => {
    if (n.type === 'todo') {
      const id = n.attrs?.id ? String(n.attrs.id) : ''
      if (id && !seen.has(id)) {
        seen.add(id)
        const context = block ? plain(block, true).replace(/\s+/g, ' ').trim().slice(0, 240) : ''
        out.push({ id, message: String(n.attrs?.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 500), done: !!n.attrs?.done, context })
      }
      return
    }
    const b = n.type && TEXT_BLOCKS.has(n.type) ? n : block
    for (const c of n.content ?? []) walk(c, b)
  }
  walk(doc)
  return out
}

export function extract(doc: DocNode): Extracted {
  const parts: string[] = []
  const outline: Extracted['outline'] = []
  const links: ExtractedLink[] = []
  let hasStats = false
  let firstImage: string | null = null

  const walk = (n: DocNode) => {
    if (n.type === 'statblock') hasStats = true
    if (n.type === 'image' && !firstImage && n.attrs?.src) firstImage = String(n.attrs.src)
    if (n.type === 'wikilink' || n.type === 'embed') {
      links.push({
        targetId: n.attrs?.pageId ?? null,
        targetName: String(n.attrs?.name ?? ''),
        anchor: n.attrs?.anchor ?? null,
        embed: n.type === 'embed',
      })
    }
    if (n.type === 'heading') {
      const t = plain(n).trim()
      if (t) outline.push({ id: n.attrs?.id ?? '', level: n.attrs?.level ?? 1, text: t })
    }
    if (n.type && TEXT_BLOCKS.has(n.type)) parts.push(plain(n))
    for (const c of n.content ?? []) walk(c)
  }
  walk(doc)

  const text = parts.join('\n').trim()
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0
  return { text, outline, links, wordCount, hasStats, firstImage }
}

/** Gives every heading a stable id so {{Page#Section}} links and embeds always have an anchor, and every todo marker one so it can be found again. Mutates and returns the doc. */
export function ensureHeadingIds(doc: DocNode): DocNode {
  const seen = new Set<string>()
  const walk = (n: DocNode) => {
    if (n.type === 'heading' || n.type === 'todo') {
      const cur = n.attrs?.id
      if (!cur || seen.has(cur)) n.attrs = { ...(n.attrs ?? {}), id: crypto.randomUUID() }
      seen.add(n.attrs!.id)
    }
    n.content?.forEach(walk)
  }
  walk(doc)
  return doc
}

/** Section of a document: the heading with `anchor` and everything up to the next heading of the same or higher rank. */
export function sliceSection(doc: DocNode, anchor: string | null | undefined): DocNode {
  if (!anchor || !doc.content) return doc
  const nodes = doc.content
  const i = nodes.findIndex((n) => n.type === 'heading' && n.attrs?.id === anchor)
  if (i < 0) return doc
  const level = nodes[i].attrs?.level ?? 1
  let j = i + 1
  while (j < nodes.length && !(nodes[j].type === 'heading' && (nodes[j].attrs?.level ?? 1) <= level)) j++
  return { type: 'doc', content: nodes.slice(i, j) }
}

export const emptyDoc = () => ({ type: 'doc', content: [{ type: 'paragraph' }] })



