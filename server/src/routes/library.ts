import type { FastifyInstance } from 'fastify'
import { requireOwner, requireUser } from '../auth.js'
import { libraryEntry, libraryIndex, libraryStatus, refreshLibrary } from '../library.js'

export async function libraryRoutes(app: FastifyInstance) {
  app.get('/api/library/status', { preHandler: requireUser }, async () => libraryStatus())

  // The download runs in the background (about a minute); the client polls the status.
  app.post('/api/library/refresh', { preHandler: requireOwner }, async () => {
    void refreshLibrary()
    return { ...libraryStatus(), running: true }
  })

  app.get('/api/library/index', { preHandler: requireUser }, async () => libraryIndex())

  app.get('/api/library/entries/:key', { preHandler: requireUser }, async (req, reply) => {
    const { key } = req.params as { key: string }
    if (!/^[\w.:-]{1,200}$/.test(key)) return reply.code(400).send({ error: 'bad request' })
    const e = libraryEntry(key)
    if (!e) return reply.code(404).send({ error: 'This entry is not in the library.' })
    return e
  })
}
