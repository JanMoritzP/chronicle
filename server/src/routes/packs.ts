import type { FastifyInstance } from 'fastify'
import { requireOwner } from '../auth.js'
import { db, now } from '../db.js'
import { contentCounts, parsePack, type Pack } from '../pack.js'
import { uid } from '../pages.js'
import { parseEntries, entriesText, parseCards, cardsText, freshDeck } from '../tables.js'
import { cryptoRng } from '../dice.js'
import { worldSettings } from './content.js'
import { z } from 'zod'

// System packs of a world (see pack.ts). The owner account installs them from a file, chooses which one the world plays by, and removes them.

interface Row { slug: string; name: string; data: string }
const read = (r: Row): Pack | null => { try { const p = parsePack(JSON.parse(r.data)); return 'pack' in p ? p.pack : null } catch { return null } }

/** The pack the world plays by, if one is chosen and still installed. */
export function activePack(ws: string): Pack | null {
  const w = db.prepare('SELECT settings FROM workspaces WHERE id = ?').get(ws) as { settings: string } | undefined
  const slug = worldSettings(w?.settings).pack
  if (!slug) return null
  const row = db.prepare('SELECT slug, name, data FROM system_packs WHERE workspace_id = ? AND slug = ?').get(ws, slug) as Row | undefined
  return row ? read(row) : null
}

const summary = (p: Pack, active: boolean) => ({ id: p.id, name: p.name, version: p.version ?? '', author: p.author ?? '', description: p.description ?? '', base: p.base, active, content: contentCounts(p) })

export async function packRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/packs', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const { ws } = req.params as { ws: string }
    const active = worldSettings((db.prepare('SELECT settings FROM workspaces WHERE id = ?').get(ws) as { settings: string } | undefined)?.settings).pack
    const rows = db.prepare('SELECT slug, name, data FROM system_packs WHERE workspace_id = ? ORDER BY name COLLATE NOCASE').all(ws) as Row[]
    return rows.map(read).filter((p): p is Pack => !!p).map((p) => ({ ...summary(p, p.id === active), pack: p }))
  })

  app.post('/api/workspaces/:ws/packs', { preHandler: requireOwner }, async (req, reply) => {
    const { ws } = req.params as { ws: string }
    const b = z.object({ pack: z.unknown(), importContent: z.boolean().default(false), replace: z.boolean().default(false) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const parsed = parsePack(b.data.pack)
    if ('error' in parsed) return reply.code(400).send({ error: parsed.error })
    const p = parsed.pack
    if (!db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(ws)) return reply.code(404).send({ error: 'world not found' })
    const have = db.prepare('SELECT 1 FROM system_packs WHERE workspace_id = ? AND slug = ?').get(ws, p.id)
    if (have && !b.data.replace) return reply.code(409).send({ error: `A pack called “${p.id}” is already installed. Replace it, or remove it first.` })
    if (!have && (db.prepare('SELECT COUNT(*) AS n FROM system_packs WHERE workspace_id = ?').get(ws) as { n: number }).n >= 20) return reply.code(409).send({ error: 'That is as many packs as a world can keep.' })
    const t = now()
    const imported = { rollTables: 0, decks: 0, macros: 0 }
    db.transaction(() => {
      db.prepare('INSERT INTO system_packs(id,workspace_id,slug,name,data,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id, slug) DO UPDATE SET name = excluded.name, data = excluded.data')
        .run(uid(), ws, p.id, p.name, JSON.stringify(p), t)
      if (b.data.importContent) {
        for (const rt of p.content?.rollTables ?? []) {
          db.prepare('INSERT INTO roll_tables(id,workspace_id,name,entries,secret,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(uid(), ws, rt.name, entriesText(parseEntries(rt.entries)), rt.secret ? 1 : 0, t, t)
          imported.rollTables++
        }
        for (const d of p.content?.decks ?? []) {
          const cards = cardsText(parseCards(d.cards))
          db.prepare('INSERT INTO decks(id,workspace_id,name,cards,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(uid(), ws, d.name, cards, JSON.stringify(freshDeck(parseCards(cards).length, cryptoRng)), t, t)
          imported.decks++
        }
        for (const m of p.content?.macros ?? []) {
          db.prepare('INSERT INTO macros(id,workspace_id,user_id,name,text,shared,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(uid(), ws, req.user!.id, m.name, m.text, t, t)
          imported.macros++
        }
      }
    })()
    return { ...summary(p, false), imported }
  })

  app.delete('/api/workspaces/:ws/packs/:slug', { preHandler: requireOwner }, async (req, reply) => {
    const { ws, slug } = req.params as { ws: string; slug: string }
    if (!db.prepare('DELETE FROM system_packs WHERE workspace_id = ? AND slug = ?').run(ws, slug).changes) return reply.code(404).send({ error: 'not found' })
    // a world cannot keep playing by a pack that is gone
    const w = db.prepare('SELECT settings FROM workspaces WHERE id = ?').get(ws) as { settings: string } | undefined
    let saved: Record<string, unknown> = {}
    try { saved = JSON.parse(w?.settings || '{}') } catch { /* nothing saved */ }
    if (saved.pack === slug) { delete saved.pack; db.prepare('UPDATE workspaces SET settings = ? WHERE id = ?').run(JSON.stringify(saved), ws) }
    return { ok: true }
  })
}
