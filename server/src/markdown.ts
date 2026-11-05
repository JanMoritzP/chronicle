import type { DocNode } from './doc.js'

export interface MdContext {
  /** Prefix that leads from the exported page file back to the archive root, e.g. "../". */
  root: string
  /** Upload id → file name inside images/, for uploads that made it into the archive. */
  images: Map<string, string>
  /** Page id → current title, so links keep working after a page was renamed. */
  titles?: Map<string, string>
}

const UPLOAD_URL = /^\/api\/uploads\/([0-9a-f-]{36})$/

const esc = (s: string) => s.replace(/[\\*_`\[\]<]/g, (c) => '\\' + c)

function wrap(text: string, marks: NonNullable<DocNode['marks']>): string {
  if (!text.trim()) return text
  const lead = /^\s*/.exec(text)![0]
  const trail = /\s*$/.exec(text)![0]
  let core = text.slice(lead.length, text.length - trail.length)
  for (const m of marks) {
    switch (m.type) {
      case 'bold': core = `**${core}**`; break
      case 'italic': core = `*${core}*`; break
      case 'strike': core = `~~${core}~~`; break
      case 'highlight': core = `==${core}==`; break
      case 'underline': core = `<u>${core}</u>`; break
      case 'link': core = `[${core}](${m.attrs?.href ?? ''})`; break
    }
  }
  return lead + core + trail
}

export function wikiSyntax(a: Record<string, any>, embed = false, titles?: Map<string, string>) {
  const name = String((a.pageId && titles?.get(a.pageId)) || a.name || '')
  const target = `${name}${a.anchorText ? `#${a.anchorText}` : ''}`
  const alias = !embed && a.alias ? `|${a.alias}` : ''
  return `${embed ? '!' : ''}[[${target}${alias}]]`
}

function inline(nodes: DocNode[] | undefined, ctx: MdContext): string {
  return (nodes ?? []).map((n) => {
    switch (n.type) {
      case 'text': {
        const marks = n.marks ?? []
        const code = marks.some((m) => m.type === 'code')
        const text = code ? '`' + (n.text ?? '') + '`' : esc(n.text ?? '')
        return wrap(text, marks.filter((m) => m.type !== 'code'))
      }
      case 'hardBreak': return '  \n'
      case 'wikilink': return wikiSyntax(n.attrs ?? {}, false, ctx.titles)
      case 'image': return image(n, ctx)
      case 'todo': return n.attrs?.done ? `**DONE:** ~~${esc(String(n.attrs?.message ?? ''))}~~` : `**TODO:** ${esc(String(n.attrs?.message ?? ''))}`
      default: return inline(n.content, ctx)
    }
  }).join('')
}

function image(n: DocNode, ctx: MdContext) {
  const src = String(n.attrs?.src ?? '')
  const m = UPLOAD_URL.exec(src)
  const file = m ? ctx.images.get(m[1]) : undefined
  return `![${esc(String(n.attrs?.alt ?? ''))}](${file ? ctx.root + 'images/' + file : src})`
}

function list(node: DocNode, ctx: MdContext): string[] {
  const out: string[] = []
  const items = node.content ?? []
  items.forEach((item, i) => {
    let marker = node.type === 'orderedList' ? `${(node.attrs?.start ?? 1) + i}. ` : '- '
    if (node.type === 'taskList') marker = `- [${item.attrs?.checked ? 'x' : ' '}] `
    const body = blocks(item.content, ctx)
    const pad = ' '.repeat(marker.length)
    body.forEach((l, j) => out.push(j === 0 ? marker + l : l ? pad + l : ''))
    if (!body.length) out.push(marker.trimEnd())
  })
  return out
}

function table(node: DocNode, ctx: MdContext): string[] {
  const rows = (node.content ?? []).map((r) =>
    (r.content ?? []).map((c) => blocks(c.content, ctx).filter(Boolean).join(' ').replace(/\|/g, '\\|') || ' '))
  if (!rows.length) return []
  const width = Math.max(...rows.map((r) => r.length))
  const pad = (r: string[]) => { while (r.length < width) r.push(' '); return `| ${r.join(' | ')} |` }
  return [pad(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(pad)]
}

function block(n: DocNode, ctx: MdContext): string[] {
  switch (n.type) {
    case 'paragraph': return inline(n.content, ctx).split('\n')
    case 'heading': return ['#'.repeat(Math.min(6, n.attrs?.level ?? 1)) + ' ' + inline(n.content, ctx)]
    case 'bulletList': case 'orderedList': case 'taskList': return list(n, ctx)
    case 'blockquote': return blocks(n.content, ctx).map((l) => (l ? '> ' + l : '>'))
    case 'codeBlock': return ['```' + (n.attrs?.language ?? ''), ...(n.content ?? []).map((c) => c.text ?? '').join('').split('\n'), '```']
    case 'horizontalRule': return ['---']
    case 'image': return [image(n, ctx)]
    case 'table': return table(n, ctx)
    case 'embed': return [wikiSyntax(n.attrs ?? {}, true, ctx.titles)]
    case 'statblock': {
      const a = n.attrs ?? {}
      const data = (a.data ?? {}) as Record<string, string>
      const lines = Object.entries(data).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ' ')}`)
      return ['```statblock ' + (a.template ?? ''), ...lines, '```']
    }
    default: return blocks(n.content, ctx)
  }
}

function blocks(nodes: DocNode[] | undefined, ctx: MdContext): string[] {
  const out: string[] = []
  for (const n of nodes ?? []) {
    const lines = block(n, ctx)
    if (!lines.length) continue
    if (out.length) out.push('')
    out.push(...lines)
  }
  return out
}

export function docToMarkdown(doc: DocNode, ctx: MdContext): string {
  return blocks(doc.content, ctx).join('\n').trimEnd() + '\n'
}
