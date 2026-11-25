import { api } from '../api'
import type { FullPage, HomebrewEntry, LibraryCategory, LibraryEntry } from '../types'
import { catalogFor, type BackgroundDef, type Catalog, type ClassDef, type Ruleset, type SpeciesDef } from './builder'
import { categoryLabel } from './library'
import { PAGE_TYPE, textDoc } from './open5e'
import { ABILITIES, SKILLS, type Ability } from './sheet'

// Homebrew: classes, species, backgrounds and any other page people make themselves, kept as pages of the world and, if they
// like, as entries of their own libraries. This module turns a page into a library entry and back, carries the pictures across
// (a world's uploads belong to that world, a library's pictures to the library), and turns the rules of a homebrew class,
// species or background into what the character builder uses.

// ---------- rules for the character builder ----------

export interface ClassRules {
  die: number
  primary: Ability[]
  saves: Ability[]
  skills: { count: number; from: string[] | 'any' }
  spell?: Ability | ''
  /** armor class of the starting kit: a base, plus the Dexterity modifier (all of it, at most 2, or none), plus one more ability, plus a shield */
  armor: { base: number; dex: 'full' | 'max2' | 'none'; plus?: Ability | ''; shield?: boolean; note: string }
  kit: { name: string; qty?: number; weight?: number; equipped?: boolean }[]
  features: { name: string; text: string }[]
  attacks: { name: string; ability: 'str' | 'dex' | 'finesse'; damage: string; note?: string }[]
  spells?: string
}
export interface SpeciesRules {
  size: string; speed: number; darkvision: number; languages: string
  asi?: Partial<Record<Ability, number>>; freeAsi?: number; hpPerLevel?: number
  traits: { name: string; text: string }[]
  skills?: string[]
}
export interface BackgroundRules { skills: string[]; tools: string; abilities?: Ability[]; feat?: string }
export type Rules = ClassRules | SpeciesRules | BackgroundRules
export type RulesCategory = 'class' | 'species' | 'background'
export const hasRules = (c: string): c is RulesCategory => c === 'class' || c === 'species' || c === 'background'

export const emptyRules = (c: RulesCategory): Rules => c === 'class'
  ? { die: 8, primary: [], saves: [], skills: { count: 2, from: [] }, spell: '', armor: { base: 10, dex: 'full', plus: '', shield: false, note: 'no armor' }, kit: [], features: [], attacks: [], spells: '' }
  : c === 'species'
    ? { size: 'Medium', speed: 30, darkvision: 0, languages: 'Common and one more', asi: {}, freeAsi: 0, hpPerLevel: 0, traits: [], skills: [] }
    : { skills: [], tools: '', abilities: [], feat: '' }

const isAbility = (a: unknown): a is Ability => typeof a === 'string' && (ABILITIES as readonly string[]).includes(a)
const abilities = (v: unknown, max = 6) => (Array.isArray(v) ? [...new Set(v.filter(isAbility))].slice(0, max) : [])
const skills = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map((s) => String(s).toLowerCase()).filter((s) => s in SKILLS))] : [])
const num = (v: unknown, min: number, max: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d }
const str = (v: unknown, n = 2000) => String(v ?? '').trim().slice(0, n)
const named = (v: unknown, n = 30) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && str((x as any).name)).slice(0, n) : []) as any[]

/** Rules from a page or a file, made safe: anything missing or out of range gets a sensible value. */
export function cleanRules(c: RulesCategory, raw: any): Rules {
  const r = raw && typeof raw === 'object' ? raw : {}
  if (c === 'class') {
    const from = r.skills?.from === 'any' ? 'any' as const : skills(r.skills?.from)
    return {
      die: [6, 8, 10, 12].includes(Number(r.die)) ? Number(r.die) : 8,
      primary: abilities(r.primary, 2), saves: abilities(r.saves, 2),
      skills: { count: num(r.skills?.count, 0, 18, 2), from },
      spell: isAbility(r.spell) ? r.spell : '',
      armor: { base: num(r.armor?.base, 0, 30, 10), dex: ['full', 'max2', 'none'].includes(r.armor?.dex) ? r.armor.dex : 'full', plus: isAbility(r.armor?.plus) ? r.armor.plus : '', shield: !!r.armor?.shield, note: str(r.armor?.note, 80) },
      kit: named(r.kit).map((k) => ({ name: str(k.name, 80), ...(Number(k.qty) > 1 ? { qty: num(k.qty, 1, 999, 1) } : {}), ...(Number(k.weight) > 0 ? { weight: Math.min(999, Number(k.weight)) } : {}), ...(k.equipped ? { equipped: true } : {}) })),
      features: named(r.features).map((f) => ({ name: str(f.name, 120), text: str(f.text) })),
      attacks: named(r.attacks, 8).map((a) => ({ name: str(a.name, 80), ability: ['str', 'dex', 'finesse'].includes(a.ability) ? a.ability : 'str', damage: /^\d+d\d+$/.test(str(a.damage)) ? str(a.damage) : '1d6', ...(str(a.note) ? { note: str(a.note, 120) } : {}) })),
      spells: str(r.spells),
    }
  }
  if (c === 'species') {
    const asi: Partial<Record<Ability, number>> = {}
    for (const a of ABILITIES) { const n = num(r.asi?.[a], 0, 3, 0); if (n) asi[a] = n }
    return {
      size: ['Tiny', 'Small', 'Medium', 'Large'].includes(r.size) ? r.size : 'Medium',
      speed: num(r.speed, 0, 120, 30), darkvision: num(r.darkvision, 0, 300, 0), languages: str(r.languages, 200),
      asi, freeAsi: num(r.freeAsi, 0, 3, 0), hpPerLevel: num(r.hpPerLevel, 0, 3, 0),
      traits: named(r.traits).map((t) => ({ name: str(t.name, 120), text: str(t.text) })),
      skills: skills(r.skills),
    }
  }
  return { skills: skills(r.skills).slice(0, 2), tools: str(r.tools, 200), abilities: abilities(r.abilities, 3), feat: str(r.feat, 120) }
}

