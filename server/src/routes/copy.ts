import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireEditor } from '../auth.js'
import { config } from '../config.js'
import { db, now } from '../db.js'
import type { DocNode } from '../doc.js'
import { recordActivity, reindexLinks, relinkByName, setTags, uid, type PageRow } from '../pages.js'

const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' }
const UPLOAD_URL = /^\/api\/uploads\/([0-9a-f-]{36})$/

const sel = z.object({ pageIds: z.array(z.string()).min(1).max(600), targetWorkspaceId: z.string() })

function livePages(ids: string[]): PageRow[] {
  const out: PageRow[] = []
  const get = db.prepare('SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL')
  for (const id of new Set(ids)) { const p = get.get(id) as PageRow | undefined; if (p) out.push(p) }
  return out
}

function folderPath(folderId: string | null): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  let cur = folderId
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const f = db.prepare('SELECT name, parent_id FROM folders WHERE id = ?').get(cur) as { name: string; parent_id: string | null } | undefined
    if (!f) break
    names.unshift(f.name)
    cur = f.parent_id
  }
  return names
}

function ensureFolders(ws: string, names: string[], cache: Map<string, string | null>): string | null {
  let parent: string | null = null
  let key = ''
  for (const name of names) {
    key += '/' + name
    if (cache.has(key)) { parent = cache.get(key)!; continue }
    const found = db.prepare('SELECT id FROM folders WHERE workspace_id = ? AND name = ? AND deleted_at IS NULL AND parent_id IS ?').get(ws, name, parent) as { id: string } | undefined
    let id = found?.id
    if (!id) { id = uid(); db.prepare('INSERT INTO folders(id,workspace_id,parent_id,name) VALUES(?,?,?,?)').run(id, ws, parent, name) }
    cache.set(key, id)
    parent = id
  }
  return parent
}

function titlesIn(ws: string): Set<string> {
  const used = new Set<string>()
  for (const r of db.prepare('SELECT title, aliases FROM pages WHERE workspace_id = ? AND deleted_at IS NULL').all(ws) as { title: string; aliases: string }[]) {
    if (r.title.trim()) used.add(r.title.trim().toLowerCase())
    try { for (const a of JSON.parse(r.aliases) as string[]) if (a.trim()) used.add(a.trim().toLowerCase()) } catch { /* ignore */ }
  }
  return used
}

