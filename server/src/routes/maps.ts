import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { z } from 'zod'
import { requireEditor, requireUser } from '../auth.js'
import { config } from '../config.js'
import { db, now } from '../db.js'
import { uid } from '../pages.js'

const MAX_MAP_BYTES = 600 * 1024 * 1024
const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/avif': '.avif' }

const mapDir = (id: string) => path.join(config.dataDir, 'maps', id)

interface MapRow {
  id: string; workspace_id: string; parent_map_id: string | null; name: string; width: number | null; height: number | null
  max_zoom: number | null; status: string; error: string | null; source_ext: string | null; scale_m_per_px: number | null; created_at: number
}
interface ItemRow {
  id: string; map_id: string; layer_id: string | null; kind: string; title: string; geometry: string; page_id: string | null
  target_map_id: string | null; style: string; time_mode: string; keyframes: string; journey: string | null
  created_at: number; updated_at: number
}

const mapOut = (m: MapRow) => ({
  id: m.id, workspaceId: m.workspace_id, parentMapId: m.parent_map_id, name: m.name, width: m.width, height: m.height,
  maxZoom: m.max_zoom, status: m.status, error: m.error, scale: m.scale_m_per_px, createdAt: m.created_at,
})
const itemOut = (i: ItemRow) => ({
  id: i.id, mapId: i.map_id, layerId: i.layer_id, kind: i.kind, title: i.title, geometry: JSON.parse(i.geometry),
  pageId: i.page_id, targetMapId: i.target_map_id, style: JSON.parse(i.style), timeMode: i.time_mode,
  keyframes: JSON.parse(i.keyframes), journey: i.journey ? JSON.parse(i.journey) : null,
})

// ---------- tiling: one image at a time, so a huge map can't starve the server ----------
const queue: string[] = []
let running = false

function enqueue(id: string) {
  if (!queue.includes(id)) queue.push(id)
  if (!running) void drain()
}

async function drain() {
  running = true
  while (queue.length) {
    const id = queue.shift()!
    try { await tileMap(id) } catch (e: any) {
      console.error('Tiling failed for map', id, e)
      db.prepare("UPDATE maps SET status='error', error=? WHERE id=?").run(String(e?.message ?? e).slice(0, 300), id)
    }
  }
  running = false
}

