import type { FastifyInstance } from 'fastify'
import { db } from '../db.js'
import { recapLines, type ChatRow } from '../recap.js'

// The table chat of the latest session as plain lines, for the GM to turn into a page. Only what everyone could read.

export async function recapRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/recap', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const { ws } = req.params as { ws: string }
    const rows = (db.prepare("SELECT ts, name, kind, parts FROM chat_messages WHERE workspace_id = ? AND kind IN ('say','emote','roll') ORDER BY ts DESC LIMIT 600").all(ws) as { ts: number; name: string; kind: string; parts: string }[])
      .map((r): ChatRow => { let parts: ChatRow['parts'] = []; try { parts = JSON.parse(r.parts) } catch { /* an unreadable message is left out */ } return { ts: r.ts, name: r.name, kind: r.kind, parts } })
    return { lines: recapLines(rows) }
  })
}
