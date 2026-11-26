import { abilityMod, ABILITIES, type Ability, type Sheet } from './sheet'

// Levelling a 5e character up, the weight a character carries and the features a class page lists for a level.
// Pure functions: they return the changes as a sheet patch (field path to value), never touch the sheet.
// The 2014 and 2024 rules differ in when subclasses come (2024: always level 3), when paladins and rangers start casting
// (2024: level 1) and how half casters add up when multiclassing (2024: rounded up), and 2024 gives an Epic Boon at 19.
// Classes the rules do not know (homebrew, Open5e) bring what is needed as `ClassInfo`.

export type Ruleset5e = '5e' | '5e-2024'
export type Caster = 'full' | 'half' | 'third' | 'pact' | null
/** What a class the tables here do not know brings along: its hit die, how it gets spell slots, the level of its subclass. */
export interface ClassInfo { die?: number; caster?: Caster; subclassLevel?: number }
/** Class infos by lower case class name. */
export type ClassInfos = Record<string, ClassInfo>
const key = (name: string) => name.trim().toLowerCase()
const rulesetOf = (r: string | undefined): Ruleset5e => (r === '5e-2024' ? '5e-2024' : '5e')

/** Hit die of the classes in the basic rules. A class that is not here asks for its die. */
export const HIT_DIE: Record<string, number> = {
  barbarian: 12, fighter: 10, paladin: 10, ranger: 10, bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8, sorcerer: 6, wizard: 6, artificer: 8,
}
export const hitDieOf = (name: string, info?: ClassInfo): number | null => HIT_DIE[key(name)] ?? info?.die ?? null

const CASTER: Record<string, Caster> = {
  bard: 'full', cleric: 'full', druid: 'full', sorcerer: 'full', wizard: 'full', paladin: 'half', ranger: 'half', artificer: 'half', warlock: 'pact',
}
export const casterOf = (name: string, subclass = '', info?: ClassInfo): Caster => {
  const n = key(name), s = subclass.trim().toLowerCase()
  if (n === 'fighter' && s.includes('eldritch knight')) return 'third'
  if (n === 'rogue' && s.includes('arcane trickster')) return 'third'
  return CASTER[n] ?? info?.caster ?? null
}

/** Spell slots of a full caster by caster level (1 to 20): slots of level 1 to 9. */
const FULL: number[][] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
]

type ClassLevel = { name: string; level: number; subclass?: string }

/**
 * The slots a set of classes gives. One casting class uses its own table, several add up as the multiclass rules say. Null when
 * nothing casts with slots. A half caster starts at level 2 in 2014 and at level 1 in 2024; a third caster at level 3.
 */
export function slotsFor(classes: ClassLevel[], ruleset: string = '5e', infos: ClassInfos = {}): number[] | null {
  const modern = rulesetOf(ruleset) === '5e-2024'
  const casting = classes.map((c) => ({ ...c, kind: casterOf(c.name, c.subclass, infos[key(c.name)]) })).filter((c) => c.kind && c.kind !== 'pact' && c.level > 0)
  if (!casting.length) return null
  let level = 0
  if (casting.length === 1) {
    const c = casting[0]
    // each counts as a caster of half or a third of its level, rounded up
    level = c.kind === 'full' ? c.level : c.kind === 'half' ? (c.level >= 2 || modern ? Math.ceil(c.level / 2) : 0) : c.level >= 3 ? Math.ceil(c.level / 3) : 0
  } else {
    // multiclassing: half casters round down in 2014 and up in 2024, third casters always round down
    for (const c of casting) level += c.kind === 'full' ? c.level : c.kind === 'half' ? (modern ? Math.ceil(c.level / 2) : Math.floor(c.level / 2)) : Math.floor(c.level / 3)
  }
  return level > 0 ? FULL[Math.min(20, level) - 1] : null
}

