import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireEditor, requireUser } from '../auth.js'
import {
  addAsset, assetUrl, builderEntries, collectionSchema, createCollection, deleteCollection, deleteEntry, entryCollection, entrySchema, exportCollection,
  fileSchema, getAsset, getCollection, importCollection, listCollections, listEntries, putEntry, slugOf, updateCollection,
} from '../homebrew.js'

// Homebrew libraries: making one, putting pages into it, taking entries out, and moving it between servers as a file.
// Anyone who can edit a world can make libraries and add to them; only the one who made a library, or the owner, deletes in it.

const MAX_FILE = 64 * 1024 * 1024
const MAX_PICTURE = 25 * 1024 * 1024

/** Whether this account may delete the library or entries in it. */
function mayManage(req: FastifyRequest, createdBy: string) {
  return req.user!.role === 'owner' || req.user!.username === createdBy
}
const refuse = (reply: FastifyReply) => reply.code(403).send({ error: 'Only the person who made this library, or the owner, can delete in it.' })

export async function homebrewRoutes(app: FastifyInstance) {
  app.addContentTypeParser(/^(image\/[a-z0-9.+-]+|application\/octet-stream)$/, { parseAs: 'buffer', bodyLimit: MAX_PICTURE }, (_req, body, done) => done(null, body))

  app.get('/api/library/collections', { preHandler: requireUser }, async () => listCollections())

  app.post('/api/library/collections', { preHandler: requireEditor }, async (req, reply) => {
    const b = collectionSchema.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'A library needs a name.' })
    return createCollection(b.data, req.user!.username)
  })

  app.get('/api/library/collections/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const c = getCollection(id)
    if (!c) return reply.code(404).send({ error: 'That library no longer exists.' })
    return { ...c, entries: listEntries(id) }
  })

  app.patch('/api/library/collections/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = collectionSchema.partial().safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const c = getCollection(id)
    if (!c) return reply.code(404).send({ error: 'That library no longer exists.' })
    if (!mayManage(req, c.createdBy)) return reply.code(403).send({ error: 'Only the person who made this library, or the owner, can change it.' })
    return updateCollection(id, b.data)
  })

  app.delete('/api/library/collections/:id', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const c = getCollection(id)
    if (!c) return reply.code(404).send({ error: 'That library no longer exists.' })
    if (!mayManage(req, c.createdBy)) return refuse(reply)
    deleteCollection(id)
    return { ok: true }
  })

  // a page goes into a library: a new entry, or (with `key`) the entry the page came from is updated
  app.put('/api/library/collections/:id/entries', { preHandler: requireEditor, bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = z.object({ entry: entrySchema, key: z.string().max(200).optional() }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const r = putEntry(id, b.data.entry, b.data.key)
    if ('error' in r) return reply.code(r.error.includes('no longer') ? 404 : 400).send(r)
    return r
  })

  app.delete('/api/library/entries/:key', { preHandler: requireEditor }, async (req, reply) => {
    const { key } = req.params as { key: string }
    const lib = entryCollection(key)
    const c = lib ? getCollection(lib) : null
    if (!c) return reply.code(404).send({ error: 'Only entries of your own libraries can be deleted. This one is not in one.' })
    if (!mayManage(req, c.createdBy)) return refuse(reply)
    deleteEntry(key)
    return { ok: true }
  })

  app.get('/api/library/collections/:id/export', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const file = exportCollection(id)
    if (!file) return reply.code(404).send({ error: 'That library no longer exists.' })
    return reply.header('Content-Disposition', `attachment; filename="${slugOf(file.library.name, 'library')}.chronicle-library.json"`).send(file)
  })

  app.post('/api/library/import', { preHandler: requireEditor, bodyLimit: MAX_FILE }, async (req, reply) => {
    const b = z.object({ file: z.unknown(), replace: z.boolean().default(false) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const f = fileSchema.safeParse(b.data.file)
    if (!f.success) {
      const issue = f.error.issues[0]
      return reply.code(400).send({ error: `That is not a Chronicle library file${issue ? ` (${issue.path.join('.') || 'file'}: ${issue.message})` : ''}.` })
    }
    const r = await importCollection(f.data, req.user!.username, b.data.replace)
    if ('error' in r) return reply.code(409).send(r)
    return r
  })

  // pictures of entries: the bytes as the body, like POST /api/workspaces/:ws/images
  app.post('/api/library/assets', { preHandler: requireEditor, bodyLimit: MAX_PICTURE }, async (req, reply) => {
    const bytes = req.body
    if (!Buffer.isBuffer(bytes) || !bytes.length) return reply.code(400).send({ error: 'Send the picture itself as the request body.' })
    try { return { url: assetUrl(await addAsset(bytes)) } } catch (e) { return reply.code(415).send({ error: e instanceof Error ? e.message : String(e) }) }
  })

  app.get('/api/library/assets/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const a = /^[a-f0-9]{32}$/.test(id) ? getAsset(id) : null
    if (!a) return reply.code(404).send({ error: 'not found' })
    return reply.header('Content-Type', a.mime).header('Cache-Control', 'private, max-age=31536000, immutable').header('X-Content-Type-Options', 'nosniff').send(a.data)
  })

  app.get('/api/library/builder', { preHandler: requireUser }, async () => builderEntries())
}
