import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from './config.js'

// The Open5e library is reference data, not user content. It lives in its own file so backups,
// restores, exports and world copies never touch it, and it can be rebuilt at any time.
const API = 'https://api.open5e.com/v2'

export const CATEGORIES = [
  { id: 'creature', endpoint: 'creatures' },
  { id: 'magicitem', endpoint: 'magicitems' },
  { id: 'item', endpoint: 'items' },
  { id: 'spell', endpoint: 'spells' },
  { id: 'class', endpoint: 'classes' },
  { id: 'species', endpoint: 'species' },
  { id: 'background', endpoint: 'backgrounds' },
  { id: 'feat', endpoint: 'feats' },
  { id: 'condition', endpoint: 'conditions' },
  // terms that other entries refer to, so that weapon properties, damage types, skills... can be linked
  { id: 'weaponproperty', endpoint: 'weaponproperties' },
  { id: 'damagetype', endpoint: 'damagetypes' },
  { id: 'skill', endpoint: 'skills' },
  { id: 'ability', endpoint: 'abilities' },
  { id: 'school', endpoint: 'spellschools' },
  { id: 'language', endpoint: 'languages' },
  { id: 'creaturetype', endpoint: 'creaturetypes' },
  { id: 'alignment', endpoint: 'alignments' },
  { id: 'size', endpoint: 'sizes' },
  { id: 'rule', endpoint: 'rules' },
] as const
export type CategoryId = (typeof CATEGORIES)[number]['id']

