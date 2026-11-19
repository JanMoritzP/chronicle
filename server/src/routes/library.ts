import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireEditor, requireOwner, requireUser } from '../auth.js'
import { db, now } from '../db.js'
import type { DocNode } from '../doc.js'
import { libraryEntry, libraryIndex, libraryStatus, refreshLibrary } from '../library.js'
import { ensureBaseline, replaceContent, type PageRow } from '../pages.js'
import { propsStatData, rewriteDataRefs } from '../refs.js'

export async function libraryRoutes(app: FastifyInstance) {
  app.get('/api/library/status', { preHandler: requireUser }, async () => libraryStatus())

  // The download runs in the background (about a minute); the client polls the status.
  app.post('/api/library/refresh', { preHandler: requireOwner }, async () => {
    void refreshLibrary()
    return { ...libraryStatus(), running: true }
  })

  app.get('/api/library/index', { preHandler: requireUser }, async () => libraryIndex())

  app.get('/api/library/entries/:key', { preHandler: requireUser }, async (req, reply) => {
    const { key } = req.params as { key: string }
    if (!/^[\w.:-]{1,200}$/.test(key)) return reply.code(400).send({ error: 'bad request' })
    const e = libraryEntry(key)
    if (!e) return reply.code(404).send({ error: 'This entry is not in the library.' })
    return e
  })

  // After an entry was imported as a page: every link to the library entry in this world now points at that page.
  app.post('/api/workspaces/:ws/library-links/repoint', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = z.object({ libKey: z.string().max(200), pageId: z.string() }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const target = db.prepare('SELECT id, title FROM pages WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(b.data.pageId, ws) as { id: string; title: string } | undefined
    if (!target) return reply.code(404).send({ error: 'not found' })

    const sources = db.prepare(
      `SELECT DISTINCT p.* FROM links l JOIN pages p ON p.id = l.source_id
       WHERE l.lib_key = ? AND p.workspace_id = ? AND p.deleted_at IS NULL`,
    ).all(b.data.libKey, ws) as PageRow[]
    let changed = 0
    for (const p of sources) {
      const doc = JSON.parse(p.content) as DocNode
      let hit = 0
      // linked fields (class, species, spells...) keep their entries in props
      const props = JSON.parse(p.props)
      let fieldHit = 0
      for (const v of Object.values(props?.data ?? {})) {
        if (!Array.isArray(v)) continue
        for (const r of v as any[]) {
          if (r && r.libKey === b.data.libKey) { delete r.libKey; r.pageId = target.id; r.name = target.title; fieldHit++ }
        }
      }
      // stat block slots of special pages
      const moveRef = (r: { libKey?: string; note?: string }) => (r.libKey === b.data.libKey ? { name: target.title, pageId: target.id, ...(r.note ? { note: r.note } : {}) } : null)
      for (const d of propsStatData(props)) fieldHit += rewriteDataRefs(d, moveRef)
      if (fieldHit) ensureBaseline(p.id)
      if (fieldHit) db.prepare('UPDATE pages SET props = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(props), now(), p.id)
      const walk = (n: DocNode) => {
        if (n.type === 'statblock') hit += rewriteDataRefs(n.attrs?.data, moveRef)
        if (n.type === 'wikilink' && n.attrs?.libKey === b.data.libKey) {
          const shown = String(n.attrs.alias || n.attrs.name || '')
          n.attrs = { ...n.attrs, name: target.title, pageId: target.id, libKey: null, anchor: null, anchorText: null, alias: shown && shown.toLowerCase() !== target.title.toLowerCase() ? shown : null }
          hit++
        }
        n.content?.forEach(walk)
      }
      walk(doc)
      if (hit || fieldHit) { replaceContent(p, doc, req.user!); changed++ }
    }
    return { changed }
  })
}
