/**
 * Markdown (CommonMark plus what note apps add: Obsidian wikilinks, embeds, callouts, highlights, tags and comments,
 * Logseq properties and block references, GitHub tables and task lists) to HTML that the editor's schema reads.
 * Pure string work, so it also runs in tests without a browser.
 */

export interface InlineHooks {
  /** [[target#anchor|alias]] */
  wikilink(target: string, alias: string | null, anchor: string | null): string
  /** ![[target]]: a picture or a page to embed */
  embed(target: string, size: number | null): string
  /** ![alt](src) */
  image(src: string, alt: string): string
  /** [text](href): may become a link to another imported page */
  link(href: string, textHtml: string): string
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const TAG = /(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu

/** Tags written in the text (#tag, #nested/tag), not counting numbers like #1. */
export function inlineTags(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.replace(/`[^`]*`/g, '').matchAll(TAG)) if (!/^\d+$/.test(m[2])) out.add(m[2].toLowerCase())
  return [...out]
}

export function inline(src: string, hooks: InlineHooks): string {
  const held: string[] = []
  const hold = (html: string) => `\u0000${held.push(html) - 1}\u0000`
  let s = src
    // Logseq block references and embeds of blocks have no meaning outside Logseq
    .replace(/\{\{embed \(\([^)]*\)\)\}\}/g, '')
    .replace(/\(\([0-9a-f-]{36}\)\)/g, '')
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_m, _t, code) => hold(`<code>${esc(code.trim())}</code>`))
  s = s.replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target, opt) => {
    const size = opt && /^\d+(x\d+)?$/.test(opt.trim()) ? Number(opt.trim().split('x')[0]) : null
    return hold(hooks.embed(target.trim(), size))
  })
  s = s.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_m, alt, url) => hold(hooks.image(url, alt)))
  s = s.replace(/\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g, (_m, target, anchor, alias) =>
    hold(hooks.wikilink(target.trim(), alias?.trim() || null, anchor?.trim() || null)))
  s = s.replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_m, text, url) => hold(hooks.link(url, inline(text, hooks))))
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_m, url) => hold(`<a href="${esc(url)}">${esc(url)}</a>`))
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)\]]+[^\s<)\].,;:!?'"])/g, (_m, pre, url) => pre + hold(`<a href="${esc(url)}">${esc(url)}</a>`))
  s = esc(s)
  s = s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>')
    .replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>')
    .replace(/\^\^(?=\S)([\s\S]*?\S)\^\^/g, '<mark>$1</mark>')
    .replace(/\\([\\`*_{}[\]()#+\-.!|~=])/g, '$1')
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => held[Number(i)])
}

const CALLOUT_KIND: Record<string, string> = {
  warning: 'warning', caution: 'warning', attention: 'warning', danger: 'warning', error: 'warning', bug: 'warning', failure: 'warning', fail: 'warning', missing: 'warning',
  quote: 'aloud', cite: 'aloud', aloud: 'aloud', boxed: 'aloud',
  secret: 'secret', gm: 'secret', dm: 'secret', spoiler: 'secret', hidden: 'secret',
}
export const calloutKind = (type: string) => CALLOUT_KIND[type.toLowerCase()] ?? 'info'

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/
const indentOf = (l: string) => l.replace(/\t/g, '    ').match(/^ */)![0].length
const dedent = (l: string, n: number) => { let i = 0, w = 0; while (i < l.length && w < n && (l[i] === ' ' || l[i] === '\t')) { w += l[i] === '\t' ? 4 : 1; i++ } return l.slice(i) }

function cells(row: string): string[] {
  const t = row.trim().replace(/^\|/, '').replace(/\|$/, '')
  const out: string[] = []
  let cur = '', code = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue }
    if (c === '`') code = !code
    if (c === '|' && !code) { out.push(cur.trim()); cur = '' } else cur += c
  }
  out.push(cur.trim())
  return out
}