/** Warlock Pact Magic: how many slots and of what level, by warlock level. */
export function pactSlots(level: number): { count: number; slotLevel: number } | null {
  if (level < 1) return null
  const count = level >= 17 ? 4 : level >= 11 ? 3 : level >= 2 ? 2 : 1
  const slotLevel = level >= 9 ? 5 : level >= 7 ? 4 : level >= 5 ? 3 : level >= 3 ? 2 : 1
  return { count, slotLevel }
}

const pactLevel = (classes: ClassLevel[], infos: ClassInfos) => classes.filter((c) => casterOf(c.name, c.subclass, infos[key(c.name)]) === 'pact').reduce((n, c) => n + c.level, 0)

/** The slots of a character: the spellcasting classes' slots and, for a warlock, the Pact Magic slots added to the level they are. */
export function allSlots(classes: ClassLevel[], ruleset: string = '5e', infos: ClassInfos = {}): number[] | null {
  const base = slotsFor(classes, ruleset, infos)
  const pact = pactSlots(pactLevel(classes, infos))
  if (!pact) return base
  const out = [...(base ?? [])]
  while (out.length < pact.slotLevel) out.push(0)
  out[pact.slotLevel - 1] += pact.count
  return out
}

export const totalLevel = (classes: { level: number }[] | undefined) => (classes ?? []).reduce((n, c) => n + c.level, 0)
export const ASI_LEVELS = [4, 8, 12, 16, 19]

/** The class level at which a class chooses its subclass in the 2014 rules. In 2024 every class chooses at level 3. */
export const SUBCLASS_LEVEL: Record<string, number> = {
  barbarian: 3, bard: 3, cleric: 1, druid: 2, fighter: 3, monk: 3, paladin: 3, ranger: 3, rogue: 3, sorcerer: 1, warlock: 1, wizard: 2, artificer: 3,
}
/** Subclasses of the basic rules (SRD 5.1 and 5.2), offered as suggestions; any name can be typed. */
export const SUBCLASSES: Record<Ruleset5e, Record<string, string[]>> = {
  '5e': {
    barbarian: ['Path of the Berserker'], bard: ['College of Lore'], cleric: ['Life Domain'], druid: ['Circle of the Land'], fighter: ['Champion'],
    monk: ['Way of the Open Hand'], paladin: ['Oath of Devotion'], ranger: ['Hunter'], rogue: ['Thief'], sorcerer: ['Draconic Bloodline'], warlock: ['The Fiend'], wizard: ['School of Evocation'],
  },
  '5e-2024': {
    barbarian: ['Path of the Berserker'], bard: ['College of Lore'], cleric: ['Life Domain'], druid: ['Circle of the Land'], fighter: ['Champion'],
    monk: ['Warrior of the Open Hand'], paladin: ['Oath of Devotion'], ranger: ['Hunter'], rogue: ['Thief'], sorcerer: ['Draconic Sorcery'], warlock: ['Fiend Patron'], wizard: ['Evoker'],
  },
}
/** The class level at which a class chooses its subclass: 3 in 2024, the 2014 table, or what the class brings (3 when unknown). */
export function subclassLevel(className: string, ruleset: string = '5e', info?: ClassInfo): number {
  const n = key(className)
  if (n in SUBCLASS_LEVEL) return rulesetOf(ruleset) === '5e-2024' ? 3 : SUBCLASS_LEVEL[n]
  return info?.subclassLevel ?? 3
}
/**
 * True when levelling this class to `level` reaches or passes the level where its subclass is chosen and the character has none yet,
 * so a subclass skipped earlier is asked for again.
 */
export const needsSubclass = (className: string, level: number, current?: string, ruleset: string = '5e', info?: ClassInfo) =>
  !current?.trim() && level >= subclassLevel(className, ruleset, info)
