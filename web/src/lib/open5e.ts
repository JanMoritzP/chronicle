import type { LibraryEntry } from '../types'

// Mappers from Open5e records to Chronicle: creatures become stat block data, everything else becomes
// a plain description (facts + sections) that is shown in the library and written into a page body.

const UNIT: Record<string, string> = { feet: 'ft.', meters: 'm' }
const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`)
const title = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const ABILITIES = [['str', 'strength'], ['dex', 'dexterity'], ['con', 'constitution'], ['int', 'intelligence'], ['wis', 'wisdom'], ['cha', 'charisma']] as const

export const crText = (cr: unknown): string => {
  const n = Number(cr)
  if (!Number.isFinite(n)) return '?'
  return n === 0.125 ? '1/8' : n === 0.25 ? '1/4' : n === 0.5 ? '1/2' : String(n)
}

function speedText(d: any): string {
  // speed_all pads every mode with a derived value (a goblin "crawls" at 15 ft.); speed holds only what is printed
  const s = d.speed ?? {}
  const unit = UNIT[s.unit ?? 'feet'] ?? 'ft.'
  const parts: string[] = []
  const walk = Number(s.walk) || 0
  if (walk) parts.push(`${walk} ${unit}`)
  for (const mode of ['burrow', 'climb', 'crawl', 'fly', 'swim']) {
    const v = Number(s[mode]) || 0
    if (v) parts.push(`${mode} ${v} ${unit}${mode === 'fly' && d.speed_all?.hover ? ' (hover)' : ''}`)
  }
  return parts.join(', ') || `0 ${unit}`
}

function sensesText(d: any): string {
  const unit = UNIT[d.speed?.unit ?? 'feet'] ?? 'ft.'
  const parts: string[] = []
  for (const [key, label] of [['blindsight_range', 'blindsight'], ['darkvision_range', 'darkvision'], ['tremorsense_range', 'tremorsense'], ['truesight_range', 'truesight']]) {
    if (d[key]) parts.push(`${label} ${d[key]} ${unit}`)
  }
  if (d.passive_perception != null) parts.push(`passive Perception ${d.passive_perception}`)
  return parts.join(', ')
}

const named = (list: any[]) => (list ?? []).map((x) => String(x.name ?? x).toLowerCase()).join(', ')
const resist = (r: any, key: string) => r?.[`${key}_display`] || named(r?.[key])

function usage(a: any): string {
  const u = a.usage_limits
  if (!u) return ''
  if (u.type === 'RECHARGE_ON_ROLL') return ` (Recharge ${u.param}${u.param < 6 ? '–6' : ''})`
  if (u.type === 'PER_DAY') return ` (${u.param}/Day)`
  if (u.type === 'RECHARGE_AFTER_REST') return ' (Recharges after a Short or Long Rest)'
  return ''
}

/** The stat block text format: ***Name.*** text, one entry per line. */
function entries(list: any[], type: string): string {
  return list
    .filter((a) => a.action_type === type)
    .sort((a, b) => (a.order_in_statblock ?? 0) - (b.order_in_statblock ?? 0))
    .map((a) => {
      const cost = type === 'LEGENDARY_ACTION' && a.legendary_action_cost > 1 ? ` (Costs ${a.legendary_action_cost} Actions)` : ''
      // legendary actions often start with an intro line stored as a nameless-style action
      if (!a.desc?.trim()) return String(a.name).trim()
      return `***${String(a.name).trim()}${type === 'ACTION' ? usage(a) : cost}.*** ${String(a.desc).replace(/\s*\r?\n\s*/g, ' ').trim()}`
    })
    .join('\n')
}

export function statTemplateFor(e: LibraryEntry): string {
  return e.data.ruleset === '5e-2024' ? '5e-monster-2024' : '5e-monster'
}

/** Fills the fields of the built-in 5e monster forms (classic and 2024 layout). */
export function creatureToStatBlock(e: LibraryEntry): { template: string; data: Record<string, string> } {
  const d = e.data
  const template = statTemplateFor(e)
  const modern = template === '5e-monster-2024'
  const out: Record<string, string> = {}
  out.name = e.name
  out.type = `${[d.size?.name, String(d.type?.name ?? '').toLowerCase()].filter(Boolean).join(' ')}${d.alignment ? `, ${d.alignment}` : ''}`
  out.ac = `${d.armor_class ?? ''}${d.armor_detail ? ` (${d.armor_detail})` : ''}`
  out.hp = d.hit_points != null ? `${d.hit_points}${d.hit_dice ? ` (${d.hit_dice})` : ''}` : ''
  out.speed = speedText(d)
  for (const [short, long] of ABILITIES) out[short] = d.ability_scores?.[long] != null ? String(d.ability_scores[long]) : ''

  const saves = d.saving_throws ?? {}
  if (modern) {
    for (const [short, long] of ABILITIES) if (saves[long] != null) out[`${short}_save`] = signed(saves[long])
    if (d.initiative_bonus != null) out.init = `${signed(d.initiative_bonus)} (${10 + d.initiative_bonus})`
  } else {
    out.saves = ABILITIES.filter(([, long]) => saves[long] != null).map(([short, long]) => `${upperFirst(short)} ${signed(saves[long])}`).join(', ')
  }
  out.skills = Object.entries(d.skill_bonuses ?? {}).map(([k, v]) => `${title(k)} ${signed(Number(v))}`).join(', ')
  const r = d.resistances_and_immunities
  out.vuln = resist(r, 'damage_vulnerabilities')
  out.resist = resist(r, 'damage_resistances')
  out.immune = resist(r, 'damage_immunities')
  const cond = resist(r, 'condition_immunities')
  if (modern) out.immune = [out.immune, cond].filter(Boolean).join('; ')
  else out.condImmune = cond
  out.senses = sensesText(d)
  out.languages = d.languages?.as_string ?? ''

  const cr = Number(d.challenge_rating)
  const pb = d.proficiency_bonus ?? (Number.isFinite(cr) ? 2 + Math.floor((Math.max(cr, 1) - 1) / 4) : null)
  const xp = d.experience_points != null ? Number(d.experience_points).toLocaleString('en-US') : ''
  if (modern) out.cr = `${crText(cr)}${xp ? ` (XP ${xp}; PB ${signed(pb ?? 2)})` : ''}`
  else {
    out.cr = `${crText(cr)}${xp ? ` (${xp} XP)` : ''}`
    out.prof = pb != null ? signed(pb) : ''
  }

  out.traits = (d.traits ?? []).map((t: any) => `***${String(t.name).trim()}.*** ${String(t.desc ?? '').replace(/\s*\r?\n\s*/g, ' ').trim()}`).join('\n')
  const actions = d.actions ?? []
  out.actions = entries(actions, 'ACTION')
  out.bonus = entries(actions, 'BONUS_ACTION')
  out.reactions = entries(actions, 'REACTION')
  out.legendary = entries(actions, 'LEGENDARY_ACTION')
  for (const k of Object.keys(out)) if (out[k] === '') delete out[k]
  return { template, data: out }
}

export interface EntryText {
  subtitle: string
  facts: [string, string][]
  sections: { heading: string; text: string }[]
}

const clean = (s: unknown) => String(s ?? '').replace(/\r\n?/g, '\n').trim()
const costText = (c: unknown) => {
  const n = Number(c)
  return Number.isFinite(n) && n > 0 ? `${n % 1 === 0 ? n : n.toFixed(2)} gp` : ''
}
const CASTING: Record<string, string> = { action: '1 action', bonus_action: '1 bonus action', reaction: '1 reaction' }
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`

