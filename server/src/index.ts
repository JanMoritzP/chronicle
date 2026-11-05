import fs from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fstatic from '@fastify/static'
import { authRoutes, ensureOwner } from './auth.js'
import { backupRoutes, scheduleBackups } from './backup.js'
import { config } from './config.js'
import { db, migrate } from './db.js'
import { contentRoutes } from './routes/content.js'
import { mapRoutes, resumeTiling } from './routes/maps.js'
import { copyRoutes } from './routes/copy.js'
import { sessionRoutes } from './routes/sessions.js'
import { shareRoutes } from './routes/shares.js'
import { exportRoutes } from './routes/export.js'
import { relationRoutes } from './routes/relations.js'
import { timelineRoutes } from './routes/timeline.js'
import { todoRoutes } from './routes/todos.js'
import { templateRoutes } from './routes/templates.js'
import { pageTypeRoutes } from './routes/pagetypes.js'
import { statTemplateRoutes } from './routes/stattemplates.js'
import { uploadRoutes } from './routes/uploads.js'

migrate()
ensureOwner()

const app = Fastify({ logger: { level: config.isProd ? 'warn' : 'info' }, trustProxy: true, bodyLimit: 10 * 1024 * 1024 })

// Accept bodyless requests that still carry a JSON content-type (e.g. DELETE from fetch wrappers).
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  if (!body) return done(null, undefined)
  try { done(null, JSON.parse(body as string)) } catch { done(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }), undefined) }
})

await app.register(cookie)
await app.register(rateLimit, { global: false })
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } })

app.addHook('onSend', async (req, reply) => {
  reply.header('X-Robots-Tag', 'noindex, nofollow')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Referrer-Policy', 'same-origin')
  reply.header('X-Frame-Options', 'SAMEORIGIN')
  if (req.url.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('Cache-Control', 'no-store')
})

// CSRF: sameSite=lax already blocks cross-site POSTs; also reject mutating requests from foreign origins.
app.addHook('onRequest', async (req, reply) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return
  const origin = req.headers.origin
  if (origin && new URL(origin).host !== req.headers.host) return reply.code(403).send({ error: 'bad origin' })
})

await app.register(authRoutes)
await app.register(contentRoutes)
await app.register(uploadRoutes)
await app.register(mapRoutes)
await app.register(timelineRoutes)
await app.register(relationRoutes)
await app.register(copyRoutes)
await app.register(sessionRoutes)
await app.register(shareRoutes)
await app.register(todoRoutes)
await app.register(templateRoutes)
await app.register(pageTypeRoutes)
await app.register(statTemplateRoutes)
await app.register(exportRoutes)
await app.register(backupRoutes)

app.get('/robots.txt', async (_req, reply) => reply.type('text/plain').send('User-agent: *\nDisallow: /\n'))
app.get('/api/health', async () => ({ ok: true }))

if (fs.existsSync(config.webDist)) {
  await app.register(fstatic, { root: config.webDist })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' })
    return reply.sendFile('index.html')
  })
}

scheduleBackups()
resumeTiling()
await app.listen({ port: config.port, host: config.host })

// Docker sends SIGTERM on stop/update: finish requests, then fold the WAL into the main database file.
let stopping = false
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    if (stopping) return
    stopping = true
    const force = setTimeout(() => process.exit(1), 8000)
    try { await app.close(); db.pragma('wal_checkpoint(TRUNCATE)'); db.close() } catch (e) { console.error(e) }
    clearTimeout(force)
    process.exit(0)
  })
}