/** True when this class level gives an ability score improvement or a feat (fighters and rogues get more). */
export function givesAsi(className: string, level: number): boolean {
  const n = key(className)
  if (ASI_LEVELS.includes(level)) return true
  if (n === 'fighter') return level === 6 || level === 14
  if (n === 'rogue') return level === 10
  return false
}
/** 2024: level 19 gives an Epic Boon (a feat of that kind, or another feat such as Ability Score Improvement). */
export const givesEpicBoon = (level: number, ruleset: string = '5e') => rulesetOf(ruleset) === '5e-2024' && level === 19

export interface Choices {
  /** the subclass chosen at this level */
  subclass?: string
  /** ability score points to spend, at most 2 in all and 2 on one score */
  asi?: Partial<Record<Ability, number>>
  /** or a feat instead */
  feat?: { name: string; text?: string }
}

// ---------- the class tables ----------

/** A column of a class table: its value at a class level, null where the class does not have it yet. */
export interface Column { name: string; at: (level: number) => string | null }
const by = (values: (string | number)[]) => (l: number) => { const v = values[l - 1]; return v == null || v === 0 || v === '' ? null : String(v) }
const steps = (s: [number, string][]) => (l: number) => { let v: string | null = null; for (const [from, x] of s) if (l >= from) v = x; return v }
const cantrips = (a: number) => steps([[1, String(a)], [4, String(a + 1)], [10, String(a + 2)]])
const fromLevel = (first: number) => (l: number) => (l >= first ? String(l) : null)
const THIRD_KNOWN = by([0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13])

/** The columns of the 2014 Player's Handbook class tables that are not spell slots or features. */
const TABLE_2014: Record<string, Column[]> = {
  barbarian: [
    { name: 'Rages', at: by([2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 'unlimited']) },
    { name: 'Rage damage', at: steps([[1, '+2'], [9, '+3'], [16, '+4']]) },
  ],
  bard: [
    { name: 'Cantrips known', at: cantrips(2) },
    { name: 'Spells known', at: by([4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22]) },
    { name: 'Bardic Inspiration die', at: steps([[1, 'd6'], [5, 'd8'], [10, 'd10'], [15, 'd12']]) },
    { name: 'Song of Rest die', at: steps([[2, 'd6'], [9, 'd8'], [13, 'd10'], [17, 'd12']]) },
  ],
  cleric: [
    { name: 'Cantrips known', at: cantrips(3) },
    { name: 'Channel Divinity uses per rest', at: steps([[2, '1'], [6, '2'], [18, '3']]) },
    { name: 'Destroy Undead', at: steps([[5, 'CR 1/2'], [8, 'CR 1'], [11, 'CR 2'], [14, 'CR 3'], [17, 'CR 4']]) },
  ],
  druid: [
    { name: 'Cantrips known', at: cantrips(2) },
    { name: 'Wild Shape', at: steps([[2, 'CR 1/4, no flying or swimming speed'], [4, 'CR 1/2, no flying speed'], [8, 'CR 1']]) },
  ],
  monk: [
    { name: 'Martial Arts die', at: steps([[1, 'd4'], [5, 'd6'], [11, 'd8'], [17, 'd10']]) },
    { name: 'Ki points', at: fromLevel(2) },
    { name: 'Unarmored Movement', at: steps([[2, '+10 ft.'], [6, '+15 ft.'], [10, '+20 ft.'], [14, '+25 ft.'], [18, '+30 ft.']]) },
  ],
  ranger: [{ name: 'Spells known', at: by([0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11]) }],
  rogue: [{ name: 'Sneak Attack', at: (l) => `${Math.ceil(l / 2)}d6` }],
  sorcerer: [
    { name: 'Cantrips known', at: cantrips(4) },
    { name: 'Spells known', at: by([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15]) },
    { name: 'Sorcery points', at: fromLevel(2) },
  ],
  warlock: [
    { name: 'Cantrips known', at: cantrips(2) },
    { name: 'Spells known', at: by([2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15]) },
    { name: 'Eldritch Invocations known', at: by([0, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8]) },
  ],
  wizard: [{ name: 'Cantrips known', at: cantrips(3) }],
}
/** The spellcasting columns of the two third casters of the 2014 rules. */
const THIRD_2014: Record<string, Column[]> = {
  'eldritch knight': [{ name: 'Cantrips known', at: steps([[3, '2'], [10, '3']]) }, { name: 'Spells known', at: THIRD_KNOWN }],
  'arcane trickster': [{ name: 'Cantrips known', at: steps([[3, '3'], [10, '4']]) }, { name: 'Spells known', at: THIRD_KNOWN }],
}
/** Classes that prepare their spells each day in the 2014 rules: the ability and whether half the class level counts. */
const PREPARES_2014: Record<string, { ability: Ability; half?: boolean }> = { cleric: { ability: 'wis' }, druid: { ability: 'wis' }, paladin: { ability: 'cha', half: true }, wizard: { ability: 'int' } }

