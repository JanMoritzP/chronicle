import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireEditor, requireUser } from '../auth.js'
import { editTodoLive } from '../collab.js'
import { db } from '../db.js'
import type { DocNode } from '../doc.js'
import { replaceContent, type PageRow } from '../pages.js'

/** Finds the comment marker with this id and either changes its attributes or removes it. Returns false if it is not in the document. */
function editComment(doc: DocNode, commentId: string, change: Record<string, any> | null): boolean {
  let hit = false
  const walk = (n: DocNode) => {
    if (!n.content) return
    for (let i = 0; i < n.content.length; i++) {
      const c = n.content[i]
      if (c.type === 'comment' && c.attrs?.id === commentId) {
        hit = true
        if (change) c.attrs = { ...c.attrs, ...change }
        else n.content.splice(i--, 1)
      } else walk(c)
    }
  }
  walk(doc)
  return hit
}

const MISSING = 'This comment is no longer in the page.'

export async function commentRoutes(app: FastifyInstance) {
  /** Everyone who can open the world, for the @ menu and for naming who plays a character: the owners plus the members, with what they may do here. */
  app.get('/api/workspaces/:ws/people', { preHandler: requireUser }, async (req) => {
    const { ws } = req.params as { ws: string }
    return db.prepare(
      `SELECT u.id, u.username, CASE WHEN u.role = 'owner' THEN 'owner' WHEN u.role = 'viewer' THEN 'viewer' ELSE COALESCE(m.role, 'editor') END AS role
       FROM users u LEFT JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = ?
       WHERE u.role = 'owner' OR m.user_id IS NOT NULL
       ORDER BY u.username COLLATE NOCASE`,
    ).all(ws)
  })

  app.get('/api/workspaces/:ws/comments', { preHandler: requireUser }, async (req) => {
    const { ws } = req.params as { ws: string }
    return (db.prepare(
      `SELECT c.page_id AS pageId, c.comment_id AS id, c.from_name AS "from", c.to_name AS "to", c.message, c.done, c.context,
              c.created_at AS createdAt, c.done_at AS doneAt, p.title AS pageTitle, p.icon AS pageIcon
       FROM comments c JOIN pages p ON p.id = c.page_id
       WHERE c.workspace_id = ? AND p.deleted_at IS NULL
       ORDER BY c.done, c.created_at DESC`,
    ).all(ws) as any[]).map((r) => ({ ...r, done: !!r.done }))
  })

  app.patch('/api/pages/:id/comments/:commentId', { preHandler: requireEditor }, async (req, reply) => {
    const { id, commentId } = req.params as { id: string; commentId: string }
    const b = z.object({ done: z.boolean().optional(), message: z.string().max(1000).optional() }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const p = db.prepare('SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL').get(id) as PageRow | undefined
    if (!p) return reply.code(404).send({ error: 'not found' })
    // with the page open somewhere the change goes through the live document, like any other edit
    const live = editTodoLive(id, commentId, b.data, req.user!, 'comment')
    if (live === 'missing') return reply.code(404).send({ error: MISSING })
    if (live === 'ok') return { ok: true }
    const doc = JSON.parse(p.content) as DocNode
    if (!editComment(doc, commentId, b.data)) return reply.code(404).send({ error: MISSING })
    replaceContent(p, doc, req.user!)
    return { ok: true }
  })

  app.delete('/api/pages/:id/comments/:commentId', { preHandler: requireEditor }, async (req, reply) => {
    const { id, commentId } = req.params as { id: string; commentId: string }
    const p = db.prepare('SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL').get(id) as PageRow | undefined
    if (!p) return reply.code(404).send({ error: 'not found' })
    const live = editTodoLive(id, commentId, null, req.user!, 'comment')
    if (live === 'missing') return reply.code(404).send({ error: MISSING })
    if (live === 'ok') return { ok: true }
    const doc = JSON.parse(p.content) as DocNode
    if (!editComment(doc, commentId, null)) return reply.code(404).send({ error: MISSING })
    replaceContent(p, doc, req.user!)
    return { ok: true }
  })
}
