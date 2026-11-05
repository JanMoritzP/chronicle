import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireEditor } from '../auth.js'
import { db, now } from '../db.js'
import { uid } from '../pages.js'

const COLS = 'id, name, definition, updated_at AS updatedAt'

const shape = (r: any) => ({ id: r.id, name: r.name, sections: JSON.parse(r.definition).sections ?? [], updatedAt: r.updatedAt })

export function statTemplatesOf(ws: string) {
  return (db.prepare(`SELECT ${COLS} FROM stat_templates WHERE workspace_id = ? ORDER BY name COLLATE NOCASE`).all(ws) as any[]).map(shape)
}

/** The sections are interpreted (and sanitised) by the client; the server only stores them within sane limits. */
const body = z.object({
  name: z.string().trim().min(1).max(80),
  sections: z.array(z.record(z.string(), z.any())).max(300).refine((v) => JSON.stringify(v).length < 200_000, 'template too large'),
})

export async function statTemplateRoutes(app: FastifyInstance) {
  app.post('/api/workspaces/:ws/stat-templates', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = body.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    if (!db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(ws)) return reply.code(404).send({ error: 'not found' })
    const id = uid(), t = now()
    db.prepare('INSERT INTO stat_templates(id,workspace_id,name,definition,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(id, ws, b.data.name, JSON.stringify({ sections: b.data.sections }), t, t)
    return shape(db.prepare(`SELECT ${COLS} FROM stat_templates WHERE id = ?`).get(id))
  })

  app.patch('/api/stat-templates/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!db.prepare('SELECT 1 FROM stat_templates WHERE id = ?').get(id)) return reply.code(404).send({ error: 'not found' })
    const b = body.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    db.prepare('UPDATE stat_templates SET name=?, definition=?, updated_at=? WHERE id=?')
      .run(b.data.name, JSON.stringify({ sections: b.data.sections }), now(), id)
    return shape(db.prepare(`SELECT ${COLS} FROM stat_templates WHERE id = ?`).get(id))
  })

  app.delete('/api/stat-templates/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!db.prepare('DELETE FROM stat_templates WHERE id = ?').run(id).changes) return reply.code(404).send({ error: 'not found' })
    return { ok: true }
  })
}
