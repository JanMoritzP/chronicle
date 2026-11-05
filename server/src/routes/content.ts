import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireEditor, requireUser } from '../auth.js'
import { db, now } from '../db.js'
import { emptyDoc, ensureHeadingIds, extract, type DocNode } from '../doc.js'
import { templatesOf } from './templates.js'
import { pageTypesOf } from './pagetypes.js'
import { statTemplatesOf } from './stattemplates.js'
import { pageSummary, recordActivity, reindexLinks, relinkByName, setTags, snapshotIfDue, uid, type PageRow } from '../pages.js'

const docSchema = z.custom<DocNode>((v) => typeof v === 'object' && v !== null && (v as DocNode).type === 'doc')

function portraitOf(p: PageRow, props: any = JSON.parse(p.props)): string | null {
  if (props?.portrait) return String(props.portrait)
  return extract(JSON.parse(p.content)).firstImage
}

function pageDerived(id: string) {
  const p = db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as PageRow
  const todos = (db.prepare('SELECT COUNT(*) n FROM todos WHERE page_id = ? AND done = 0').get(id) as { n: number }).n
  const props = JSON.parse(p.props)
  return {
    ok: true, updatedAt: p.updated_at, outline: JSON.parse(p.outline), text: p.text.slice(0, 4000),
    wordCount: p.word_count, hasStats: !!p.has_stats, portrait: portraitOf(p, props), type: props?.type ?? null, links: linksOf(id), todos,
  }
}

function linksOf(sourceId: string) {
  return db.prepare(
    'SELECT source_id AS sourceId, target_id AS targetId, target_name AS targetName, anchor, embed FROM links WHERE source_id = ?',
  ).all(sourceId)
}

function wsExists(id: string) {
  return !!db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(id)
}

