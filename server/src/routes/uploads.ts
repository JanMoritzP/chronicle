import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import { requireEditor, requireUser } from '../auth.js'
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
const ANY: Record<string, string> = { ...ALLOWED, ...AUDIO }

export async function uploadRoutes(app: FastifyInstance) {
  app.post('/api/workspaces/:ws/uploads', { preHandler: requireEditor }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'no file' })
    const ext = ANY[file.mimetype]
    if (!ext) { file.file.resume(); return reply.code(415).send({ error: 'Only PNG, JPEG, WebP, GIF and AVIF images and MP3, OGG, WAV, WebM, M4A and AAC sound files are allowed' }) }
    const id = uid()
    const dest = path.join(config.dataDir, 'uploads', id + ext)
    await pipeline(file.file, fs.createWriteStream(dest))
    if (file.file.truncated) { fs.unlinkSync(dest); return reply.code(413).send({ error: 'File too large' }) }
    const size = fs.statSync(dest).size
    db.prepare('INSERT INTO uploads(id,workspace_id,filename,mime,size,created_at) VALUES(?,?,?,?,?,?)')
      .run(id, ws, file.filename.slice(0, 200), file.mimetype, size, now())
    return { id, url: `/api/uploads/${id}`, mime: file.mimetype, size }
  })

  app.get('/api/uploads/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const row = db.prepare('SELECT mime FROM uploads WHERE id = ?').get(id) as { mime: string } | undefined
    if (!row || !ANY[row.mime]) return reply.code(404).send({ error: 'not found' })
    const file = path.join(config.dataDir, 'uploads', id + ANY[row.mime])
    if (!fs.existsSync(file)) return reply.code(404).send({ error: 'not found' })
    return reply
      .header('Content-Type', row.mime)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .send(fs.createReadStream(file))
  })
}