/** The class table columns the level up shows: the 2014 tables for the classes of the 2014 rules, else what the class brings (Open5e). */
export function columnsOf(className: string, subclass = '', ruleset: string = '5e', brought: Column[] = []): Column[] {
  const n = key(className), s = subclass.trim().toLowerCase()
  if (rulesetOf(ruleset) !== '5e') return brought
  if (n === 'fighter' || n === 'rogue') {
    const third = Object.entries(THIRD_2014).find(([name]) => s.includes(name))
    return [...(TABLE_2014[n] ?? []), ...(third?.[1] ?? [])]
  }
  return TABLE_2014[n] ?? brought
}

/** Columns from an Open5e class (its "CLASS_TABLE_DATA" features), leaving out spell slots, which the level up works out itself. */
export function open5eColumns(d: any): Column[] {
  const out: Column[] = []
  for (const f of Array.isArray(d?.features) ? d.features : []) {
    if (f?.feature_type !== 'CLASS_TABLE_DATA' || /slot/i.test(String(f.name ?? ''))) continue
    const values = new Map<number, string>(), bad = new Set<number>()
    for (const x of Array.isArray(f.data_for_class_table) ? f.data_for_class_table : []) {
      const l = Number(x?.level), v = String(x?.column_value ?? '').trim()
      if (!Number.isInteger(l) || !v || v === '-' || v === '—') continue
      // a level listed twice with different values is a slip in the data; nothing is said for it
      if (values.has(l) && values.get(l) !== v) bad.add(l)
      values.set(l, v)
    }
    if (values.size) out.push({ name: String(f.name).trim(), at: (l) => (bad.has(l) ? null : values.get(l) ?? null) })
  }
  return out
}

/** What changes in the class table from one class level to the next, as lines ("Sneak Attack: 2d6 to 3d6"). */
export function columnLines(columns: Column[], from: number, to: number): string[] {
  const out: string[] = []
  for (const c of columns) {
    const was = from > 0 ? c.at(from) : null, now = c.at(to)
    if (now == null || was === now) continue
    const more = Number(now) - Number(was ?? 0)
    const learn = /known/i.test(c.name) && Number.isFinite(more) && more > 0 ? ` (learn ${more} more)` : ''
    out.push(was == null ? `${c.name}: ${now}${learn}` : `${c.name}: ${was} to ${now}${learn}`)
  }
  return out
}

