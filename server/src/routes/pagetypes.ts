import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireEditor } from '../auth.js'
import { db, now } from '../db.js'
import { uid } from '../pages.js'

const COLS = 'id, name, icon, tag, source, definition, updated_at AS updatedAt'

const shape = (r: any) => ({ id: r.id, name: r.name, icon: r.icon, tag: r.tag, source: r.source, definition: JSON.parse(r.definition), updatedAt: r.updatedAt })

export function pageTypesOf(ws: string) {
  return (db.prepare(`SELECT ${COLS} FROM page_types WHERE workspace_id = ? ORDER BY name COLLATE NOCASE`).all(ws) as any[]).map(shape)
}

const cleanTag = (t: string) => t.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-')

/** The layout itself is interpreted by the client; the server only stores it, within sane limits. */
const body = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().max(40).default('file-text'),
  tag: z.string().max(100).default(''),
  source: z.string().max(100_000).default(''),
  definition: z.record(z.string(), z.any()).refine((v) => JSON.stringify(v).length < 200_000, 'definition too large'),
})

export async function pageTypeRoutes(app: FastifyInstance) {
  app.post('/api/workspaces/:ws/page-types', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = body.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    if (!db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(ws)) return reply.code(404).send({ error: 'not found' })
    const id = uid(), t = now()
    db.prepare('INSERT INTO page_types(id,workspace_id,name,icon,tag,source,definition,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, ws, b.data.name, b.data.icon, cleanTag(b.data.tag), b.data.source, JSON.stringify(b.data.definition), t, t)
    return shape(db.prepare(`SELECT ${COLS} FROM page_types WHERE id = ?`).get(id))
  })

  app.patch('/api/page-types/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!db.prepare('SELECT 1 FROM page_types WHERE id = ?').get(id)) return reply.code(404).send({ error: 'not found' })
    const b = body.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    db.prepare('UPDATE page_types SET name=?, icon=?, tag=?, source=?, definition=?, updated_at=? WHERE id=?')
      .run(b.data.name, b.data.icon, cleanTag(b.data.tag), b.data.source, JSON.stringify(b.data.definition), now(), id)
    return shape(db.prepare(`SELECT ${COLS} FROM page_types WHERE id = ?`).get(id))
  })

  app.delete('/api/page-types/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!db.prepare('DELETE FROM page_types WHERE id = ?').run(id).changes) return reply.code(404).send({ error: 'not found' })
    return { ok: true }
  })
}
