import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { addMember, worldRole } from '../access.js'
import { hashPassword, requireOwner, startSession, verifyPassword, type Role } from '../auth.js'
import { db, now } from '../db.js'
import { revalidateLive } from '../live.js'
import { uid } from '../pages.js'
import { worldSettings } from './content.js'

// Invite links: the owner makes a link for a world, anyone who opens it can make an account (or sign in with theirs) and is let into
// that one world as a player or a spectator. Only a hash of the token is stored, so the link is shown once, when it is made.

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

interface InviteRow {
  id: string; workspace_id: string; role: 'editor' | 'viewer'; created_at: number; expires_at: number | null
  max_uses: number | null; uses: number; revoked: number; last_used_at: number | null
}

const statusOf = (r: InviteRow, t = now()) => r.revoked ? 'revoked' : r.expires_at != null && r.expires_at <= t ? 'expired' : r.max_uses != null && r.uses >= r.max_uses ? 'used up' : 'open'

/** The invite behind a token, if it can still be used: not revoked, not expired, not used up, in a world that exists and has invites switched on. */
function usable(token: string) {
  const inv = db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(sha(token)) as InviteRow | undefined
  if (!inv || statusOf(inv) !== 'open') return null
  const w = db.prepare('SELECT name, settings FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(inv.workspace_id) as { name: string; settings: string } | undefined
  if (!w || !worldSettings(w.settings).invites) return null
  return { inv, world: w.name }
}

const invalid = { error: 'This invite link is not valid any more. Ask for a new one.' }

export async function inviteRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/invites', { preHandler: requireOwner }, async (req) => {
    const { ws } = req.params as { ws: string }
    return (db.prepare('SELECT * FROM invites WHERE workspace_id = ? ORDER BY created_at DESC').all(ws) as InviteRow[]).map((r) => ({
      id: r.id, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at, maxUses: r.max_uses, uses: r.uses, lastUsedAt: r.last_used_at, status: statusOf(r),
    }))
  })

  app.post('/api/workspaces/:ws/invites', { preHandler: requireOwner }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = z.object({
      role: z.enum(['editor', 'viewer']),
      /** days the link works, null for no end */
      days: z.number().int().min(1).max(365).nullable(),
      /** how many people may join with it, null for any number */
      maxUses: z.number().int().min(1).max(500).nullable(),
    }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const w = db.prepare('SELECT settings FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(ws) as { settings: string } | undefined
    if (!w) return reply.code(404).send({ error: 'world not found' })
    if (!worldSettings(w.settings).invites) return reply.code(409).send({ error: 'Turn invite links on for this world first.' })
    const token = crypto.randomBytes(32).toString('base64url')
    const id = uid(), t = now()
    db.prepare('INSERT INTO invites(id,workspace_id,token_hash,role,created_by,created_at,expires_at,max_uses) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, ws, sha(token), b.data.role, req.user!.id, t, b.data.days == null ? null : t + b.data.days * 86400_000, b.data.maxUses)
    return { id, token, path: `/join/${token}` }
  })

  app.delete('/api/invites/:id', { preHandler: requireOwner }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!db.prepare('UPDATE invites SET revoked = 1 WHERE id = ?').run(id).changes) return reply.code(404).send({ error: 'not found' })
    return { ok: true }
  })

  // ---- unauthenticated: what the link's page needs, and joining. Nothing about the world leaves except its name and the role offered.
  const limit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }
  const joinLimit = { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }

  app.get('/api/public/invite/:token', limit, async (req, reply) => {
    const found = usable((req.params as { token: string }).token)
    if (!found) return reply.code(404).send(invalid)
    return { world: found.world, role: found.inv.role }
  })

  app.post('/api/public/invite/:token/join', joinLimit, async (req, reply) => {
    const found = usable((req.params as { token: string }).token)
    if (!found) return reply.code(404).send(invalid)
    const b = z.object({ mode: z.enum(['new', 'existing']), username: z.string().trim().min(2).max(50), password: z.string().min(8).max(500) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'Choose a name of at least 2 letters and a password of at least 8 characters.' })
    const { inv } = found
    let user: { id: string; username: string; role: Role }
    if (b.data.mode === 'new') {
      const taken = db.prepare('SELECT 1 FROM users WHERE username = ?').get(b.data.username)
      if (taken) return reply.code(409).send({ error: 'That name is taken. Pick another, or sign in with it if it is yours.' })
      const id = crypto.randomUUID()
      db.transaction(() => {
        db.prepare('INSERT INTO users(id,username,pass_hash,role,created_at) VALUES(?,?,?,?,?)').run(id, b.data.username, hashPassword(b.data.password), inv.role, now())
        addMember(inv.workspace_id, id, inv.role, now())
        db.prepare('UPDATE invites SET uses = uses + 1, last_used_at = ? WHERE id = ?').run(now(), inv.id)
      })()
      user = { id, username: b.data.username, role: inv.role }
    } else {
      const u = db.prepare('SELECT id, username, role, pass_hash FROM users WHERE username = ?').get(b.data.username) as (typeof user & { pass_hash: string }) | undefined
      // always hash, so the time taken does not say whether the name exists
      const ok = verifyPassword(b.data.password, u?.pass_hash ?? hashPassword('x'))
      if (!u || !ok) return reply.code(401).send({ error: 'Invalid username or password' })
      if (u.role === 'owner') return reply.code(400).send({ error: 'You already have access to every world with this account.' })
      user = { id: u.id, username: u.username, role: u.role }
      // someone who is in the world already is just signed in; it does not use up the link
      if (!worldRole({ id: u.id, username: u.username, role: u.role }, inv.workspace_id)) {
        db.transaction(() => {
          addMember(inv.workspace_id, u.id, inv.role, now())
          db.prepare('UPDATE invites SET uses = uses + 1, last_used_at = ? WHERE id = ?').run(now(), inv.id)
        })()
        revalidateLive([u.id])
      }
    }
    startSession(req, reply, user.id)
    return { id: user.id, username: user.username, role: user.role, worldId: inv.workspace_id }
  })
}
