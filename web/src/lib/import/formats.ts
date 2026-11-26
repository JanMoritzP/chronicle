import { parse as parseYaml } from 'yaml'
import { bbcodeToHtml, looksLikeBbcode } from './bbcode'
import { blocks, esc, frontMatter, inline, inlineTags, logseqProperties, stripComments, type InlineHooks } from './markdown'

/**
 * Works out what a pile of files is (an Obsidian vault, a Notion export, a Logseq graph, World Anvil or LegendKeeper
 * exports, Roam JSON, HTML pages, plain Markdown or text) and plans the pages it becomes. Nothing is sent anywhere
 * here; `run.ts` carries the plan out.
 */

export interface SourceFile { path: string; read: () => Promise<Uint8Array> }

export type FormatId = 'obsidian' | 'logseq' | 'notion' | 'worldanvil' | 'legendkeeper' | 'roam' | 'html' | 'markdown' | 'json' | 'text'
export const FORMAT_LABEL: Record<FormatId, string> = {
  obsidian: 'Obsidian vault', logseq: 'Logseq graph', notion: 'Notion export', worldanvil: 'World Anvil export',
  legendkeeper: 'LegendKeeper export', roam: 'Roam Research export', html: 'HTML pages', markdown: 'Markdown files', json: 'JSON export', text: 'Text files',
}

/** How a page's text refers to other things; resolved once every page has its id. */
export interface Resolver {
  /** a page by the name or path a link uses; null when the import has no such page */
  page(target: string, from: string): { id: string; title: string } | null
  /** the address of an uploaded picture, by the path or name the text uses; null when it is not in the import */
  picture(ref: string, from: string): Promise<string | null>
}

export interface PlannedPage {
  /** where it came from, unique in the plan */
  key: string
  title: string
  folder: string[]
  tags: string[]
  aliases: string[]
  /** other names links may use for this page (file name, path without extension, an id from the source app) */
  linkNames: string[]
  html: (r: Resolver) => Promise<string>
}

