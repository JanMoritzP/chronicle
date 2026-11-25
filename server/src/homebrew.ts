import crypto from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import { CATEGORIES, libDb } from './library.js'

// Libraries people make themselves: homebrew classes, species, spells, monsters and any other page, kept in library.db next to the
// Open5e data and searched with it. An entry holds what its page is made of (special page type, field values, sheet, text) plus,
// for classes, species and backgrounds, the rules the character builder needs. The file format is documented in docs/LIBRARY.md.

export const FILE_FORMAT = 'chronicle-library'
export const FILE_VERSION = 1

/** Homebrew may also hold plain pages (lore, places, anything) besides the kinds Open5e has. */
export const HOMEBREW_CATEGORIES = [...CATEGORIES.map((c) => c.id), 'page'] as const
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/
const MAX_ENTRY = 2 * 1024 * 1024

export const slugOf = (s: string, fallback = 'entry') => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || fallback

export const entrySchema = z.object({
  /** the entry's name inside its library, kept across exports so a second import updates it */
  id: z.string().regex(SLUG).optional(),
  category: z.enum(HOMEBREW_CATEGORIES),
  name: z.string().trim().min(1).max(200),
  /** the short line next to the name in search results, e.g. "Class · d10" */
  sub: z.string().max(200).optional(),
  /** the special page type the page becomes; by default the one of the category */
  type: z.string().max(64).optional(),
  /** the page's field values (props.data), the stat block under "main" */
  fields: z.record(z.string(), z.any()).optional(),
  sheet: z.record(z.string(), z.any()).optional(),
  /** what the character builder needs of a class, species or background */
  rules: z.record(z.string(), z.any()).optional(),
  /** the page text as a TipTap document */
  content: z.any().optional(),
  /** plain text with Markdown headings, lists and bold, for files written by hand; used when there is no content */
  text: z.string().max(200_000).optional(),
  portrait: z.string().max(400).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
})
export type HomebrewEntry = z.infer<typeof entrySchema>

export const collectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).default(''),
  author: z.string().trim().max(100).default(''),
  license: z.string().trim().max(200).default(''),
})

export const fileSchema = z.object({
  format: z.literal(FILE_FORMAT),
  version: z.number().int().min(1).max(FILE_VERSION),
  library: collectionSchema.extend({ id: z.string().regex(SLUG) }),
  entries: z.array(entrySchema).max(5000),
  /** pictures the entries use, as data: URLs; an entry refers to one as "asset:<id>" */
  assets: z.record(z.string().regex(/^[\w-]{1,80}$/), z.string()).default({}),
})
export type LibraryFile = z.infer<typeof fileSchema>

export interface Collection { id: string; name: string; description: string; author: string; license: string; createdBy: string; createdAt: number; updatedAt: number; count: number }
interface CollectionRow { id: string; name: string; description: string; author: string; license: string; created_by: string; created_at: number; updated_at: number; count: number }
const toCollection = (r: CollectionRow): Collection => ({ id: r.id, name: r.name, description: r.description, author: r.author, license: r.license, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, count: r.count })