const armorOf = (a: ClassRules['armor']) => (m: Record<Ability, number>) => ({
  value: a.base + (a.dex === 'full' ? m.dex : a.dex === 'max2' ? Math.min(2, m.dex) : 0) + (a.plus ? m[a.plus] : 0) + (a.shield ? 2 : 0),
  note: a.note,
})

export function classDef(id: string, name: string, raw: any): ClassDef {
  const r = cleanRules('class', raw) as ClassRules
  return {
    id, name, die: r.die, primary: r.primary.length ? r.primary : ['str'], saves: r.saves, skills: r.skills, ...(r.spell ? { spell: r.spell } : {}),
    ac: armorOf(r.armor), kit: r.kit,
    features: r.features,
    attacks: r.attacks, ...(r.spells ? { spells: r.spells } : {}),
  }
}
export function speciesDef(id: string, name: string, raw: any, ruleset: Ruleset): SpeciesDef {
  const r = cleanRules('species', raw) as SpeciesRules
  // the 2024 rules raise scores through the background only
  const old = ruleset !== '5e-2024'
  return { id, name, size: r.size, speed: r.speed, darkvision: r.darkvision, languages: r.languages, traits: r.traits, ...(r.skills?.length ? { skills: r.skills } : {}), ...(r.hpPerLevel ? { hpPerLevel: r.hpPerLevel } : {}), ...(old && Object.keys(r.asi ?? {}).length ? { asi: r.asi } : {}), ...(old && r.freeAsi ? { freeAsi: r.freeAsi } : {}) }
}
export function backgroundDef(id: string, name: string, raw: any, ruleset: Ruleset): BackgroundDef {
  const r = cleanRules('background', raw) as BackgroundRules
  return { id, name, skills: r.skills, tools: r.tools, ...(ruleset === '5e-2024' && r.abilities?.length === 3 ? { abilities: r.abilities } : {}), ...(r.feat ? { feat: r.feat } : {}) }
}

/** One homebrew class, species or background the builder can offer, from a page of the world or an entry of a library. */
export interface HomebrewOption { id: string; category: RulesCategory; name: string; rules: any; from: string; pageId?: string; libKey?: string }

/** The builder's choices with the homebrew ones added. Ids are "page:<id>" or "lib:<key>". */
export function homebrewCatalog(ruleset: Ruleset, options: HomebrewOption[]): Catalog {
  return catalogFor(ruleset, {
    classes: options.filter((o) => o.category === 'class').map((o) => classDef(o.id, o.name, o.rules)),
    species: options.filter((o) => o.category === 'species').map((o) => speciesDef(o.id, o.name, o.rules, ruleset)),
    backgrounds: options.filter((o) => o.category === 'background').map((o) => backgroundDef(o.id, o.name, o.rules, ruleset)),
  })
}

/**
 * Every homebrew class, species and background: the world's pages of those types that carry rules, then the library entries
 * with rules. A page made from a library entry stands in for the entry, since it may have been changed in this world.
 */
