// Pure helpers over the cached workspace data.
import type { Folder, LinkRow, PageMeta } from '../types'

export function norm(s: string) { return s.trim().toLowerCase() }

export function findPageByName(pages: PageMeta[], name: string): PageMeta | undefined {
  const n = norm(name)
  if (!n) return
  return pages.find((p) => norm(p.title) === n) ?? pages.find((p) => p.aliases.some((a) => norm(a) === n))
}

export function backlinksOf(links: LinkRow[], pageId: string) {
  const seen = new Set<string>()
  return links.filter((l) => {
    if (l.targetId !== pageId || l.sourceId === pageId || seen.has(l.sourceId)) return false
    seen.add(l.sourceId)
    return true
  })
}

/** Ids of every page that links to a page which doesn't exist yet, grouped by the missing name. */
export function unresolvedByName(links: LinkRow[]) {
  const m = new Map<string, Set<string>>()
  for (const l of links) {
    if (l.targetId) continue
    const k = l.targetName.trim()
    if (!k) continue
    ;(m.get(k) ?? m.set(k, new Set()).get(k)!).add(l.sourceId)
  }
  return m
}

export function folderPath(folders: Folder[], id: string | null): string {
  const parts: string[] = []
  let cur = id
  const byId = new Map(folders.map((f) => [f.id, f]))
  while (cur) {
    const f = byId.get(cur)
    if (!f) break
    parts.unshift(f.name)
    cur = f.parentId
  }
  return parts.join(' / ')
}

export interface TagNode { name: string; full: string; count: number; children: TagNode[] }

/** Builds a tree from nested tags like "npc/villain". Counts include descendants' pages. */
export function buildTagTree(pages: PageMeta[]): TagNode[] {
  const root: TagNode = { name: '', full: '', count: 0, children: [] }
  for (const p of pages) {
    const touched = new Set<TagNode>()
    for (const t of p.tags) {
      let node = root
      let full = ''
      for (const part of t.split('/').filter(Boolean)) {
        full = full ? `${full}/${part}` : part
        let child = node.children.find((c) => c.name === part)
        if (!child) { child = { name: part, full, count: 0, children: [] }; node.children.push(child) }
        touched.add(child)
        node = child
      }
    }
    touched.forEach((n) => n.count++)
  }
  const sort = (n: TagNode) => { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.children.forEach(sort) }
  sort(root)
  return root.children
}

export function ago(ts: number) {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(ts).toLocaleDateString()
}