// ---------- markdown-ish text: paragraphs, bullet lists and tables ----------

export type TextBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; head: string[] | null; rows: string[][] }

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const isSeparator = (line: string) => cells(line).every((c) => /^:?-{2,}:?$/.test(c))

export function textBlocks(text: string): TextBlock[] {
  const lines = text.split('\n')
  const out: TextBlock[] = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    if (line.trimStart().startsWith('|')) {
      const rows: string[][] = []
      let head: string[] | null = null
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        if (isSeparator(lines[i])) { if (rows.length === 1) { head = rows[0]; rows.length = 0 } }
        else rows.push(cells(lines[i]))
        i++
      }
      if (head?.every((c) => !c)) head = null
      out.push({ kind: 'table', head, rows })
    } else if (/^\s*[*-] /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[*-] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[*-] /, ''))
      out.push({ kind: 'ul', items })
    } else {
      if (line.trim()) out.push({ kind: 'p', text: line })
      i++
    }
  }
  return out
}

const mdTable = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

/** Text that goes into a stat block field: list items become bullets, which the stat block text shows as they are. */
const statText = (s: unknown) => clean(s).replace(/^\s*[*-] /gm, '• ').replace(/\n{3,}/g, '\n\n')

// ---------- classes: the level table and the features ----------

function classSections(d: any): { heading: string; text: string }[] {
  const features: any[] = d.features ?? []
  const of = (t: string) => features.filter((f) => f.feature_type === t)
  const sections: { heading: string; text: string }[] = []
  const section = (heading: string, text: unknown) => { const s = clean(text); if (s && s !== '[Column data]') sections.push({ heading, text: s }) }

  section('', d.desc)
  for (const f of of('CORE_TRAITS_TABLE')) section(f.name, f.desc)
  for (const f of of('PROFICIENCIES')) section(f.name, f.desc)
  for (const f of of('STARTING_EQUIPMENT')) section(f.name, f.desc)

  // one row per level: proficiency bonus, features gained, then the class specific columns and spell slots
  const columns = [...of('PROFICIENCY_BONUS'), ...of('CLASS_TABLE_DATA'), ...of('SPELL_SLOTS')].filter((f) => f.data_for_class_table?.length)
  const levelFeatures = of('CLASS_LEVEL_FEATURE')
  const levels = new Set<number>()
  for (const f of levelFeatures) for (const g of f.gained_at ?? []) levels.add(Number(g.level))
  for (const c of columns) for (const r of c.data_for_class_table) levels.add(Number(r.level))
  const maxLevel = Math.min(20, Math.max(0, ...levels))
  if (columns.length || levelFeatures.length) {
    const head = ['Level', ...columns.map((c) => (c.feature_type === 'SPELL_SLOTS' ? `${c.name} slots` : c.name)), 'Features']
    const rows: string[][] = []
    for (let lv = 1; lv <= maxLevel; lv++) {
      const names = levelFeatures.filter((f) => (f.gained_at ?? []).some((g: any) => Number(g.level) === lv)).map((f) => f.name)
      rows.push([String(lv), ...columns.map((c) => c.data_for_class_table.find((r: any) => Number(r.level) === lv)?.column_value ?? '—'), names.join(', ') || '—'])
    }
    if (rows.length) section('Level progression', mdTable(head, rows))
  }

  const firstLevel = (f: any) => Math.min(99, ...((f.gained_at ?? []).map((g: any) => Number(g.level))))
  for (const f of [...levelFeatures].sort((a, b) => firstLevel(a) - firstLevel(b))) {
    const lv = ([...new Set<number>((f.gained_at ?? []).map((g: any) => Number(g.level)))]).sort((a, b) => a - b)
    section(`${f.name}${lv.length ? ` (level ${lv.join(', ')})` : ''}`, f.desc)
  }
  for (const f of of('CLASS_FEATURE_OPTION_LIST')) section(f.name, f.desc)
  return sections
}