const touch = () => libDb().prepare("INSERT INTO meta(k,v) VALUES('homebrewAt', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(String(Date.now()))

export function listCollections(): Collection[] {
  return (libDb().prepare('SELECT c.*, (SELECT COUNT(*) FROM homebrew h WHERE h.collection_id = c.id) AS count FROM collections c ORDER BY c.name COLLATE NOCASE').all() as CollectionRow[]).map(toCollection)
}

export function getCollection(id: string): Collection | null {
  const r = libDb().prepare('SELECT c.*, (SELECT COUNT(*) FROM homebrew h WHERE h.collection_id = c.id) AS count FROM collections c WHERE c.id = ?').get(id) as CollectionRow | undefined
  return r ? toCollection(r) : null
}

/** A new library with an id made from its name (a number added when that is taken). */
export function createCollection(meta: z.infer<typeof collectionSchema>, user: string, wanted?: string): Collection {
  const db = libDb()
  const base = wanted ?? slugOf(meta.name, 'library')
  let id = base, n = 2
  while (db.prepare('SELECT 1 FROM collections WHERE id = ?').get(id)) id = `${base.slice(0, 36)}-${n++}`
  const t = Date.now()
  db.prepare('INSERT INTO collections(id,name,description,author,license,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, meta.name, meta.description, meta.author, meta.license, user, t, t)
  touch()
  return getCollection(id)!
}

export function updateCollection(id: string, meta: Partial<z.infer<typeof collectionSchema>>): Collection | null {
  const cur = getCollection(id)
  if (!cur) return null
  const next = { ...cur, ...meta }
  libDb().prepare('UPDATE collections SET name = ?, description = ?, author = ?, license = ?, updated_at = ? WHERE id = ?').run(next.name, next.description, next.author, next.license, Date.now(), id)
  touch()
  return getCollection(id)
}

export function deleteCollection(id: string): boolean {
  const db = libDb()
  const done = db.transaction(() => {
    db.prepare('DELETE FROM homebrew WHERE collection_id = ?').run(id)
    return db.prepare('DELETE FROM collections WHERE id = ?').run(id).changes > 0
  })()
  if (done) { dropUnusedAssets(); touch() }
  return done
}

export const keyOf = (category: string, collection: string, slug: string) => `${category}:hb.${collection}.${slug}`
const sizeOk = (data: string) => data.length <= MAX_ENTRY

export interface EntryRow { key: string; category: string; name: string; sub: string; updatedAt: number }
export function listEntries(collection: string): EntryRow[] {
  return (libDb().prepare('SELECT key, category, name, sub, updated_at AS updatedAt FROM homebrew WHERE collection_id = ? ORDER BY name COLLATE NOCASE').all(collection) as EntryRow[])
}

export function entryCollection(key: string): string | null {
  const r = libDb().prepare('SELECT collection_id AS c FROM homebrew WHERE key = ?').get(key) as { c: string } | undefined
  return r?.c ?? null
}

/**
 * Adds an entry to a library, or replaces the one with the same key. `replaceKey` is the entry a page came from: pushing it again
 * updates that entry, even when its name changed. Returns the key, or an error sentence.
 */
export function putEntry(collection: string, entry: HomebrewEntry, replaceKey?: string): { key: string } | { error: string } {
  const db = libDb()
  if (!getCollection(collection)) return { error: 'That library no longer exists.' }
  let key: string
  if (replaceKey) {
    if (entryCollection(replaceKey) !== collection) return { error: 'That entry is not in this library.' }
    key = replaceKey
  } else {
    const base = entry.id ?? slugOf(entry.name)
    let slug = base, n = 2
    while (db.prepare('SELECT 1 FROM homebrew WHERE collection_id = ? AND key LIKE ?').get(collection, `%:hb.${collection}.${slug}`)) slug = `${base.slice(0, 70)}-${n++}`
    key = keyOf(entry.category, collection, slug)
  }
  const slug = key.slice(key.lastIndexOf('.') + 1)
  const data = JSON.stringify({ ...entry, id: slug })
  if (!sizeOk(data)) return { error: 'That page is too big for a library entry (2 MB at most).' }
  const t = Date.now()
  db.transaction(() => {
    // the category may change, and with it the key; the old row goes
    const nextKey = keyOf(entry.category, collection, slug)
    if (nextKey !== key) db.prepare('DELETE FROM homebrew WHERE key = ?').run(key)
    db.prepare(`INSERT INTO homebrew(key,collection_id,category,name,sub,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET category=excluded.category, name=excluded.name, sub=excluded.sub, data=excluded.data, updated_at=excluded.updated_at`)
      .run(nextKey, collection, entry.category, entry.name, entry.sub?.trim() || 'Homebrew', data, t, t)
    db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(t, collection)
    key = nextKey
  })()
  touch()
  return { key }
}

export function deleteEntry(key: string): boolean {
  const done = libDb().prepare('DELETE FROM homebrew WHERE key = ?').run(key).changes > 0
  if (done) { dropUnusedAssets(); touch() }
  return done
}

// ---------- pictures ----------

const SNIFFED: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heif: 'image/avif' }
const ASSET_URL = /\/api\/library\/assets\/([a-f0-9]{32})/g
export const assetUrl = (id: string) => `/api/library/assets/${id}`

/** Keeps a picture for the library. The same picture twice is stored once. Throws with a readable message when it is not one. */
export async function addAsset(bytes: Buffer): Promise<string> {
  let format = ''
  try { format = (await sharp(bytes).metadata()).format ?? '' } catch { /* not a picture */ }
  const mime = SNIFFED[format]
  if (!mime) throw new Error('That is not a PNG, JPEG, WebP, GIF or AVIF picture')
  const id = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32)
  libDb().prepare('INSERT INTO assets(id,mime,data,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').run(id, mime, bytes, Date.now())
  return id
}

