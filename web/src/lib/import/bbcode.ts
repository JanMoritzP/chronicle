import { esc, type InlineHooks } from './markdown'

/**
 * World Anvil writes articles in BBCode with its own additions: mentions (@[Name](article:id)), [aloud] boxes,
 * [section] and [container] wrappers, [spoiler] text. This turns them into HTML the editor reads.
 */
const SIMPLE: Record<string, [string, string]> = {
  b: ['<strong>', '</strong>'], i: ['<em>', '</em>'], u: ['<u>', '</u>'], s: ['<s>', '</s>'], strike: ['<s>', '</s>'],
  h1: ['<h1>', '</h1>'], h2: ['<h2>', '</h2>'], h3: ['<h3>', '</h3>'], h4: ['<h4>', '</h4>'], h5: ['<h4>', '</h4>'], h6: ['<h4>', '</h4>'],
  p: ['<p>', '</p>'], quote: ['<blockquote><p>', '</p></blockquote>'], code: ['<code>', '</code>'],
  ul: ['<ul>', '</ul>'], ol: ['<ol>', '</ol>'], list: ['<ul>', '</ul>'], li: ['<li><p>', '</p></li>'], '*': ['<li><p>', '</p></li>'],
  table: ['<table><tbody>', '</tbody></table>'], tr: ['<tr>', '</tr>'], td: ['<td><p>', '</p></td>'], th: ['<th><p>', '</p></th>'],
  aloud: ['<div data-callout data-kind="aloud"><p>', '</p></div>'], spoiler: ['<div data-callout data-kind="secret"><p>', '</p></div>'],
  sidebar: ['<div data-callout data-kind="info"><p>', '</p></div>'], center: ['<p>', '</p>'], small: ['', ''], sup: ['', ''], sub: ['', ''],
  section: ['', ''], container: ['', ''], row: ['', ''], col: ['', ''], col3: ['', ''], col6: ['', ''], br: ['<br>', ''],
}

export function bbcodeToHtml(src: string, hooks: InlineHooks): string {
  let s = esc(src.replace(/\r\n?/g, '\n'))
  // mentions keep their name: @[Name](type:id)
  s = s.replace(/@\[([^\]]+)\]\(([\w-]+):[\w-]+\)/g, (_m, name) => hooks.wikilink(name.replace(/&amp;/g, '&'), null, null))
  s = s.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_m, href, text) => hooks.link(href.replace(/&amp;/g, '&'), text))
  s = s.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_m, href) => hooks.link(href.replace(/&amp;/g, '&'), href))
  s = s.replace(/\[img(?:=[^\]]*)?\]([\s\S]*?)\[\/img\]/gi, (_m, url) => hooks.image(url.trim().replace(/&amp;/g, '&'), ''))
  s = s.replace(/\[img:[\w-]+[^\]]*\]/gi, '')
  s = s.replace(/\[(\/?)([a-z*][\w-]*\d?)(?:[=:][^\]]*)?\]/gi, (m, close, tag) => {
    const t = SIMPLE[tag.toLowerCase()]
    if (!t) return m
    return close ? t[1] : t[0]
  })
  // what is left are paragraphs separated by blank lines
  return s.split(/\n{2,}/).map((block) => {
    const b = block.trim()
    if (!b) return ''
    if (/^<(h\d|ul|ol|table|blockquote|div|p)[\s>]/.test(b)) return b.replace(/\n/g, '<br>')
    return `<p>${b.replace(/\n/g, '<br>')}</p>`
  }).join('')
}

export const looksLikeBbcode = (s: string) => /\[(b|i|u|h[1-6]|url|quote|ul|li|p|aloud|section|container)(=[^\]]*)?\]/i.test(s) || /@\[[^\]]+\]\([\w-]+:[\w-]+\)/.test(s)