/** Everything except stat block based entries: a subtitle, a few labelled facts and titled text sections. */
export function entryText(e: LibraryEntry): EntryText {
  const d = e.data
  const facts: [string, string][] = []
  const sections: { heading: string; text: string }[] = []
  const fact = (label: string, v: unknown) => { const s = String(v ?? '').trim(); if (s) facts.push([label, s]) }
  const section = (heading: string, text: unknown) => { const s = clean(text); if (s) sections.push({ heading, text: s }) }
  let subtitle = ''

  switch (e.category) {
    case 'class': {
      subtitle = d.subclass_of?.name ? `Subclass of ${d.subclass_of.name}` : 'Class'
      fact('Hit die', d.hit_points?.hit_dice_name ?? d.hit_dice)
      fact('Saving throws', (d.saving_throws ?? []).map((s: any) => s.name).join(', '))
      fact('Primary ability', (d.primary_abilities ?? []).map((s: any) => s.name ?? s).join(', '))
      sections.push(...classSections(d))
      break
    }
    case 'species': {
      subtitle = d.is_subspecies ? 'Subspecies' : 'Species'
      section('', d.desc)
      for (const t of [...(d.traits ?? [])].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))) section(t.name, String(t.desc ?? '').replace(/^\*\*_[^_]+_\*\*\s*/, ''))
      break
    }
    case 'background': {
      subtitle = 'Background'
      section('', d.desc)
      for (const b of d.benefits ?? []) section(b.name, b.desc)
      break
    }
    case 'feat': {
      subtitle = d.type ? `${upperFirst(String(d.type).toLowerCase())} feat` : 'Feat'
      fact('Prerequisite', d.prerequisite)
      section('', d.desc)
      const benefits = (d.benefits ?? []).map((b: any) => clean(b.desc)).filter(Boolean)
      if (benefits.length) section('Benefits', benefits.map((b: string) => `* ${b}`).join('\n'))
      break
    }
    case 'condition': {
      subtitle = 'Condition'
      // a condition lists its wording in every rules version; the entry's own book is the one that counts
      const own = (d.descriptions ?? []).filter((x: any) => x.document === e.source)
      section('', (own.length ? own : (d.descriptions ?? []).slice(0, 1)).map((x: any) => clean(x.desc)).filter(Boolean).join('\n\n'))
      break
    }
    default:
      break
  }
  return { subtitle, facts, sections }
}

