import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireEditor } from '../auth.js'
import { db, now } from '../db.js'
import { templateDoc, type DocNode } from '../doc.js'
import { uid } from '../pages.js'

const docSchema = z.custom<DocNode>((v) => typeof v === 'object' && v !== null && (v as DocNode).type === 'doc')

/** The word typed after "/" to insert the template: lower case, letters and digits joined by hyphens. */
export const slugOf = (name: string) => name.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')

export function templatesOf(ws: string) {
  return (db.prepare(
    'SELECT id, name, slug, description, content, updated_at AS updatedAt FROM templates WHERE workspace_id = ? ORDER BY name COLLATE NOCASE',
  ).all(ws) as any[]).map((t) => ({ ...t, content: JSON.parse(t.content) }))
}

const row = (id: string) => db.prepare('SELECT id, name, slug, description, content, updated_at AS updatedAt, workspace_id AS ws FROM templates WHERE id = ?').get(id) as any

const shape = (r: any) => ({ id: r.id, name: r.name, slug: r.slug, description: r.description, content: JSON.parse(r.content), updatedAt: r.updatedAt })

export async function templateRoutes(app: FastifyInstance) {
  app.post('/api/workspaces/:ws/templates', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = z.object({
      name: z.string().trim().min(1).max(60),
      description: z.string().max(200).optional(),
      content: docSchema.optional(),
    }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    if (!db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(ws)) return reply.code(404).send({ error: 'not found' })
    const slug = slugOf(b.data.name)
    if (!slug) return reply.code(400).send({ error: 'The name needs at least one letter or digit.' })
    if (db.prepare('SELECT 1 FROM templates WHERE workspace_id = ? AND slug = ?').get(ws, slug)) return reply.code(409).send({ error: `There is already a template called /${slug}.` })
    const id = uid(), t = now()
    const content = templateDoc(b.data.content ?? { type: 'doc', content: [{ type: 'paragraph' }] })
    db.prepare('INSERT INTO templates(id,workspace_id,name,slug,description,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, ws, b.data.name, slug, b.data.description ?? '', JSON.stringify(content), t, t)
    return shape(row(id))
  })

  app.patch('/api/templates/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const cur = row(id)
    if (!cur) return reply.code(404).send({ error: 'not found' })
    const b = z.object({
      name: z.string().trim().min(1).max(60).optional(),
      description: z.string().max(200).optional(),
      content: docSchema.optional(),
    }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const name = b.data.name ?? cur.name
    const slug = b.data.name !== undefined ? slugOf(name) : cur.slug
    if (!slug) return reply.code(400).send({ error: 'The name needs at least one letter or digit.' })
    if (slug !== cur.slug && db.prepare('SELECT 1 FROM templates WHERE workspace_id = ? AND slug = ? AND id <> ?').get(cur.ws, slug, id)) {
      return reply.code(409).send({ error: `There is already a template called /${slug}.` })
    }
    const content = b.data.content ? JSON.stringify(templateDoc(b.data.content)) : cur.content
    db.prepare('UPDATE templates SET name=?, slug=?, description=?, content=?, updated_at=? WHERE id=?')
      .run(name, slug, b.data.description ?? cur.description, content, now(), id)
    return shape(row(id))
  })

  app.delete('/api/templates/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!db.prepare('DELETE FROM templates WHERE id = ?').run(id).changes) return reply.code(404).send({ error: 'not found' })
    return { ok: true }
  })
}
