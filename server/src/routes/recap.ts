import type { FastifyInstance } from 'fastify'
import { db } from '../db.js'
import { requireOwner } from '../auth.js'
import { recapLines, sessionStart, type ChatRow } from '../recap.js'

// The table chat of the latest session as plain lines, for the GM to turn into a page. Only what everyone could read.

export async function recapRoutes(app: FastifyInstance) {
  // the latest session as it happened: where the tokens went, and what was said, for the GM to play back
  app.get('/api/workspaces/:ws/replay', { preHandler: requireOwner }, async (req) => {
    const { ws } = req.params as { ws: string }
    const rows = (db.prepare('SELECT ts, kind, scene_id, data FROM session_events WHERE workspace_id = ? ORDER BY ts DESC, id DESC LIMIT 6000').all(ws) as { ts: number; kind: string; scene_id: string | null; data: string }[]).reverse()
    const from = sessionStart(rows.map((r) => r.ts))
    const events = rows.slice(from).map((r) => { let d = {}; try { d = JSON.parse(r.data) } catch { /* left empty */ } return { ts: r.ts, kind: r.kind, scene: r.scene_id, ...d } })
    const start = events[0]?.ts ?? 0, end = events.at(-1)?.ts ?? 0
    const chat = (db.prepare('SELECT ts, name, kind, parts FROM chat_messages WHERE workspace_id = ? AND ts >= ? AND ts <= ? ORDER BY ts').all(ws, start - 60_000, end + 60_000) as { ts: number; name: string; kind: string; parts: string }[])
      .map((r) => { let parts: ChatRow['parts'] = []; try { parts = JSON.parse(r.parts) } catch { /* left empty */ } return { ts: r.ts, name: r.name, kind: r.kind, text: parts.map((p) => (p.t === 'roll' && p.roll ? `${p.roll.label || p.roll.expr || 'a roll'} ${p.roll.total}` : p.text ?? '')).join('').trim() } })
    const scenes = (db.prepare('SELECT id, name, bg, width, height FROM scenes WHERE workspace_id = ?').all(ws) as { id: string; name: string; bg: string; width: number; height: number }[])
    return { events, chat, scenes }
  })

  app.get('/api/workspaces/:ws/recap', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const { ws } = req.params as { ws: string }
    const rows = (db.prepare("SELECT ts, name, kind, parts FROM chat_messages WHERE workspace_id = ? AND kind IN ('say','emote','roll') ORDER BY ts DESC LIMIT 600").all(ws) as { ts: number; name: string; kind: string; parts: string }[])
      .map((r): ChatRow => { let parts: ChatRow['parts'] = []; try { parts = JSON.parse(r.parts) } catch { /* an unreadable message is left out */ } return { ts: r.ts, name: r.name, kind: r.kind, parts } })
    return { lines: recapLines(rows) }
  })
}
