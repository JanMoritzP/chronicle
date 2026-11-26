import { get as idbGet, set as idbSet } from 'idb-keyval'
import { create } from 'zustand'
import { api } from '../api'
import type { LibraryCategory, LibraryEntry, LibraryIndex, LibraryRow, LibraryStatus } from '../types'
import { fuzzy } from './fuzzy'

export const LIBRARY_CATEGORIES: { id: LibraryCategory; label: string; plural: string }[] = [
  { id: 'creature', label: 'Creature', plural: 'Creatures' },
  { id: 'spell', label: 'Spell', plural: 'Spells' },
  { id: 'magicitem', label: 'Magic item', plural: 'Magic items' },
  { id: 'item', label: 'Equipment', plural: 'Equipment' },
  { id: 'class', label: 'Class', plural: 'Classes' },
  { id: 'species', label: 'Species', plural: 'Species' },
  { id: 'background', label: 'Background', plural: 'Backgrounds' },
  { id: 'feat', label: 'Feat', plural: 'Feats' },
  { id: 'condition', label: 'Condition', plural: 'Conditions' },
  { id: 'weaponproperty', label: 'Weapon property', plural: 'Weapon properties' },
  { id: 'damagetype', label: 'Damage type', plural: 'Damage types' },
  { id: 'skill', label: 'Skill', plural: 'Skills' },
  { id: 'ability', label: 'Ability', plural: 'Abilities' },
  { id: 'school', label: 'Spell school', plural: 'Spell schools' },
  { id: 'language', label: 'Language', plural: 'Languages' },
  { id: 'creaturetype', label: 'Creature type', plural: 'Creature types' },
  { id: 'alignment', label: 'Alignment', plural: 'Alignments' },
  { id: 'size', label: 'Size', plural: 'Sizes' },
  { id: 'rule', label: 'Rule', plural: 'Rules' },
  { id: 'page', label: 'Page', plural: 'Pages' },
]
const entries = new Map<string, LibraryEntry>()

/** A full entry, fetched once and kept: the Library view and the hover cards share it. */
export async function fetchLibraryEntry(key: string): Promise<LibraryEntry> {
  const hit = entries.get(key)
  if (hit) return hit
  const e = await api.libraryEntry(key)
  entries.set(key, e)
  return e
}

export const categoryLabel = (c: LibraryCategory) => LIBRARY_CATEGORIES.find((x) => x.id === c)?.label ?? c

interface LibraryState {
  status: LibraryStatus | null
  index: LibraryIndex | null
  loaded: boolean
  load: () => Promise<void>
  refresh: () => Promise<void>
}

const CACHE_KEY = 'library:index'
let lower: string[] = []
let polling = false

async function loadIndex(version: number): Promise<LibraryIndex | null> {
  try {
    const cached = await idbGet<LibraryIndex>(CACHE_KEY)
    if (cached && cached.version === version) return cached
  } catch { /* the cache is optional */ }
  const fresh = await api.libraryIndex()
  try { await idbSet(CACHE_KEY, fresh) } catch { /* best effort */ }
  return fresh
}

export const useLibrary = create<LibraryState>((set, get) => ({
  status: null,
  index: null,
  loaded: false,
  async load() {
    const status = await api.libraryStatus()
    set({ status })
    // the version moves with every Open5e refresh and every change to a homebrew library
    const version = status.version ?? status.updatedAt ?? 0
    if (!status.count) { lower = []; set({ index: null }) } else if (get().index?.version !== version) {
      const index = await loadIndex(version)
      lower = index ? index.rows.map((r) => r[2].toLowerCase()) : []
      set({ index })
    }
    set({ loaded: true })
    if (status.running) void poll()
  },
  async refresh() {
    set({ status: await api.libraryRefresh() })
    void poll()
  },
}))

/** The download takes about a minute on the server; watch it until it stops, then load the new index. */
async function poll() {
  if (polling) return
  polling = true
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000))
      const status = await api.libraryStatus()
      useLibrary.setState({ status })
      if (!status.running) break
    }
    await useLibrary.getState().load()
  } catch { /* the next open of the library tries again */ } finally { polling = false }
}

export interface LibraryHit { row: LibraryRow; indices: number[]; score: number }

/** Fuzzy match on names. With no query the first entries by name are returned. */
export function searchLibrary(index: LibraryIndex | null, q: string, category: LibraryCategory | null, limit = 60): LibraryHit[] {
  if (!index) return []
  const out: LibraryHit[] = []
  const query = q.trim()
  if (!query) {
    for (const row of index.rows) {
      if (category && row[1] !== category) continue
      out.push({ row, indices: [], score: 0 })
      if (out.length >= limit) break
    }
    return out
  }
  const ql = query.toLowerCase()
  for (let i = 0; i < index.rows.length; i++) {
    const row = index.rows[i]
    if (category && row[1] !== category) continue
    if (ql.length > lower[i].length) continue
    const h = fuzzy(ql, lower[i])
    if (h) out.push({ row, indices: h.indices, score: h.score })
  }
  out.sort((a, b) => b.score - a.score || a.row[2].length - b.row[2].length)
  return out.slice(0, limit)
}

/** False for an entry of the other edition of the System Reference Document than the sheet plays by (the 2014 Fighter on a 2024 sheet). */
export const fitsRules = (row: LibraryRow, ruleset: string) => row[3] !== (ruleset === '5e-2024' ? 'srd-2014' : 'srd-2024')

const plainName = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()

/**
 * The feat of the library a name means, in the sheet's edition: "Magic Initiate (Cleric)" and "Alert (feat)" find "Magic Initiate" and "Alert".
 * Homebrew comes first, then the edition's own book, then any other.
 */
export function findFeat(index: LibraryIndex | null, name: string, ruleset: string): LibraryRow | null {
  const want = [plainName(name), plainName(name.replace(/\s*\([^)]*\)\s*$/, '')), plainName(name.replace(/\s*\(.*\)\s*$/, ''))]
  const modern = ruleset === '5e-2024'
  const rank = (r: LibraryRow) => (r[0].includes(':hb.') ? 0 : r[3].includes('2024') === modern ? 1 : 2)
  for (const n of want) {
    const hits = (index?.rows ?? []).filter((r) => r[1] === 'feat' && plainName(r[2]) === n)
    if (hits.length) return hits.sort((a, b) => rank(a) - rank(b))[0]
  }
  return null
}

/** What a feat does, from its entry: the description and each benefit, in plain words. */
export function featText(data: any, max = 1800): string {
  const strip = (t: unknown) => String(t ?? '').replace(/\*\*?|__?|^#+\s*/gm, '').replace(/\s+/g, ' ').trim()
  const parts = [strip(data?.desc), ...(Array.isArray(data?.benefits) ? data.benefits.map((b: any) => strip(b?.desc)) : [])].filter(Boolean)
  const all = parts.join(' ')
  return all.length > max ? `${all.slice(0, max - 1).trimEnd()}…` : all
}

/** The library's feat of a name and what it does, or null when the library has none of that name. Loads the library index when needed. */
export async function featFromLibrary(name: string, ruleset: string): Promise<{ key: string; name: string; text: string } | null> {
  if (!name.trim()) return null
  if (!useLibrary.getState().loaded) await useLibrary.getState().load().catch(() => {})
  const row = findFeat(useLibrary.getState().index, name, ruleset)
  if (!row) return null
  const e = await fetchLibraryEntry(row[0])
  return { key: row[0], name: row[2], text: featText(e.data) }
}
