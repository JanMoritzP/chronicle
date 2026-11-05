import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireEditor, requireUser } from '../auth.js'
import { db, now } from '../db.js'
import { uid } from '../pages.js'

const unit = z.object({
  name: z.string().min(1).max(40),
  days: z.number().int().min(1).max(10000).optional(),
  children: z.array(z.object({ name: z.string().min(1).max(40), days: z.number().int().min(1).max(10000) })).max(100).optional(),
})

/**
 * Calendar shape: Year → up to two named sub-levels → days. No leap years.
 * levels = 0: the year is just `yearDays` days.
 * levels = 1: `units` are e.g. months, each with `days`.
 * levels = 2: `units` are e.g. seasons, each with `children` (months) that have `days`.
 */
export const calendarSchema = z.object({
  yearLabel: z.string().min(1).max(30),
  startYear: z.number().int(),
  levels: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  level1Label: z.string().max(30).default(''),
  level2Label: z.string().max(30).default(''),
  dayLabel: z.string().min(1).max(30),
  yearDays: z.number().int().min(0).max(100000).default(360),
  units: z.array(unit).max(100),
})

const DEFAULT_CALENDAR = {
  yearLabel: 'Year', startYear: 1, levels: 1, level1Label: 'Month', level2Label: '', dayLabel: 'Day', yearDays: 360,
  units: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    .map((name) => ({ name, days: 30 })),
}

export async function timelineRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/calendar', { preHandler: requireUser }, async (req) => {
    const { ws } = req.params as { ws: string }
    const row = db.prepare('SELECT definition FROM calendars WHERE workspace_id = ?').get(ws) as { definition: string } | undefined
    return row ? { custom: true, calendar: JSON.parse(row.definition) } : { custom: false, calendar: DEFAULT_CALENDAR }
  })

  app.put('/api/workspaces/:ws/calendar', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = calendarSchema.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'Invalid calendar' })
    const c = b.data
    if (c.levels === 0 && !c.yearDays) return reply.code(400).send({ error: 'The year needs a day count' })
    if (c.levels === 1 && (!c.units.length || c.units.some((u) => !u.days))) return reply.code(400).send({ error: 'Every unit needs a day count' })
    if (c.levels === 2 && (!c.units.length || c.units.some((u) => !u.children?.length))) return reply.code(400).send({ error: 'Every top-level unit needs sub-units' })
    db.prepare('INSERT INTO calendars(workspace_id, definition) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET definition=excluded.definition')
      .run(ws, JSON.stringify(c))
    return { ok: true }
  })

  // ---------- events (a page can have a time without being on any map) ----------
  app.get('/api/workspaces/:ws/events', { preHandler: requireUser }, async (req) => {
    const { ws } = req.params as { ws: string }
    return db.prepare(
      `SELECT id, page_id AS pageId, title, t_start AS tStart, t_end AS tEnd FROM events WHERE workspace_id = ? ORDER BY t_start`,
    ).all(ws)
  })

  const eventBody = z.object({
    pageId: z.string().nullable().optional(),
    title: z.string().min(1).max(200),
    tStart: z.number().int(),
    tEnd: z.number().int().nullable().optional(),
  })

  app.post('/api/workspaces/:ws/events', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = eventBody.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad event' })
    const d = b.data
    if (d.tEnd != null && d.tEnd < d.tStart) return reply.code(400).send({ error: 'End is before start' })
    const id = uid()
    db.prepare('INSERT INTO events(id,workspace_id,page_id,title,t_start,t_end,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, ws, d.pageId ?? null, d.title, d.tStart, d.tEnd ?? null, now())
    return { id, pageId: d.pageId ?? null, title: d.title, tStart: d.tStart, tEnd: d.tEnd ?? null }
  })

  app.patch('/api/events/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const cur = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as any
    if (!cur) return reply.code(404).send({ error: 'not found' })
    const b = eventBody.partial().safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad event' })
    const d = b.data
    const tStart = d.tStart ?? cur.t_start
    const tEnd = d.tEnd !== undefined ? d.tEnd : cur.t_end
    if (tEnd != null && tEnd < tStart) return reply.code(400).send({ error: 'End is before start' })
    db.prepare('UPDATE events SET title=?, page_id=?, t_start=?, t_end=? WHERE id=?')
      .run(d.title ?? cur.title, d.pageId !== undefined ? d.pageId : cur.page_id, tStart, tEnd, id)
    return { id, pageId: d.pageId !== undefined ? d.pageId : cur.page_id, title: d.title ?? cur.title, tStart, tEnd }
  })

  app.delete('/api/events/:id', { preHandler: requireEditor }, async (req) => {
    const { id } = req.params as { id: string }
    db.prepare('DELETE FROM events WHERE id = ?').run(id)
    return { ok: true }
  })
}
