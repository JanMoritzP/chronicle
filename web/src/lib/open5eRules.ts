import type { BackgroundRules, ClassRules, SpeciesRules } from './homebrew'
import { SKILLS, type Ability } from './sheet'

// Open5e's classes, species and backgrounds as rules for the character builder. The words of the books are the source: a class's
// table of core traits (2024) or its proficiencies (2014), the traits of a species and the benefits of a background. Open5e's
// structured fields are only a fallback, because they are sometimes wrong (the 2024 fighter's saving throws read Dexterity and
// Strength there, Strength and Constitution in its own table). Pure functions, so `scripts/test-open5erules.ts` checks them.

const ABILITY_OF: Record<string, Ability> = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' }
const NUMBER: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }
const plain = (s: unknown) => String(s ?? '').replace(/\*\*?|__|_(?=\w)|(?<=\w)_/g, '').replace(/\r\n?/g, '\n').trim()

/** Ability names in text, in the order they appear, each once. */
export function abilitiesIn(text: unknown): Ability[] {
  const out: Ability[] = []
  for (const m of String(text ?? '').toLowerCase().matchAll(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\b/g)) {
    const a = ABILITY_OF[m[1]]
    if (!out.includes(a)) out.push(a)
  }
  return out
}

/** Skill names in text, in the order they appear, each once. */
export function skillsIn(text: unknown): string[] {
  const t = String(text ?? '').toLowerCase()
  return Object.keys(SKILLS).map((k) => [k, t.indexOf(k)] as const).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([k]) => k)
}

