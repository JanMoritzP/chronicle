import { abilityMod, type Sheet } from './sheet'

// Levelling a 5e character up, the weight a character carries and the features a class page lists for a level.
// Pure functions: they return the changes as a sheet patch (field path to value), never touch the sheet.

/** Hit die of the classes in the basic rules. A class that is not here asks for its die. */
export const HIT_DIE: Record<string, number> = {
  barbarian: 12, fighter: 10, paladin: 10, ranger: 10, bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8, sorcerer: 6, wizard: 6, artificer: 8,
}
export const hitDieOf = (name: string): number | null => HIT_DIE[name.trim().toLowerCase()] ?? null

type Caster = 'full' | 'half' | 'third' | 'pact' | null
const CASTER: Record<string, Caster> = {
  bard: 'full', cleric: 'full', druid: 'full', sorcerer: 'full', wizard: 'full', paladin: 'half', ranger: 'half', artificer: 'half', warlock: 'pact',
}
export const casterOf = (name: string, subclass = ''): Caster => {
  const n = name.trim().toLowerCase(), s = subclass.trim().toLowerCase()
  if (n === 'fighter' && s.includes('eldritch knight')) return 'third'
  if (n === 'rogue' && s.includes('arcane trickster')) return 'third'
  return CASTER[n] ?? null
}

/** Spell slots of a full caster by caster level (1 to 20): slots of level 1 to 9. */
const FULL: number[][] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
]

/** The slots a set of classes gives. One casting class uses its own table, several add up as the multiclass rules say. Null when nothing casts with slots. */
export function slotsFor(classes: { name: string; level: number; subclass?: string }[]): number[] | null {
  const casting = classes.map((c) => ({ ...c, kind: casterOf(c.name, c.subclass) })).filter((c) => c.kind && c.kind !== 'pact' && c.level > 0)
  if (!casting.length) return null
  let level = 0
  if (casting.length === 1) {
    const c = casting[0]
    // a half caster starts at level 2 and a third caster at level 3; each counts as a caster of half or a third of its level, rounded up
    level = c.kind === 'full' ? c.level : c.kind === 'half' ? (c.level >= 2 ? Math.ceil(c.level / 2) : 0) : c.level >= 3 ? Math.ceil(c.level / 3) : 0
  } else {
    for (const c of casting) level += c.kind === 'full' ? c.level : c.kind === 'half' ? Math.floor(c.level / 2) : Math.floor(c.level / 3)
  }
  return level > 0 ? FULL[Math.min(20, level) - 1] : null
}

export const totalLevel = (classes: { level: number }[] | undefined) => (classes ?? []).reduce((n, c) => n + c.level, 0)
export const ASI_LEVELS = [4, 8, 12, 16, 19]

export interface LevelUp { patch: Record<string, unknown>; lines: string[]; newLevel: number }

/**
 * One more level in a class (a new class when the character has none of that name yet). Hit points go up by the average of the hit die
 * (or the rolled number) plus the Constitution modifier, at least 1; a hit die is added, spell slots are recalculated and kept spent counts stay.
 */