export async function copyRoutes(app: FastifyInstance) {
  /** What a copy would bring along: pages these pages link to, and titles that already exist in the target world. */
  app.post('/api/copy/preview', { preHandler: requireEditor }, async (req, reply) => {
    const b = sel.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const pages = livePages(b.data.pageIds)
    if (!pages.length) return reply.code(404).send({ error: 'no such pages' })
    const chosen = new Set(pages.map((p) => p.id))
    const linked = new Map<string, { id: string; title: string; mentions: number }>()
    const q = db.prepare(
      `SELECT l.target_id AS id, p.title FROM links l JOIN pages p ON p.id = l.target_id
       WHERE l.source_id = ? AND l.target_id IS NOT NULL AND p.deleted_at IS NULL AND p.workspace_id = ?`,
    )
    let ghosts = 0
    for (const p of pages) {
      for (const r of q.all(p.id, p.workspace_id) as { id: string; title: string }[]) {
        if (chosen.has(r.id)) continue
        const cur = linked.get(r.id) ?? { id: r.id, title: r.title, mentions: 0 }
        cur.mentions++
        linked.set(r.id, cur)
      }
      ghosts += (db.prepare('SELECT COUNT(*) n FROM links WHERE source_id = ? AND target_id IS NULL').get(p.id) as { n: number }).n
    }
    const used = titlesIn(b.data.targetWorkspaceId)
    return {
      pages: pages.map((p) => ({ id: p.id, title: p.title, exists: used.has(p.title.trim().toLowerCase()) })),
      linked: [...linked.values()].sort((a, c) => c.mentions - a.mentions || a.title.localeCompare(c.title)).map((l) => ({ ...l, exists: used.has(l.title.trim().toLowerCase()) })),
      alreadyUnresolved: ghosts,
    }
  })

  app.post('/api/copy', { preHandler: requireEditor }, async (req, reply) => {
    const b = sel.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const target = b.data.targetWorkspaceId
    if (!db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(target)) return reply.code(404).send({ error: 'target world not found' })
    const pages = livePages(b.data.pageIds)
    if (!pages.length) return reply.code(404).send({ error: 'no such pages' })
    const srcWs = pages[0].workspace_id
    if (pages.some((p) => p.workspace_id !== srcWs)) return reply.code(400).send({ error: 'Pages must come from one world' })
    if (srcWs === target) return reply.code(400).send({ error: 'Choose a different world' })

    const idMap = new Map(pages.map((p) => [p.id, uid()]))
    const upMap = new Map<string, string>()
    const titleOf = (id: string) => (db.prepare('SELECT title FROM pages WHERE id = ?').get(id) as { title: string } | undefined)?.title ?? ''
    let ghosted = 0
    const copiedFiles: string[] = []

    const copyUpload = (url: string): string => {
      const m = UPLOAD_URL.exec(url)
      if (!m) return url
      const hit = upMap.get(m[1])
      if (hit) return `/api/uploads/${hit}`
      const row = db.prepare('SELECT filename, mime, size FROM uploads WHERE id = ?').get(m[1]) as { filename: string; mime: string; size: number } | undefined
      const ext = row && EXT[row.mime]
      const from = ext ? path.join(config.dataDir, 'uploads', m[1] + ext) : ''
      if (!row || !fs.existsSync(from)) return url
      const nid = uid()
      const to = path.join(config.dataDir, 'uploads', nid + ext)
      fs.copyFileSync(from, to)
      copiedFiles.push(to)
      db.prepare('INSERT INTO uploads(id,workspace_id,filename,mime,size,created_at) VALUES(?,?,?,?,?,?)').run(nid, target, row.filename, row.mime, row.size, now())
      upMap.set(m[1], nid)
      return `/api/uploads/${nid}`
    }

    // a custom stat template used by a copied page is copied along (reusing one of the same name that already exists there)
    const tplMap = new Map<string, string>()
    const copyTemplate = (id: unknown): unknown => {
      if (typeof id !== 'string') return id
      const hit = tplMap.get(id)
      if (hit) return hit
      const row = db.prepare('SELECT name, definition FROM stat_templates WHERE id = ? AND workspace_id = ?').get(id, srcWs) as { name: string; definition: string } | undefined
      if (!row) return id
      const same = db.prepare('SELECT id FROM stat_templates WHERE workspace_id = ? AND name = ? COLLATE NOCASE').get(target, row.name) as { id: string } | undefined
      const nid = same?.id ?? uid()
      if (!same) {
        const t = now()
        db.prepare('INSERT INTO stat_templates(id,workspace_id,name,definition,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(nid, target, row.name, row.definition, t, t)
      }
      tplMap.set(id, nid)
      return nid
    }

    const rewrite = (n: DocNode) => {
      if (n.type === 'statblock' && n.attrs) n.attrs.template = copyTemplate(n.attrs.template)
      if ((n.type === 'wikilink' || n.type === 'embed') && n.attrs) {
        const old = n.attrs.pageId as string | null
        if (old && idMap.has(old)) n.attrs.pageId = idMap.get(old)
        else if (old) {
          // linked page stays behind: keep its name so the link becomes a ghost that resolves once such a page exists here
          const t = titleOf(old)
          if (t) n.attrs.name = t
          n.attrs.pageId = null
          n.attrs.anchor = null
          ghosted++
        }
      }
      if (n.type === 'image' && typeof n.attrs?.src === 'string') n.attrs.src = copyUpload(n.attrs.src)
      n.content?.forEach(rewrite)
    }

    const used = titlesIn(target)
    const folderCache = new Map<string, string | null>()
    const result: { from: string; to: string; title: string; renamed: boolean }[] = []

    try {
      db.transaction(() => {
        const t = now()
        for (const p of pages) {
          const id = idMap.get(p.id)!
          const doc = JSON.parse(p.content) as DocNode
          rewrite(doc)
          const props = JSON.parse(p.props)
          if (typeof props?.portrait === 'string') props.portrait = copyUpload(props.portrait)
          if (props?.data && typeof props.data === 'object') {
            for (const [k, v] of Object.entries(props.data) as [string, any][]) {
              if (v && typeof v === 'object' && typeof v.template === 'string') v.template = copyTemplate(v.template)
              else if (typeof v === 'string') props.data[k] = copyUpload(v)
            }
          }

          let title = p.title
          let renamed = false
          if (title.trim() && used.has(title.trim().toLowerCase())) {
            const base = `${p.title} (copy)`
            title = base
            for (let i = 2; used.has(title.toLowerCase()); i++) title = `${base.slice(0, -1)} ${i})`
            renamed = true
          }
          if (title.trim()) used.add(title.trim().toLowerCase())

          const folder = ensureFolders(target, folderPath(p.folder_id), folderCache)
          db.prepare(
            `INSERT INTO pages(id,workspace_id,folder_id,title,icon,aliases,content,props,created_at,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?,?)`,
          ).run(id, target, folder, title, p.icon, p.aliases, JSON.stringify(doc), JSON.stringify(props), t, t)
          const tags = (db.prepare('SELECT tag FROM page_tags WHERE page_id = ?').all(p.id) as { tag: string }[]).map((x) => x.tag)
          setTags(id, tags)
          recordActivity(id, target, 0, true)
          result.push({ from: p.id, to: id, title, renamed })
        }
        // second pass: all pages exist now, so ids inside the copied set resolve; the rest resolve by name or stay ghosts
        for (const r of result) {
          const row = db.prepare('SELECT content FROM pages WHERE id = ?').get(r.to) as { content: string }
          const ex = reindexLinks(r.to, target, JSON.parse(row.content))
          db.prepare('UPDATE pages SET text = ?, outline = ?, word_count = ?, has_stats = ? WHERE id = ?')
            .run(ex.text, JSON.stringify(ex.outline), ex.wordCount, ex.hasStats ? 1 : 0, r.to)
        }
        for (const r of result) {
          const row = db.prepare('SELECT title, aliases FROM pages WHERE id = ?').get(r.to) as { title: string; aliases: string }
          relinkByName(target, r.to, row.title, JSON.parse(row.aliases))
        }
        // family and custom relations between pages that were both copied
        const rels = db.prepare('SELECT source_id, target_id, kind, label FROM relations WHERE workspace_id = ?').all(srcWs) as any[]
        const ins = db.prepare('INSERT INTO relations(id,workspace_id,source_id,target_id,kind,label,created_at) VALUES(?,?,?,?,?,?,?)')
        for (const r of rels) {
          if (idMap.has(r.source_id) && idMap.has(r.target_id)) ins.run(uid(), target, idMap.get(r.source_id), idMap.get(r.target_id), r.kind, r.label, t)
        }
      })()
    } catch (e) {
      for (const f of copiedFiles) fs.rmSync(f, { force: true })
      throw e
    }

    const ghostNames = (db.prepare(
      `SELECT COUNT(DISTINCT lower(target_name)) n FROM links WHERE target_id IS NULL AND source_id IN (${result.map(() => '?').join(',')})`,
    ).get(...result.map((r) => r.to)) as { n: number }).n
    return { workspaceId: target, pages: result, ghostLinks: ghosted, unresolvedNames: ghostNames, images: upMap.size }
  })
}
