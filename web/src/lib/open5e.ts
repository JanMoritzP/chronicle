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

/** Everything except creatures: a subtitle, a few labelled facts and titled text sections. */
export function entryText(e: LibraryEntry): EntryText {
  const d = e.data
  const facts: [string, string][] = []
  const sections: { heading: string; text: string }[] = []
  const fact = (label: string, v: unknown) => { const s = String(v ?? '').trim(); if (s) facts.push([label, s]) }
  const section = (heading: string, text: unknown) => { const s = clean(text); if (s) sections.push({ heading, text: s }) }
  let subtitle = ''

  switch (e.category) {
    case 'spell': {
      subtitle = `${d.level === 0 ? 'Cantrip' : `Level ${d.level}`} ${d.school?.name ?? ''}`.trim() + (d.ritual ? ' (ritual)' : '')
      fact('Casting time', CASTING[d.casting_time] ?? d.casting_time)
      fact('Range', d.range_text)
      fact('Components', [d.verbal && 'V', d.somatic && 'S', d.material && `M${d.material_specified ? ` (${d.material_specified})` : ''}`].filter(Boolean).join(', '))
      fact('Duration', `${d.concentration ? 'Concentration, ' : ''}${d.duration ?? ''}`.replace(/, $/, ''))
      fact('Classes', (d.classes ?? []).map((c: any) => c.name ?? c).join(', '))
      section('', d.desc)
      section('At higher levels', d.higher_level)
      break
    }
    case 'magicitem': {
      subtitle = [d.category?.name, d.rarity?.name?.toLowerCase()].filter(Boolean).join(', ') + (d.requires_attunement ? ` (requires attunement${d.attunement_detail ? ` ${d.attunement_detail}` : ''})` : '')
      if (d.armor?.ac_display) fact('Armor Class', d.armor.ac_display)
      if (d.weapon?.damage_dice) fact('Damage', `${d.weapon.damage_dice} ${String(d.weapon.damage_type?.name ?? '').toLowerCase()}`.trim())
      section('', d.desc)
      break
    }
    case 'item': {
      subtitle = d.category?.name ?? ''
      fact('Cost', costText(d.cost))
      fact('Weight', Number(d.weight) > 0 ? `${Number(d.weight)} ${d.weight_unit ?? 'lb'}` : '')
      if (d.weapon) {
        fact('Damage', `${d.weapon.damage_dice ?? ''} ${String(d.weapon.damage_type?.name ?? '').toLowerCase()}`.trim())
        fact('Properties', (d.weapon.properties ?? []).map((p: any) => p.property?.name + (p.detail ? ` (${p.detail})` : '')).join(', '))
      }
      if (d.armor) {
        fact('Armor Class', d.armor.ac_display)
        fact('Strength', d.armor.strength_score_required)
        fact('Stealth', d.armor.grants_stealth_disadvantage ? 'Disadvantage' : '')
      }
      section('', d.desc)
      break
    }
    case 'class': {
      subtitle = d.subclass_of?.name ? `Subclass of ${d.subclass_of.name}` : 'Class'
      fact('Hit die', d.hit_dice)
      fact('Saving throws', (d.saving_throws ?? []).map((s: any) => s.name).join(', '))
      fact('Primary ability', (d.primary_abilities ?? []).map((s: any) => s.name ?? s).join(', '))
      section('', d.desc)
      for (const f of d.features ?? []) {
        if (f.feature_type && f.feature_type !== 'CLASS_LEVEL_FEATURE') continue
        const lv = [...new Set((f.gained_at ?? []).map((g: any) => g.level))].sort((a: any, b: any) => a - b)
        section(`${f.name}${lv.length ? ` (level ${lv.join(', ')})` : ''}`, f.desc)
      }
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
      section('', (d.descriptions ?? []).map((x: any) => clean(x.desc)).filter(Boolean).join('\n\n'))
      break
    }
    default:
      break
  }
  return { subtitle, facts, sections }
}

/** Page body for an imported entry, as an editor document. */
export function entryDoc(e: LibraryEntry): any {
  const t = entryText(e)
  const text = (s: string, marks?: any[]) => ({ type: 'text', text: s, ...(marks ? { marks } : {}) })
  const para = (s: string) => ({ type: 'paragraph', content: s ? [text(s)] : undefined })
  const content: any[] = []
  if (t.subtitle) content.push({ type: 'paragraph', content: [text(t.subtitle, [{ type: 'italic' }])] })
  for (const [label, value] of t.facts) content.push({ type: 'paragraph', content: [text(`${label}: `, [{ type: 'bold' }]), text(value)] })
  for (const s of t.sections) {
    if (s.heading) content.push({ type: 'heading', attrs: { level: 2 }, content: [text(s.heading)] })
    const lines = s.text.split('\n')
    let i = 0
    while (i < lines.length) {
      if (lines[i].startsWith('* ')) {
        const items: any[] = []
        while (i < lines.length && lines[i].startsWith('* ')) items.push({ type: 'listItem', content: [para(lines[i++].slice(2).replace(/\*\*/g, ''))] })
        content.push({ type: 'bulletList', content: items })
      } else {
        if (lines[i].trim()) content.push(para(lines[i].replace(/\*\*|__/g, '')))
        i++
      }
    }
  }
  content.push(para(`Source: ${e.sourceName}${e.license ? `. ${e.license}.` : ''}`))
  return { type: 'doc', content }
}