export async function loadHomebrew(pages: { id: string; title: string; type?: string | null; library?: string | null }[]): Promise<HomebrewOption[]> {
  const candidates = pages.filter((p) => p.type && hasRules(p.type))
  const full = await Promise.all(candidates.map((p) => api.getPage(p.id).catch(() => null)))
  const out: HomebrewOption[] = []
  const covered = new Set<string>()
  full.forEach((pg, i) => {
    const meta = candidates[i]
    if (!pg?.props?.rules) return
    out.push({ id: `page:${pg.id}`, category: meta.type as RulesCategory, name: pg.title || 'Untitled', rules: pg.props.rules, from: 'this world', pageId: pg.id })
    if (pg.props.library) covered.add(pg.props.library)
  })
  for (const e of await api.libraryBuilder().catch(() => [])) {
    if (!covered.has(e.key)) out.push({ id: `lib:${e.key}`, category: e.category, name: e.name, rules: e.rules, from: e.library, libKey: e.key })
  }
  return out
}

/** One line on what the rules give, shown in search results and on cards. */
export function rulesSub(c: RulesCategory, rules: any): string {
  const r = cleanRules(c, rules)
  if (c === 'class') { const k = r as ClassRules; return `Class · d${k.die} hit die${k.spell ? ' · casts spells' : ''}` }
  if (c === 'species') { const s = r as SpeciesRules; return `Species · ${s.size}, speed ${s.speed} ft` }
  return `Background · ${(r as BackgroundRules).skills.join(' and ') || 'no skills yet'}`
}

