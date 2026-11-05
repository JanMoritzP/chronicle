import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireEditor, requireUser } from '../auth.js'
import { db, now } from '../db.js'
import { emptyDoc, ensureHeadingIds, extract } from '../doc.js'
import { recordActivity, reindexLinks, setTags, today, uid } from '../pages.js'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const body = z.object({
  title: z.string().max(200).default(''),
  playedOn: day.optional(),
  tStart: z.number().int().nullable().optional(),
  tEnd: z.number().int().nullable().optional(),
  pageId: z.string().nullable().optional(),
  createPage: z.boolean().optional(),
})

interface SessionRow { id: string; workspace_id: string; number: number; title: string; played_on: string; t_start: number | null; t_end: number | null; page_id: string | null }

const FAR = '9999-12-31'

function statsBetween(ws: string, from: string, to: string) {
  const r = db.prepare(
    `SELECT COALESCE(SUM(created),0) AS pagesCreated, COALESCE(SUM(written),0) AS wordsWritten, COUNT(DISTINCT page_id) AS pagesTouched
     FROM page_activity WHERE workspace_id = ? AND day >= ? AND day < ?`,
  ).get(ws, from, to) as { pagesCreated: number; wordsWritten: number; pagesTouched: number }
  return r
}

function list(ws: string) {
  const rows = db.prepare('SELECT * FROM game_sessions WHERE workspace_id = ? ORDER BY played_on, number').all(ws) as SessionRow[]
  return rows.map((s, i) => {
    // a session owns the days from its own date until the next session starts: the game, the write-up and the prep for next time
    const until = rows[i + 1]?.played_on ?? FAR
    const page = s.page_id ? db.prepare('SELECT title FROM pages WHERE id = ? AND deleted_at IS NULL').get(s.page_id) as { title: string } | undefined : undefined
    return {
      id: s.id, number: s.number, title: s.title, playedOn: s.played_on, tStart: s.t_start, tEnd: s.t_end,
      pageId: page ? s.page_id : null, pageTitle: page?.title ?? null,
      stats: statsBetween(ws, s.played_on, until),
    }
  }).reverse()
}

function sessionDoc(number: number, title: string, playedOn: string) {
  const h = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
  const p = (text?: string) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
  return ensureHeadingIds({
    type: 'doc',
    content: [p(`Session ${number}${title ? `: ${title}` : ''} · played ${playedOn}`), h('Recap'), p(), h('Decisions and consequences'), p(), h('Loose ends'), p(), h('Next session'), p()],
  })
}

function ensureSessionFolder(ws: string): string {
  const f = db.prepare("SELECT id FROM folders WHERE workspace_id = ? AND name = 'Sessions' AND parent_id IS NULL AND deleted_at IS NULL").get(ws) as { id: string } | undefined
  if (f) return f.id
  const id = uid()
  db.prepare("INSERT INTO folders(id,workspace_id,parent_id,name) VALUES(?,?,NULL,'Sessions')").run(id, ws)
  return id
}