export async function contentRoutes(app: FastifyInstance) {
  // ---------- workspaces ----------
  app.get('/api/workspaces', { preHandler: requireUser }, async () =>
    db.prepare('SELECT id, name, created_at AS createdAt FROM workspaces WHERE deleted_at IS NULL ORDER BY created_at').all())

  app.post('/api/workspaces', { preHandler: requireEditor }, async (req, reply) => {
    const b = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'name required' })
    const id = uid()
    db.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(id, b.data.name, now())
    return { id, name: b.data.name }
  })

  app.patch('/api/workspaces/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'name required' })
    db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(b.data.name, id)
    return { ok: true }
  })

  app.delete('/api/workspaces/:id', { preHandler: requireEditor }, async (req) => {
    const { id } = req.params as { id: string }
    db.prepare('UPDATE workspaces SET deleted_at = ? WHERE id = ?').run(now(), id)
    return { ok: true }
  })

  // ---------- bootstrap: everything the client cache needs in one request ----------
  app.get('/api/workspaces/:ws/bootstrap', { preHandler: requireUser }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    if (!wsExists(ws)) return reply.code(404).send({ error: 'not found' })
    const pages = db.prepare('SELECT * FROM pages WHERE workspace_id = ? AND deleted_at IS NULL').all(ws) as PageRow[]
    const tagRows = db.prepare(
      'SELECT pt.page_id, pt.tag FROM page_tags pt JOIN pages p ON p.id = pt.page_id WHERE p.workspace_id = ? AND p.deleted_at IS NULL',
    ).all(ws) as { page_id: string; tag: string }[]
    const todoMap = new Map((db.prepare('SELECT page_id, COUNT(*) n FROM todos WHERE workspace_id = ? AND done = 0 GROUP BY page_id').all(ws) as { page_id: string; n: number }[]).map((r) => [r.page_id, r.n]))
    const tagMap = new Map<string, string[]>()
    for (const t of tagRows) (tagMap.get(t.page_id) ?? tagMap.set(t.page_id, []).get(t.page_id)!).push(t.tag)
    const links = db.prepare(
      `SELECT l.source_id AS sourceId, l.target_id AS targetId, l.target_name AS targetName, l.anchor, l.embed
       FROM links l JOIN pages p ON p.id = l.source_id WHERE p.workspace_id = ? AND p.deleted_at IS NULL`,
    ).all(ws)
    const folders = db.prepare(
      'SELECT id, parent_id AS parentId, name, sort FROM folders WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY sort, name',
    ).all(ws)
    const zettels = db.prepare(
      `SELECT id, body, tags, created_at AS createdAt, page_id AS pageId, processed_at AS processedAt
       FROM zettels WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    ).all(ws) as any[]
    return {
      folders,
      links,
      templates: templatesOf(ws),
      pageTypes: pageTypesOf(ws),
      statTemplates: statTemplatesOf(ws),
      zettels: zettels.map((z) => ({ ...z, tags: JSON.parse(z.tags) })),
      pages: pages.map((p) => {
        const props = JSON.parse(p.props)
        return {
          id: p.id, folderId: p.folder_id, title: p.title, icon: p.icon,
          aliases: JSON.parse(p.aliases), tags: tagMap.get(p.id) ?? [],
          outline: JSON.parse(p.outline), text: p.text.slice(0, 4000),
          hasStats: !!p.has_stats, portrait: portraitOf(p, props), type: props?.type ?? null,
          wordCount: p.word_count, createdAt: p.created_at, updatedAt: p.updated_at, todos: todoMap.get(p.id) ?? 0,
        }
      }),
    }
  })

  app.get('/api/workspaces/:ws/links', { preHandler: requireUser }, async (req) => {
    const { ws } = req.params as { ws: string }
    return db.prepare(
      `SELECT l.source_id AS sourceId, l.target_id AS targetId, l.target_name AS targetName, l.anchor, l.embed
       FROM links l JOIN pages p ON p.id = l.source_id WHERE p.workspace_id = ? AND p.deleted_at IS NULL`,
    ).all(ws)
  })

  // ---------- folders ----------
  app.post('/api/workspaces/:ws/folders', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = z.object({ name: z.string().min(1).max(100), parentId: z.string().nullable().optional() }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const id = uid()
    db.prepare('INSERT INTO folders(id,workspace_id,parent_id,name) VALUES(?,?,?,?)').run(id, ws, b.data.parentId ?? null, b.data.name)
    return { id, parentId: b.data.parentId ?? null, name: b.data.name, sort: 0 }
  })

  app.patch('/api/folders/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({ name: z.string().min(1).max(100).optional(), parentId: z.string().nullable().optional(), sort: z.number().optional() }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    if (b.data.parentId) {
      // refuse to move a folder inside itself or its own descendants
      let cur: string | null = b.data.parentId
      while (cur) {
        if (cur === id) return reply.code(400).send({ error: 'Cannot move a folder into itself' })
        cur = (db.prepare('SELECT parent_id p FROM folders WHERE id = ?').get(cur) as { p: string | null } | undefined)?.p ?? null
      }
    }
    const f = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as any
    if (!f) return reply.code(404).send({ error: 'not found' })
    db.prepare('UPDATE folders SET name = ?, parent_id = ?, sort = ? WHERE id = ?').run(
      b.data.name ?? f.name, b.data.parentId === undefined ? f.parent_id : b.data.parentId, b.data.sort ?? f.sort, id)
    return { ok: true }
  })

  app.delete('/api/folders/:id', { preHandler: requireEditor }, async (req) => {
    const { id } = req.params as { id: string }
    const f = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(id) as { parent_id: string | null } | undefined
    if (!f) return { ok: true }
    // children move up one level instead of being lost
    db.prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ?').run(f.parent_id, id)
    db.prepare('UPDATE pages SET folder_id = ? WHERE folder_id = ?').run(f.parent_id, id)
    db.prepare('DELETE FROM folders WHERE id = ?').run(id)
    return { ok: true }
  })

  // ---------- pages ----------
  app.post('/api/workspaces/:ws/pages', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    if (!wsExists(ws)) return reply.code(404).send({ error: 'workspace not found' })
    const b = z.object({
      title: z.string().max(300).default(''),
      folderId: z.string().nullable().optional(),
      content: docSchema.optional(),
      props: z.record(z.string(), z.any()).optional(),
      tags: z.array(z.string()).optional(),
      sourceZettelId: z.string().optional(),
    }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const id = uid()
    const doc = ensureHeadingIds(b.data.content ?? emptyDoc())
    const t = now()
    db.transaction(() => {
      db.prepare(
        `INSERT INTO pages(id,workspace_id,folder_id,title,content,props,source_zettel_id,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      ).run(id, ws, b.data.folderId ?? null, b.data.title, JSON.stringify(doc), JSON.stringify(b.data.props ?? {}), b.data.sourceZettelId ?? null, t, t)
      const ex = reindexLinks(id, ws, doc)
      db.prepare('UPDATE pages SET text = ?, outline = ?, word_count = ?, has_stats = ? WHERE id = ?').run(ex.text, JSON.stringify(ex.outline), ex.wordCount, ex.hasStats ? 1 : 0, id)
      if (b.data.tags) setTags(id, b.data.tags)
      recordActivity(id, ws, ex.wordCount, true)
      if (b.data.title.trim()) relinkByName(ws, id, b.data.title, [])
      if (b.data.sourceZettelId) {
        db.prepare('UPDATE zettels SET page_id = ?, processed_at = ? WHERE id = ?').run(id, t, b.data.sourceZettelId)
      }
    })()
    return pageSummary(db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as PageRow)
  })

  app.get('/api/pages/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const p = db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as PageRow | undefined
    if (!p) return reply.code(404).send({ error: 'not found' })
    return { ...pageSummary(p), content: JSON.parse(p.content), props: JSON.parse(p.props), outline: JSON.parse(p.outline) }
  })

  app.patch('/api/pages/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({
      title: z.string().max(300).optional(),
      icon: z.string().max(16).nullable().optional(),
      folderId: z.string().nullable().optional(),
      aliases: z.array(z.string().max(300)).optional(),
      tags: z.array(z.string().max(100)).optional(),
      content: docSchema.optional(),
      props: z.record(z.string(), z.any()).optional(),
    }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const p = db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as PageRow | undefined
    if (!p) return reply.code(404).send({ error: 'not found' })
    const d = b.data
    if (d.content) ensureHeadingIds(d.content)

    db.transaction(() => {
      const title = d.title ?? p.title
      const aliases = d.aliases ?? (JSON.parse(p.aliases) as string[])
      let content = p.content, text = p.text, outline = p.outline, wc = p.word_count, hasStats = p.has_stats
      if (d.content) {
        content = JSON.stringify(d.content)
        const ex = reindexLinks(id, p.workspace_id, d.content)
        text = ex.text; outline = JSON.stringify(ex.outline); wc = ex.wordCount; hasStats = ex.hasStats ? 1 : 0
        recordActivity(id, p.workspace_id, ex.wordCount - p.word_count)
      }
      // keep a restorable copy of the state *before* this edit (throttled)
      if (d.content) snapshotIfDue({ id, title: p.title, content: p.content, word_count: p.word_count })
      db.prepare(
        `UPDATE pages SET title=?, icon=?, folder_id=?, aliases=?, content=?, text=?, outline=?, word_count=?, has_stats=?, props=?, updated_at=? WHERE id=?`,
      ).run(
        title, d.icon === undefined ? p.icon : d.icon, d.folderId === undefined ? p.folder_id : d.folderId,
        JSON.stringify(aliases), content, text, outline, wc, hasStats, d.props ? JSON.stringify(d.props) : p.props, now(), id,
      )
      if (d.tags) setTags(id, d.tags)
      if (d.title !== undefined || d.aliases) relinkByName(p.workspace_id, id, title, aliases)
    })()
    return pageDerived(id)
  })

  // soft delete -> trash
  app.delete('/api/pages/:id', { preHandler: requireEditor }, async (req) => {
    const { id } = req.params as { id: string }
    db.prepare('UPDATE pages SET deleted_at = ? WHERE id = ?').run(now(), id)
    return { ok: true }
  })

  app.get('/api/workspaces/:ws/trash', { preHandler: requireUser }, async (req) => {
    const { ws } = req.params as { ws: string }
    const rows = db.prepare('SELECT * FROM pages WHERE workspace_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC').all(ws) as PageRow[]
    return rows.map(pageSummary)
  })

  app.post('/api/pages/:id/restore', { preHandler: requireEditor }, async (req) => {
    const { id } = req.params as { id: string }
    const p = db.prepare('SELECT workspace_id, title, aliases, content FROM pages WHERE id = ?').get(id) as any
    if (!p) return { ok: false }
    db.prepare('UPDATE pages SET deleted_at = NULL WHERE id = ?').run(id)
    reindexLinks(id, p.workspace_id, JSON.parse(p.content))
    relinkByName(p.workspace_id, id, p.title, JSON.parse(p.aliases))
    return { ok: true }
  })

  app.delete('/api/pages/:id/purge', { preHandler: requireEditor }, async (req) => {
    const { id } = req.params as { id: string }
    db.prepare('UPDATE links SET target_id = NULL WHERE target_id = ?').run(id)
    db.prepare('DELETE FROM pages WHERE id = ? AND deleted_at IS NOT NULL').run(id)
    return { ok: true }
  })

  // ---------- history ----------
  app.get('/api/pages/:id/versions', { preHandler: requireUser }, async (req) => {
    const { id } = req.params as { id: string }
    return db.prepare('SELECT id, title, word_count AS wordCount, created_at AS createdAt FROM page_versions WHERE page_id = ? ORDER BY created_at DESC').all(id)
  })

  app.get('/api/versions/:vid', { preHandler: requireUser }, async (req, reply) => {
    const { vid } = req.params as { vid: string }
    const v = db.prepare('SELECT * FROM page_versions WHERE id = ?').get(vid) as any
    if (!v) return reply.code(404).send({ error: 'not found' })
    return { id: v.id, pageId: v.page_id, title: v.title, content: JSON.parse(v.content), createdAt: v.created_at }
  })

  // ---------- zettelkasten ----------
  app.post('/api/workspaces/:ws/zettels', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = z.object({ body: z.string().min(1).max(20000), tags: z.array(z.string()).default([]) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'body required' })
    if (!wsExists(ws)) return reply.code(404).send({ error: 'workspace not found' })
    const id = uid(), t = now()
    db.prepare('INSERT INTO zettels(id,workspace_id,body,tags,created_at) VALUES(?,?,?,?,?)').run(id, ws, b.data.body, JSON.stringify(b.data.tags), t)
    return { id, body: b.data.body, tags: b.data.tags, createdAt: t, pageId: null, processedAt: null }
  })

  app.patch('/api/zettels/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({ body: z.string().max(20000).optional(), tags: z.array(z.string()).optional(), processed: z.boolean().optional() }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const z0 = db.prepare('SELECT * FROM zettels WHERE id = ?').get(id) as any
    if (!z0) return reply.code(404).send({ error: 'not found' })
    db.prepare('UPDATE zettels SET body = ?, tags = ?, processed_at = ? WHERE id = ?').run(
      b.data.body ?? z0.body, b.data.tags ? JSON.stringify(b.data.tags) : z0.tags,
      b.data.processed === undefined ? z0.processed_at : b.data.processed ? now() : null, id)
    return { ok: true }
  })

  app.delete('/api/zettels/:id', { preHandler: requireEditor }, async (req) => {
    const { id } = req.params as { id: string }
    db.prepare('UPDATE zettels SET deleted_at = ? WHERE id = ?').run(now(), id)
    return { ok: true }
  })
}




