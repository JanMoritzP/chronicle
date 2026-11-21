import { abilityMod, ABILITIES, characterLevel, proficiency, type Sheet } from './sheet'

// A macro is a few lines of chat. Before it is sent, two things are filled in:
//   ?{Question|default}            asks the person (with "Choice|a|b|c" the answer is one of the options)
//   @{selected|name}               what the selected token is: name, hp, maxhp, ac, level, prof, str_mod ... cha_mod, str ... cha
// Every non-empty line is then sent as its own chat message, so a macro can hold /roll lines and plain talk together.

export interface Query { raw: string; prompt: string; options: string[] }

const QUERY = /\?\{([^{}|]{1,80})((?:\|[^{}|]{0,80}){0,12})\}/g
const REF = /@\{selected\|([a-z_]{1,20})\}/gi

/** The questions a macro asks, in order, each once. */
export function queriesIn(text: string): Query[] {
  const seen = new Set<string>()
  const out: Query[] = []
  for (const m of text.matchAll(QUERY)) {
    if (seen.has(m[0])) continue
    seen.add(m[0])
    out.push({ raw: m[0], prompt: m[1].trim(), options: m[2] ? m[2].slice(1).split('|') : [] })
  }
  return out
}

/** The text with each question replaced by its answer. A question that has no answer is left blank. */
export function fillQueries(text: string, answers: Record<string, string>): string {
  return text.replace(QUERY, (raw) => answers[raw] ?? '')
}

export interface Selected { name: string; hp?: number; maxhp?: number; ac?: number; sheet?: Sheet | null }

/** What `@{selected|key}` stands for, or null when there is no such thing. */
export function refValue(key: string, sel: Selected): string | null {
  const k = key.toLowerCase()
  if (k === 'name') return sel.name
  if (k === 'hp') return sel.hp != null ? String(sel.hp) : null
  if (k === 'maxhp') return sel.maxhp != null ? String(sel.maxhp) : null
  if (k === 'ac') return sel.ac != null ? String(sel.ac) : null
  const s = sel.sheet
  if (!s) return null
  if (k === 'level') return String(characterLevel(s))
  if (k === 'prof') return String(proficiency(s))
  const mod = /^([a-z]{3})_mod$/.exec(k)
  const a = (mod ? mod[1] : k) as (typeof ABILITIES)[number]
  if (!ABILITIES.includes(a)) return null
  return mod ? String(abilityMod(s.abilities[a])) : String(s.abilities[a])
}

/** Replaces the references to the selected token. Returns the text and the references that could not be filled. */
export function resolveRefs(text: string, sel: Selected | null): { text: string; missing: string[] } {
  const missing: string[] = []
  const out = text.replace(REF, (raw, key: string) => {
    const v = sel ? refValue(key, sel) : null
    if (v == null) { missing.push(raw); return raw }
    return v
  })
  return { text: out, missing }
}

/** The lines to send: one chat message each, empty lines left out, and no more than a handful so a macro cannot flood the table. */
export const linesOf = (text: string, max = 10): string[] => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, max)