/** The ability scores a class needs, for multiclassing into it or out of it: every group must be met, one score of a group is enough. */
const MULTICLASS_NEEDS: Record<string, Ability[][]> = {
  barbarian: [['str']], bard: [['cha']], cleric: [['wis']], druid: [['wis']], fighter: [['str', 'dex']], monk: [['dex'], ['wis']], paladin: [['str'], ['cha']],
  ranger: [['dex'], ['wis']], rogue: [['dex']], sorcerer: [['cha']], warlock: [['cha']], wizard: [['int']], artificer: [['int']],
}
const NAMES: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' }
/** What a class that is not met needs, e.g. "Strength 13 and Charisma 13", or null when the scores are enough (or the class is not known). */
export function multiclassNeed(className: string, abilities: Record<Ability, number>): string | null {
  const need = MULTICLASS_NEEDS[key(className)]
  if (!need || need.every((g) => g.some((a) => abilities[a] >= 13))) return null
  return need.map((g) => g.map((a) => `${NAMES[a]} 13`).join(' or ')).join(' and ')
}
/** What the 2014 rules give for taking a class as a second (or later) class, instead of its first level proficiencies. */
const MULTICLASS_PROFS_2014: Record<string, string> = {
  barbarian: 'shields, simple and martial weapons', bard: 'light armor, one skill, one musical instrument', cleric: 'light and medium armor, shields',
  druid: 'light and medium armor, shields (druids will not wear metal)', fighter: 'light and medium armor, shields, simple and martial weapons',
  monk: 'simple weapons, shortswords', paladin: 'light and medium armor, shields, simple and martial weapons',
  ranger: 'light and medium armor, shields, simple and martial weapons, one skill from the ranger list', rogue: "light armor, one skill from the rogue list, thieves' tools",
  sorcerer: 'none', warlock: 'light armor, simple weapons', wizard: 'none',
}

export interface LevelUp { patch: Record<string, unknown>; lines: string[]; newLevel: number; /** what the rules would not allow or ask to check, shown but not refused */ warnings: string[] }

/**
 * One more level in a class (a new class when the character has none of that name yet). Hit points go up by the average of the hit die
 * (or the rolled number) plus the Constitution modifier, at least 1; a hit die is added, spell slots are recalculated and kept spent counts stay.
 * `infos` describes classes the tables here do not know (homebrew, Open5e), by lower case name.
 */