export async function sessionRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/sessions', { preHandler: requireUser }, async (req) => {
    const { ws } = req.params as { ws: string }
    return list(ws)
  })

  app.post('/api/workspaces/:ws/sessions', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = body.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad session' })
    const d = b.data
    if (d.tStart != null && d.tEnd != null && d.tEnd < d.tStart) return reply.code(400).send({ error: 'The in-world end is before its start' })
    if (d.pageId && !db.prepare('SELECT 1 FROM pages WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(d.pageId, ws)) return reply.code(400).send({ error: 'Page not found in this world' })
    const id = uid()
    db.transaction(() => {
      const number = ((db.prepare('SELECT MAX(number) m FROM game_sessions WHERE workspace_id = ?').get(ws) as { m: number | null }).m ?? 0) + 1
      const playedOn = d.playedOn ?? today()
      let pageId = d.pageId ?? null
      if (d.createPage && !pageId) {
        pageId = uid()
        const title = `Session ${number}${d.title.trim() ? `: ${d.title.trim()}` : ''}`
        const doc = sessionDoc(number, d.title.trim(), playedOn)
        const t = now()
        db.prepare('INSERT INTO pages(id,workspace_id,folder_id,title,content,props,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(pageId, ws, ensureSessionFolder(ws), title, JSON.stringify(doc), '{}', t, t)
        const ex = reindexLinks(pageId, ws, doc)
        db.prepare('UPDATE pages SET text = ?, outline = ?, word_count = ?, has_stats = 0 WHERE id = ?').run(ex.text, JSON.stringify(ex.outline), ex.wordCount, pageId)
        setTags(pageId, ['session'])
        recordActivity(pageId, ws, ex.wordCount, true)
      }
      db.prepare('INSERT INTO game_sessions(id,workspace_id,number,title,played_on,t_start,t_end,page_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(id, ws, number, d.title.trim(), playedOn, d.tStart ?? null, d.tEnd ?? null, pageId, now())
    })()
    return list(ws).find((s) => s.id === id)
  })

  app.patch('/api/sessions/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = body.partial().safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad session' })
    const s = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(id) as SessionRow | undefined
    if (!s) return reply.code(404).send({ error: 'not found' })
    const d = b.data
    const tStart = d.tStart === undefined ? s.t_start : d.tStart
    const tEnd = d.tEnd === undefined ? s.t_end : d.tEnd
    if (tStart != null && tEnd != null && tEnd < tStart) return reply.code(400).send({ error: 'The in-world end is before its start' })
    const pageId = d.pageId === undefined ? s.page_id : d.pageId
    if (pageId && !db.prepare('SELECT 1 FROM pages WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(pageId, s.workspace_id)) return reply.code(400).send({ error: 'Page not found in this world' })
    db.prepare('UPDATE game_sessions SET title = ?, played_on = ?, t_start = ?, t_end = ?, page_id = ? WHERE id = ?')
      .run(d.title === undefined ? s.title : d.title.trim(), d.playedOn ?? s.played_on, tStart, tEnd, pageId, id)
    return list(s.workspace_id).find((x) => x.id === id)
  })

  app.delete('/api/sessions/:id', { preHandler: requireEditor }, async (req) => {
    const { id } = req.params as { id: string }
    db.prepare('DELETE FROM game_sessions WHERE id = ?').run(id)
    return { ok: true }
  })

  /** Writing statistics for a date range, plus a per-day series and the busiest pages. */
  app.get('/api/workspaces/:ws/stats', { preHandler: requireUser }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const q = z.object({ from: day.optional(), to: day.optional() }).safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: 'bad range' })
    const from = q.data.from ?? '0000-01-01'
    const to = q.data.to ?? FAR // inclusive in the API, exclusive in SQL below
    const toEx = to === FAR ? FAR : new Date(Date.parse(to + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
    const totals = statsBetween(ws, from, toEx)
    const daily = db.prepare(
      `SELECT day, SUM(written) AS words, SUM(created) AS pages FROM page_activity WHERE workspace_id = ? AND day >= ? AND day < ? GROUP BY day ORDER BY day`,
    ).all(ws, from, toEx)
    const top = db.prepare(
      `SELECT a.page_id AS pageId, p.title, SUM(a.written) AS words FROM page_activity a JOIN pages p ON p.id = a.page_id
       WHERE a.workspace_id = ? AND a.day >= ? AND a.day < ? AND p.deleted_at IS NULL GROUP BY a.page_id HAVING words > 0 ORDER BY words DESC LIMIT 8`,
    ).all(ws, from, toEx)
    const all = db.prepare('SELECT COUNT(*) pages, COALESCE(SUM(word_count),0) words FROM pages WHERE workspace_id = ? AND deleted_at IS NULL').get(ws) as { pages: number; words: number }
    return { totals, daily, top, world: all }
  })
}