export function levelUp(sheet: Sheet, className: string, opts: { hit?: number; die?: number } = {}): LevelUp | { error: string } {
  const name = className.trim()
  if (!name) return { error: 'Choose a class first.' }
  const classes = (sheet.classes ?? []).map((c) => ({ ...c }))
  if (totalLevel(classes) >= 20) return { error: 'A character cannot go past level 20.' }
  const at = classes.findIndex((c) => c.name.trim().toLowerCase() === name.toLowerCase())
  const die = opts.die ?? hitDieOf(name)
  if (!die) return { error: `The hit die of ${name} is not known. Enter it.` }
  if (at >= 0) classes[at].level += 1; else classes.push({ name, level: 1 })
  const newLevel = totalLevel(classes)
  const con = abilityMod(sheet.abilities.con)
  const roll = opts.hit ?? Math.floor(die / 2) + 1
  const gain = Math.max(1, roll + con)
  const patch: Record<string, unknown> = {
    classes,
    'hp.max': sheet.hp.max + gain,
    'hp.current': (sheet.hp.current ?? sheet.hp.max) + gain,
  }
  const dice = (sheet.hitDice ?? []).map((d) => ({ ...d }))
  const d = dice.find((x) => x.sides === die)
  if (d) d.total += 1; else dice.push({ sides: die, total: 1, used: 0 })
  patch.hitDice = dice
  const lines = [`Level ${newLevel}: ${name} ${at >= 0 ? classes[at].level : 1}`, `${gain} more hit points (${opts.hit != null ? `rolled ${opts.hit}` : `average ${roll}`}${con ? `, ${con > 0 ? '+' : ''}${con} Constitution` : ''})`, `One more d${die} hit die`]
  const prof = (l: number) => 2 + Math.floor((l - 1) / 4)
  if (prof(newLevel) !== prof(newLevel - 1)) lines.push(`Proficiency bonus is now +${prof(newLevel)}`)
  if (ASI_LEVELS.includes(classes[at >= 0 ? at : classes.length - 1].level)) lines.push('An ability score improvement or a feat')
  const slots = slotsFor(classes)
  if (slots) {
    const old = sheet.spellcasting?.slots ?? []
    patch['spellcasting.slots'] = slots.map((total, i) => ({ total, used: Math.min(old[i]?.used ?? 0, total) }))
    if (JSON.stringify(slots) !== JSON.stringify(old.map((s) => s.total))) lines.push(`Spell slots: ${slots.join(' / ')}`)
  } else if (classes.some((c) => casterOf(c.name, c.subclass) === 'pact')) lines.push('Pact magic slots are set by hand')
  return { patch, lines, newLevel }
}

// ---------- carrying ----------

export interface Carried { name: string; qty: number; equipped: boolean; weight?: number; attuned?: boolean }

/** Pounds carried: each item's weight times how many. */
export const carriedWeight = (items: Carried[] | undefined) => Math.round((items ?? []).reduce((n, i) => n + (i.weight ?? 0) * i.qty, 0) * 100) / 100
/** What a character can carry: 15 pounds for each point of Strength. */
export const capacityOf = (str: number) => str * 15
export const attunedCount = (items: Carried[] | undefined) => (items ?? []).filter((i) => i.attuned).length
export const MAX_ATTUNED = 3

/** How loaded the character is by the variant rules: light, encumbered (over 5 x Strength), heavily (over 10 x Strength) or beyond what they can carry. */
export function loadOf(weight: number, str: number): 'light' | 'encumbered' | 'heavily encumbered' | 'over capacity' {
  if (weight > capacityOf(str)) return 'over capacity'
  if (weight > str * 10) return 'heavily encumbered'
  if (weight > str * 5) return 'encumbered'
  return 'light'
}

// ---------- class pages ----------

const textOf = (n: any): string => (typeof n?.text === 'string' ? n.text : Array.isArray(n?.content) ? n.content.map(textOf).join('') : '')

/**
 * The features a class page lists for a level. An imported class has one heading per feature, "Second Wind (level 1)" or "Extra Attack (level 5, 11)",
 * followed by its text. Returns the feature names with their text.
 */
export function classFeaturesAt(doc: any, level: number): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = []
  let cur: { name: string; text: string; levels: number[] } | null = null
  const flush = () => { if (cur && cur.levels.includes(level)) out.push({ name: cur.name, text: cur.text.trim() }); cur = null }
  for (const n of doc?.content ?? []) {
    if (n.type === 'heading') {
      flush()
      const m = /^(.*?)\s*\(levels?\s+([\d,\s]+)\)\s*$/i.exec(textOf(n).trim())
      if (m) cur = { name: m[1].trim(), text: '', levels: m[2].split(',').map((x: string) => Number(x.trim())).filter(Boolean) }
    } else if (cur) cur.text += `${textOf(n)}\n`
  }
  flush()
  return out
}