/** Markdown blocks to HTML. */
export function blocks(src: string, hooks: InlineHooks): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []
  const flush = () => {
    if (!para.length) return
    out.push(`<p>${para.map((l) => inline(l.trim(), hooks)).join('<br>')}</p>`)
    para = []
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { flush(); i++; continue }
    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const mark = fence[2]
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(mark)) body.push(dedent(lines[i++], fence[1].length))
      i++
      out.push(`<pre><code${fence[3] ? ` class="language-${esc(fence[3])}"` : ''}>${esc(body.join('\n'))}</code></pre>`)
      continue
    }
    const h = HEADING.exec(line)
    if (h && indentOf(line) < 4) {
      flush()
      out.push(`<h${Math.min(4, h[1].length)}>${inline(h[2], hooks)}</h${Math.min(4, h[1].length)}>`)
      i++
      continue
    }
    if (para.length && /^\s*(=+|-+)\s*$/.test(line)) {
      // a setext heading: the paragraph above is its text
      const level = line.trim().startsWith('=') ? 1 : 2
      out.push(`<h${level}>${para.map((l) => inline(l.trim(), hooks)).join(' ')}</h${level}>`)
      para = []
      i++
      continue
    }
    if (RULE.test(line) && !para.length) { out.push('<hr>'); i++; continue }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush()
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      const tr = (r: string[], tag: string) => `<tr>${head.map((_, c) => `<${tag}><p>${inline(r[c] ?? '', hooks)}</p></${tag}>`).join('')}</tr>`
      out.push(`<table><tbody>${tr(head, 'th')}${rows.map((r) => tr(r, 'td')).join('')}</tbody></table>`)
      continue
    }
    if (/^\s{0,3}>/.test(line)) {
      flush()
      const quoted: string[] = []
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s{0,3}> ?/, ''))
      const head = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/.exec(quoted[0] ?? '')
      if (head) {
        const title = head[3].trim()
        const body = blocks(quoted.slice(1).join('\n'), hooks)
        const inner = `${title ? `<p><strong>${inline(title, hooks)}</strong></p>` : ''}${body}` || '<p></p>'
        if (head[2] && calloutKind(head[1]) === 'info') out.push(`<div data-fold data-title="${esc(title || head[1])}">${body || '<p></p>'}</div>`)
        else out.push(`<div data-callout data-kind="${calloutKind(head[1])}">${inner}</div>`)
      } else out.push(`<blockquote>${blocks(quoted.join('\n'), hooks) || '<p></p>'}</blockquote>`)
      continue
    }
    const li = LIST.exec(line)
    if (li && (!para.length || li[2] === '-' || li[2] === '*' || li[2] === '+' || li[2] === '1.' || li[2] === '1)')) {
      flush()
      const start = i
      const base = indentOf(line)
      i++
      // the list goes on through blank lines while the next line is still a list item or indented under one
      while (i < lines.length) {
        const l = lines[i]
        if (!l.trim()) {
          const next = lines.slice(i + 1).find((x) => x.trim())
          if (next === undefined || (indentOf(next) <= base && !LIST.test(next))) break
          i++
          continue
        }
        if (indentOf(l) < base) break
        if (indentOf(l) === base && !LIST.test(l) && !lines[i - 1].trim()) break
        if (FENCE.test(l) && indentOf(l) <= base) break
        if (HEADING.test(l) && indentOf(l) <= base) break
        i++
      }
      out.push(list(lines.slice(start, i), hooks))
      continue
    }
    para.push(line)
    i++
  }
  flush()
  return out.join('')
}

/** One list (all lines that belong to it, the first being an item) with nested lists by indentation. */
function list(lines: string[], hooks: InlineHooks): string {
  const first = LIST.exec(lines[0])!
  const base = indentOf(lines[0])
  const ordered = /\d/.test(first[2])
  const items: { text: string; rest: string[] }[] = []
  for (const l of lines) {
    const m = LIST.exec(l)
    if (m && indentOf(l) === base) items.push({ text: m[4], rest: [] })
    else items[items.length - 1]?.rest.push(l)
  }
  const task = (t: string) => /^\[( |x|X)\]\s?/.exec(t)
  const isTasks = items.length > 0 && items.every((it) => task(it.text))
  const body = items.map((it) => {
    const t = task(it.text)
    const text = isTasks && t ? it.text.slice(t[0].length) : it.text
    // continuation lines of the item's own text, then whatever is indented under it
    const cont: string[] = []
    let k = 0
    while (k < it.rest.length && it.rest[k].trim() && !LIST.test(it.rest[k]) && !FENCE.test(it.rest[k])) cont.push(it.rest[k++].trim())
    const width = Math.min(...it.rest.slice(k).filter((r) => r.trim()).map(indentOf), Infinity)
    const nested = it.rest.slice(k).map((r) => dedent(r, Number.isFinite(width) ? width : 0)).join('\n')
    const own = [text, ...cont].filter((x) => x.trim())
    const inner = `${own.length ? `<p>${own.map((x) => inline(x, hooks)).join('<br>')}</p>` : '<p></p>'}${nested.trim() ? blocks(nested, hooks) : ''}`
    return isTasks ? `<li data-type="taskItem" data-checked="${t![1] !== ' '}">${inner}</li>` : `<li>${inner}</li>`
  }).join('')
  if (isTasks) return `<ul data-type="taskList">${body}</ul>`
  const start = ordered ? parseInt(first[2], 10) : 1
  return ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>${body}</ol>` : `<ul>${body}</ul>`
}

/** Splits YAML front matter off the top of a note. */
export function frontMatter(src: string): { yaml: string | null; body: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n(---|\.\.\.)\s*(\r?\n|$)/.exec(src)
  return m ? { yaml: m[1], body: src.slice(m[0].length) } : { yaml: null, body: src.replace(/^﻿/, '') }
}

/** Logseq writes page properties as `key:: value` lines at the top, and block properties under each bullet. */
export function logseqProperties(src: string): { props: Record<string, string>; body: string } {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const props: Record<string, string> = {}
  let k = 0
  while (k < lines.length && /^[\w-]+::/.test(lines[k].replace(/^-\s+/, '').trim())) {
    const m = /^([\w-]+)::\s*(.*)$/.exec(lines[k].replace(/^-\s+/, '').trim())!
    props[m[1].toLowerCase()] = m[2]
    k++
  }
  // properties further down belong to blocks (ids, collapsed state); they mean nothing outside Logseq
  const body = lines.slice(k).filter((l) => !/^\s*(-\s+)?(id|collapsed|heading|background-color)::/.test(l)).join('\n')
  return { props, body }
}

/** Obsidian comments (%% … %%) and HTML comments are notes to the writer: left out. */
export const stripComments = (s: string) => s.replace(/%%[\s\S]*?%%/g, '').replace(/<!--[\s\S]*?-->/g, '')