async function tileMap(id: string) {
  const row = db.prepare('SELECT * FROM maps WHERE id = ?').get(id) as MapRow | undefined
  if (!row?.source_ext) return
  const dir = mapDir(id)
  const src = path.join(dir, 'source' + row.source_ext)
  const tiles = path.join(dir, 'tiles')
  fs.rmSync(tiles, { recursive: true, force: true })
  const meta = await sharp(src, { limitInputPixels: false }).metadata()
  const swap = (meta.orientation ?? 1) >= 5
  const width = swap ? meta.height! : meta.width!
  const height = swap ? meta.width! : meta.height!
  // "google" layout = Leaflet's own grid: zoom z, tile folder z/y/x, edge tiles padded to 256 so nothing is stretched.
  await sharp(src, { limitInputPixels: false })
    .rotate()
    .webp({ quality: 82 })
    .tile({ size: 256, layout: 'google', container: 'fs', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toFile(tiles)
  const levels = fs.readdirSync(tiles).filter((n) => /^\d+$/.test(n)).map(Number)
  db.prepare("UPDATE maps SET status='ready', error=NULL, width=?, height=?, max_zoom=? WHERE id=?")
    .run(width, height, Math.max(...levels), id)
}

/** Maps still marked "processing" were interrupted by a restart; start them again. */
export function resumeTiling() {
  const rows = db.prepare("SELECT id FROM maps WHERE status = 'processing'").all() as { id: string }[]
  for (const r of rows) enqueue(r.id)
}

const num = z.number().finite()
const pt = z.tuple([num, num])
const geometry = z.union([pt, z.array(pt).min(2).max(5000)])
const keyframes = z.array(z.object({ t: z.number().int(), geometry: geometry.optional(), hidden: z.boolean().optional() })).max(500)
const journey = z.object({
  mode: z.string().max(40).default('foot'),
  waypoints: z.array(z.object({ arrive: z.number().int().nullable(), depart: z.number().int().nullable() })).max(5000),
}).nullable()

const itemBody = z.object({
  layerId: z.string().nullable().optional(),
  kind: z.enum(['point', 'line', 'polygon']),
  title: z.string().max(200).default(''),
  geometry,
  pageId: z.string().nullable().optional(),
  targetMapId: z.string().nullable().optional(),
  style: z.record(z.string(), z.any()).default({}),
  timeMode: z.enum(['static', 'timed', 'journey']).default('static'),
  keyframes: keyframes.default([]),
  journey: journey.optional(),
})

// Not itemBody.partial(): that would still apply the .default() values and reset omitted fields.
const itemPatch = z.object({
  layerId: z.string().nullable().optional(),
  title: z.string().max(200).optional(),
  geometry: geometry.optional(),
  pageId: z.string().nullable().optional(),
  targetMapId: z.string().nullable().optional(),
  style: z.record(z.string(), z.any()).optional(),
  timeMode: z.enum(['static', 'timed', 'journey']).optional(),
  keyframes: keyframes.optional(),
  journey: journey.optional(),
})

function geometryMatchesKind(kind: string, g: unknown): boolean {
  if (kind === 'point') return Array.isArray(g) && g.length === 2 && typeof g[0] === 'number'
  const ok = Array.isArray(g) && Array.isArray(g[0])
  if (!ok) return false
  return kind === 'line' ? (g as unknown[]).length >= 2 : (g as unknown[]).length >= 3
}

export async function mapRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/maps', { preHandler: requireUser }, async (req) => {
    const { ws } = req.params as { ws: string }
    return (db.prepare('SELECT * FROM maps WHERE workspace_id = ? ORDER BY created_at').all(ws) as MapRow[]).map(mapOut)
  })

  app.post('/api/workspaces/:ws/maps', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const file = await req.file({ limits: { fileSize: MAX_MAP_BYTES, files: 1 } })
    if (!file) return reply.code(400).send({ error: 'no file' })
    const ext = EXT[file.mimetype]
    if (!ext) { file.file.resume(); return reply.code(415).send({ error: 'Maps must be PNG, JPEG, WebP or AVIF' }) }
    const field = (n: string) => { const f = file.fields[n] as any; return typeof f?.value === 'string' ? f.value : '' }
    const parent = field('parentMapId') || null
    const name = (field('name') || file.filename.replace(/\.[^.]+$/, '') || 'Map').slice(0, 100)
    const id = uid()
    const dir = mapDir(id)
    fs.mkdirSync(dir, { recursive: true })
    const dest = path.join(dir, 'source' + ext)
    await pipeline(file.file, fs.createWriteStream(dest))
    if (file.file.truncated) { fs.rmSync(dir, { recursive: true, force: true }); return reply.code(413).send({ error: 'Map image too large (limit 600 MB)' }) }
    try { await sharp(dest, { limitInputPixels: false }).metadata() } catch {
      fs.rmSync(dir, { recursive: true, force: true })
      return reply.code(415).send({ error: 'Could not read that image' })
    }
    db.prepare('INSERT INTO maps(id,workspace_id,parent_map_id,name,status,source_ext,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, ws, parent, name, 'processing', ext, now())
    db.prepare('INSERT INTO map_layers(id,map_id,name,sort) VALUES(?,?,?,0)').run(uid(), id, 'Default')
    enqueue(id)
    return mapOut(db.prepare('SELECT * FROM maps WHERE id = ?').get(id) as MapRow)
  })

  app.get('/api/maps/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const m = db.prepare('SELECT * FROM maps WHERE id = ?').get(id) as MapRow | undefined
    if (!m) return reply.code(404).send({ error: 'not found' })
    const layers = db.prepare('SELECT id, name, sort, visible FROM map_layers WHERE map_id = ? ORDER BY sort, rowid').all(id)
      .map((l: any) => ({ ...l, visible: !!l.visible }))
    const items = (db.prepare('SELECT * FROM map_items WHERE map_id = ?').all(id) as ItemRow[]).map(itemOut)
    return { ...mapOut(m), layers, items }
  })

  app.patch('/api/maps/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({
      name: z.string().min(1).max(100).optional(),
      parentMapId: z.string().nullable().optional(),
      scale: z.number().positive().nullable().optional(),
    }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    if (b.data.parentMapId === id) return reply.code(400).send({ error: 'A map cannot be its own parent' })
    if (b.data.parentMapId) {
      // refuse cycles
      let cur: string | null = b.data.parentMapId
      for (let n = 0; cur && n < 50; n++) {
        if (cur === id) return reply.code(400).send({ error: 'That would create a loop' })
        cur = (db.prepare('SELECT parent_map_id p FROM maps WHERE id = ?').get(cur) as any)?.p ?? null
      }
    }
    if (b.data.name !== undefined) db.prepare('UPDATE maps SET name = ? WHERE id = ?').run(b.data.name, id)
    if (b.data.parentMapId !== undefined) db.prepare('UPDATE maps SET parent_map_id = ? WHERE id = ?').run(b.data.parentMapId, id)
    if (b.data.scale !== undefined) db.prepare('UPDATE maps SET scale_m_per_px = ? WHERE id = ?').run(b.data.scale, id)
    return { ok: true }
  })

  app.delete('/api/maps/:id', { preHandler: requireEditor }, async (req) => {
    const { id } = req.params as { id: string }
    db.prepare('DELETE FROM maps WHERE id = ?').run(id)
    fs.rmSync(mapDir(id), { recursive: true, force: true })
    return { ok: true }
  })

  app.get('/api/maps/:id/t/:z/:y/:file', { preHandler: requireUser }, async (req, reply) => {
    const { id, z: zoom, y, file } = req.params as { id: string; z: string; y: string; file: string }
    if (!/^[0-9a-f-]{36}$/.test(id) || !/^\d{1,2}$/.test(zoom) || !/^\d{1,6}$/.test(y) || !/^\d{1,6}\.webp$/.test(file)) return reply.code(404).send()
    const p = path.join(mapDir(id), 'tiles', zoom, y, file)
    if (!fs.existsSync(p)) return reply.code(404).send()
    return reply.header('Content-Type', 'image/webp').header('Cache-Control', 'private, max-age=31536000, immutable').send(fs.createReadStream(p))
  })

  // ---------- layers ----------
  app.post('/api/maps/:id/layers', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({ name: z.string().min(1).max(60) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'name required' })
    const sort = ((db.prepare('SELECT MAX(sort) m FROM map_layers WHERE map_id = ?').get(id) as any).m ?? -1) + 1
    const lid = uid()
    db.prepare('INSERT INTO map_layers(id,map_id,name,sort) VALUES(?,?,?,?)').run(lid, id, b.data.name, sort)
    return { id: lid, name: b.data.name, sort, visible: true }
  })

  app.patch('/api/layers/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({ name: z.string().min(1).max(60).optional(), visible: z.boolean().optional(), sort: z.number().int().optional() }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    if (b.data.name !== undefined) db.prepare('UPDATE map_layers SET name = ? WHERE id = ?').run(b.data.name, id)
    if (b.data.visible !== undefined) db.prepare('UPDATE map_layers SET visible = ? WHERE id = ?').run(b.data.visible ? 1 : 0, id)
    if (b.data.sort !== undefined) db.prepare('UPDATE map_layers SET sort = ? WHERE id = ?').run(b.data.sort, id)
    return { ok: true }
  })

  app.delete('/api/layers/:id', { preHandler: requireEditor }, async (req) => {
    const { id } = req.params as { id: string }
    db.prepare('DELETE FROM map_layers WHERE id = ?').run(id)
    return { ok: true }
  })

  // ---------- items ----------
  app.post('/api/maps/:id/items', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = itemBody.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad item' })
    const d = b.data
    if (!geometryMatchesKind(d.kind, d.geometry)) return reply.code(400).send({ error: 'geometry does not fit the item kind' })
    if (d.timeMode === 'journey' && d.kind !== 'line') return reply.code(400).send({ error: 'Only lines can be journeys' })
    const iid = uid()
    db.prepare(
      `INSERT INTO map_items(id,map_id,layer_id,kind,title,geometry,page_id,target_map_id,style,time_mode,keyframes,journey,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(iid, id, d.layerId ?? null, d.kind, d.title, JSON.stringify(d.geometry), d.pageId ?? null, d.targetMapId ?? null,
      JSON.stringify(d.style), d.timeMode, JSON.stringify(d.keyframes), d.journey ? JSON.stringify(d.journey) : null, now(), now())
    return itemOut(db.prepare('SELECT * FROM map_items WHERE id = ?').get(iid) as ItemRow)
  })

  app.patch('/api/items/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const cur = db.prepare('SELECT * FROM map_items WHERE id = ?').get(id) as ItemRow | undefined
    if (!cur) return reply.code(404).send({ error: 'not found' })
    const b = itemPatch.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad item' })
    const d = b.data
    const timeMode = d.timeMode ?? cur.time_mode
    // A line either changes over time or is a journey, never both.
    if (timeMode === 'journey' && cur.kind !== 'line') return reply.code(400).send({ error: 'Only lines can be journeys' })
    if (timeMode === 'journey' && (d.keyframes ?? JSON.parse(cur.keyframes)).length) return reply.code(400).send({ error: 'A journey line cannot also change over time' })
    if (d.geometry !== undefined && !geometryMatchesKind(cur.kind, d.geometry)) return reply.code(400).send({ error: 'geometry does not fit the item kind' })
    db.prepare(
      `UPDATE map_items SET layer_id=?, title=?, geometry=?, page_id=?, target_map_id=?, style=?, time_mode=?, keyframes=?, journey=?, updated_at=? WHERE id=?`,
    ).run(
      d.layerId !== undefined ? d.layerId : cur.layer_id,
      d.title ?? cur.title,
      d.geometry !== undefined ? JSON.stringify(d.geometry) : cur.geometry,
      d.pageId !== undefined ? d.pageId : cur.page_id,
      d.targetMapId !== undefined ? d.targetMapId : cur.target_map_id,
      d.style !== undefined ? JSON.stringify(d.style) : cur.style,
      timeMode,
      d.keyframes !== undefined ? JSON.stringify(d.keyframes) : cur.keyframes,
      d.journey !== undefined ? (d.journey ? JSON.stringify(d.journey) : null) : cur.journey,
      now(), id,
    )
    return itemOut(db.prepare('SELECT * FROM map_items WHERE id = ?').get(id) as ItemRow)
  })

  app.delete('/api/items/:id', { preHandler: requireEditor }, async (req) => {
    const { id } = req.params as { id: string }
    db.prepare('DELETE FROM map_items WHERE id = ?').run(id)
    return { ok: true }
  })

  /** Where a page appears on maps, for the page's "on the map" panel and /pin. */
  app.get('/api/pages/:id/pins', { preHandler: requireUser }, async (req) => {
    const { id } = req.params as { id: string }
    return db.prepare(
      `SELECT i.id, i.map_id AS mapId, m.name AS mapName, i.kind FROM map_items i JOIN maps m ON m.id = i.map_id WHERE i.page_id = ?`,
    ).all(id)
  })
}
