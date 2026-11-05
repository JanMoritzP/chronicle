import { useStore } from '../store'
import type { PageMeta } from '../types'
import { fuzzy, type FuzzyHit } from './fuzzy'
import { norm } from './data'

export interface PageHit { page: PageMeta; hit: FuzzyHit; via: 'title' | 'alias' }
export interface SectionHit { page: PageMeta; heading: { id: string; level: number; text: string }; hit: FuzzyHit }

/** Parses the inside of a {{...}} link: name#section|alias */
export function parseLinkText(inner: string) {
  const pipe = inner.indexOf('|')
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : ''
  const left = pipe >= 0 ? inner.slice(0, pipe) : inner
  const hash = left.indexOf('#')
  const name = (hash >= 0 ? left.slice(0, hash) : left).trim()
  const section = hash >= 0 ? left.slice(hash + 1).trim() : null
  return { name, section, alias, hasPipe: pipe >= 0 }
}

export function searchPages(query: string, limit = 12): PageHit[] {
  const pages = useStore.getState().data.pages
  const q = query.trim()
  const out: PageHit[] = []
  for (const p of pages) {
    const title = p.title || 'Untitled'
    let best: PageHit | null = null
    const th = fuzzy(q, title)
    if (th) best = { page: p, hit: th, via: 'title' }
    if (q) {
      for (const a of p.aliases) {
        const ah = fuzzy(q, a)
        if (ah && (!best || ah.score > best.hit.score)) best = { page: p, hit: { ...ah, indices: [] }, via: 'alias' }
      }
    }
    if (best) out.push(best)
  }
  out.sort((a, b) => b.hit.score - a.hit.score || b.page.updatedAt - a.page.updatedAt)
  return out.slice(0, limit)
}

export function searchSections(page: PageMeta, query: string, limit = 12): SectionHit[] {
  const out: SectionHit[] = []
  for (const h of page.outline) {
    const hit = fuzzy(query.trim(), h.text)
    if (hit) out.push({ page, heading: h, hit })
  }
  out.sort((a, b) => b.hit.score - a.hit.score)
  return out.slice(0, limit)
}

/** Resolves a typed name (+ optional section text) to ids using the cached workspace. */
export function resolveLink(name: string, section: string | null) {
  const pages = useStore.getState().data.pages
  const n = norm(name)
  const page = pages.find((p) => norm(p.title) === n) ?? pages.find((p) => p.aliases.some((a) => norm(a) === n))
  let anchor: string | null = null
  let anchorText: string | null = null
  if (page && section) {
    const s = norm(section)
    const h = page.outline.find((x) => norm(x.text) === s) ?? page.outline.find((x) => norm(x.text).startsWith(s))
    if (h) { anchor = h.id; anchorText = h.text } else anchorText = section
  }
  return { pageId: page?.id ?? null, name: page?.title ?? name.trim(), anchor, anchorText }
}

/** Section of a document: the heading with `anchor` and everything up to the next heading of same or higher rank. */
export function sliceSection(doc: any, anchor: string | null | undefined) {
  if (!anchor || !doc?.content) return doc
  const nodes: any[] = doc.content
  const i = nodes.findIndex((n) => n.type === 'heading' && n.attrs?.id === anchor)
  if (i < 0) return doc
  const level = nodes[i].attrs?.level ?? 1
  let j = i + 1
  while (j < nodes.length && !(nodes[j].type === 'heading' && (nodes[j].attrs?.level ?? 1) <= level)) j++
  return { type: 'doc', content: nodes.slice(i, j) }
}
