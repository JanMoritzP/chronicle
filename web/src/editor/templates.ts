import { parse as parseYaml, stringify as toYaml } from 'yaml'
import type { StatTemplateRow } from '../types'

// Stat templates are plain data: the built-in ones below, plus any the user designs per world.
export type FieldType = 'text' | 'number' | 'checkbox' | 'select' | 'long'
export interface Field {
  key: string
  label: string
  type?: FieldType
  /** choices for type "select" */
  options?: string[]
  placeholder?: string
  /** number fields: also show the D&D ability modifier, e.g. 16 (+3) */
  mod?: boolean
}
export type Section =
  | { kind: 'title'; key: string; placeholder?: string }
  | { kind: 'subtitle'; key: string; placeholder?: string }
  | { kind: 'rule' }
  | { kind: 'heading'; text: string }
  | { kind: 'rows'; fields: Field[]; columns?: 1 | 2 }
  | { kind: 'abilities'; layout: 'row' | 'table'; saves?: boolean }
  | { kind: 'group'; fields: Field[] }
  | { kind: 'long'; key: string; heading?: string; placeholder?: string }
  | { kind: 'list'; key: string; heading?: string; placeholder?: string }

/** How a form is drawn: classic is the printed monster stat block, card follows the app theme, plain has no frame. */
export interface Look {
  style: 'classic' | 'card' | 'plain'
  /** CSS colour for names, labels and rules; empty uses the style's own */
  accent: string
  font: 'serif' | 'sans' | 'page'
  /** px, for the stat block when it has room (page layouts may make it fill their column) */
  width: number
  columns: 1 | 2
}
export const DEFAULT_LOOK: Look = { style: 'card', accent: '', font: 'page', width: 520, columns: 1 }
export const CLASSIC_LOOK: Look = { style: 'classic', accent: '', font: 'serif', width: 440, columns: 1 }

export interface StatTemplate { id: string; name: string; sections: Section[]; look: Look; builtin?: boolean }

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
const abilitySection: Section = { kind: 'abilities', layout: 'row' }

