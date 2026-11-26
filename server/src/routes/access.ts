import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { addMember } from '../access.js'
import { requireUser } from '../auth.js'
import { revalidateCollab } from '../collab.js'
import { db, now } from '../db.js'
import { publishWorld, revalidateLive } from '../live.js'
import { ruleSchema, storedRule, type AccessRule } from '../pageAccess.js'
import { memberIds } from '../players.js'
import { revalidateTable } from '../table.js'

/** Members of a world with what they are in it. Owner accounts are GMs of every world and are listed too, as owners. */
export function membersOf(ws: string) {
  return (db.prepare(
    `SELECT u.id, u.username, u.role AS account, m.role, m.gm
     FROM users u LEFT JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = ?
     WHERE u.role = 'owner' OR m.user_id IS NOT NULL
     ORDER BY u.username COLLATE NOCASE`,
  ).all(ws) as { id: string; username: string; account: string; role: string | null; gm: number | null }[]).map((r) => ({
    id: r.id, username: r.username,
    role: r.account === 'owner' ? 'owner' : r.account === 'viewer' ? 'viewer' : r.gm && r.role === 'editor' ? 'gm' : (r.role ?? 'editor'),
    /** a read-only account can never write, whatever its role in the world */
    readOnlyAccount: r.account === 'viewer',
  }))
}

const onlyGm = (req: FastifyRequest, reply: FastifyReply) => {
  if (req.worldRole !== 'gm') { reply.code(403).send({ error: 'Only a GM can change who sees what.' }); return false }
  return true
}

/** A rule keeps only people who are members of the world: an id from elsewhere means nothing here. */
function cleanRule(ws: string, rule: AccessRule | null): AccessRule | null {
  if (!rule) return null
  const members = memberIds(ws)
  const people = Object.fromEntries(Object.entries(rule.people ?? {}).filter(([id]) => members.has(id)))
  return { ...(rule.everyone ? { everyone: rule.everyone } : {}), ...(Object.keys(people).length ? { people } : {}) }
}

/** What others see changed: their lists reload, live editors are checked again, and so is the table. */
function afterRuleChange(ws: string) {
  revalidateCollab()
  publishWorld(ws, { k: 'refresh', area: 'access' })
}

export async function accessRuleRoutes(app: FastifyInstance) {
  const body = z.object({ rule: ruleSchema.nullable() })

  app.put('/api/pages/:id/access', { preHandler: requireUser }, async (req, reply) => {
    if (!onlyGm(req, reply)) return
    const { id } = req.params as { id: string }
    const b = body.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const ws = req.worldId!
    db.prepare('UPDATE pages SET access = ? WHERE id = ?').run(storedRule(cleanRule(ws, b.data.rule)), id)
    afterRuleChange(ws)
    return { ok: true }
  })

  app.put('/api/folders/:id/access', { preHandler: requireUser }, async (req, reply) => {
    if (!onlyGm(req, reply)) return
    const { id } = req.params as { id: string }
    const b = body.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const ws = req.worldId!
    db.prepare('UPDATE folders SET access = ? WHERE id = ?').run(storedRule(cleanRule(ws, b.data.rule)), id)
    afterRuleChange(ws)
    return { ok: true }
  })

  app.get('/api/workspaces/:ws/members', { preHandler: requireUser }, async (req) => {
    const { ws } = req.params as { ws: string }
    return membersOf(ws)
  })

  // Adding and removing people stays with the admin dashboard and invite links; a GM decides what each member is in the world.
  app.put('/api/workspaces/:ws/members/:userId', { preHandler: requireUser }, async (req, reply) => {
    if (!onlyGm(req, reply)) return
    const { ws, userId } = req.params as { ws: string; userId: string }
    const b = z.object({ role: z.enum(['gm', 'editor', 'viewer']) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const member = membersOf(ws).find((m) => m.id === userId)
    if (!member || member.role === 'owner') return reply.code(404).send({ error: 'That person is not a member of this world.' })
    if (member.readOnlyAccount && b.data.role !== 'viewer') return reply.code(400).send({ error: 'This account only reads. An admin can change that in the dashboard.' })
    addMember(ws, userId, b.data.role, now())
    revalidateLive([userId]); revalidateCollab([userId]); revalidateTable([userId])
    publishWorld(ws, { k: 'refresh', area: 'access' })
    return { ok: true }
  })
}
