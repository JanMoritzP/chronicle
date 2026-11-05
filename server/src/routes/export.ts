import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { requireUser } from '../auth.js'
import { config } from '../config.js'
import { db } from '../db.js'
import type { DocNode } from '../doc.js'
import { docToMarkdown } from '../markdown.js'
import { zipStream, type ZipEntry } from '../zip.js'

const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' }

const safeName = (s: string) =>
  (s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, 100)) || 'Untitled'

const q = (s: string) => JSON.stringify(s)

interface PageRow {
  id: string; folder_id: string | null; title: string; icon: string | null; aliases: string; content: string; props: string
  created_at: number; updated_at: number
}
interface FolderRow { id: string; parent_id: string | null; name: string; sort: number }

function frontMatter(p: PageRow, tags: string[]) {
  const aliases = JSON.parse(p.aliases) as string[]
  const lines = ['---', `title: ${q(p.title)}`]
  if (p.icon) lines.push(`icon: ${q(p.icon)}`)
  if (aliases.length) lines.push(`aliases: [${aliases.map(q).join(', ')}]`)
  if (tags.length) lines.push(`tags: [${tags.map(q).join(', ')}]`)
  lines.push(`created: ${new Date(p.created_at).toISOString()}`, `updated: ${new Date(p.updated_at).toISOString()}`, `id: ${p.id}`, '---', '')
  return lines.join('\n')
}