export function levelUp(sheet: Sheet, className: string, opts: { hit?: number; die?: number; infos?: ClassInfos; /** the class table columns of a class the rules here do not know */ columns?: Column[] } & Choices = {}): LevelUp | { error: string } {
  const name = className.trim()
  if (!name) return { error: 'Choose a class first.' }
  const infos = opts.infos ?? {}
  const ruleset = rulesetOf(sheet.ruleset)
  const classes = (sheet.classes ?? []).filter((c) => c.name.trim() && c.level > 0).map((c) => ({ ...c }))
  if (totalLevel(classes) >= 20) return { error: 'A character cannot go past level 20.' }
  const at = classes.findIndex((c) => key(c.name) === key(name))
  const info = infos[key(name)]
  const die = opts.die ?? hitDieOf(name, info)
  if (!die) return { error: `The hit die of ${name} is not known. Enter it.` }
  const first = !classes.length
  const others = classes.map((c) => c.name)
  if (at >= 0) classes[at].level += 1; else classes.push({ name, level: 1 })
  const newLevel = totalLevel(classes)
  const con = abilityMod(sheet.abilities.con)
  // the very first level of a character gives the whole hit die; every later one the average or a roll
  const roll = first ? die : opts.hit ?? Math.floor(die / 2) + 1
  const gain = Math.max(1, roll + con)
  const patch: Record<string, unknown> = {
    classes,
    'hp.max': first ? gain : sheet.hp.max + gain,
    'hp.current': first ? gain : (sheet.hp.current ?? sheet.hp.max) + gain,
  }
  const dice = (sheet.hitDice ?? []).map((d) => ({ ...d }))
  const d = dice.find((x) => x.sides === die)
  if (d) d.total += 1; else dice.push({ sides: die, total: 1, used: 0 })
  patch.hitDice = dice
  const how = first ? `the whole d${die}` : opts.hit != null ? `rolled ${opts.hit}` : `average ${roll}`
  const lines = [`Level ${newLevel}: ${name} ${at >= 0 ? classes[at].level : 1}`, `${gain} ${first ? '' : 'more '}hit points (${how}${con ? `, ${con > 0 ? '+' : ''}${con} Constitution` : ''})`, `One more d${die} hit die`]
  const warnings: string[] = []
  const prof = (l: number) => 2 + Math.floor((l - 1) / 4)
  if (prof(newLevel) !== prof(newLevel - 1)) lines.push(`Proficiency bonus is now +${prof(newLevel)}`)
  const here = classes[at >= 0 ? at : classes.length - 1]
  if (at < 0 && others.length) {
    // multiclassing asks for 13 in the main abilities of the new class and of every class the character already has
    for (const c of [name, ...others]) {
      const need = multiclassNeed(c, sheet.abilities)
      if (need) warnings.push(`Multiclassing ${c === name ? 'into' : 'out of'} ${c} needs ${need}.`)
    }
    const profs = ruleset === '5e' ? MULTICLASS_PROFS_2014[key(name)] : undefined
    if (profs) lines.push(`Proficiencies from ${name} as a second class: ${profs}`)
  }
  if (opts.subclass?.trim()) {
    if (here.subclass?.trim()) return { error: `${here.name} already has a subclass, ${here.subclass}.` }
    if (!needsSubclass(here.name, here.level, here.subclass, ruleset, info)) return { error: `${here.name} chooses a subclass at level ${subclassLevel(here.name, ruleset, info)}.` }
    here.subclass = opts.subclass.trim().slice(0, 60)
    lines.push(`Subclass: ${here.subclass}`)
  } else if (needsSubclass(here.name, here.level, here.subclass, ruleset, info) && here.level > subclassLevel(here.name, ruleset, info)) {
    // at the level itself the panel's subclass box asks; a level later it was missed
    warnings.push(`${here.name} should have a subclass since level ${subclassLevel(here.name, ruleset, info)}. Choose it now.`)
  }
  lines.push(...columnLines(columnsOf(here.name, here.subclass, ruleset, opts.columns), here.level - 1, here.level))
  if (givesAsi(here.name, here.level)) {
    const boon = givesEpicBoon(here.level, ruleset)
    const points = Object.entries(opts.asi ?? {}).filter(([, n]) => n)
    if (opts.feat?.name.trim() && points.length) return { error: 'Take either the ability score points or a feat, not both.' }
    if (opts.feat?.name.trim()) {
      patch['features.traits'] = [...sheet.features.traits, { name: opts.feat.name.trim().slice(0, 200), text: (opts.feat.text ?? '').slice(0, 1800) }]
      lines.push(`${boon ? 'Epic Boon' : 'Feat'}: ${opts.feat.name.trim()}`)
    } else if (points.length) {
      if (points.some(([k, n]) => !ABILITIES.includes(k as Ability) || !Number.isInteger(n) || (n as number) < 1 || (n as number) > 2) || points.reduce((t, [, n]) => t + (n as number), 0) > 2) return { error: 'Spend at most 2 points, and at most 2 on one ability.' }
      let hpMore = 0
      for (const [k, n] of points) {
        const old = sheet.abilities[k as Ability], now = Math.min(20, old + (n as number))
        patch[`abilities.${k}`] = now
        lines.push(`${k.toUpperCase()} ${old} to ${now}`)
        if (k === 'con') hpMore = (abilityMod(now) - abilityMod(old)) * newLevel
      }
      if (hpMore) { patch['hp.max'] = (patch['hp.max'] as number) + hpMore; patch['hp.current'] = (patch['hp.current'] as number) + hpMore; lines.push(`${hpMore > 0 ? '+' : ''}${hpMore} hit points from Constitution`) }
    } else lines.push(boon ? 'An Epic Boon, or another feat such as Ability Score Improvement' : 'An ability score improvement or a feat')
  }
  // what a preparing class may prepare follows the score after this level's improvement
  const scores = { ...sheet.abilities, ...Object.fromEntries(ABILITIES.filter((a) => patch[`abilities.${a}`] != null).map((a) => [a, patch[`abilities.${a}`] as number])) }
  lines.push(...spellLines(scores, here, ruleset, infos))
  const slots = allSlots(classes, ruleset, infos)
  const old = sheet.spellcasting?.slots ?? []
  if (slots) {
    patch['spellcasting.slots'] = slots.map((total, i) => ({ total, used: Math.min(old[i]?.used ?? 0, total) }))
    if (JSON.stringify(slots) !== JSON.stringify(old.map((s) => s.total))) lines.push(`Spell slots: ${slots.join(' / ')}`)
  }
  const pact = pactSlots(pactLevel(classes, infos))
  const pactBefore = pactSlots(pactLevel(sheet.classes ?? [], infos))
  if (pact && JSON.stringify(pact) !== JSON.stringify(pactBefore)) lines.push(`Pact Magic: ${pact.count} ${pact.count === 1 ? 'slot' : 'slots'} of level ${pact.slotLevel}, which come back on a short rest`)
  return { patch, lines, newLevel, warnings }
}