// ---------- spells and items as stat blocks ----------

export interface Ref { name: string; libKey?: string; pageId?: string }
type Index = { rows: [string, string, string, string, string][] } | null

/** The library entry a name or key from another entry points at: by key first, then by name (the same entry may live in another book). */
export function resolveRef(index: Index, category: string, apiKey: string | undefined, name: string): Ref {
  if (index) {
    const id = apiKey ? `${category}:${apiKey}` : ''
    let row = id ? index.rows.find((r) => r[0] === id) : undefined
    if (!row) {
      const want = name.toLowerCase()
      row = index.rows.find((r) => r[1] === category && r[2].toLowerCase() === want && (category !== 'class' || r[4] === 'Class'))
    }
    if (row) return { name: row[2], libKey: row[0] }
  }
  return { name }
}

type StatPart = { template: string; data: Record<string, string> }

function withRefs(data: Record<string, string>, key: string, refs: Ref[]) {
  if (!refs.length) return
  data[key] = refs.map((r) => r.name).join(', ')
  if (refs.some((r) => r.libKey)) data[`${key}:refs`] = JSON.stringify(refs)
}

export function spellToStatBlock(e: LibraryEntry, index: Index): StatPart {
  const d = e.data
  const out: Record<string, string> = { name: e.name }
  const school = String(d.school?.name ?? '')
  out.sub = (d.level === 0 ? `${school} cantrip` : `${ordinal(d.level)}-level ${school.toLowerCase()}`).trim() + (d.ritual ? ' (ritual)' : '')
  out.time = [CASTING[d.casting_time] ?? d.casting_time, d.reaction_condition].filter(Boolean).join(', ')
  out.range = d.range_text ?? ''
  out.components = [d.verbal && 'V', d.somatic && 'S', d.material && `M${d.material_specified ? ` (${d.material_specified})` : ''}`].filter(Boolean).join(', ')
  out.duration = `${d.concentration ? 'Concentration, ' : ''}${d.duration ?? ''}`.replace(/, $/, '')
  withRefs(out, 'classes', (d.classes ?? []).map((c: any) => resolveRef(index, 'class', c.key, c.name ?? String(c))))
  out.desc = statText(d.desc)
  out.higher = statText(d.higher_level)
  for (const k of Object.keys(out)) if (out[k] === '') delete out[k]
  return { template: '5e-spell', data: out }
}

export function itemToStatBlock(e: LibraryEntry): StatPart {
  const d = e.data
  const out: Record<string, string> = { name: e.name }
  if (e.category === 'magicitem') {
    out.sub = [d.category?.name, String(d.rarity?.name ?? '').toLowerCase()].filter(Boolean).join(', ') + (d.requires_attunement ? ` (requires attunement${d.attunement_detail ? ` ${d.attunement_detail}` : ''})` : '')
  } else out.sub = d.category?.name ?? ''
  if (d.weapon?.damage_dice) out.damage = `${d.weapon.damage_dice} ${String(d.weapon.damage_type?.name ?? '').toLowerCase()}`.trim()
  if (d.weapon?.properties?.length) out.properties = d.weapon.properties.map((p: any) => `${p.property?.name ?? ''}${p.detail ? ` (${p.detail})` : ''}`).filter(Boolean).join(', ')
  if (d.armor) {
    out.ac = d.armor.ac_display ?? ''
    if (d.armor.strength_score_required) out.strength = `Str ${d.armor.strength_score_required}`
    if (d.armor.grants_stealth_disadvantage) out.stealth = 'Disadvantage'
  }
  out.cost = e.category === 'item' ? costText(d.cost) : ''
  out.weight = Number(d.weight) > 0 ? `${Number(d.weight)} ${d.weight_unit ?? 'lb'}` : ''
  out.desc = statText(d.desc)
  for (const k of Object.keys(out)) if (out[k] === '') delete out[k]
  return { template: '5e-item', data: out }
}

