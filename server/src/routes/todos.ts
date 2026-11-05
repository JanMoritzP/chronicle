import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireEditor, requireUser } from '../auth.js'
import { db } from '../db.js'
import type { DocNode } from '../doc.js'
import { applyContent, type PageRow } from '../pages.js'

/** Finds the todo marker with this id and either changes its attributes or removes it. Returns false if it is not in the document. */
function editTodo(doc: DocNode, todoId: string, change: Record<string, any> | null): boolean {
  let hit = false
  const walk = (n: DocNode) => {
    if (!n.content) return
    for (let i = 0; i < n.content.length; i++) {
      const c = n.content[i]
      if (c.type === 'todo' && c.attrs?.id === todoId) {
        hit = true
        if (change) c.attrs = { ...c.attrs, ...change }
        else n.content.splice(i--, 1)
      } else walk(c)
    }
  }
  walk(doc)
  return hit
}

export async function todoRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/todos', { preHandler: requireUser }, async (req) => {
    const { ws } = req.params as { ws: string }
    return (db.prepare(
      `SELECT t.page_id AS pageId, t.todo_id AS id, t.message, t.done, t.context, t.created_at AS createdAt, t.done_at AS doneAt,
              p.title AS pageTitle, p.icon AS pageIcon
       FROM todos t JOIN pages p ON p.id = t.page_id
       WHERE t.workspace_id = ? AND p.deleted_at IS NULL
       ORDER BY t.done, p.title COLLATE NOCASE, t.pos`,
    ).all(ws) as any[]).map((r) => ({ ...r, done: !!r.done }))
  })

  app.patch('/api/pages/:id/todos/:todoId', { preHandler: requireEditor }, async (req, reply) => {
    const { id, todoId } = req.params as { id: string; todoId: string }
    const b = z.object({ done: z.boolean().optional(), message: z.string().max(500).optional() }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const p = db.prepare('SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL').get(id) as PageRow | undefined
    if (!p) return reply.code(404).send({ error: 'not found' })
    const doc = JSON.parse(p.content) as DocNode
    if (!editTodo(doc, todoId, b.data)) return reply.code(404).send({ error: 'This todo is no longer in the page.' })
    applyContent(p, doc)
    return { ok: true }
  })

  app.delete('/api/pages/:id/todos/:todoId', { preHandler: requireEditor }, async (req, reply) => {
    const { id, todoId } = req.params as { id: string; todoId: string }
    const p = db.prepare('SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL').get(id) as PageRow | undefined
    if (!p) return reply.code(404).send({ error: 'not found' })
    const doc = JSON.parse(p.content) as DocNode
    if (!editTodo(doc, todoId, null)) return reply.code(404).send({ error: 'This todo is no longer in the page.' })
    applyContent(p, doc)
    return { ok: true }
  })
}
