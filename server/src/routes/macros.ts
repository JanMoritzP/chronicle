import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, now } from '../db.js'
import { uid } from '../pages.js'

// Macros: saved chat lines. Each person keeps their own; the owner account can share one with everyone in the world.
// What a macro contains (queries, references to the selected token) is worked out in the browser when it runs.

const body = z.object({
  name: z.string().trim().min(1).max(60),
  text: z.string().min(1).max(2000),
  shared: z.boolean().default(false),
})

interface Row { id: string; user_id: string; name: string; text: string; shared: number; updated_at: number }
const shape = (r: Row, userId: string) => ({ id: r.id, name: r.name, text: r.text, shared: !!r.shared, mine: r.user_id === userId, updatedAt: r.updated_at })

export async function macroRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/macros', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const { ws } = req.params as { ws: string }
    const rows = db.prepare('SELECT id, user_id, name, text, shared, updated_at FROM macros WHERE workspace_id = ? AND (user_id = ? OR shared = 1) ORDER BY name COLLATE NOCASE').all(ws, req.user.id) as Row[]
    return rows.map((r) => shape(r, req.user!.id))
  })

  app.post('/api/workspaces/:ws/macros', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const { ws } = req.params as { ws: string }
    const b = body.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    if (b.data.shared && req.user.role !== 'owner') return reply.code(403).send({ error: 'Only the GM account can share a macro with everyone.' })
    if ((db.prepare('SELECT COUNT(*) AS n FROM macros WHERE workspace_id = ? AND user_id = ?').get(ws, req.user.id) as { n: number }).n >= 100) return reply.code(409).send({ error: 'That is as many macros as one person can keep here.' })
    const id = uid(), t = now()
    db.prepare('INSERT INTO macros(id,workspace_id,user_id,name,text,shared,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, ws, req.user.id, b.data.name, b.data.text, b.data.shared ? 1 : 0, t, t)
    return shape(db.prepare('SELECT id, user_id, name, text, shared, updated_at FROM macros WHERE id = ?').get(id) as Row, req.user.id)
  })

  app.patch('/api/macros/:id', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const { id } = req.params as { id: string }
    const row = db.prepare('SELECT id, user_id, name, text, shared, updated_at FROM macros WHERE id = ?').get(id) as Row | undefined
    if (!row) return reply.code(404).send({ error: 'not found' })
    if (row.user_id !== req.user.id && req.user.role !== 'owner') return reply.code(403).send({ error: 'This macro is not yours.' })
    const b = body.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    if (b.data.shared && req.user.role !== 'owner') return reply.code(403).send({ error: 'Only the GM account can share a macro with everyone.' })
    db.prepare('UPDATE macros SET name = ?, text = ?, shared = ?, updated_at = ? WHERE id = ?').run(b.data.name, b.data.text, b.data.shared ? 1 : 0, now(), id)
    return shape(db.prepare('SELECT id, user_id, name, text, shared, updated_at FROM macros WHERE id = ?').get(id) as Row, req.user.id)
  })

  app.delete('/api/macros/:id', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const { id } = req.params as { id: string }
    const row = db.prepare('SELECT user_id FROM macros WHERE id = ?').get(id) as { user_id: string } | undefined
    if (!row) return reply.code(404).send({ error: 'not found' })
    if (row.user_id !== req.user.id && req.user.role !== 'owner') return reply.code(403).send({ error: 'This macro is not yours.' })
    db.prepare('DELETE FROM macros WHERE id = ?').run(id)
    return { ok: true }
  })
}
