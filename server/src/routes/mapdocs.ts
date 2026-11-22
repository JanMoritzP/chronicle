import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireOwner } from '../auth.js'
import { db, now } from '../db.js'

// What the map editor made a scene from, so the map can be opened in the editor again. Only the owner account (the GM) reads and writes it.

const doc = z.object({
  v: z.literal(1),
  cols: z.number().int().min(5).max(100), rows: z.number().int().min(5).max(100),
  floor: z.array(z.string().regex(/^[01]*$/)).max(100),
  doors: z.array(z.object({ x: z.number().int().min(0).max(99), y: z.number().int().min(0).max(99), side: z.enum(['n', 'w']), kind: z.enum(['door', 'secret', 'window']).optional() })).max(400),
  diag: z.array(z.object({ x1: z.number().int().min(0).max(100), y1: z.number().int().min(0).max(100), x2: z.number().int().min(0).max(100), y2: z.number().int().min(0).max(100) })).max(300).optional(),
  props: z.array(z.object({ x: z.number().int().min(0).max(99), y: z.number().int().min(0).max(99), kind: z.string().max(20), turn: z.number().int().min(0).max(3), image: z.string().regex(/^\/api\/uploads\/[A-Za-z0-9-]+$/).optional(), size: z.number().min(0.5).max(20).optional() })).max(600),
  lights: z.array(z.object({ x: z.number().int().min(0).max(99), y: z.number().int().min(0).max(99), radius: z.number().min(1).max(30), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).max(100),
  theme: z.enum(['stone', 'cave', 'wood', 'ice']),
}).refine((d) => d.floor.length === d.rows && d.floor.every((r) => r.length === d.cols), 'the floor does not match the size')

export async function mapDocRoutes(app: FastifyInstance) {
  const sceneIn = (ws: string, scene: string) => !!db.prepare('SELECT 1 FROM scenes WHERE id = ? AND workspace_id = ?').get(scene, ws)

  app.get('/api/workspaces/:ws/scenes/:scene/map-doc', { preHandler: requireOwner }, async (req, reply) => {
    const { ws, scene } = req.params as { ws: string; scene: string }
    if (!sceneIn(ws, scene)) return reply.code(404).send({ error: 'not found' })
    const row = db.prepare('SELECT doc FROM map_docs WHERE scene_id = ?').get(scene) as { doc: string } | undefined
    return { doc: row ? JSON.parse(row.doc) : null }
  })

  app.put('/api/workspaces/:ws/scenes/:scene/map-doc', { preHandler: requireOwner }, async (req, reply) => {
    const { ws, scene } = req.params as { ws: string; scene: string }
    if (!sceneIn(ws, scene)) return reply.code(404).send({ error: 'not found' })
    const b = z.object({ doc }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'That map could not be saved.' })
    db.prepare('INSERT INTO map_docs(scene_id,workspace_id,doc,updated_at) VALUES(?,?,?,?) ON CONFLICT(scene_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at').run(scene, ws, JSON.stringify(b.data.doc), now())
    return { ok: true }
  })
}
