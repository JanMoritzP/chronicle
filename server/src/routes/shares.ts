import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { requireEditor, requireUser } from '../auth.js'
import { config } from '../config.js'
import { db, now } from '../db.js'
import { sliceSection, type DocNode } from '../doc.js'
import { resolveTarget, type PageRow } from '../pages.js'

const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' }
const UPLOAD_URL = /^\/api\/uploads\/([0-9a-f-]{36})$/
const MAX_EMBED_DEPTH = 2

const newToken = () => crypto.randomBytes(18).toString('base64url')
const tokenOf = (pageId: string) => (db.prepare('SELECT token FROM shares WHERE page_id = ?').get(pageId) as { token: string } | undefined)?.token ?? null

function sharedPage(token: string): PageRow | undefined {
  return db.prepare(
    `SELECT p.* FROM shares s JOIN pages p ON p.id = s.page_id WHERE s.token = ? AND p.deleted_at IS NULL`,
  ).get(token) as PageRow | undefined
}

/**
 * Turns a page document into what an anonymous reader may see:
 * links to shared pages stay links, links to anything else become plain text,
 * embeds of shared pages are inlined and every other embed is dropped, images point at the public image route.
 */
function publicDoc(page: PageRow, doc: DocNode, depth = 0): DocNode {
  const ws = page.workspace_id
  const walk = (n: DocNode): DocNode[] => {
    if (n.type === 'wikilink') {
      const a = n.attrs ?? {}
      const label = String(a.alias || a.name || 'link')
      const target = (a.pageId && (db.prepare('SELECT id FROM pages WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(a.pageId, ws) as { id: string } | undefined)?.id) || resolveTarget(ws, String(a.name ?? ''))
      const token = target ? tokenOf(target) : null
      if (!token) return [{ type: 'text', text: label }]
      const href = `/s/${token}${a.anchor ? `#${a.anchor}` : ''}`
      return [{ type: 'text', text: label, marks: [{ type: 'link', attrs: { href, target: null, rel: null } }] }]
    }
    if (n.type === 'embed') {
      if (depth + 1 >= MAX_EMBED_DEPTH) return []
      const a = n.attrs ?? {}
      const target = (a.pageId && (db.prepare('SELECT * FROM pages WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(a.pageId, ws) as PageRow | undefined)) || undefined
      if (!target || !tokenOf(target.id)) return []
      const inner = publicDoc(target, sliceSection(JSON.parse(target.content) as DocNode, a.anchor), depth + 1)
      return inner.content?.length ? [{ type: 'blockquote', content: inner.content }] : []
    }
    if (n.type === 'todo') return []
    if (n.type === 'image' && typeof n.attrs?.src === 'string') {
      const m = UPLOAD_URL.exec(n.attrs.src)
      return [{ ...n, attrs: { ...n.attrs, src: m ? `/api/public/img/${m[1]}` : '' } }]
    }
    if (!n.content) return [n]
    const content = n.content.flatMap(walk)
    if (!content.length && n.type !== 'doc') {
      // an emptied container (e.g. a paragraph that only held an embed) would be invalid; keep text blocks as empty
      return n.type === 'paragraph' || n.type === 'heading' ? [{ ...n, content: undefined }] : []
    }
    return [{ ...n, content }]
  }
  return walk(doc)[0] ?? { type: 'doc', content: [{ type: 'paragraph' }] }
}

export async function shareRoutes(app: FastifyInstance) {
  app.get('/api/pages/:id/share', { preHandler: requireUser }, async (req) => {
    const { id } = req.params as { id: string }
    return { token: tokenOf(id) }
  })

  app.post('/api/pages/:id/share', { preHandler: requireEditor }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const p = db.prepare('SELECT workspace_id FROM pages WHERE id = ? AND deleted_at IS NULL').get(id) as { workspace_id: string } | undefined
    if (!p) return reply.code(404).send({ error: 'not found' })
    const token = tokenOf(id) ?? newToken()
    db.prepare('INSERT OR IGNORE INTO shares(token,page_id,workspace_id,created_at) VALUES(?,?,?,?)').run(token, id, p.workspace_id, now())
    return { token }
  })

  /** Stopping sharing kills the link; sharing again makes a new one. */
  app.delete('/api/pages/:id/share', { preHandler: requireEditor }, async (req) => {
    const { id } = req.params as { id: string }
    db.prepare('DELETE FROM shares WHERE page_id = ?').run(id)
    return { ok: true }
  })

  app.get('/api/workspaces/:ws/shares', { preHandler: requireUser }, async (req) => {
    const { ws } = req.params as { ws: string }
    return db.prepare(
      `SELECT s.token, s.page_id AS pageId, s.created_at AS createdAt, p.title FROM shares s JOIN pages p ON p.id = s.page_id
       WHERE s.workspace_id = ? AND p.deleted_at IS NULL ORDER BY p.title COLLATE NOCASE`,
    ).all(ws)
  })

  const limit = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }

  app.get('/api/public/:token', limit, async (req, reply) => {
    const { token } = req.params as { token: string }
    const p = sharedPage(token)
    if (!p) return reply.code(404).send({ error: 'This page is not shared (any more).' })
    const props = JSON.parse(p.props)
    const portrait = typeof props?.portrait === 'string' ? UPLOAD_URL.exec(props.portrait)?.[1] : null
    return {
      title: p.title,
      icon: p.icon,
      updatedAt: p.updated_at,
      portrait: portrait ? `/api/public/img/${portrait}` : null,
      content: publicDoc(p, JSON.parse(p.content)),
    }
  })

  app.get('/api/public/img/:id', limit, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!/^[0-9a-f-]{36}$/.test(id)) return reply.code(404).send({ error: 'not found' })
    const row = db.prepare('SELECT mime FROM uploads WHERE id = ?').get(id) as { mime: string } | undefined
    const used = db.prepare(
      `SELECT 1 FROM shares s JOIN pages p ON p.id = s.page_id WHERE p.deleted_at IS NULL AND (p.content LIKE ? OR p.props LIKE ?) LIMIT 1`,
    ).get(`%${id}%`, `%${id}%`)
    if (!row || !EXT[row.mime] || !used) return reply.code(404).send({ error: 'not found' })
    const file = path.join(config.dataDir, 'uploads', id + EXT[row.mime])
    if (!fs.existsSync(file)) return reply.code(404).send({ error: 'not found' })
    return reply
      .header('Content-Type', row.mime)
      .header('Cache-Control', 'public, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff')
      .send(fs.createReadStream(file))
  })
}