export interface Plan {
  format: FormatId
  pages: PlannedPage[]
  /** pictures by their path in the import */
  pictures: Map<string, SourceFile>
  skipped: { path: string; reason: string }[]
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i
const UPLOADABLE = /\.(png|jpe?g|gif|webp|avif)$/i
const IGNORE_DIR = /(^|\/)(\.obsidian|\.trash|\.git|\.github|node_modules|__MACOSX|logseq\/bak|logseq\/\.recycle|\.DS_Store)(\/|$)/
const NOTION_ID = /\s+[0-9a-f]{32}$/i

const decoder = new TextDecoder('utf-8')
const text = async (f: SourceFile) => decoder.decode(await f.read())
const base = (p: string) => p.split('/').pop() ?? p
const dir = (p: string) => p.split('/').slice(0, -1)
const noExt = (p: string) => p.replace(/\.[^./]+$/, '')
const clean = (s: string) => s.replace(NOTION_ID, '').trim()

/** Joins a relative path to the folder of the file it was written in. */
export function joinPath(fromFile: string, rel: string): string {
  const parts = rel.startsWith('/') ? [] : dir(fromFile)
  for (const seg of rel.replace(/^\/+/, '').split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

const safeDecode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

/** The common top folder of an export (a zip usually holds one folder) is left out of the folders made. */
function commonRoot(paths: string[]): string[] {
  if (!paths.length) return []
  const split = paths.map((p) => dir(p))
  const first = split[0]
  let n = 0
  while (n < first.length && split.every((s) => s[n] === first[n])) n++
  return first.slice(0, n)
}

export function detect(files: SourceFile[]): FormatId {
  const paths = files.map((f) => f.path)
  if (paths.some((p) => /(^|\/)\.obsidian\//.test(p))) return 'obsidian'
  if (paths.some((p) => /(^|\/)logseq\/config\.edn$/.test(p)) || (paths.some((p) => /(^|\/)pages\/[^/]+\.md$/.test(p)) && paths.some((p) => /(^|\/)journals\/\d{4}_\d{2}_\d{2}\.md$/.test(p)))) return 'logseq'
  if (paths.some((p) => NOTION_ID.test(noExt(base(p))))) return 'notion'
  if (paths.some((p) => /\.lk$/i.test(p))) return 'legendkeeper'
  const md = paths.filter((p) => /\.(md|markdown)$/i.test(p)).length
  const html = paths.filter((p) => /\.html?$/i.test(p)).length
  const json = paths.filter((p) => /\.json$/i.test(p)).length
  if (md && md >= html) return 'markdown'
  if (html) return 'html'
  if (json) return 'json'
  return 'text'
}

/** A JSON export, looked at more closely: World Anvil, Roam, LegendKeeper or something else with titles and text. */
function jsonKind(data: unknown): FormatId {
  if (Array.isArray(data) && data.length && data.every((x) => x && typeof x === 'object' && 'title' in x && ('children' in x || 'create-time' in x || 'edit-time' in x))) return 'roam'
  const s = JSON.stringify(data).slice(0, 200000)
  if (/"(entityClass|templateType|sidebarcontent|worldanvil|world_anvil)"/i.test(s) || /@\[[^\]]+\]\([\w-]+:[\w-]+\)/.test(s)) return 'worldanvil'
  if (/"(resources|documents)"\s*:\s*\[/.test(s) && /legendkeeper|"pos"|"isHidden"|"banner"/i.test(s)) return 'legendkeeper'
  return 'json'
}

/** Front matter values as a list of words: YAML lists, comma lists or one word. */
function words(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(words)
  if (typeof v === 'string') return v.split(/,\s*/).map((x) => x.trim().replace(/^#/, '').replace(/^\[\[(.*)\]\]$/, '$1')).filter(Boolean)
  if (typeof v === 'number') return [String(v)]
  return []
}

const SKIP_PROPS = new Set(['tags', 'tag', 'aliases', 'alias', 'title', 'cssclass', 'cssclasses', 'publish', 'permalink', 'position', 'id', 'public', 'filters'])

/** Front matter or page properties that are not tags or names stay readable as a small table at the top. */
function propsTable(props: Record<string, unknown>, hooks: InlineHooks): string {
  const rows = Object.entries(props).filter(([k, v]) => !SKIP_PROPS.has(k.toLowerCase()) && v !== null && v !== undefined && v !== '' && (typeof v !== 'object' || Array.isArray(v)))
  if (!rows.length) return ''
  const cell = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).join(', ') : String(v))
  return `<table><tbody>${rows.map(([k, v]) => `<tr><th><p>${esc(k)}</p></th><td><p>${inline(cell(v), hooks)}</p></td></tr>`).join('')}</tbody></table>`
}

/** Hooks that turn links and pictures in the text into the editor's nodes, through the resolver. */
function hooksFor(r: Resolver, from: string, pending: Promise<unknown>[], pics: Map<string, string | null>): InlineHooks {
  const pic = (ref: string) => {
    const key = ref
    if (!pics.has(key)) {
      pics.set(key, null)
      pending.push(r.picture(ref, from).then((url) => { pics.set(key, url) }))
    }
    return `\u0001PIC:${encodeURIComponent(key)}\u0001`
  }
  const link = (target: string, alias: string | null, anchor: string | null) => {
    const hit = r.page(target, from)
    const shown = alias ?? (anchor ? `${target} › ${anchor}` : null)
    if (!hit) return `<span data-wikilink name="${esc(target)}"${shown ? ` alias="${esc(shown)}"` : ''}>${esc(shown ?? target)}</span>`
    return `<span data-wikilink name="${esc(hit.title)}" pageid="${hit.id}"${shown ? ` alias="${esc(shown)}"` : ''}>${esc(shown ?? hit.title)}</span>`
  }
  return {
    wikilink: (t, alias, anchor) => (t ? link(t, alias, anchor) : esc(alias ?? '')),
    embed: (t, size) => {
      if (IMAGE.test(t)) return `<img src="${pic(t)}" alt=""${size ? ` data-size="${size}"` : ''}>`
      const hit = r.page(t, from)
      if (!hit) return `<p>${link(t, null, null)}</p>`
      return `<div data-embed name="${esc(hit.title)}" pageid="${hit.id}"></div>`
    },
    image: (src, alt) => (/^(https?:)?\/\//.test(src) ? `<img src="${esc(src)}" alt="${esc(alt)}">` : `<img src="${pic(safeDecode(src))}" alt="${esc(alt)}">`),
    link: (href, textHtml) => {
      if (/^(https?:|mailto:)/i.test(href)) return `<a href="${esc(href)}">${textHtml}</a>`
      // a link to another file of the export is a link to its page
      const target = safeDecode(href.split('#')[0])
      const hit = target ? r.page(target, from) : null
      if (hit) return `<span data-wikilink name="${esc(hit.title)}" pageid="${hit.id}" alias="${textHtml.replace(/<[^>]+>/g, '')}">${textHtml}</span>`
      return textHtml
    },
  }
}

/** Runs a page's conversion, then fills in the addresses of the pictures it uses (uploaded meanwhile). */
async function render(r: Resolver, from: string, make: (h: InlineHooks) => string): Promise<string> {
  const pending: Promise<unknown>[] = []
  const pics = new Map<string, string | null>()
  const html = make(hooksFor(r, from, pending, pics))
  await Promise.all(pending)
  // a picture that is not in the import is dropped, with its img tag
  return html.replace(/<img src="\u0001PIC:([^\u0001]*)\u0001"[^>]*>/g, (m, key) => {
    const url = pics.get(decodeURIComponent(key))
    return url ? m.replace(/\u0001PIC:[^\u0001]*\u0001/, url) : ''
  })
}

// ---------- plans per format ----------

function markdownPage(f: SourceFile, root: string[], format: FormatId): PlannedPage {
  const rel = f.path.split('/').slice(root.length)
  const folder = format === 'notion' ? rel.slice(0, -1).map(clean) : rel.slice(0, -1)
  const stem = noExt(base(f.path))
  let title = format === 'notion' ? clean(stem) : stem
  if (format === 'logseq') {
    // Logseq writes namespaces as a___b (newer) or a%2Fb (older) in file names, and journal days as 2024_01_31
    title = safeDecode(stem.replace(/___/g, '/'))
    if (/^\d{4}_\d{2}_\d{2}$/.test(stem)) title = stem.replace(/_/g, '-')
  }
  const page: PlannedPage = {
    key: f.path, title, folder: format === 'logseq' ? (folder[folder.length - 1] === 'journals' ? ['Journals'] : []) : folder, tags: [], aliases: [],
    linkNames: [stem, noExt(rel.join('/')), noExt(f.path), base(f.path), rel.join('/')],
    html: async () => '',
  }
  let cached: string | null = null
  const load = async () => (cached ??= await text(f))
  page.html = async (r) => {
    const raw = stripComments(await load())
    let body = raw
    let props: Record<string, unknown> = {}
    if (format === 'logseq') {
      const lp = logseqProperties(raw)
      props = lp.props
      body = lp.body
    } else {
      const fm = frontMatter(raw)
      body = fm.body
      if (fm.yaml) { try { props = (parseYaml(fm.yaml) as Record<string, unknown>) ?? {} } catch { /* unreadable front matter stays out */ } }
      // Notion puts the title as the first heading and properties as "Key: value" lines under it
      if (format === 'notion') body = body.replace(/^#\s+.*\n+/, '')
    }
    return render(r, f.path, (h) => propsTable(props, h) + blocks(body, h))
  }
  return page
}

/** Reads names and tags from the start of a Markdown file, before the pages are made. */
async function readMeta(p: PlannedPage, f: SourceFile, format: FormatId) {
  const raw = stripComments(await text(f))
  if (format === 'logseq') {
    const { props, body } = logseqProperties(raw)
    if (props.title) p.title = props.title.trim()
    p.tags = [...words(props.tags), ...inlineTags(body)]
    p.aliases = words(props.alias)
    return
  }
  const fm = frontMatter(raw)
  let props: Record<string, unknown> = {}
  if (fm.yaml) { try { props = (parseYaml(fm.yaml) as Record<string, unknown>) ?? {} } catch { /* no names from broken front matter */ } }
  if (typeof props.title === 'string' && props.title.trim()) p.title = props.title.trim()
  p.tags = [...new Set([...words(props.tags ?? props.tag), ...inlineTags(fm.body)])]
  p.aliases = words(props.aliases ?? props.alias)
}

function htmlPage(f: SourceFile, root: string[]): PlannedPage {
  const rel = f.path.split('/').slice(root.length)
  const stem = noExt(base(f.path))
  const page: PlannedPage = {
    key: f.path, title: clean(stem), folder: rel.slice(0, -1).map(clean), tags: [], aliases: [],
    linkNames: [stem, base(f.path), rel.join('/'), f.path], html: async () => '',
  }
  page.html = async (r) => {
    const doc = new DOMParser().parseFromString(await text(f), 'text/html')
    doc.querySelectorAll('script, style, noscript, iframe, object, nav, header > nav, footer').forEach((n) => n.remove())
    const body = doc.querySelector('main, article, .page-body') ?? doc.body
    // the title is shown as the page's title, not again in the text
    const h1 = body.querySelector('h1')
    if (h1 && h1.textContent?.trim() === page.title) h1.remove()
    const pending: Promise<unknown>[] = []
    for (const a of [...body.querySelectorAll('a[href]')]) {
      const href = a.getAttribute('href') ?? ''
      if (/^(https?:|mailto:|#)/i.test(href)) continue
      const hit = r.page(safeDecode(href.split('#')[0]), f.path)
      const span = doc.createElement('span')
      if (hit) { span.setAttribute('data-wikilink', ''); span.setAttribute('name', hit.title); span.setAttribute('pageid', hit.id); span.setAttribute('alias', a.textContent ?? hit.title) }
      span.textContent = a.textContent ?? ''
      a.replaceWith(span)
    }
    for (const img of [...body.querySelectorAll('img[src]')]) {
      const src = img.getAttribute('src') ?? ''
      if (/^(https?:)?\/\//.test(src)) continue
      if (src.startsWith('data:')) { img.remove(); continue }
      pending.push(r.picture(safeDecode(src), f.path).then((url) => { if (url) img.setAttribute('src', url); else img.remove() }))
    }
    await Promise.all(pending)
    return body.innerHTML
  }
  return page
}

function textPage(f: SourceFile, root: string[]): PlannedPage {
  const rel = f.path.split('/').slice(root.length)
  return {
    key: f.path, title: noExt(base(f.path)), folder: rel.slice(0, -1), tags: [], aliases: [], linkNames: [noExt(base(f.path))],
    html: async () => (await text(f)).replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''),
  }
}

/** A table from a Notion database (CSV) becomes a page holding the table. */
function csvPage(f: SourceFile, root: string[]): PlannedPage {
  const rel = f.path.split('/').slice(root.length)
  return {
    key: f.path, title: clean(noExt(base(f.path))).replace(/_all$/, ''), folder: rel.slice(0, -1).map(clean), tags: [], aliases: [], linkNames: [noExt(base(f.path))],
    html: async () => {
      const rows = parseCsv(await text(f))
      if (!rows.length) return '<p></p>'
      const tr = (r: string[], tag: string) => `<tr>${rows[0].map((_, c) => `<${tag}><p>${esc(r[c] ?? '')}</p></${tag}>`).join('')}</tr>`
      return `<table><tbody>${tr(rows[0], 'th')}${rows.slice(1).map((r) => tr(r, 'td')).join('')}</tbody></table>`
    },
  }
}

export function parseCsv(src: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', q = false
  const s = src.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim()))
}

// ---------- JSON exports ----------

/** A ProseMirror or TipTap document from another app, as HTML: the common nodes and marks, text for the rest. */
export function pmToHtml(node: any, hooks: InlineHooks): string {
  if (!node || typeof node !== 'object') return ''
  const kids = () => (Array.isArray(node.content) ? node.content.map((c: any) => pmToHtml(c, hooks)).join('') : '')
  switch (node.type) {
    case 'doc': return kids()
    case 'paragraph': return `<p>${kids()}</p>`
    case 'heading': { const l = Math.min(4, Math.max(1, Number(node.attrs?.level) || 2)); return `<h${l}>${kids()}</h${l}>` }
    case 'bulletList': case 'bullet_list': return `<ul>${kids()}</ul>`
    case 'orderedList': case 'ordered_list': return `<ol>${kids()}</ol>`
    case 'listItem': case 'list_item': return `<li>${kids()}</li>`
    case 'taskList': return `<ul data-type="taskList">${kids()}</ul>`
    case 'taskItem': return `<li data-type="taskItem" data-checked="${!!node.attrs?.checked}">${kids()}</li>`
    case 'blockquote': return `<blockquote>${kids()}</blockquote>`
    case 'codeBlock': case 'code_block': return `<pre><code>${esc(textOf(node))}</code></pre>`
    case 'horizontalRule': case 'horizontal_rule': return '<hr>'
    case 'hardBreak': case 'hard_break': return '<br>'
    case 'image': return node.attrs?.src ? hooks.image(String(node.attrs.src), String(node.attrs.alt ?? '')) : ''
    case 'table': return `<table><tbody>${kids()}</tbody></table>`
    case 'tableRow': case 'table_row': return `<tr>${kids()}</tr>`
    case 'tableCell': case 'table_cell': return `<td>${kids() || '<p></p>'}</td>`
    case 'tableHeader': case 'table_header': return `<th>${kids() || '<p></p>'}</th>`
    case 'mention': case 'pageLink': case 'link': case 'wikilink': case 'documentLink': {
      const name = node.attrs?.label ?? node.attrs?.name ?? node.attrs?.title ?? node.attrs?.text ?? textOf(node)
      return name ? hooks.wikilink(String(name), null, null) : kids()
    }
    case 'text': {
      let t = esc(String(node.text ?? ''))
      for (const m of node.marks ?? []) {
        const k = m.type
        if (k === 'bold' || k === 'strong') t = `<strong>${t}</strong>`
        else if (k === 'italic' || k === 'em') t = `<em>${t}</em>`
        else if (k === 'strike' || k === 'strikethrough') t = `<s>${t}</s>`
        else if (k === 'code') t = `<code>${t}</code>`
        else if (k === 'highlight') t = `<mark>${t}</mark>`
        else if (k === 'underline') t = `<u>${t}</u>`
        else if (k === 'link' && m.attrs?.href) t = /^https?:/.test(m.attrs.href) ? `<a href="${esc(m.attrs.href)}">${t}</a>` : t
      }
      return t
    }
    default: {
      const inner = kids()
      // an unknown block (a callout, a column, a panel) keeps its content
      return inner || (node.text ? esc(String(node.text)) : '')
    }
  }
}
const textOf = (n: any): string => (n?.text ? String(n.text) : Array.isArray(n?.content) ? n.content.map(textOf).join('') : '')

/** Any text value: HTML, BBCode, a ProseMirror document or Markdown. */
function anyContent(v: unknown, hooks: InlineHooks): string {
  if (!v) return ''
  if (typeof v === 'object') {
    if ((v as any).type === 'doc') return pmToHtml(v, hooks)
    if (Array.isArray(v)) return v.map((x) => anyContent(x, hooks)).join('')
    return ''
  }
  const s = String(v)
  if (/^\s*</.test(s) && /<\/(p|div|h\d|ul|li|span)>/i.test(s)) {
    // HTML from another app: links to its own pages can not be followed; their text stays
    return s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  }
  if (looksLikeBbcode(s)) return bbcodeToHtml(s, hooks)
  return blocks(s, hooks)
}

interface JsonDoc { id?: string; title: string; content: unknown; extra: [string, unknown][]; folder: string[]; tags: string[] }

const TITLE_KEYS = ['title', 'name', 'pageTitle']
const BODY_KEYS = ['content', 'body', 'text', 'markdown', 'html', 'document', 'doc', 'description', 'entry']
const EXTRA_KEYS = ['sidebarcontent', 'sidebarcontentbottom', 'footnotes', 'scrapbook', 'pronunciation', 'subheading', 'excerpt', 'summary', 'gmnotes', 'gm_notes']

/** Finds the documents in any JSON: objects that have a title and some text, with folders from their nesting. */
function jsonDocs(data: unknown, kind: FormatId): JsonDoc[] {
  const out: JsonDoc[] = []
  const walk = (v: unknown, folder: string[]) => {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, folder)); return }
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    const title = TITLE_KEYS.map((k) => o[k]).find((x) => typeof x === 'string' && x.trim()) as string | undefined
    const bodyKey = BODY_KEYS.find((k) => o[k] !== undefined && o[k] !== null && o[k] !== '')
    const id = typeof o.id === 'string' || typeof o.id === 'number' ? String(o.id) : undefined
    let here = folder
    if (title && bodyKey) {
      const category = (o.category as any)?.title ?? (typeof o.category === 'string' ? o.category : undefined)
      const tags = words(o.tags)
      out.push({
        id, title: title.trim(), content: o[bodyKey], tags,
        extra: EXTRA_KEYS.filter((k) => typeof o[k] === 'string' && (o[k] as string).trim()).map((k) => [k, o[k]]),
        folder: kind === 'worldanvil' && category ? [String(category)] : folder,
      })
      here = [...folder, title.trim()]
    } else if (title && !bodyKey && Object.values(o).some((x) => Array.isArray(x))) {
      // a named group (a LegendKeeper resource holding documents, a World Anvil category) becomes a folder
      here = [...folder, title.trim()]
    }
    for (const [k, x] of Object.entries(o)) {
      if (k === (bodyKey ?? '') || TITLE_KEYS.includes(k)) continue
      if (x && typeof x === 'object') walk(x, here)
    }
  }
  walk(data, [])
  return out
}

function jsonPages(f: SourceFile, data: unknown, kind: FormatId): PlannedPage[] {
  if (kind === 'roam') {
    return (data as any[]).map((p, i) => ({
      key: `${f.path}#${i}`, title: String(p.title), folder: [], tags: [], aliases: [], linkNames: [String(p.title)],
      html: (r: Resolver) => render(r, f.path, (h) => roamBlocks(p.children ?? [], h)),
    }))
  }
  const docs = jsonDocs(data, kind)
  const label = kind === 'worldanvil' ? 'Sidebar' : 'More'
  return docs.map((d, i) => ({
    key: `${f.path}#${i}`, title: d.title, folder: d.folder, tags: d.tags, aliases: [], linkNames: [d.title, ...(d.id ? [d.id] : [])],
    html: (r: Resolver) => render(r, f.path, (h) => anyContent(d.content, h) + d.extra.map(([k, v]) => `<h2>${esc(k === 'sidebarcontent' ? label : k.replace(/_/g, ' '))}</h2>${anyContent(v, h)}`).join('')),
  }))
}

function roamBlocks(children: any[], h: InlineHooks): string {
  if (!children.length) return ''
  return `<ul>${children.map((c) => `<li>${blocks(String(c.string ?? '').replace(/__(.+?)__/g, '*$1*'), h) || '<p></p>'}${roamBlocks(c.children ?? [], h)}</li>`).join('')}</ul>`
}

// ---------- the plan ----------

export async function plan(files: SourceFile[]): Promise<Plan> {
  const kept = files.filter((f) => !IGNORE_DIR.test(f.path) && !base(f.path).startsWith('.'))
  // the app folders (.obsidian, logseq) say what the export is, even though their files are not imported
  let format = detect(files)
  const skipped: Plan['skipped'] = []
  const pictures = new Map<string, SourceFile>()
  const pages: PlannedPage[] = []
  const docs = kept.filter((f) => /\.(md|markdown|html?|txt|json|lk|csv)$/i.test(f.path))
  const root = commonRoot(docs.map((f) => f.path))
  for (const f of kept) {
    if (IMAGE.test(f.path)) {
      if (UPLOADABLE.test(f.path)) pictures.set(f.path, f)
      else skipped.push({ path: f.path, reason: 'Pictures in this format can not be uploaded (PNG, JPEG, WebP, GIF and AVIF can).' })
      continue
    }
    if (/\.(md|markdown)$/i.test(f.path)) {
      const p = markdownPage(f, root, format === 'html' || format === 'json' || format === 'text' ? 'markdown' : format)
      await readMeta(p, f, format)
      pages.push(p)
    } else if (/\.html?$/i.test(f.path)) pages.push(htmlPage(f, root))
    else if (/\.txt$/i.test(f.path)) pages.push(textPage(f, root))
    else if (/\.csv$/i.test(f.path)) {
      // Notion writes each database twice (the view and "_all"): one is enough
      if (/_all\.csv$/i.test(f.path) || !kept.some((x) => x.path === f.path.replace(/\.csv$/i, '_all.csv'))) pages.push(csvPage(f, root))
    } else if (/\.(json|lk)$/i.test(f.path)) {
      let data: unknown
      try { data = JSON.parse(await text(f)) } catch { skipped.push({ path: f.path, reason: 'Not readable JSON.' }); continue }
      const kind = jsonKind(data)
      if (format === 'json' || format === 'legendkeeper' || format === 'text') format = kind === 'json' && format === 'legendkeeper' ? 'legendkeeper' : kind
      const found = jsonPages(f, data, kind)
      if (!found.length) skipped.push({ path: f.path, reason: 'No pages found in it (nothing with a title and text).' })
      pages.push(...found)
    } else if (/\.(docx?|odt|pdf|rtf|pages)$/i.test(f.path)) {
      skipped.push({ path: f.path, reason: 'Documents of word processors are not read. Save them as Markdown or HTML first.' })
    } else if (!/\.(edn|css|js|canvas|excalidraw|base)$/i.test(f.path)) {
      skipped.push({ path: f.path, reason: 'Not a format Chronicle reads.' })
    }
  }
  for (const p of pages) if (!p.title.trim()) p.title = 'Untitled'
  return { format, pages, pictures, skipped }
}

/** Finds the page a link means: by path relative to the linking file, by path in the import, then by name. */
export function pageFinder(pages: PlannedPage[], ids: Map<string, string>, existing: { id: string; title: string; aliases: string[] }[]) {
  const byPath = new Map<string, PlannedPage>()
  const byName = new Map<string, PlannedPage>()
  for (const p of pages) {
    byPath.set(p.key.toLowerCase(), p)
    byPath.set(noExt(p.key).toLowerCase(), p)
    for (const n of [p.title, ...p.aliases, ...p.linkNames]) {
      const k = n.toLowerCase()
      if (k && !byName.has(k)) byName.set(k, p)
    }
  }
  const world = new Map<string, { id: string; title: string }>()
  for (const e of existing) for (const n of [e.title, ...e.aliases]) if (n && !world.has(n.toLowerCase())) world.set(n.toLowerCase(), e)
  return (target: string, from: string): { id: string; title: string } | null => {
    const t = target.trim()
    if (!t) return null
    const rel = joinPath(from, t).toLowerCase()
    const hit = byPath.get(rel) ?? byPath.get(noExt(rel)) ?? byPath.get(rel + '.md')
      ?? byName.get(t.toLowerCase()) ?? byName.get(noExt(base(t)).toLowerCase()) ?? byName.get(clean(noExt(base(t))).toLowerCase())
    if (hit) { const id = ids.get(hit.key); return id ? { id, title: hit.title } : null }
    return world.get(t.toLowerCase()) ?? null
  }
}

/** Finds a picture of the import by the path or name the text uses. */
export function pictureFinder(pictures: Map<string, SourceFile>) {
  const byName = new Map<string, SourceFile>()
  for (const [p, f] of pictures) if (!byName.has(base(p).toLowerCase())) byName.set(base(p).toLowerCase(), f)
  const lower = new Map([...pictures].map(([p, f]) => [p.toLowerCase(), f]))
  return (ref: string, from: string): SourceFile | null => {
    const r = ref.split('?')[0].split('#')[0]
    return lower.get(joinPath(from, r).toLowerCase()) ?? lower.get(r.replace(/^\/+/, '').toLowerCase()) ?? byName.get(base(r).toLowerCase()) ?? null
  }
}
