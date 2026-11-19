import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireOwner } from '../auth.js'
import { db, now } from '../db.js'
import { uid } from '../pages.js'

// Prepared fights: which creatures, how many, and the party they are meant for. Only the GM account sees them, so they never spoil a surprise.

const body = z.object({
  name: z.string().trim().min(1).max(120),
  party: z.array(z.number().int().min(1).max(20)).max(12).default([]),
  notes: z.string().max(4000).default(''),
  monsters: z.array(z.object({ pageId: z.string().min(1).max(64), count: z.number().int().min(1).max(50) })).max(40).default([]),
})

const shape = (r: { id: string; name: string; data: string; updated_at: number }) => {
  let d: Partial<z.infer<typeof body>> = {}
  try { d = JSON.parse(r.data) } catch { /* an unreadable row shows as empty */ }
  return { id: r.id, name: r.name, party: d.party ?? [], notes: d.notes ?? '', monsters: d.monsters ?? [], updatedAt: r.updated_at }
}

export const encountersOf = (ws: string) =>
  (db.prepare('SELECT id, name, data, updated_at FROM encounters WHERE workspace_id = ? ORDER BY name COLLATE NOCASE').all(ws) as Parameters<typeof shape>[0][]).map(shape)

export const encounterRow = (id: string, ws: string) => {
  const r = db.prepare('SELECT id, name, data, updated_at FROM encounters WHERE id = ? AND workspace_id = ?').get(id, ws) as Parameters<typeof shape>[0] | undefined
  return r ? shape(r) : undefined
}

/** Pages sent by the client must belong to the same world. */
const allInWorld = (ws: string, ids: string[]) => ids.every((id) => db.prepare('SELECT 1 FROM pages WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(id, ws))

export async function encounterRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/encounters', { preHandler: requireOwner }, async (req) => encountersOf((req.params as { ws: string }).ws))

  app.post('/api/workspaces/:ws/encounters', { preHandler: requireOwner }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = body.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    if (!db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(ws)) return reply.code(404).send({ error: 'not found' })
    if (!allInWorld(ws, b.data.monsters.map((m) => m.pageId))) return reply.code(400).send({ error: 'bad request' })
    const id = uid(), t = now()
    const { name, ...data } = b.data
    db.prepare('INSERT INTO encounters(id,workspace_id,name,data,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, ws, name, JSON.stringify(data), t, t)
    return encounterRow(id, ws)
  })

  app.patch('/api/encounters/:id', { preHandler: requireOwner }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const row = db.prepare('SELECT workspace_id AS w FROM encounters WHERE id = ?').get(id) as { w: string } | undefined
    if (!row) return reply.code(404).send({ error: 'not found' })
    const b = body.safeParse(req.body)
    if (!b.success || !allInWorld(row.w, b.data.monsters.map((m) => m.pageId))) return reply.code(400).send({ error: 'bad request' })
    const { name, ...data } = b.data
    db.prepare('UPDATE encounters SET name = ?, data = ?, updated_at = ? WHERE id = ?').run(name, JSON.stringify(data), now(), id)
    return encounterRow(id, row.w)
  })

  app.delete('/api/encounters/:id', { preHandler: requireOwner }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!db.prepare('DELETE FROM encounters WHERE id = ?').run(id).changes) return reply.code(404).send({ error: 'not found' })
    return { ok: true }
  })
}