/** The stat block form and data of entries that are shown as stat blocks (creatures, spells, items), else null. */
export function statBlockFor(e: LibraryEntry, index: Index): StatPart | null {
  switch (e.category) {
    case 'creature': return creatureToStatBlock(e)
    case 'spell': return spellToStatBlock(e, index)
    case 'item': case 'magicitem': return itemToStatBlock(e)
    default: return null
  }
}

// ---------- importing: one special page per kind ----------

/** Page body for an imported entry, as an editor document. */
export function textDoc(sections: { heading: string; text: string }[], e: LibraryEntry): any {
  const text = (s: string, marks?: any[]) => ({ type: 'text', text: s, ...(marks ? { marks } : {}) })
  // **bold**, *italic*, ***both*** and _italic_ become marks instead of showing their punctuation
  const inline = (s: string) => s.split(/(\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|\*[^*\n]+\*|(?<!\w)_[^_\n]+_(?!\w))/g).filter(Boolean).map((part) => {
    if (part.startsWith('***') && part.length > 6) return text(part.slice(3, -3), [{ type: 'bold' }, { type: 'italic' }])
    if (part.startsWith('**') && part.length > 4) return text(part.slice(2, -2), [{ type: 'bold' }])
    if ((part.startsWith('*') || part.startsWith('_')) && part.length > 2) return text(part.slice(1, -1), [{ type: 'italic' }])
    return text(part)
  })
  const para = (s: string) => ({ type: 'paragraph', content: s ? inline(s) : undefined })
  const plain = (s: string) => s.replace(/\*\*\*|\*\*|__/g, '')
  const content: any[] = []
  for (const s of sections) {
    if (s.heading) content.push({ type: 'heading', attrs: { level: 2 }, content: [text(plain(s.heading))] })
    for (const b of textBlocks(s.text)) {
      if (b.kind === 'ul') content.push({ type: 'bulletList', content: b.items.map((i) => ({ type: 'listItem', content: [para(i)] })) })
      else if (b.kind === 'p') content.push(para(b.text))
      else {
        const row = (r: string[], header: boolean) => ({ type: 'tableRow', content: r.map((c) => ({ type: header ? 'tableHeader' : 'tableCell', content: [para(c)] })) })
        content.push({ type: 'table', content: [...(b.head ? [row(b.head, true)] : []), ...b.rows.map((r) => row(r, false))] })
      }
    }
  }
  content.push(para(`Source: ${e.sourceName}${e.license ? `. ${e.license}.` : ''}`))
  return { type: 'doc', content }
}

export interface ImportPlan {
  /** id of the special page type the page becomes */
  type: string
  props: Record<string, any>
  content: any
}

const PAGE_TYPE: Record<string, string> = { creature: 'monster', spell: 'spell', item: 'item', magicitem: 'item', class: 'class', species: 'species', background: 'background', feat: 'feat', condition: 'condition' }

/** What becomes of a library entry when it is added to a world: its special page type, field values and body text. */
export function importPlan(e: LibraryEntry, index: Index): ImportPlan {
  const type = PAGE_TYPE[e.category]
  const stat = statBlockFor(e, index)
  if (stat) return { type, props: { library: e.key, data: { main: stat } }, content: textDoc([], e) }

  const t = entryText(e)
  const d = e.data
  const data: Record<string, any> = {}
  if (e.category === 'class') {
    const fact = (label: string) => t.facts.find((f) => f[0] === label)?.[1]
    if (fact('Hit die')) data.hit_die = fact('Hit die')
    if (fact('Saving throws')) data.saves = fact('Saving throws')
    if (fact('Primary ability')) data.primary = fact('Primary ability')
    if (d.subclass_of?.name) data.subclass_of = [resolveRef(index, 'class', d.subclass_of.key, d.subclass_of.name)]
  } else if (e.category === 'species' && d.subspecies_of) {
    const parent = index?.rows.find((r) => r[0] === `species:${d.subspecies_of}`)
    data.subspecies_of = [parent ? { name: parent[2], libKey: parent[0] } : { name: String(d.subspecies_of) }]
  } else if (e.category === 'feat') {
    if (d.prerequisite) data.prerequisite = String(d.prerequisite)
    if (d.type) data.kind = upperFirst(String(d.type).toLowerCase())
  }
  return { type, props: { library: e.key, data }, content: textDoc(t.sections, e) }
}