export const TEMPLATES: StatTemplate[] = [
  {
    id: '5e-monster',
    name: '5e Monster / NPC',
    builtin: true,
    look: CLASSIC_LOOK,
    sections: [
      { kind: 'title', key: 'name', placeholder: 'Creature name' },
      { kind: 'subtitle', key: 'type', placeholder: 'Medium humanoid, neutral' },
      { kind: 'rule' },
      { kind: 'rows', fields: [{ key: 'ac', label: 'Armor Class', placeholder: '15 (natural armor)' }, { key: 'hp', label: 'Hit Points', placeholder: '45 (6d8 + 18)' }, { key: 'speed', label: 'Speed', placeholder: '30 ft., fly 60 ft.' }] },
      { kind: 'rule' },
      abilitySection,
      { kind: 'rule' },
      {
        kind: 'rows',
        fields: [
          { key: 'saves', label: 'Saving Throws' }, { key: 'skills', label: 'Skills' },
          { key: 'vuln', label: 'Damage Vulnerabilities' }, { key: 'resist', label: 'Damage Resistances' }, { key: 'immune', label: 'Damage Immunities' },
          { key: 'condImmune', label: 'Condition Immunities' }, { key: 'senses', label: 'Senses' },
          { key: 'languages', label: 'Languages' },
        ],
      },
      { kind: 'rows', columns: 2, fields: [{ key: 'cr', label: 'Challenge', placeholder: '3 (700 XP)' }, { key: 'prof', label: 'Proficiency Bonus', placeholder: '+2' }] },
      { kind: 'rule' },
      { kind: 'long', key: 'traits', placeholder: '***Pack Tactics.*** The wolf has advantage on attack rolls…' },
      { kind: 'long', key: 'actions', heading: 'Actions', placeholder: '***Bite.*** *Melee Weapon Attack:* +4 to hit, reach 5 ft., one target. *Hit:* 7 (2d4 + 2) piercing damage.' },
      { kind: 'long', key: 'bonus', heading: 'Bonus Actions' },
      { kind: 'long', key: 'reactions', heading: 'Reactions' },
      { kind: 'long', key: 'legendary', heading: 'Legendary Actions' },
    ],
  },
  {
    id: '5e-monster-2024',
    name: '5e Monster (2024 layout)',
    builtin: true,
    look: { ...CLASSIC_LOOK, width: 480 },
    sections: [
      { kind: 'title', key: 'name', placeholder: 'Creature name' },
      { kind: 'subtitle', key: 'type', placeholder: 'Medium Humanoid, Neutral' },
      { kind: 'rule' },
      { kind: 'rows', columns: 2, fields: [{ key: 'ac', label: 'AC', placeholder: '15' }, { key: 'init', label: 'Initiative', placeholder: '+2 (12)' }] },
      { kind: 'rows', fields: [{ key: 'hp', label: 'HP', placeholder: '45 (6d8 + 18)' }, { key: 'speed', label: 'Speed', placeholder: '30 ft.' }] },
      { kind: 'rule' },
      { kind: 'abilities', layout: 'table', saves: true },
      { kind: 'rule' },
      {
        kind: 'rows',
        fields: [
          { key: 'skills', label: 'Skills' }, { key: 'vuln', label: 'Vulnerabilities' }, { key: 'resist', label: 'Resistances' }, { key: 'immune', label: 'Immunities' },
          { key: 'senses', label: 'Senses' }, { key: 'languages', label: 'Languages' }, { key: 'cr', label: 'CR', placeholder: '3 (XP 700; PB +2)' },
        ],
      },
      { kind: 'long', key: 'traits', heading: 'Traits' },
      { kind: 'long', key: 'actions', heading: 'Actions' },
      { kind: 'long', key: 'bonus', heading: 'Bonus Actions' },
      { kind: 'long', key: 'reactions', heading: 'Reactions' },
      { kind: 'long', key: 'legendary', heading: 'Legendary Actions' },
    ],
  },
  {
    id: '5e-character',
    name: '5e Player Character',
    builtin: true,
    look: CLASSIC_LOOK,
    sections: [
      { kind: 'title', key: 'name', placeholder: 'Character name' },
      { kind: 'subtitle', key: 'class', placeholder: 'Level 5 Half-Elf Rogue' },
      { kind: 'rule' },
      {
        kind: 'rows',
        fields: [
          { key: 'player', label: 'Player' }, { key: 'background', label: 'Background' }, { key: 'alignment', label: 'Alignment' },
          { key: 'ac', label: 'Armor Class' }, { key: 'hp', label: 'Hit Points' }, { key: 'speed', label: 'Speed' }, { key: 'prof', label: 'Proficiency' },
        ],
      },
      { kind: 'rule' },
      abilitySection,
      { kind: 'rule' },
      { kind: 'rows', fields: [{ key: 'saves', label: 'Saving Throws' }, { key: 'skills', label: 'Skills' }, { key: 'languages', label: 'Languages' }, { key: 'tools', label: 'Tools' }] },
      { kind: 'rule' },
      { kind: 'long', key: 'features', heading: 'Features', placeholder: 'Class & racial features…' },
      { kind: 'long', key: 'attacks', heading: 'Attacks & Spells' },
      { kind: 'long', key: 'gear', heading: 'Equipment' },
    ],
  },
  {
    id: 'blank',
    name: 'Blank (name + notes)',
    builtin: true,
    look: DEFAULT_LOOK,
    sections: [
      { kind: 'title', key: 'name', placeholder: 'Name' },
      { kind: 'subtitle', key: 'sub', placeholder: 'Subtitle' },
      { kind: 'rule' },
      { kind: 'long', key: 'body', placeholder: 'Free-form stats…' },
    ],
  },
]

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id)

const FIELD_TYPES: FieldType[] = ['text', 'number', 'checkbox', 'select', 'long']
const str = (v: any) => (v == null ? '' : String(v))
const opt = (v: any) => (v == null || v === '' ? undefined : String(v))

function field(raw: any, where: string): Field {
  if (typeof raw === 'string') return { key: raw.toLowerCase().replace(/\W+/g, '_') || 'field', label: raw }
  if (!raw || typeof raw !== 'object') throw new Error(`${where}: each field needs a key and a label`)
  if (!raw.key && !raw.label) throw new Error(`${where}: field has neither key nor label`)
  const label = str(raw.label ?? raw.key)
  const f: Field = { key: str(raw.key ?? label.toLowerCase().replace(/\W+/g, '_')), label }
  if (FIELD_TYPES.includes(raw.type) && raw.type !== 'text') f.type = raw.type
  if (f.type === 'select') f.options = Array.isArray(raw.options) ? raw.options.map(str).filter(Boolean) : str(raw.options).split(',').map((s) => s.trim()).filter(Boolean)
  if (opt(raw.placeholder)) f.placeholder = str(raw.placeholder)
  if (raw.mod) f.mod = true
  return f
}

