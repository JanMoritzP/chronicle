import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { addMember, visibleWorldIds, worldRole } from '../access.js'
import { requireEditor, requireOwner, requireUser } from '../auth.js'
import { db, now } from '../db.js'
import { emptyDoc, ensureHeadingIds, type DocNode } from '../doc.js'
import { parseSheet, patchSheet } from '../sheet.js'
import { templatesOf } from './templates.js'
import { pageTypesOf } from './pagetypes.js'
import { statTemplatesOf } from './stattemplates.js'
import { contentHooks, ensureBaseline, pageDerived, pageSummary, portraitOf, recordActivity, recordRevision, reindexLinks, relinkByName, setTags, uid, type PageRow } from '../pages.js'

const docSchema = z.custom<DocNode>((v) => typeof v === 'object' && v !== null && (v as DocNode).type === 'doc')

function wsExists(id: string) {
  return !!db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(id)
}

/** True when the row with this id belongs to the given world, so ids sent by a client can never pull in another world's data. */
function sameWorld(table: 'folders' | 'pages' | 'zettels', id: string, ws: string) {
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND workspace_id = ?`).get(id, ws)
}

/** Props sent whole may carry a sheet; it must be a valid one, and it is stored as parsed (unknown keys dropped). */
function validSheetProps(props: Record<string, any>) {
  if (props.sheet === undefined) return true
  const sheet = parseSheet(props.sheet)
  if (!sheet) return false
  props.sheet = sheet
  return true
}

const settingsSchema = z.object({
  /** Text of the todo every new page starts with; empty turns it off. */
  newPageTodo: z.string().max(200),
  /** The rules the world plays by: the 2014 or the 2024 edition of 5e. */
  system: z.enum(['5e', '5e-2024']),
}).partial()

export const DEFAULT_WORLD_SETTINGS = { newPageTodo: 'Fill me', system: '5e' as '5e' | '5e-2024' }

export function worldSettings(raw: string | null | undefined) {
  let saved: any = {}
  try { saved = JSON.parse(raw || '{}') } catch { /* keep the defaults */ }
  return {
    ...DEFAULT_WORLD_SETTINGS,
    ...(typeof saved.newPageTodo === 'string' ? { newPageTodo: saved.newPageTodo } : {}),
    ...(saved.system === '5e' || saved.system === '5e-2024' ? { system: saved.system as '5e' | '5e-2024' } : {}),
  }
}

/** A new page starts with the world's default todo: alone in a blank page, after the content when a template or capture supplied some. */
function withStarterTodo(doc: DocNode, ws: string, hasContent: boolean): DocNode {
  const row = db.prepare('SELECT settings FROM workspaces WHERE id = ?').get(ws) as { settings: string } | undefined
  const text = worldSettings(row?.settings).newPageTodo.trim()
  if (!text) return doc
  const todo = { type: 'paragraph', content: [{ type: 'todo', attrs: { message: text, done: false } }] }
  return { ...doc, content: hasContent ? [...(doc.content ?? []), todo] : [todo] }
}

export async function contentRoutes(app: FastifyInstance) {
  // ---------- workspaces ----------
  app.get('/api/workspaces', { preHandler: requireUser }, async (req) => {
    const user = req.user!
    const mine = new Set(visibleWorldIds(user))
    return (db.prepare('SELECT id, name, settings, created_at AS createdAt FROM workspaces WHERE deleted_at IS NULL ORDER BY created_at').all() as { id: string; name: string; settings: string; createdAt: number }[])
      .filter((w) => mine.has(w.id))
      .map((w) => ({ ...w, settings: worldSettings(w.settings), role: worldRole(user, w.id) }))
  })

  app.post('/api/workspaces', { preHandler: requireEditor }, async (req, reply) => {
    const b = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'name required' })
    const id = uid()
    db.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run(id, b.data.name, now())
    // the creator can open it; owners reach every world anyway
    if (req.user!.role !== 'owner') addMember(id, req.user!.id, 'editor', now())
    return { id, name: b.data.name, settings: worldSettings('{}'), role: 'editor' }
  })

  app.patch('/api/workspaces/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({ name: z.string().min(1).max(100).optional(), settings: settingsSchema.optional() }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const row = db.prepare('SELECT settings FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(id) as { settings: string } | undefined
    if (!row) return reply.code(404).send({ error: 'world not found' })
    if (b.data.name) db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(b.data.name, id)
    if (b.data.settings) db.prepare('UPDATE workspaces SET settings = ? WHERE id = ?').run(JSON.stringify({ ...worldSettings(row.settings), ...b.data.settings }), id)
    return { ok: true, settings: worldSettings((db.prepare('SELECT settings FROM workspaces WHERE id = ?').get(id) as { settings: string }).settings) }
  })

  app.delete('/api/workspaces/:id', { preHandler: requireOwner }, async (req) => {
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
      `SELECT l.source_id AS sourceId, l.target_id AS targetId, l.target_name AS targetName, l.anchor, l.embed, l.lib_key AS libKey
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
          hasStats: !!p.has_stats, portrait: portraitOf(p, props), type: props?.type ?? null, library: props?.library ?? null,
          wordCount: p.word_count, createdAt: p.created_at, updatedAt: p.updated_at, todos: todoMap.get(p.id) ?? 0,
        }
      }),
    }
  })

  app.get('/api/workspaces/:ws/links', { preHandler: requireUser }, async (req) => {
    const { ws } = req.params as { ws: string }
    return db.prepare(
      `SELECT l.source_id AS sourceId, l.target_id AS targetId, l.target_name AS targetName, l.anchor, l.embed, l.lib_key AS libKey
       FROM links l JOIN pages p ON p.id = l.source_id WHERE p.workspace_id = ? AND p.deleted_at IS NULL`,
    ).all(ws)
  })

  // ---------- folders ----------
  app.post('/api/workspaces/:ws/folders', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = z.object({ name: z.string().min(1).max(100), parentId: z.string().nullable().optional() }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    if (b.data.parentId && !sameWorld('folders', b.data.parentId, ws)) return reply.code(400).send({ error: 'bad request' })
    const id = uid()
    db.prepare('INSERT INTO folders(id,workspace_id,parent_id,name) VALUES(?,?,?,?)').run(id, ws, b.data.parentId ?? null, b.data.name)
    return { id, parentId: b.data.parentId ?? null, name: b.data.name, sort: 0 }
  })

  app.patch('/api/folders/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({ name: z.string().min(1).max(100).optional(), parentId: z.string().nullable().optional(), sort: z.number().optional() }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const own = db.prepare('SELECT workspace_id AS w FROM folders WHERE id = ?').get(id) as { w: string } | undefined
    if (own && b.data.parentId && !sameWorld('folders', b.data.parentId, own.w)) return reply.code(400).send({ error: 'bad request' })
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
    if (b.data.folderId && !sameWorld('folders', b.data.folderId, ws)) return reply.code(400).send({ error: 'bad request' })
    if (b.data.sourceZettelId && !sameWorld('zettels', b.data.sourceZettelId, ws)) return reply.code(400).send({ error: 'bad request' })
    if (b.data.props && !validSheetProps(b.data.props)) return reply.code(400).send({ error: 'bad request' })
    const id = uid()
    const doc = ensureHeadingIds(withStarterTodo(b.data.content ?? emptyDoc(), ws, !!b.data.content))
    const t = now()
    db.transaction(() => {
      db.prepare(
        `INSERT INTO pages(id,workspace_id,folder_id,title,content,props,source_zettel_id,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      ).run(id, ws, b.data.folderId ?? null, b.data.title, JSON.stringify(doc), JSON.stringify(b.data.props ?? {}), b.data.sourceZettelId ?? null, t, t)
      const ex = reindexLinks(id, ws, doc)
      db.prepare('UPDATE pages SET text = ?, outline = ?, word_count = ?, has_stats = ? WHERE id = ?').run(ex.text, JSON.stringify(ex.outline), ex.wordCount, ex.hasStats ? 1 : 0, id)
      if (b.data.tags) setTags(id, b.data.tags)
      // text imported from the library was not written by the user, so it does not count as words written
      const imported = typeof b.data.props?.library === 'string' && b.data.props.library !== ''
      recordActivity(id, ws, imported ? 0 : ex.wordCount, true)
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
      /** Changes to single fields, merged into the stored props, so two people editing different fields do not overwrite each other. A null value removes the field. */
      propsPatch: z.object({
        data: z.record(z.string(), z.any()).optional(),
        portrait: z.string().nullable().optional(),
        type: z.string().nullable().optional(),
        /** Sheet fields by path ("hp.max"); see server/src/sheet.ts. */
        sheet: z.record(z.string(), z.any()).optional(),
      }).optional(),
    }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const p = db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as PageRow | undefined
    if (!p) return reply.code(404).send({ error: 'not found' })
    const d = b.data
    if (d.folderId && !sameWorld('folders', d.folderId, p.workspace_id)) return reply.code(400).send({ error: 'bad request' })
    if (d.props && !validSheetProps(d.props)) return reply.code(400).send({ error: 'bad request' })
    if (d.propsPatch) {
      const merged: any = { ...(d.props ?? JSON.parse(p.props)) }
      const pp = d.propsPatch
      if (pp.data) {
        merged.data = { ...(merged.data ?? {}) }
        for (const [k, v] of Object.entries(pp.data)) { if (v === null || v === '') delete merged.data[k]; else merged.data[k] = v }
        // the old stat block is the source until the sheet is edited itself: changing it drops a sheet made from the earlier text
        if ('main' in pp.data && !pp.sheet) delete merged.sheet
      }
      if (pp.sheet) {
        const sheet = patchSheet(merged.sheet, pp.sheet)
        if (!sheet) return reply.code(400).send({ error: 'bad request' })
        merged.sheet = sheet
      }
      for (const k of ['portrait', 'type'] as const) {
        if (pp[k] === undefined) continue
        if (pp[k]) merged[k] = pp[k]; else delete merged[k]
      }
      d.props = merged
    }
    if (d.content) ensureHeadingIds(d.content)

    db.transaction(() => {
      ensureBaseline(id)
      const title = d.title ?? p.title
      const aliases = d.aliases ?? (JSON.parse(p.aliases) as string[])
      let content = p.content, text = p.text, outline = p.outline, wc = p.word_count, hasStats = p.has_stats
      if (d.content) {
        content = JSON.stringify(d.content)
        const ex = reindexLinks(id, p.workspace_id, d.content, d.props ?? JSON.parse(p.props))
        text = ex.text; outline = JSON.stringify(ex.outline); wc = ex.wordCount; hasStats = ex.hasStats ? 1 : 0
        recordActivity(id, p.workspace_id, ex.wordCount - p.word_count)
      }
      db.prepare(
        `UPDATE pages SET title=?, icon=?, folder_id=?, aliases=?, content=?, text=?, outline=?, word_count=?, has_stats=?, props=?, updated_at=? WHERE id=?`,
      ).run(
        title, d.icon === undefined ? p.icon : d.icon, d.folderId === undefined ? p.folder_id : d.folderId,
        JSON.stringify(aliases), content, text, outline, wc, hasStats, d.props ? JSON.stringify(d.props) : p.props, now(), id,
      )
      // linked fields live in props, so a props-only save has to refresh the link index too
      if (d.props && !d.content) reindexLinks(id, p.workspace_id, JSON.parse(p.content) as DocNode, d.props)
      if (d.tags) setTags(id, d.tags)
      if (d.title !== undefined || d.aliases) relinkByName(p.workspace_id, id, title, aliases)
      recordRevision(id, req.user!)
    })()
    // a document sent over REST replaces whatever is being edited live; open editors reload it
    if (d.content) contentHooks.replaced(id)
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
    return db.prepare(
      `SELECT id, title, word_count AS wordCount, created_at AS createdAt, author_name AS authorName, reason, restored_from AS restoredFrom
       FROM page_versions WHERE page_id = ? ORDER BY created_at DESC, rowid DESC`,
    ).all(id)
  })

  app.get('/api/versions/:vid', { preHandler: requireUser }, async (req, reply) => {
    const { vid } = req.params as { vid: string }
    const v = db.prepare('SELECT * FROM page_versions WHERE id = ?').get(vid) as any
    if (!v) return reply.code(404).send({ error: 'not found' })
    return { id: v.id, pageId: v.page_id, title: v.title, content: JSON.parse(v.content), createdAt: v.created_at, authorName: v.author_name, meta: v.meta ? JSON.parse(v.meta) : null }
  })

  // Puts the whole page back as it was in a version: text, title, special-page fields, portrait, icon, aliases and tags. The restore is itself a history entry.
  app.post('/api/versions/:vid/restore', { preHandler: requireEditor }, async (req, reply) => {
    const { vid } = req.params as { vid: string }
    const v = db.prepare('SELECT * FROM page_versions WHERE id = ?').get(vid) as any
    if (!v) return reply.code(404).send({ error: 'not found' })
    const p = db.prepare('SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL').get(v.page_id) as PageRow | undefined
    if (!p) return reply.code(404).send({ error: 'not found' })
    const doc = ensureHeadingIds(JSON.parse(v.content) as DocNode)
    const meta = v.meta ? JSON.parse(v.meta) as { icon: string | null; aliases: string[]; tags: string[] } : null
    db.transaction(() => {
      // a live editor may not have saved yet; make sure what is on the page now is in the history before it is replaced
      recordRevision(p.id, null)
      const aliases = meta?.aliases ?? (JSON.parse(p.aliases) as string[])
      const props = v.props ?? p.props
      const ex = reindexLinks(p.id, p.workspace_id, doc, JSON.parse(props))
      recordActivity(p.id, p.workspace_id, ex.wordCount - p.word_count)
      db.prepare('UPDATE pages SET title=?, icon=?, aliases=?, content=?, text=?, outline=?, word_count=?, has_stats=?, props=?, updated_at=? WHERE id=?')
        .run(v.title, meta ? meta.icon : p.icon, JSON.stringify(aliases), JSON.stringify(doc), ex.text, JSON.stringify(ex.outline), ex.wordCount, ex.hasStats ? 1 : 0, props, now(), p.id)
      if (meta) setTags(p.id, meta.tags)
      relinkByName(p.workspace_id, p.id, v.title, aliases)
      recordRevision(p.id, req.user!, { reason: 'restore', restoredFrom: v.created_at })
    })()
    contentHooks.replaced(p.id)
    const s = pageSummary(db.prepare('SELECT * FROM pages WHERE id = ?').get(p.id) as PageRow)
    return { ...pageDerived(p.id), title: s.title, icon: s.icon, aliases: s.aliases, tags: s.tags }
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