/** Everything about one world as plain files: Markdown pages in their folders, images, and world.json with the lossless data. */
function* worldArchive(ws: string): Generator<ZipEntry> {
  const workspace = db.prepare('SELECT id, name, created_at AS createdAt FROM workspaces WHERE id = ?').get(ws) as { id: string; name: string; createdAt: number }
  const folders = db.prepare('SELECT id, parent_id, name, sort FROM folders WHERE workspace_id = ? AND deleted_at IS NULL').all(ws) as FolderRow[]
  const pages = db.prepare('SELECT id, folder_id, title, icon, aliases, content, props, created_at, updated_at FROM pages WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY title COLLATE NOCASE').all(ws) as PageRow[]
  const tagRows = db.prepare('SELECT t.page_id, t.tag FROM page_tags t JOIN pages p ON p.id = t.page_id WHERE p.workspace_id = ? AND p.deleted_at IS NULL').all(ws) as { page_id: string; tag: string }[]
  const tags = new Map<string, string[]>()
  for (const t of tagRows) (tags.get(t.page_id) ?? tags.set(t.page_id, []).get(t.page_id)!).push(t.tag)
  const uploads = db.prepare('SELECT id, filename, mime, size, created_at AS createdAt FROM uploads WHERE workspace_id = ?').all(ws) as { id: string; filename: string; mime: string; size: number; createdAt: number }[]

  const images = new Map<string, string>()
  const imageEntries: ZipEntry[] = []
  for (const u of uploads) {
    const ext = EXT[u.mime]
    const file = path.join(config.dataDir, 'uploads', u.id + (ext ?? ''))
    if (!ext || !fs.existsSync(file)) continue
    images.set(u.id, u.id + ext)
    imageEntries.push({ name: `images/${u.id}${ext}`, data: { file }, store: true })
  }

  const byId = new Map(folders.map((f) => [f.id, f]))
  const folderPath = (id: string | null): string[] => {
    const parts: string[] = []
    const seen = new Set<string>()
    for (let f = id ? byId.get(id) : undefined; f && !seen.has(f.id); f = f.parent_id ? byId.get(f.parent_id) : undefined) {
      seen.add(f.id)
      parts.unshift(safeName(f.name))
    }
    return parts
  }

  const titles = new Map(pages.map((p) => [p.id, p.title]))
  const used = new Set<string>()
  const files: Record<string, string> = {}
  for (const p of pages) {
    const dirParts = folderPath(p.folder_id)
    let rel = [...dirParts, safeName(p.title)].join('/')
    let n = 2
    while (used.has(rel.toLowerCase())) rel = [...dirParts, `${safeName(p.title)} (${n++})`].join('/')
    used.add(rel.toLowerCase())
    const file = `pages/${rel}.md`
    files[p.id] = file
    let doc: DocNode
    try { doc = JSON.parse(p.content) } catch { doc = { type: 'doc', content: [] } }
    const root = '../'.repeat(dirParts.length + 1)
    const body = docToMarkdown(doc, { root, images, titles })
    yield { name: file, data: Buffer.from(frontMatter(p, tags.get(p.id) ?? []) + '\n' + `# ${p.title || 'Untitled'}\n\n` + body, 'utf8'), mtime: p.updated_at }
  }

  const all = (sql: string) => db.prepare(sql).all(ws)
  const maps = db.prepare('SELECT * FROM maps WHERE workspace_id = ?').all(ws) as { id: string; source_ext: string | null }[]
  const mapIds = maps.map((m) => m.id)
  const mapRows = (table: string) => mapIds.length ? db.prepare(`SELECT * FROM ${table} WHERE map_id IN (${mapIds.map(() => '?').join(',')})`).all(...mapIds) : []
  const calendar = db.prepare('SELECT definition FROM calendars WHERE workspace_id = ?').get(ws) as { definition: string } | undefined

  const json = {
    format: 'chronicle-world',
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace,
    folders,
    pages: pages.map((p) => ({
      id: p.id, title: p.title, icon: p.icon, folderId: p.folder_id, aliases: JSON.parse(p.aliases), tags: tags.get(p.id) ?? [],
      props: JSON.parse(p.props), content: JSON.parse(p.content), createdAt: p.created_at, updatedAt: p.updated_at, markdown: files[p.id],
    })),
    relations: all('SELECT id, source_id AS sourceId, target_id AS targetId, kind, label FROM relations WHERE workspace_id = ?'),
    events: all('SELECT id, page_id AS pageId, title, t_start AS tStart, t_end AS tEnd FROM events WHERE workspace_id = ?'),
    sessions: all('SELECT id, number, title, played_on AS playedOn, t_start AS tStart, t_end AS tEnd, page_id AS pageId FROM game_sessions WHERE workspace_id = ? ORDER BY number'),
    zettels: all('SELECT id, body, tags, created_at AS createdAt, page_id AS pageId, processed_at AS processedAt FROM zettels WHERE workspace_id = ? AND deleted_at IS NULL'),
    templates: all('SELECT id, name, slug, description, content FROM templates WHERE workspace_id = ?').map((t: any) => ({ ...t, content: JSON.parse(t.content) })),
    pageTypes: all('SELECT id, name, icon, tag, source, definition FROM page_types WHERE workspace_id = ?').map((t: any) => ({ ...t, definition: JSON.parse(t.definition) })),
    statTemplates: all('SELECT id, name, definition FROM stat_templates WHERE workspace_id = ?').map((t: any) => ({ id: t.id, name: t.name, sections: JSON.parse(t.definition).sections })),
    calendar: calendar ? JSON.parse(calendar.definition) : null,
    maps: maps.map((m) => ({ ...m, layers: (mapRows('map_layers') as any[]).filter((l) => l.map_id === m.id), items: (mapRows('map_items') as any[]).filter((i) => i.map_id === m.id) })),
    uploads: uploads.filter((u) => images.has(u.id)).map((u) => ({ ...u, file: `images/${images.get(u.id)}` })),
  }
  yield { name: 'world.json', data: Buffer.from(JSON.stringify(json, null, 2), 'utf8') }
  yield* imageEntries
  for (const m of maps) {
    if (!m.source_ext) continue
    const file = path.join(config.dataDir, 'maps', m.id, 'source' + m.source_ext)
    if (fs.existsSync(file)) yield { name: `maps/${m.id}/source${m.source_ext}`, data: { file }, store: true }
  }
  yield {
    name: 'README.txt',
    data: Buffer.from(
      `Export of the world "${workspace.name}" from Chronicle.\n\npages/       one Markdown file per page, in the same folders. Links are [[Page]], [[Page#Section]] and [[Page|shown text]]; embeds are ![[Page]]. Stat blocks are fenced \`\`\`statblock blocks.\nimages/      uploaded images used by the world (Markdown links point here).\nmaps/        original map images.\nworld.json   everything in one machine-readable file (pages as editor documents, relations, events, sessions, calendar, map pins, zettels).\n`,
    ),
  }
}

export async function exportRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/export', { preHandler: requireUser }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const w = db.prepare('SELECT name FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(ws) as { name: string } | undefined
    if (!w) return reply.code(404).send({ error: 'not found' })
    const stamp = new Date().toISOString().slice(0, 10)
    const fname = `${safeName(w.name).replace(/[^\x20-\x7e]/g, '_')}-${stamp}.zip`
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(`${safeName(w.name)}-${stamp}.zip`)}`)
      .send(zipStream(worldArchive(ws)))
  })
}