export function getAsset(id: string): { mime: string; data: Buffer } | null {
  return (libDb().prepare('SELECT mime, data FROM assets WHERE id = ?').get(id) as { mime: string; data: Buffer } | undefined) ?? null
}

/** Pictures no entry refers to any more are removed with the last entry that did. */
function dropUnusedAssets() {
  const db = libDb()
  const used = new Set<string>()
  for (const r of db.prepare('SELECT data FROM homebrew').all() as { data: string }[]) for (const m of r.data.matchAll(ASSET_URL)) used.add(m[1])
  for (const r of db.prepare('SELECT id FROM assets').all() as { id: string }[]) if (!used.has(r.id)) db.prepare('DELETE FROM assets WHERE id = ?').run(r.id)
}

// ---------- files ----------

/** A library as one file: its entries, and the pictures they use inside it, so it can travel to another server. */
export function exportCollection(id: string): LibraryFile | null {
  const c = getCollection(id)
  if (!c) return null
  const assets: Record<string, string> = {}
  const entries = (libDb().prepare('SELECT data FROM homebrew WHERE collection_id = ? ORDER BY name COLLATE NOCASE').all(id) as { data: string }[]).map((r) => {
    const json = r.data.replace(ASSET_URL, (_m, a: string) => {
      if (!assets[a]) { const x = getAsset(a); if (x) assets[a] = `data:${x.mime};base64,${x.data.toString('base64')}` }
      return `asset:${a}`
    })
    return JSON.parse(json) as HomebrewEntry
  })
  return { format: FILE_FORMAT, version: FILE_VERSION, library: { id: c.id, name: c.name, description: c.description, author: c.author, license: c.license }, entries, assets }
}

/**
 * Reads a library file. With `replace` a library of the same id is replaced by the file (entries the file no longer has go);
 * without it, that is a conflict the person decides. Returns the library, or an error and whether the id was taken.
 */
export async function importCollection(file: LibraryFile, user: string, replace: boolean): Promise<{ collection: Collection; entries: number } | { error: string; exists?: boolean }> {
  const existing = getCollection(file.library.id)
  if (existing && !replace) return { error: `There is already a library “${existing.name}”. Replace it with the one in the file?`, exists: true }
  const ids = new Map<string, string>()
  for (const [name, url] of Object.entries(file.assets)) {
    const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(url)
    if (!m) continue
    try { ids.set(name, await addAsset(Buffer.from(m[1], 'base64'))) } catch { /* a broken picture is left out; its entry keeps the text */ }
  }
  const entries = file.entries.map((e) => {
    const json = JSON.stringify(e).replace(/asset:([\w-]{1,80})/g, (m, a: string) => (ids.has(a) ? assetUrl(ids.get(a)!) : m))
    return JSON.parse(json) as HomebrewEntry
  })
  const db = libDb()
  let collection: Collection
  if (existing) {
    collection = updateCollection(existing.id, file.library)!
    db.prepare('DELETE FROM homebrew WHERE collection_id = ?').run(existing.id)
  } else collection = createCollection(file.library, user, file.library.id)
  let n = 0
  for (const e of entries) if ('key' in putEntry(collection.id, e)) n++
  dropUnusedAssets()
  touch()
  return { collection: getCollection(collection.id)!, entries: n }
}

/** The classes, species and backgrounds of every homebrew library that carry rules for the character builder. */
export function builderEntries(): { key: string; category: string; name: string; library: string; rules: Record<string, unknown> }[] {
  const out: { key: string; category: string; name: string; library: string; rules: Record<string, unknown> }[] = []
  for (const r of libDb().prepare("SELECT h.key, h.category, h.name, c.name AS library, h.data FROM homebrew h JOIN collections c ON c.id = h.collection_id WHERE h.category IN ('class','species','background') ORDER BY h.name COLLATE NOCASE").all() as { key: string; category: string; name: string; library: string; data: string }[]) {
    try { const d = JSON.parse(r.data); if (d.rules && typeof d.rules === 'object') out.push({ key: r.key, category: r.category, name: r.name, library: r.library, rules: d.rules }) } catch { /* a damaged entry is left out */ }
  }
  return out
}
