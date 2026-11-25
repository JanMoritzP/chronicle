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