/** The page fields of the built-in Class type the rules can fill (the rest of the page is the text). */
export function rulesFields(c: RulesCategory, rules: any): Record<string, unknown> {
  if (c !== 'class') return {}
  const r = cleanRules('class', rules) as ClassRules
  const name = (a: Ability) => ({ name: { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' }[a] })
  return { hit_die: `d${r.die}`, ...(r.saves.length ? { saves: r.saves.map(name) } : {}), ...(r.primary.length ? { primary: r.primary.map(name) } : {}) }
}

// ---------- the same species or background put straight on a character sheet ----------

/** A sheet patch for a homebrew species: size, speed, darkvision, languages, skills and traits. */
export function homebrewSpeciesPatch(sheet: { features?: { traits?: { name: string; text: string }[] }; profs?: { skills?: Record<string, string> } }, name: string, raw: any): Record<string, unknown> {
  const r = cleanRules('species', raw) as SpeciesRules
  const have = new Set((sheet.features?.traits ?? []).map((t) => t.name.toLowerCase()))
  const patch: Record<string, unknown> = { species: name.slice(0, 80), size: r.size, 'speed.walk': r.speed }
  if (r.darkvision) patch['senses.darkvision'] = r.darkvision
  if (r.languages) patch.languages = r.languages
  const added = r.traits.filter((t) => !have.has(t.name.toLowerCase()))
  if (added.length) patch['features.traits'] = [...(sheet.features?.traits ?? []), ...added]
  if (r.skills?.length) patch['profs.skills'] = { ...(sheet.profs?.skills ?? {}), ...Object.fromEntries(r.skills.map((s) => [s, sheet.profs?.skills?.[s] ?? 'p'])) }
  return patch
}
export function homebrewBackgroundPatch(sheet: { features?: { traits?: { name: string; text: string }[] }; profs?: { skills?: Record<string, string>; tools?: string } }, name: string, raw: any): Record<string, unknown> {
  const r = cleanRules('background', raw) as BackgroundRules
  const patch: Record<string, unknown> = { background: name.slice(0, 80) }
  if (r.skills.length) patch['profs.skills'] = { ...(sheet.profs?.skills ?? {}), ...Object.fromEntries(r.skills.map((s) => [s, sheet.profs?.skills?.[s] ?? 'p'])) }
  const had = sheet.profs?.tools ?? ''
  if (r.tools && !had.toLowerCase().includes(r.tools.toLowerCase())) patch['profs.tools'] = had ? `${had}, ${r.tools}` : r.tools
  const traits = sheet.features?.traits ?? []
  if (r.feat && !traits.some((t) => t.name.toLowerCase() === r.feat!.toLowerCase())) patch['features.traits'] = [...traits, { name: r.feat, text: `A feat from the ${name} background.` }]
  return patch
}

// ---------- pages and library entries ----------

/** The kind of library entry a page of each special page type becomes. */
const CATEGORY_OF_TYPE: Record<string, LibraryCategory> = { monster: 'creature', spell: 'spell', item: 'item', class: 'class', species: 'species', background: 'background', feat: 'feat', condition: 'condition', rule: 'rule' }
export const categoryOfPage = (props: Record<string, any> | null | undefined): LibraryCategory => {
  const t = props?.type
  if (t === 'item' && /magic|wondrous|rare|uncommon|legendary|artifact/i.test(String(props?.data?.main?.sub ?? ''))) return 'magicitem'
  return (typeof t === 'string' && CATEGORY_OF_TYPE[t]) || 'page'
}
export const typeOfCategory = (c: LibraryCategory): string | undefined => (c === 'page' ? undefined : PAGE_TYPE[c])
export const isHomebrewKey = (key: string | null | undefined) => !!key && /^[a-z]+:hb\./.test(key)

const UPLOAD = /^\/api\/uploads\/[A-Za-z0-9-]+$/
const ASSET = /^\/api\/library\/assets\/[a-f0-9]{32}$/

/** Every string in a value that matches, replaced by what `map` gives for it (each distinct one asked once). */
async function mapStrings<T>(value: T, test: RegExp, map: (s: string) => Promise<string | null>): Promise<T> {
  const found = new Set<string>()
  const walk = (v: any): void => { if (typeof v === 'string') { if (test.test(v)) found.add(v) } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk) }
  walk(value)
  if (!found.size) return value
  const to = new Map<string, string>()
  for (const s of found) { const n = await map(s).catch(() => null); if (n) to.set(s, n) }
  const swap = (v: any): any => typeof v === 'string' ? (to.get(v) ?? v) : Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v
  return swap(value)
}

/**
 * Links to pages of this world mean nothing elsewhere: they keep their names, and links into the library stay.
 * Todos belong to the world's to-do list, so they stay behind.
 */
function dropPageIds(v: any): any {
  if (Array.isArray(v)) return v.filter((x) => x?.type !== 'todo').map(dropPageIds)
  if (!v || typeof v !== 'object') return v
  const out: Record<string, any> = {}
  for (const [k, x] of Object.entries(v)) if (k !== 'pageId') out[k] = dropPageIds(x)
  if (v.type === 'wikilink' && v.attrs) out.attrs = { ...dropPageIds(v.attrs), pageId: null }
  if (v.type === 'embed') return { type: 'paragraph', content: v.attrs?.name ? [{ type: 'text', text: String(v.attrs.name) }] : undefined }
  return out
}

/** A page as a library entry: its type, fields, sheet, rules, text and pictures (copied into the library). */
export async function pageToEntry(page: FullPage, category = categoryOfPage(page.props)): Promise<HomebrewEntry> {
  const p = page.props ?? {}
  const { portrait: _p, ...data } = p.data ?? {}
  const entry: HomebrewEntry = {
    category,
    name: page.title.trim() || 'Untitled',
    sub: p.rules && hasRules(category) ? rulesSub(category, p.rules) : `${categoryLabel(category)} · homebrew`,
    ...(typeof p.type === 'string' ? { type: p.type } : {}),
    ...(Object.keys(data).length ? { fields: dropPageIds(data) } : {}),
    ...(p.sheet ? { sheet: p.sheet } : {}),
    ...(p.rules ? { rules: p.rules } : {}),
    content: dropPageIds(page.content),
    ...(typeof p.portrait === 'string' ? { portrait: p.portrait } : {}),
    ...(page.tags?.length ? { tags: page.tags } : {}),
  }
  // the world's pictures become the library's own, so the entry keeps them in every world
  return mapStrings(entry, UPLOAD, async (url) => {
    const r = await fetch(url)
    if (!r.ok) return null
    return api.libraryAsset(await r.blob())
  })
}

/** Headings in plain text start sections, as in the Open5e texts. */
function sectionsOf(text: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [{ heading: '', text: '' }]
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^#{1,3}\s+(.+)$/.exec(line)
    if (h) out.push({ heading: h[1].trim(), text: '' })
    else out[out.length - 1].text += `${line}\n`
  }
  return out.filter((s) => s.heading || s.text.trim())
}

/** What a homebrew entry becomes in a world: the page type, its props and text, with the library's pictures uploaded into the world. */
export async function homebrewPlan(e: LibraryEntry, ws: string, knownTypes: Set<string>): Promise<{ type?: string; props: Record<string, any>; content: any; tags?: string[] }> {
  const d = e.data as HomebrewEntry
  const type = d.type && knownTypes.has(d.type) ? d.type : typeOfCategory(e.category)
  const props: Record<string, any> = { library: e.key }
  if (d.fields) props.data = d.fields
  if (d.sheet) props.sheet = d.sheet
  if (d.rules) props.rules = d.rules
  if (d.portrait) props.portrait = d.portrait
  const content = d.content?.type === 'doc' ? d.content : textDoc(sectionsOf(d.text ?? ''), e)
  const plan = await mapStrings({ props, content }, ASSET, async (url) => {
    const r = await fetch(url)
    if (!r.ok) return null
    const fd = new FormData()
    const blob = await r.blob()
    fd.append('file', new File([blob], `${e.name}.${blob.type.split('/')[1] ?? 'png'}`, { type: blob.type }))
    const up = await fetch(`/api/workspaces/${ws}/uploads`, { method: 'POST', body: fd })
    return up.ok ? ((await up.json()).url as string) : null
  })
  return { type, ...plan, ...(d.tags?.length ? { tags: d.tags } : {}) }
}