const STYLES: Look['style'][] = ['classic', 'card', 'plain']
const FONTS: Look['font'][] = ['serif', 'sans', 'page']

/** Anything that is not a plain CSS colour is dropped, so a stored look can never inject styles. */
const colour = (v: any) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(v.trim()) ? v.trim() : '')

export function normalizeLook(raw: any): Look {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    style: STYLES.includes(r.style) ? r.style : DEFAULT_LOOK.style,
    accent: colour(r.accent),
    font: FONTS.includes(r.font) ? r.font : DEFAULT_LOOK.font,
    width: Math.min(760, Math.max(260, Math.round(Number(r.width)) || DEFAULT_LOOK.width)),
    columns: Number(r.columns) === 2 ? 2 : 1,
  }
}

/** Turns loosely typed JSON/YAML into well-formed sections; throws a readable Error when a section is unusable. */
export function normalizeSections(raw: any): Section[] {
  if (!Array.isArray(raw)) throw new Error('"sections" must be a list.')
  return raw.map((s: any, i: number): Section => {
    const where = `Section ${i + 1}`
    if (typeof s === 'string') s = { kind: s }
    if (!s || typeof s !== 'object') throw new Error(`${where} must be an object with a "kind".`)
    const key = () => { if (!s.key) throw new Error(`${where} (${s.kind}) needs a key`); return str(s.key) }
    switch (s.kind) {
      case 'rule': return { kind: 'rule' }
      case 'heading': return { kind: 'heading', text: str(s.text ?? s.heading) }
      case 'title': case 'subtitle': return { kind: s.kind, key: key(), placeholder: opt(s.placeholder) }
      case 'long': case 'list': return { kind: s.kind, key: key(), heading: opt(s.heading), placeholder: opt(s.placeholder) }
      case 'rows': case 'group': {
        if (!Array.isArray(s.fields)) throw new Error(`${where} (${s.kind}) needs a fields: list`)
        const fields = s.fields.map((f: any, j: number) => field(f, `${where}, field ${j + 1}`))
        return s.kind === 'rows' && Number(s.columns) === 2 ? { kind: 'rows', fields, columns: 2 } : { kind: s.kind, fields }
      }
      case 'abilities': {
        const layout = s.layout === 'table' ? 'table' : 'row'
        return layout === 'table' && s.saves ? { kind: 'abilities', layout, saves: true } : { kind: 'abilities', layout }
      }
      default: throw new Error(`${where}: unknown kind "${s.kind}" (title, subtitle, rule, heading, rows, group, abilities, long, list)`)
    }
  })
}

/** Template source may be JSON or YAML: a list of sections, or an object with "sections" and an optional "look". */
export function parseTemplateSource(source: string): { sections: Section[]; look: Look } {
  const text = source.trim()
  if (!text) throw new Error('The template is empty.')
  let data: any
  try { data = text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : parseYaml(text) } catch (e: any) {
    throw new Error(`Could not read the template: ${String(e.message ?? e).split('\n')[0]}`)
  }
  return { sections: normalizeSections(Array.isArray(data) ? data : data?.sections), look: normalizeLook(Array.isArray(data) ? null : data?.look) }
}

export const sectionsToSource = (sections: Section[], look: Look) => toYaml({ look: { ...look, accent: look.accent || undefined }, sections }, { indent: 2 })

export function resolveTemplates(custom: StatTemplateRow[] | undefined): StatTemplate[] {
  const out = [...TEMPLATES]
  for (const t of custom ?? []) {
    let sections: Section[]
    try { sections = normalizeSections(t.sections) } catch { sections = [] }
    out.push({ id: t.id, name: t.name, sections, look: normalizeLook(t.look) })
  }
  return out
}

/** By id, falling back to the template's name so hand-written page layouts can say `template: Dragon`. */
export function findTemplate(list: StatTemplate[], idOrName: string | undefined | null): StatTemplate | undefined {
  if (!idOrName) return undefined
  return list.find((t) => t.id === idOrName) ?? list.find((t) => t.name.toLowerCase() === idOrName.toLowerCase())
}