let lib: Database.Database | null = null
function open() {
  if (lib) return lib
  fs.mkdirSync(config.dataDir, { recursive: true })
  lib = new Database(path.join(config.dataDir, 'library.db'))
  lib.pragma('journal_mode = WAL')
  lib.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      key TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      sub TEXT NOT NULL DEFAULT '',
      hash TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entries_category ON entries(category);
    CREATE TABLE IF NOT EXISTS sources (key TEXT PRIMARY KEY, name TEXT NOT NULL, license TEXT NOT NULL, published TEXT NOT NULL, permalink TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `)
  return lib
}

export function closeLibrary() { lib?.close(); lib = null }

export interface LibraryStatus {
  count: number
  byCategory: Record<string, number>
  updatedAt: number | null
  running: boolean
  phase: string
  error: string | null
}
const state = { running: false, phase: '', error: null as string | null }

export function libraryStatus(): LibraryStatus {
  const db = open()
  const byCategory: Record<string, number> = {}
  let count = 0
  for (const r of db.prepare('SELECT category, COUNT(*) AS n FROM entries GROUP BY category').all() as { category: string; n: number }[]) { byCategory[r.category] = r.n; count += r.n }
  const at = db.prepare("SELECT v FROM meta WHERE k = 'updatedAt'").get() as { v: string } | undefined
  return { count, byCategory, updatedAt: at ? Number(at.v) : null, running: state.running, phase: state.phase, error: state.error }
}

export function libraryIndex() {
  const db = open()
  const sources: Record<string, string> = {}
  for (const s of db.prepare('SELECT key, name FROM sources').all() as { key: string; name: string }[]) sources[s.key] = s.name
  const rows = (db.prepare('SELECT key, category, name, source, sub FROM entries ORDER BY name COLLATE NOCASE').all() as { key: string; category: string; name: string; source: string; sub: string }[])
    .map((r) => [r.key, r.category, r.name, r.source, r.sub])
  const at = db.prepare("SELECT v FROM meta WHERE k = 'updatedAt'").get() as { v: string } | undefined
  return { version: at ? Number(at.v) : 0, sources, rows }
}

export function libraryHas(key: string): boolean {
  return !!open().prepare('SELECT 1 FROM entries WHERE key = ?').get(key)
}

export function libraryEntry(key: string) {
  const db = open()
  const r = db.prepare('SELECT key, category, name, source, data FROM entries WHERE key = ?').get(key) as { key: string; category: string; name: string; source: string; data: string } | undefined
  if (!r) return null
  const s = db.prepare('SELECT name, license, permalink FROM sources WHERE key = ?').get(r.source) as { name: string; license: string; permalink: string } | undefined
  return { key: r.key, category: r.category, name: r.name, source: r.source, sourceName: s?.name ?? r.source, license: s?.license ?? '', permalink: s?.permalink ?? '', data: JSON.parse(r.data) }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

async function getJson(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error(`Open5e answered ${r.status}`)
      return await r.json()
    } catch (e) {
      if (attempt >= 2) throw e
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)))
    }
  }
}

async function fetchAll(endpoint: string): Promise<any[]> {
  let url: string | null = `${API}/${endpoint}/?limit=500`
  const out: any[] = []
  while (url) {
    const page = await getJson(url)
    out.push(...page.results)
    // only ever follow the API's own pagination links
    url = typeof page.next === 'string' && page.next.startsWith(`${API}/`) ? page.next : null
  }
  return out
}

/** The text shown next to a name in search results, e.g. "CR 1/4 · Small humanoid" or "Level 3 · Evocation". */
function subOf(category: CategoryId, d: any): string {
  switch (category) {
    case 'creature': return `CR ${crText(d.challenge_rating)} · ${[d.size?.name, d.type?.name?.toLowerCase()].filter(Boolean).join(' ')}`
    case 'spell': return `${d.level === 0 ? 'Cantrip' : `Level ${d.level}`} · ${d.school?.name ?? ''}`
    case 'magicitem': return [d.rarity?.name, d.category?.name].filter(Boolean).join(' · ')
    case 'item': return d.category?.name ?? ''
    case 'class': return d.subclass_of?.name ? `Subclass of ${d.subclass_of.name}` : 'Class'
    case 'species': return d.is_subspecies ? 'Subspecies' : 'Species'
    case 'feat': return d.type ? String(d.type).toLowerCase().replace(/^./, (c: string) => c.toUpperCase()) : 'Feat'
    case 'weaponproperty': return d.type ? `Weapon property · ${d.type}` : 'Weapon property'
    case 'damagetype': return 'Damage type'
    case 'skill': return d.ability ? `Skill · ${String(d.ability).toUpperCase()}` : 'Skill'
    case 'ability': return d.short_desc ? upperFirst(String(d.short_desc)) : 'Ability'
    case 'school': return 'Spell school'
    case 'language': return d.is_secret ? 'Secret language' : d.is_exotic ? 'Exotic language' : 'Language'
    case 'creaturetype': return 'Creature type'
    case 'alignment': return d.short_name ? `Alignment · ${d.short_name}` : 'Alignment'
    case 'size': return d.space_diameter ? `Size · ${d.space_diameter} ${d.distance_unit === 'feet' ? 'ft.' : d.distance_unit ?? ''} space`.trim() : 'Size'
    case 'rule': return sectionOf(d)
    default: return ''
  }
}

const upperFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const titleCase = (key: string) => key.split(/[-_s]+/).filter(Boolean).map(upperFirst).join(' ')

/** The section of the rules a rule belongs to, without the book prefix: "srd-2024_d20-tests" becomes "D20 tests". */
function sectionOf(d: any): string {
  const key = String(d.ruleset ?? '').replace(/^[^_]+_/, '')
  return key ? upperFirst(key.replace(/[-_]+/g, ' ')) : 'Rule'
}

export function crText(cr: unknown): string {
  const n = Number(cr)
  if (!Number.isFinite(n)) return '?'
  if (n === 0.125) return '1/8'
  if (n === 0.25) return '1/4'
  if (n === 0.5) return '1/2'
  return String(n)
}

/** Subclasses and subspecies share names across books, so the parent is part of what makes an entry the same. */
function identity(category: CategoryId, d: any): string {
  // the same rule name appears in several sections, so the section (without its book prefix) belongs to the identity
  const parent = category === 'class' ? d.subclass_of?.name : category === 'species' ? d.subspecies_of : category === 'rule' ? String(d.ruleset ?? '').replace(/^[^_]+_/, '') : ''
  return `${category}:${norm(d.name ?? '')}:${norm(String(parent ?? ''))}`
}

const EDITION: Record<string, number> = { '5e-2024': 3, '5e-2014': 2 }
const OFFICIAL = new Set(['srd-2024', 'srd-2014', 'core'])

/**
 * Which copy of an entry wins when several books have it: the newest edition of the rules first, then the official
 * SRD over third-party books, then the newest publication date. A later date alone would let a third-party
 * book beat the SRD with the same name. Compared as a string, so every part is zero padded.
 */
function sourceRank(doc: any, published: string): string {
  return `${EDITION[doc?.gamesystem?.key] ?? 1}${OFFICIAL.has(doc?.key) ? 1 : 0}${published}`
}

const logFile = () => path.join(config.dataDir, 'library.log')

/**
 * Downloads everything from Open5e and replaces the local copy. Where several books have the same entry,
 * only the one from the newest book is kept. Every created, updated and deleted entry is appended to library.log.
 */
export async function refreshLibrary(): Promise<void> {
  if (state.running) return
  state.running = true
  state.error = null
  try {
    const db = open()
    state.phase = 'Reading the list of books'
    const docs = (await fetchAll('documents')) as any[]
    const docInfo = new Map(docs.map((d) => [d.key as string, d]))

    const winners = new Map<string, { category: CategoryId; d: any; rank: string }>()
    for (const cat of CATEGORIES) {
      state.phase = `Downloading ${cat.endpoint}`
      for (const d of await fetchAll(cat.endpoint)) {
        // most glossaries give the book as a plain key, the older endpoints as an object
        const source = (typeof d.document === 'string' ? d.document : d.document?.key) as string
        // alignments have no name, only a key such as chaotic-evil
        if (!d.name && d.key) d.name = titleCase(String(d.key))
        if (!source || !d.key || !d.name) continue
        const rank = sourceRank(docInfo.get(source) ?? d.document, String(docInfo.get(source)?.publication_date ?? ''))
        const id = identity(cat.id, d)
        const cur = winners.get(id)
        if (!cur || rank > cur.rank || (rank === cur.rank && d.key < cur.d.key)) winners.set(id, { category: cat.id, d, rank })
      }
    }

    state.phase = 'Saving'
    const rows = [...winners.values()].map(({ category, d }) => {
      const { document: _doc, crossreferences: _x, illustration: _i, ...rest } = d
      const src = (typeof d.document === 'string' ? d.document : d.document?.key) as string
      const system = docInfo.get(src)?.gamesystem?.key ?? d.document?.gamesystem?.key ?? ''
      // rules keep their own "ruleset" (the section); everything else gets the game system there
      const data = JSON.stringify({ ...rest, system, ruleset: category === 'rule' ? rest.ruleset : system })
      // Open5e keys are only unique within one endpoint (srd-2024_camel is both a mount and a creature)
      return { key: `${category}:${d.key}`, category, name: d.name as string, source: src, sub: subOf(category, d), data, hash: crypto.createHash('md5').update(data).digest('hex') }
    })

    const old = new Map((db.prepare('SELECT key, category, name, hash FROM entries').all() as { key: string; category: string; name: string; hash: string }[]).map((r) => [r.key, r]))
    const lines: string[] = []
    const stamp = new Date().toISOString()
    const line = (what: string, category: string, key: string, name: string) => lines.push(`${stamp} ${what} ${category} ${key} ${name}`)
    const keep = new Set<string>()
    for (const r of rows) {
      keep.add(r.key)
      const o = old.get(r.key)
      if (!o) line('CREATED', r.category, r.key, r.name)
      else if (o.hash !== r.hash) line('UPDATED', r.category, r.key, r.name)
    }
    for (const [key, o] of old) if (!keep.has(key)) line('DELETED', o.category, key, o.name)

    const put = db.prepare('INSERT INTO entries(key,category,name,source,sub,hash,data) VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET category=excluded.category, name=excluded.name, source=excluded.source, sub=excluded.sub, hash=excluded.hash, data=excluded.data')
    const putSource = db.prepare('INSERT INTO sources(key,name,license,published,permalink) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET name=excluded.name, license=excluded.license, published=excluded.published, permalink=excluded.permalink')
    db.transaction(() => {
      for (const r of rows) put.run(r.key, r.category, r.name, r.source, r.sub, r.hash, r.data)
      for (const key of old.keys()) if (!keep.has(key)) db.prepare('DELETE FROM entries WHERE key = ?').run(key)
      for (const d of docs) putSource.run(d.key, d.display_name ?? d.name ?? d.key, (d.licenses ?? []).map((l: any) => l.name).join(', '), String(d.publication_date ?? ''), d.permalink ?? '')
      db.prepare("INSERT INTO meta(k,v) VALUES('updatedAt', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(String(Date.now()))
    })()
    if (lines.length) fs.appendFileSync(logFile(), lines.join('\n') + '\n')
    state.phase = ''
  } catch (e) {
    state.error = `The library could not be downloaded. ${e instanceof Error ? e.message : String(e)}`
    state.phase = ''
  } finally {
    state.running = false
  }
}
