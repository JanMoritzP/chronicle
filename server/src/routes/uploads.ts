import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireEditor, requireOwner, requireUser } from '../auth.js'
import { config } from '../config.js'
import { db, now } from '../db.js'
import { uid } from '../pages.js'

export const ALLOWED: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif',
}

/** Sound files for the table's jukebox. */
export const AUDIO: Record<string, string> = {
  'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/webm': '.weba', 'audio/mp4': '.m4a', 'audio/aac': '.aac',
}
/** Looping video for an animated map. */
export const VIDEO: Record<string, string> = { 'video/webm': '.webm', 'video/mp4': '.mp4' }
const ANY: Record<string, string> = { ...ALLOWED, ...AUDIO, ...VIDEO }

export async function uploadRoutes(app: FastifyInstance) {
  app.post('/api/workspaces/:ws/uploads', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'no file' })
    const ext = ANY[file.mimetype]
    if (!ext) { file.file.resume(); return reply.code(415).send({ error: 'Only PNG, JPEG, WebP, GIF and AVIF images, WebM and MP4 video and MP3, OGG, WAV, WebM, M4A and AAC sound files are allowed' }) }
    const id = uid()
    const dest = path.join(config.dataDir, 'uploads', id + ext)
    await pipeline(file.file, fs.createWriteStream(dest))
    if (file.file.truncated) { fs.unlinkSync(dest); return reply.code(413).send({ error: 'File too large' }) }
    const size = fs.statSync(dest).size
    // a world keeps a limited amount of files
    const used = (db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM uploads WHERE workspace_id = ?').get(ws) as { n: number }).n
    if (used + size > config.uploadQuotaMb * 1024 * 1024) { fs.unlinkSync(dest); return reply.code(413).send({ error: `This world has used its ${config.uploadQuotaMb} MB of files. Delete some in the asset library first.` }) }
    db.prepare('INSERT INTO uploads(id,workspace_id,filename,mime,size,created_at) VALUES(?,?,?,?,?,?)')
      .run(id, ws, file.filename.slice(0, 200), file.mimetype, size, now())
    return { id, url: `/api/uploads/${id}`, mime: file.mimetype, size }
  })

  // the asset library: every file of the world, with tags to search by (the owner account only)
  app.get('/api/workspaces/:ws/uploads', { preHandler: requireOwner }, async (req) => {
    const { ws } = req.params as { ws: string }
    const rows = db.prepare('SELECT id, filename, mime, size, created_at, tags FROM uploads WHERE workspace_id = ? ORDER BY created_at DESC').all(ws) as { id: string; filename: string; mime: string; size: number; created_at: number; tags: string }[]
    const used = rows.reduce((n, r) => n + r.size, 0)
    return { quota: config.uploadQuotaMb * 1024 * 1024, used, items: rows.map((r) => ({ id: r.id, url: `/api/uploads/${r.id}`, filename: r.filename, mime: r.mime, size: r.size, createdAt: r.created_at, tags: r.tags ? r.tags.split(',') : [], kind: AUDIO[r.mime] ? 'sound' : 'image' })) }
  })

  app.patch('/api/uploads/:id', { preHandler: requireOwner }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({ tags: z.array(z.string().trim().min(1).max(24).regex(/^[^,]+$/)).max(12), filename: z.string().trim().min(1).max(200).optional() }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    if (!db.prepare('UPDATE uploads SET tags = ?' + (b.data.filename ? ', filename = ?' : '') + ' WHERE id = ?').run(...[[...new Set(b.data.tags.map((t) => t.toLowerCase()))].join(','), ...(b.data.filename ? [b.data.filename] : []), id]).changes) return reply.code(404).send({ error: 'not found' })
    return { ok: true }
  })

  app.delete('/api/uploads/:id', { preHandler: requireOwner }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const row = db.prepare('SELECT mime FROM uploads WHERE id = ?').get(id) as { mime: string } | undefined
    if (!row) return reply.code(404).send({ error: 'not found' })
    db.prepare('DELETE FROM uploads WHERE id = ?').run(id)
    try { fs.unlinkSync(path.join(config.dataDir, 'uploads', id + ANY[row.mime])) } catch { /* the file was already gone */ }
    return { ok: true }
  })

  app.get('/api/uploads/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const row = db.prepare('SELECT mime FROM uploads WHERE id = ?').get(id) as { mime: string } | undefined
    if (!row || !ANY[row.mime]) return reply.code(404).send({ error: 'not found' })
    const file = path.join(config.dataDir, 'uploads', id + ANY[row.mime])
    if (!fs.existsSync(file)) return reply.code(404).send({ error: 'not found' })
    // a video is read in pieces, so that it can loop and be skipped through
    if (VIDEO[row.mime]) {
      const size = fs.statSync(file).size
      const r = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
      if (r && (r[1] || r[2])) {
        const start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2]))
        const end = r[1] && r[2] ? Math.min(size - 1, Number(r[2])) : size - 1
        if (start > end || start >= size) return reply.code(416).header('Content-Range', `bytes */${size}`).send()
        return reply.code(206).header('Content-Type', row.mime).header('Accept-Ranges', 'bytes').header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1).header('X-Content-Type-Options', 'nosniff').send(fs.createReadStream(file, { start, end }))
      }
      reply.header('Accept-Ranges', 'bytes').header('Content-Length', size)
    }
    return reply
      .header('Content-Type', row.mime)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .send(fs.createReadStream(file))
  })
}
