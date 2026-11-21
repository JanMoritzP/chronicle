// The words of a page as plain text, for sending them somewhere that has no formatting (a handout, a recap).

const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'taskItem', 'tableRow'])

function walk(n: any, out: string[]): void {
  if (!n || typeof n !== 'object') return
  if (typeof n.text === 'string') { out.push(n.text); return }
  if (n.type === 'hardBreak') { out.push('\n'); return }
  const start = out.length
  if (n.type === 'listItem' || n.type === 'taskItem') out.push('• ')
  for (const c of Array.isArray(n.content) ? n.content : []) {
    if (n.type === 'tableRow' && out.length > start && !String(out[out.length - 1]).endsWith(' | ')) out.push(' | ')
    walk(c, out)
  }
  if (BLOCKS.has(n.type) && out.length > start) out.push('\n')
}

/** Plain text of a page's content: one line per paragraph, heading or list item, blank lines dropped, cut at `max` characters. */
export function docText(doc: unknown, max = 20000): string {
  const out: string[] = []
  walk(doc, out)
  return out.join('').replace(/\n{2,}/g, '\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, max)
}
