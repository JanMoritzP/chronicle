import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireEditor, requireUser } from '../auth.js'
import { db, now } from '../db.js'
import { uid } from '../pages.js'

const SYMMETRIC = new Set(['spouse', 'sibling'])

const body = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  kind: z.enum(['parent', 'spouse', 'sibling', 'other']),
  label: z.string().max(80).default(''),
})

const out = (r: any) => ({ id: r.id, sourceId: r.source_id, targetId: r.target_id, kind: r.kind, label: r.label })

/** True if `ancestor` is already an ancestor of `of` through parent links (so the new link would make a loop). */
function isAncestor(ws: string, ancestor: string, of: string): boolean {
  const seen = new Set<string>()
  const stack = [of]
  const parentsOf = db.prepare("SELECT source_id FROM relations WHERE workspace_id = ? AND kind = 'parent' AND target_id = ?")
  while (stack.length) {
    const cur = stack.pop()!
    for (const row of parentsOf.all(ws, cur) as { source_id: string }[]) {
      if (row.source_id === ancestor) return true
      if (!seen.has(row.source_id)) { seen.add(row.source_id); stack.push(row.source_id) }
    }
  }
  return false
}

export async function relationRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/relations', { preHandler: requireUser }, async (req) => {
    const { ws } = req.params as { ws: string }
    return (db.prepare(
      `SELECT r.* FROM relations r JOIN pages a ON a.id = r.source_id JOIN pages b ON b.id = r.target_id
       WHERE r.workspace_id = ? AND a.deleted_at IS NULL AND b.deleted_at IS NULL ORDER BY r.created_at`,
    ).all(ws) as any[]).map(out)
  })

  app.post('/api/workspaces/:ws/relations', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = body.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad relation' })
    const d = b.data
    if (d.sourceId === d.targetId) return reply.code(400).send({ error: 'A page cannot be related to itself' })
    const ok = db.prepare('SELECT COUNT(*) n FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND id IN (?, ?)').get(ws, d.sourceId, d.targetId) as { n: number }
    if (ok.n !== 2) return reply.code(400).send({ error: 'Both pages must exist in this world' })
    if (d.kind === 'parent' && isAncestor(ws, d.targetId, d.sourceId)) return reply.code(400).send({ error: 'That would make someone their own ancestor' })

    // symmetric kinds and identical links are stored once
    const dup = db.prepare(
      `SELECT id FROM relations WHERE workspace_id = ? AND kind = ? AND label = ? AND
        ((source_id = ? AND target_id = ?) ${SYMMETRIC.has(d.kind) ? 'OR (source_id = ? AND target_id = ?)' : ''})`,
    ).get(...([ws, d.kind, d.label, d.sourceId, d.targetId, ...(SYMMETRIC.has(d.kind) ? [d.targetId, d.sourceId] : [])] as any[])) as { id: string } | undefined
    if (dup) return reply.code(409).send({ error: 'That relation already exists' })

    const id = uid()
    db.prepare('INSERT INTO relations(id,workspace_id,source_id,target_id,kind,label,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, ws, d.sourceId, d.targetId, d.kind, d.kind === 'other' ? d.label : '', now())
    return out(db.prepare('SELECT * FROM relations WHERE id = ?').get(id))
  })

  app.patch('/api/relations/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({ label: z.string().max(80) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad relation' })
    const r = db.prepare('SELECT * FROM relations WHERE id = ?').get(id) as any
    if (!r) return reply.code(404).send({ error: 'not found' })
    if (r.kind !== 'other') return reply.code(400).send({ error: 'Only custom relations have a label' })
    db.prepare('UPDATE relations SET label = ? WHERE id = ?').run(b.data.label, id)
    return out({ ...r, label: b.data.label })
  })

  app.delete('/api/relations/:id', { preHandler: requireEditor }, async (req) => {
    const { id } = req.params as { id: string }
    db.prepare('DELETE FROM relations WHERE id = ?').run(id)
    return { ok: true }
  })
}