/** The highest level of spell one class can cast by its own slots at a class level (0 for none). */
function spellLevelOf(c: ClassLevel, ruleset: Ruleset5e, infos: ClassInfos): number {
  if (c.level < 1) return 0
  const kind = casterOf(c.name, c.subclass, infos[key(c.name)])
  if (kind === 'pact') return pactSlots(c.level)?.slotLevel ?? 0
  return slotsFor([c], ruleset, infos)?.length ?? 0
}

/** What a level means for the spells of a class: a new spell level, the spells a wizard copies, what a preparing class may prepare. */
function spellLines(abilities: Record<Ability, number>, c: ClassLevel, ruleset: Ruleset5e, infos: ClassInfos): string[] {
  const out: string[] = []
  const n = key(c.name)
  const was = spellLevelOf({ ...c, level: c.level - 1 }, ruleset, infos), now = spellLevelOf(c, ruleset, infos)
  if (now > was) out.push(`${c.name} spells of level ${now} can now be learned and cast`)
  if (ruleset !== '5e') return out
  if (n === 'wizard') out.push(c.level === 1 ? 'Spellbook: six wizard spells of level 1' : `Copy two wizard spells of up to level ${now} into the spellbook`)
  const prep = PREPARES_2014[n]
  if (prep && now > 0) {
    const lvl = prep.half ? Math.floor(c.level / 2) : c.level
    const count = Math.max(1, abilityMod(abilities[prep.ability]) + lvl)
    out.push(`Prepare up to ${count} ${c.name.toLowerCase()} spells each day (${NAMES[prep.ability]} modifier + ${prep.half ? 'half the ' : ''}${c.name.toLowerCase()} level)`)
  }
  const swaps = ['bard', 'sorcerer', 'warlock', 'ranger'].includes(n) || (['fighter', 'rogue'].includes(n) && /eldritch knight|arcane trickster/i.test(c.subclass ?? ''))
  if (swaps && was > 0) out.push('You may also swap one spell you know for another of this class')
  return out
}

// ---------- carrying ----------

export interface Carried { name: string; qty: number; equipped: boolean; weight?: number; attuned?: boolean; /** the name of the bag or chest this is kept in */ in?: string; /** a container whose contents weigh nothing (a bag of holding) */ weightless?: boolean }

/** Pounds carried: each item's weight times how many. */
export const carriedWeight = (items: Carried[] | undefined) => {
  const list = items ?? []
  const held = new Set(list.filter((i) => i.weightless).map((i) => i.name.trim().toLowerCase()))
  // what is kept in a container that holds weightlessly (a bag of holding) is not carried weight
  return Math.round(list.filter((i) => !(i.in && held.has(i.in.trim().toLowerCase()))).reduce((n, i) => n + (i.weight ?? 0) * i.qty, 0) * 100) / 100
}
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