/** The first paragraph of a description, without Markdown, cut at a sentence near `max` characters. */
export function firstParagraph(text: unknown, max = 320): string {
  const p = plain(text).split(/\n\s*\n/).find((x) => x.trim() && !x.trim().startsWith('|')) ?? ''
  const one = p.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  const cut = one.slice(0, max)
  const end = cut.lastIndexOf('. ')
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`
}

/** "Label: value" facts of a class: the rows of its core traits table and the bold labels of its proficiencies. */
export function classFacts(d: any): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of Array.isArray(d?.features) ? d.features : []) {
    if (f?.feature_type !== 'CORE_TRAITS_TABLE' && f?.feature_type !== 'PROFICIENCIES') continue
    for (const line of String(f.desc ?? '').split(/\r?\n/)) {
      const row = /^\s*\|([^|]+)\|([^|]+)\|\s*$/.exec(line)
      const bold = /^\s*\*\*([^*]+?):?\*\*:?\s*(.+)$/.exec(line)
      const m = row ?? bold
      if (!m || /^-+$/.test(m[1].trim())) continue
      const k = plain(m[1]).replace(/:$/, '').toLowerCase()
      if (k && !out[k]) out[k] = plain(m[2])
    }
  }
  return out
}

/** How many skills a class chooses and from which: "Choose 2: Acrobatics, …" or "Choose two from …", or any. */
export function classSkills(text: string): ClassRules['skills'] {
  const m = /choose\s+(\d+|one|two|three|four|five|six)/i.exec(text)
  const count = m ? (NUMBER[m[1].toLowerCase()] ?? Number(m[1])) : 2
  const from = skillsIn(text)
  return { count, from: from.length && !/\bany\b/i.test(text.replace(/any of the following/i, '')) ? from : 'any' }
}

/** Open5e's caster types; 2014 classes have none, and one that casts counts as a full caster then. */
const CASTER_TYPE: Record<string, ClassRules['caster']> = { FULL: 'full', HALF: 'half', THIRD: 'third', PACT: 'pact', NONE: '' }

/** The level of the feature that gives the subclass ("Fighter Subclass", "Martial Archetype"), 3 when there is none. */
export function subclassLevelOf(d: any): number {
  const f = (Array.isArray(d?.features) ? d.features : []).find((x: any) => x?.feature_type === 'CLASS_LEVEL_FEATURE' && /subclass|archetype/i.test(String(x.name)) && x.gained_at?.length)
  const levels = (f?.gained_at ?? []).map((g: any) => Number(g?.level)).filter((n: number) => n >= 1 && n <= 20)
  return levels.length ? Math.min(...levels) : 3
}

const isLevel1Feature = (f: any) => f?.feature_type === 'CLASS_LEVEL_FEATURE' && (f.gained_at ?? []).some((g: any) => g?.level === 1)

/** The gear of the first choice: option (A) of a 2024 class, the (a) of each line of a 2014 class. Gold is left out. */
export function startingKit(text: string): ClassRules['kit'] {
  const t = plain(text)
  let parts: string[] = []
  const a = /\(A\)\s*([^;]+?)(?:;|\s+or\s+\(B\)|$)/.exec(t)
  if (a) parts = a[1].split(/,\s*(?:and\s+)?|\s+and\s+/)
  else {
    // the bullets are read before the Markdown, which shares their asterisk
    const lines = String(text ?? '').split(/\r?\n/).map((l) => /^\s*[-*]\s+(.+)$/.exec(l)?.[1]).filter((l): l is string => !!l).map(plain)
    // lines of (a) or (b) choices each give their first; lines without them are whole packages, and the first package is taken
    const choices = lines.some((l) => /\(\s*a\s*\)/i.test(l))
    for (const line of choices ? lines : lines.slice(0, 1)) {
      const first = line.replace(/^[^:()]{0,60}(?:\([^)]*\))?:\s*/, '').replace(/\(\s*a\s*\)\s*/i, '').split(/,?\s*(?:or\s+)?\(\s*b\s*\)/i)[0]
      parts.push(...first.split(/,\s*(?:and\s+)?|\s+and\s+/))
    }
  }
  const out: ClassRules['kit'] = []
  for (const raw of parts) {
    let s = raw.trim().replace(/\.$/, '')
    if (!s || /\b\d+\s*gp\b/i.test(s) || /^(?:you start|you begin)/i.test(s)) continue
    let qty = 1
    const n = /^(\d+|two|three|four|five|ten|twenty)\s+(.+)$/i.exec(s)
    if (n) { qty = NUMBER[n[1].toLowerCase()] ?? (n[1].toLowerCase() === 'ten' ? 10 : n[1].toLowerCase() === 'twenty' ? 20 : Number(n[1])); s = n[2] }
    s = s.replace(/^(?:an?|any)\s+/i, '')
    if (s.length > 60) continue
    out.push({ name: s.charAt(0).toUpperCase() + s.slice(1), ...(qty > 1 ? { qty } : {}) })
    if (out.length >= 10) break
  }
  return out
}

/** The armor of a class's training (the heaviest it may wear), or its own Unarmored Defense. */
export function classArmor(armorText: string, features: { name: string; desc: string }[]): ClassRules['armor'] {
  const unarmored = features.find((f) => /unarmored defense/i.test(f.name))
  if (unarmored) {
    const plus = abilitiesIn(unarmored.desc).find((a) => a !== 'dex')
    return { base: 10, dex: 'full', plus: plus ?? '', shield: false, note: 'Unarmored Defense' }
  }
  const t = armorText.toLowerCase()
  const shield = /shield/.test(t)
  if (/heavy|all armor/.test(t)) return { base: 16, dex: 'none', shield, note: `chain mail${shield ? ' and shield' : ''}` }
  if (/medium/.test(t)) return { base: 14, dex: 'max2', shield, note: `scale mail${shield ? ' and shield' : ''}` }
  if (/light/.test(t)) return { base: 11, dex: 'full', shield, note: `leather armor${shield ? ' and shield' : ''}` }
  return { base: 10, dex: 'full', shield: false, note: 'no armor' }
}

/** A class of Open5e as builder rules. `fallbackPrimary` is used when the book does not say (the 2014 classes). */
export function classRulesFromOpen5e(d: any, fallbackPrimary: Ability[] = []): ClassRules {
  const facts = classFacts(d)
  const fact = (...keys: string[]) => keys.map((k) => facts[k]).find(Boolean) ?? ''
  const features = (Array.isArray(d?.features) ? d.features : []).filter(isLevel1Feature).map((f: any) => ({ name: plain(f.name), desc: String(f.desc ?? '') }))
  const casting = features.find((f: { name: string }) => /spellcasting|pact magic/i.test(f.name))
  const spell = casting ? (/(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+is\s+your\s+spellcasting\s+ability/i.exec(casting.desc)?.[1] ?? abilitiesIn(/spellcasting ability[^.]*\./i.exec(casting.desc)?.[0])[0] ?? '') : ''
  const spellAbility = spell ? (ABILITY_OF[String(spell).toLowerCase()] ?? (spell as Ability)) : ''
  let saves = abilitiesIn(fact('saving throw proficiencies', 'saving throws')).slice(0, 2)
  if (saves.length < 2) saves = abilitiesIn((d?.saving_throws ?? []).map((s: any) => s?.name).join(' ')).slice(0, 2)
  let primary = abilitiesIn(fact('primary ability')).slice(0, 2)
  if (!primary.length) primary = abilitiesIn((d?.primary_abilities ?? []).map((s: any) => s?.name ?? s).join(' ')).slice(0, 2)
  const armor = classArmor(fact('armor training', 'armor'), features)
  // the 2014 books do not name one: the spellcasting ability, else the first save in Strength or Dexterity (a rogue's Dexterity),
  // else Strength for a class in medium or heavy armor (a marshal) and Dexterity for one in light armor or none
  if (!primary.length) primary = fallbackPrimary.length ? fallbackPrimary : spellAbility ? [spellAbility] : [saves.find((a) => a === 'str' || a === 'dex') ?? (armor.base >= 14 ? 'str' : 'dex')]
  const equipment = fact('starting equipment') || (d?.features ?? []).find((f: any) => f?.feature_type === 'STARTING_EQUIPMENT')?.desc || ''
  const die = Number(/(\d+)/.exec(String(d?.hit_dice ?? fact('hit point die', 'hit dice')))?.[1]) || 8
  return {
    die: [6, 8, 10, 12].includes(die) ? die : 8,
    primary, saves,
    skills: classSkills(fact('skill proficiencies', 'skills')),
    spell: spellAbility,
    armor,
    kit: startingKit(equipment),
    features: features.map((f: { name: string; desc: string }) => ({ name: f.name, text: firstParagraph(f.desc) })),
    attacks: [],
    spells: casting ? 'Choose your cantrips and spells with the class’s list.' : '',
    caster: CASTER_TYPE[String(d?.caster_type ?? '').toUpperCase()] ?? (spellAbility ? 'full' : ''),
    subclassLevel: subclassLevelOf(d),
  }
}

const SIZES = ['Tiny', 'Small', 'Medium', 'Large']
/** Trait names that are numbers on the sheet rather than features. */
const NOT_A_TRAIT = /^(ability score increases?|age|alignment|size|speed|languages?|darkvision|creature type)$/i

/** A species of Open5e as builder rules. A subspecies is read together with its parent: the parent's traits first. */
export function speciesRulesFromOpen5e(d: any, parent?: any): SpeciesRules {
  const traits: { name: string; desc: string; type?: string | null }[] = [...(parent?.traits ?? []), ...(d?.traits ?? [])].map((t: any) => ({ name: plain(t?.name), desc: String(t?.desc ?? ''), type: t?.type }))
  const find = (re: RegExp, type?: string) => [...traits].reverse().find((t) => (type && t.type === type) || re.test(t.name))
  const speed = Number(/(\d+)\s*(?:feet|ft)/i.exec(find(/^speed$/i, 'SPEED')?.desc ?? '')?.[1]) || 30
  const sizeText = find(/^size$/i, 'SIZE')?.desc ?? ''
  const size = SIZES.find((s) => new RegExp(`your size is ${s}|^\\s*${s}\\b`, 'i').test(sizeText)) ?? SIZES.find((s) => new RegExp(`\\b${s}\\b`, 'i').test(sizeText)) ?? 'Medium'
  const darkvision = Math.max(0, ...traits.filter((t) => /darkvision|superior darkvision/i.test(t.name)).map((t) => Number(/(\d+)\s*feet/i.exec(t.desc)?.[1]) || 0))
  const asi: Partial<Record<Ability, number>> = {}
  let freeAsi = 0
  for (const t of traits.filter((x) => /ability score increase/i.test(x.name))) {
    for (const m of t.desc.matchAll(/(strength|dexterity|constitution|intelligence|wisdom|charisma) score increases? by (\d)/gi)) {
      const a = ABILITY_OF[m[1].toLowerCase()]
      asi[a] = (asi[a] ?? 0) + Number(m[2])
    }
    for (const m of t.desc.matchAll(/each increase by (\d)/gi)) for (const a of abilitiesIn(t.desc)) asi[a] = (asi[a] ?? 0) + Number(m[1])
    const free = /(one|two|three) (?:other )?ability scores? of your choice increases? by 1/i.exec(t.desc)
    if (free) freeAsi += NUMBER[free[1].toLowerCase()]
  }
  const languages = plain(/(?:speak, read, and write|you know)\s+([^.]+)\./i.exec(find(/^languages?$/i)?.desc ?? '')?.[1] ?? '')
  // "the Insight, Perception, or Survival skill" is a choice for the player, not three skills
  const skills = [...new Set(traits.filter((t) => /proficien/i.test(t.desc) && /skill/i.test(t.desc) && !/of your choice/i.test(t.desc))
    .flatMap((t) => { const found = skillsIn(t.desc); return found.length > 1 && /,?\s+or\s+/i.test(t.desc) ? [] : found }))]
  const hpPerLevel = traits.some((t) => /hit point maximum increases by 1/i.test(t.desc)) ? 1 : 0
  return {
    size, speed, darkvision, languages: languages || 'Common and one more',
    asi, freeAsi, hpPerLevel,
    traits: traits.filter((t) => !NOT_A_TRAIT.test(t.name) && t.type !== 'SIZE' && t.type !== 'SPEED').map((t) => ({ name: t.name, text: firstParagraph(t.desc) })),
    skills,
  }
}

/** A background of Open5e as builder rules: its two skills, its tools and languages, and (2024) the three scores and the feat. */
export function backgroundRulesFromOpen5e(d: any): BackgroundRules {
  const benefits: { type: string; desc: string }[] = (Array.isArray(d?.benefits) ? d.benefits : []).map((b: any) => ({ type: String(b?.type ?? ''), desc: plain(b?.desc) }))
  const of = (type: string) => benefits.find((b) => b.type === type)?.desc ?? ''
  const abilities = abilitiesIn(of('ability_score'))
  return {
    skills: skillsIn(of('skill_proficiency')).slice(0, 2),
    tools: [of('tool_proficiency'), of('language') && `Languages: ${of('language')}`].filter(Boolean).join('; ').slice(0, 200),
    abilities: abilities.length === 3 ? abilities : [],
    feat: of('feat').replace(/\s*\(.*\)\s*$/, '').slice(0, 120),
  }
}

/** Names the same as one of the builder's own ("Hill Dwarf" and "Hill dwarf", "Lightfoot" and "Lightfoot halfling"). */
export function sameAsBuiltin(name: string, builtins: string[]): boolean {
  const n = name.toLowerCase().replace(/[^a-z]/g, '')
  return !!n && builtins.some((b) => { const m = b.toLowerCase().replace(/[^a-z]/g, ''); return m === n || (n.length >= 5 && m.startsWith(n)) })
}

