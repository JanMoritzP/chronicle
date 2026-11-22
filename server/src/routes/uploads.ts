import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance, FastifyReply } from 'fastify'
import sharp from 'sharp'
import { z } from 'zod'
import { requireEditor, requireOwner, requireUser } from '../auth.js'
import { config } from '../config.js'
import { db, now } from '../db.js'
import { uid } from '../pages.js'
import { PluginRejection, runHook } from '../plugins.js'

const MAX_RAW = 25 * 1024 * 1024

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

/** Checks a file that is already on disk against the world's quota and the plugins, then records it. Removes the file when refused. */
type Kept = { id: string; url: string; mime: string; size: number; warnings?: string[] }
async function keepFile(ws: string, user: string, id: string, dest: string, filename: string, mime: string): Promise<Kept | { code: number; error: string }> {
  const size = fs.statSync(dest).size
  const refuse = (code: number, error: string) => { fs.unlinkSync(dest); return { code, error } }
  // a world keeps a limited amount of files
  const used = (db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM uploads WHERE workspace_id = ?').get(ws) as { n: number }).n
  if (used + size > config.uploadQuotaMb * 1024 * 1024) return refuse(413, `This world has used its ${config.uploadQuotaMb} MB of files. Delete some in the asset library first.`)
  filename = filename.slice(0, 200)
  try { await runHook('upload:before', { ws, user, filename, mime, size, file: dest }) } catch (err) {
    if (err instanceof PluginRejection) return refuse(422, err.message)
    throw err
  }
  db.prepare('INSERT INTO uploads(id,workspace_id,filename,mime,size,created_at) VALUES(?,?,?,?,?,?)').run(id, ws, filename, mime, size, now())
  const url = `/api/uploads/${id}`
  const failures = await runHook('upload:stored', { ws, user, id, filename, mime, size, file: dest, url })
  return { id, url, mime, size, ...(failures.length ? { warnings: failures.map((f) => `${f.plugin}: ${f.error}`) } : {}) }
}
async function keep(ws: string, user: string, id: string, dest: string, filename: string, mime: string, reply: FastifyReply) {
  const r = await keepFile(ws, user, id, dest, filename, mime)
  return 'error' in r ? reply.code(r.code).send({ error: r.error }) : r
}

/** What the content of a picture says it is, whatever the sender claimed. */
const SNIFFED: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heif: 'image/avif' }

/** Lets a plugin add a picture the same way the upload routes do (quota, hooks). Throws with a readable message when refused. */
export async function addPicture(ws: string, user: string, filename: string, bytes: Buffer): Promise<Kept> {
  let format = ''
  try { format = (await sharp(bytes).metadata()).format ?? '' } catch { /* not a picture */ }
  const mime = SNIFFED[format]
  if (!mime) throw new Error('That is not a PNG, JPEG, WebP, GIF or AVIF picture')
  const id = uid()
  const dest = path.join(config.dataDir, 'uploads', id + ANY[mime])
  fs.writeFileSync(dest, bytes)
  const r = await keepFile(ws, user, id, dest, filename, mime)
  if ('error' in r) throw new Error(r.error)
  return r
}

export async function uploadRoutes(app: FastifyInstance) {
  // raw bytes are read as a buffer, so a script or another program can send a picture without building a form
  app.addContentTypeParser(/^(image\/[a-z0-9.+-]+|application\/octet-stream)$/, { parseAs: 'buffer', bodyLimit: MAX_RAW }, (_req, body, done) => done(null, body))

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
    return keep(ws, req.user!.username, id, dest, file.filename, file.mimetype, reply)
  })

  // POST the bytes of one picture (PNG, JPEG, WebP, GIF or AVIF) as the body; ?name= is the file name shown in the asset library
  app.post('/api/workspaces/:ws/images', { preHandler: requireEditor, bodyLimit: MAX_RAW }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const q = z.object({ name: z.string().trim().min(1).max(200).default('image') }).safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: 'bad request' })
    const bytes = req.body
    if (!Buffer.isBuffer(bytes) || !bytes.length) return reply.code(400).send({ error: 'Send the picture itself as the request body, with content type image/png, image/jpeg, image/webp, image/gif, image/avif or application/octet-stream' })
    let format = ''
    try { format = (await sharp(bytes).metadata()).format ?? '' } catch { /* not a picture */ }
    const mime = SNIFFED[format]
    if (!mime) return reply.code(415).send({ error: 'That is not a PNG, JPEG, WebP, GIF or AVIF picture' })
    const id = uid()
    const dest = path.join(config.dataDir, 'uploads', id + ANY[mime])
    fs.writeFileSync(dest, bytes)
    return keep(ws, req.user!.username, id, dest, q.data.name, mime, reply)
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
    const row = db.prepare('SELECT mime, workspace_id AS ws FROM uploads WHERE id = ?').get(id) as { mime: string; ws: string } | undefined
    if (!row) return reply.code(404).send({ error: 'not found' })
    db.prepare('DELETE FROM uploads WHERE id = ?').run(id)
    try { fs.unlinkSync(path.join(config.dataDir, 'uploads', id + ANY[row.mime])) } catch { /* the file was already gone */ }
    await runHook('upload:deleted', { ws: row.ws, id })
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
