import type { LibraryEntry } from '../types'

// The structured sheet of a creature or character. Numbers stay numbers so a token can read hit points,
// armor class and speed, and the page, the hover card and the table all draw the same data.
// It is stored on the page as `props.sheet` and converted from the older string-based stat block data.

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export type Ability = (typeof ABILITIES)[number]
export const SPEED_MODES = ['walk', 'burrow', 'climb', 'crawl', 'fly', 'swim'] as const
export type SpeedMode = (typeof SPEED_MODES)[number]
export const SENSES = ['blindsight', 'darkvision', 'tremorsense', 'truesight'] as const
export type Sense = (typeof SENSES)[number]
export const FEATURE_GROUPS = ['traits', 'actions', 'bonus', 'reactions', 'legendary'] as const
export type FeatureGroup = (typeof FEATURE_GROUPS)[number]

export type Usage =
  | { type: 'recharge'; min: number }
  | { type: 'perDay'; times: number }
  | { type: 'rest' }

/** How many of a feature's uses are spent (a per-day or after-a-rest feature). Kept on the feature itself. */
export const usesLeft = (f: { usage?: Usage; used?: number }) => (f.usage?.type === 'perDay' ? Math.max(0, f.usage.times - (f.used ?? 0)) : null)

export type ActionCost = 'one' | 'two' | 'three' | 'reaction' | 'free'
/** What only a Pathfinder 2e creature has. Ability scores do not exist there: `mods` holds the modifiers themselves. */
/** Proficiency rank: 0 untrained, 1 trained, 2 expert, 3 master, 4 legendary. */
export type Rank = 0 | 1 | 2 | 3 | 4
export interface Pf2eStrike { name: string; ability: 'str' | 'dex'; rank: Rank; item: number; damage: string; agile: boolean; note: string }
/** What only a Pathfinder 2e player character has. Its numbers are worked out from level, ranks and modifiers by `pfDerived`. */
export interface Pf2eChar {
  ancestry: string; heritage: string; background: string; className: string
  keyAbility: Ability | ''
  ranks: { perception: Rank; fort: Rank; ref: Rank; will: Rank; classDc: Rank; spell: Rank; armor: Rank; skills: Record<string, Rank> }
  lores: { name: string; rank: Rank }[]
  armor: { name: string; bonus: number; dexCap: number | null }
  acExtra: number
  strikes: Pf2eStrike[]
  heroPoints: number
  dying: number
  wounded: number
  focus: { max: number; current: number }
  tradition: string
  spellAbility: Ability | ''
}
export interface Pf2ePart {
  level: number
  char?: Pf2eChar
  perception: number
  fort: number
  ref: number
  will: number
  mods: Record<Ability, number>
  traits: string[]
  rarity: string
}

export interface Feature {
  name: string
  text: string
  /** uses spent since the last rest */
  used?: number
  /** Pathfinder 2e: what it costs to use, its attack bonus and damage, and whether a strike is agile (a smaller penalty for later attacks) */
  actions?: ActionCost
  bonus?: number
  damage?: string
  agile?: boolean
  usage?: Usage
  /** legendary actions: how many of the creature's actions this one spends */
  cost?: number
}

export interface ClassLevel { name: string; level: number; subclass?: string }
export interface HitDice { sides: number; total: number; used: number }
export interface InventoryItem { name: string; qty: number; equipped: boolean; note: string; /** pounds, each */ weight?: number; attuned?: boolean; /** uses of a wand or a staff spent, and how many it has */ charges?: { used: number; max: number }; /** added to armor class while the item is equipped */ acBonus?: number }
export interface Currency { cp: number; sp: number; ep: number; gp: number; pp: number }
export type Proficiency = 'p' | 'e'

/** What only a player character has. Everything is optional so a creature's sheet is unchanged. */
export interface CharacterPart {
  player?: string
  species?: string
  background?: string
  classes?: ClassLevel[]
  inspiration?: boolean
  profs?: { saves: Ability[]; skills: Record<string, Proficiency>; tools?: string }
  hitDice?: HitDice[]
  deathSaves?: { ok: number; fail: number }
  spellcasting?: { ability: Ability | ''; /** index 0 is level 1 */ slots: { total: number; used: number }[] }
  spells?: string
  inventory?: InventoryItem[]
  currency?: Currency
}

export interface Sheet extends CharacterPart {
  v: 1
  pf2e?: Pf2ePart
  /** a creature unless it says otherwise */
  kind?: 'creature' | 'character'
  ruleset: '5e' | '5e-2024' | 'pf2e'
  name: string
  size: string
  /** creature type, lower case ("humanoid") */
  type: string
  alignment: string
  abilities: Record<Ability, number>
  ac: { value: number; note: string }
  hp: { max: number; formula: string; /** characters keep their current and temporary hit points on the sheet */ current?: number; temp?: number }
  speed: Partial<Record<SpeedMode, number>> & { hover?: boolean }
  /** total bonuses, as printed; a missing entry means "just the ability modifier" */
  saves: Partial<Record<Ability, number>>
  skills: Record<string, number>
  initiative?: number
  senses: Partial<Record<Sense, number>>
  passivePerception?: number
  vulnerabilities: string
  resistances: string
  immunities: string
  conditionImmunities: string
  languages: string
  cr?: number
  xp?: number
  features: Record<FeatureGroup, Feature[]>
}

export const emptySheet = (ruleset: Sheet['ruleset'] = '5e'): Sheet => ({
  v: 1,
  ruleset,
  name: '',
  size: '',
  type: '',
  alignment: '',
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  ac: { value: 10, note: '' },
  hp: { max: 1, formula: '' },
  speed: { walk: 30 },
  saves: {},
  skills: {},
  senses: {},
  vulnerabilities: '',
  resistances: '',
  immunities: '',
  conditionImmunities: '',
  languages: '',
  features: { traits: [], actions: [], bonus: [], reactions: [], legendary: [] },
})

/**
 * The sheet of a page: the stored one, else one read from the page's old stat block (`props.data.main`), else null.
 * The converted sheet is only stored when someone edits it (`wholeSheetPatch`), so reading never writes.
 */
export function sheetOf(props: Record<string, any> | null | undefined): Sheet | null {
  if (props?.sheet && props.sheet.v === 1) return props.sheet as Sheet
  const main = props?.data?.main
  if (main && typeof main === 'object' && main.data && typeof main.data === 'object') return sheetFromLegacy(main.data, main.template)
  return null
}

/** Every top-level field as a path patch, for `propsPatch.sheet` when a sheet is stored for the first time. */
export const wholeSheetPatch = (s: Sheet): Record<string, unknown> => ({ ...s })

// ---------- derived values ----------

export const abilityMod = (score: number) => Math.floor((score - 10) / 2)
export const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`)

/** Proficiency bonus from challenge rating (a challenge rating below 1 counts as 1). */
export const profBonus = (cr: number) => 2 + Math.floor((Math.max(cr, 1) - 1) / 4)

export const isCharacter = (s: Sheet) => s.kind === 'character'
export const characterLevel = (s: Sheet) => (s.classes ?? []).reduce((n, c) => n + Math.max(0, c.level), 0)

/** The proficiency bonus: by level for a character, by challenge rating for a creature. */
export const proficiency = (s: Sheet) => isCharacter(s) ? 2 + Math.floor((Math.max(1, characterLevel(s)) - 1) / 4) : s.cr != null ? profBonus(s.cr) : 2

export const SKILLS: Record<string, Ability> = {
  acrobatics: 'dex', 'animal handling': 'wis', arcana: 'int', athletics: 'str', deception: 'cha', history: 'int', insight: 'wis', intimidation: 'cha', investigation: 'int',
  medicine: 'wis', nature: 'int', perception: 'wis', performance: 'cha', persuasion: 'cha', religion: 'int', 'sleight of hand': 'dex', stealth: 'dex', survival: 'wis',
}

export function skillBonus(s: Sheet, skill: string): number {
  const ability = SKILLS[skill] ?? 'int'
  if (!isCharacter(s)) return s.skills[skill] ?? abilityMod(s.abilities[ability])
  const p = s.profs?.skills[skill]
  return abilityMod(s.abilities[ability]) + (p === 'e' ? 2 * proficiency(s) : p === 'p' ? proficiency(s) : 0)
}

export const saveBonus = (s: Sheet, a: Ability) => isCharacter(s) ? abilityMod(s.abilities[a]) + (s.profs?.saves.includes(a) ? proficiency(s) : 0) : s.saves[a] ?? abilityMod(s.abilities[a])

export const spellAbilityMod = (s: Sheet) => s.spellcasting?.ability ? abilityMod(s.abilities[s.spellcasting.ability]) : null
export const spellDC = (s: Sheet) => { const m = spellAbilityMod(s); return m == null ? null : 8 + proficiency(s) + m }
export const spellAttack = (s: Sheet) => { const m = spellAbilityMod(s); return m == null ? null : proficiency(s) + m }

/** The fields a long rest changes: full hit points, no temporary ones, every slot back, half the hit dice back (at least one), death saves cleared. */
export function longRestPatch(s: Sheet): Record<string, unknown> {
  const patch: Record<string, unknown> = { 'hp.current': s.hp.max, 'hp.temp': 0, deathSaves: { ok: 0, fail: 0 } }
  if (s.spellcasting) patch['spellcasting.slots'] = s.spellcasting.slots.map((x) => ({ ...x, used: 0 }))
  if (s.hitDice?.length) {
    let back = Math.max(1, Math.floor((s.hitDice.reduce((n, d) => n + d.total, 0)) / 2))
    patch.hitDice = s.hitDice.map((d) => { const give = Math.min(d.used, back); back -= give; return { ...d, used: d.used - give } })
  }
  return patch
}

export const emptyCharacter = (ruleset: Sheet['ruleset'] = '5e'): Sheet => ({
  ...emptySheet(ruleset), kind: 'character', hp: { max: 10, formula: '', current: 10, temp: 0 }, classes: [{ name: '', level: 1 }],
  profs: { saves: [], skills: {} }, hitDice: [], deathSaves: { ok: 0, fail: 0 }, spellcasting: { ability: '', slots: [] }, spells: '', inventory: [],
  currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, inspiration: false,
})

/** Pathfinder 2e rolls initiative with Perception unless the sheet says otherwise. */
export const initiativeBonus = (s: Sheet) => s.initiative ?? (s.ruleset === 'pf2e' && s.pf2e ? s.pf2e.perception : abilityMod(s.abilities.dex))

/** The attack bonuses of a strike for the first, second and third attack in a turn. */
export const multipleAttack = (bonus: number, agile = false) => [bonus, bonus - (agile ? 4 : 5), bonus - (agile ? 8 : 10)]

export const pf2eMod = (s: Sheet, a: Ability) => s.pf2e?.mods[a] ?? 0

// ---------- Pathfinder 2e characters ----------

export const RANK_NAMES = ['Untrained', 'Trained', 'Expert', 'Master', 'Legendary'] as const
export const PF_SKILLS: Record<string, Ability> = {
  acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int', deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
  nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis', society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
}

/** Level plus two per rank, nothing at all when untrained. */
export const rankBonus = (level: number, rank: number) => (rank > 0 ? level + 2 * rank : 0)

const pfc = (s: Sheet) => s.pf2e?.char
const lvl = (s: Sheet) => s.pf2e?.level ?? 1
export const pfPerception = (s: Sheet) => pf2eMod(s, 'wis') + rankBonus(lvl(s), pfc(s)?.ranks.perception ?? 0)
export const pfSave = (s: Sheet, k: 'fort' | 'ref' | 'will') => pf2eMod(s, k === 'fort' ? 'con' : k === 'ref' ? 'dex' : 'wis') + rankBonus(lvl(s), pfc(s)?.ranks[k] ?? 0)
export const pfSkill = (s: Sheet, skill: string) => pf2eMod(s, PF_SKILLS[skill] ?? 'int') + rankBonus(lvl(s), pfc(s)?.ranks.skills[skill] ?? 0)
export const pfLore = (s: Sheet, rank: number) => pf2eMod(s, 'int') + rankBonus(lvl(s), rank)
/** 10, plus Dexterity up to what the armor allows, plus the armor's bonus, plus armor proficiency, plus anything else that applies. */
export function pfAc(s: Sheet) {
  const c = pfc(s)
  if (!c) return s.ac.value
  const dex = c.armor.dexCap == null ? pf2eMod(s, 'dex') : Math.min(pf2eMod(s, 'dex'), c.armor.dexCap)
  return 10 + dex + c.armor.bonus + rankBonus(lvl(s), c.ranks.armor) + c.acExtra
}
export const pfStrike = (s: Sheet, st: Pf2eStrike) => pf2eMod(s, st.ability) + rankBonus(lvl(s), st.rank) + st.item
export const pfClassDc = (s: Sheet) => { const c = pfc(s); return c && c.keyAbility ? 10 + pf2eMod(s, c.keyAbility) + rankBonus(lvl(s), c.ranks.classDc) : null }
export const pfSpellAttack = (s: Sheet) => { const c = pfc(s); return c && c.spellAbility ? pf2eMod(s, c.spellAbility) + rankBonus(lvl(s), c.ranks.spell) : null }
export const pfSpellDc = (s: Sheet) => { const a = pfSpellAttack(s); return a == null ? null : 10 + a }

/**
 * The numbers other parts of the app read from a character (initiative, armor class on a token, the roll card) written back to the sheet,
 * so they never disagree with the ranks. Added to every edit of a Pathfinder character.
 */
export function pfDerived(s: Sheet): Record<string, unknown> {
  return { 'pf2e.perception': pfPerception(s), 'pf2e.fort': pfSave(s, 'fort'), 'pf2e.ref': pfSave(s, 'ref'), 'pf2e.will': pfSave(s, 'will'), 'ac.value': pfAc(s) }
}

/** Eight hours of rest: Constitution modifier times level hit points (at least the level), spells back, focus points back to the number of sources. */
export function pfRestPatch(s: Sheet): Record<string, unknown> {
  const heal = Math.max(1, pf2eMod(s, 'con')) * lvl(s)
  const patch: Record<string, unknown> = { 'hp.current': Math.min(s.hp.max, (s.hp.current ?? s.hp.max) + heal) }
  if (s.spellcasting) patch['spellcasting.slots'] = s.spellcasting.slots.map((x) => ({ ...x, used: 0 }))
  return patch
}

export const emptyPf2eCharacter = (): Sheet => ({
  ...emptyPf2eCreature(), kind: 'character', hp: { max: 10, formula: '', current: 10, temp: 0 }, speed: { walk: 25 },
  inventory: [], currency: { cp: 0, sp: 0, ep: 0, gp: 15, pp: 0 }, xp: 0, spells: '', spellcasting: { ability: '', slots: [] },
  pf2e: {
    level: 1, perception: 0, fort: 0, ref: 0, will: 0, mods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, traits: [], rarity: 'common',
    char: {
      ancestry: '', heritage: '', background: '', className: '', keyAbility: '',
      ranks: { perception: 1, fort: 1, ref: 1, will: 1, classDc: 1, spell: 0, armor: 0, skills: {} }, lores: [],
      armor: { name: '', bonus: 0, dexCap: null }, acExtra: 0, strikes: [], heroPoints: 1, dying: 0, wounded: 0, focus: { max: 0, current: 0 }, tradition: '', spellAbility: '',
    },
  },
})

export const emptyPf2eCreature = (): Sheet => ({
  ...emptySheet('pf2e'),
  ac: { value: 15, note: '' },
  hp: { max: 20, formula: '' },
  speed: { walk: 25 },
  pf2e: { level: 1, perception: 5, fort: 5, ref: 5, will: 5, mods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, traits: [], rarity: 'common' },
})

export const passivePerception = (s: Sheet) => s.passivePerception ?? 10 + skillBonus(s, 'perception')

export function crText(cr: number | undefined): string {
  if (cr == null || !Number.isFinite(cr)) return ''
  return cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr)
}

export function crFromText(text: string): number | undefined {
  const m = /^\s*(\d+)\s*\/\s*(\d+)/.exec(text)
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : undefined
  const n = parseFloat(text)
  return Number.isFinite(n) ? n : undefined
}

export const speedText = (s: Sheet) => {
  const parts: string[] = []
  if (s.speed.walk) parts.push(`${s.speed.walk} ft.`)
  for (const m of SPEED_MODES) if (m !== 'walk' && s.speed[m]) parts.push(`${m} ${s.speed[m]} ft.${m === 'fly' && s.speed.hover ? ' (hover)' : ''}`)
  return parts.join(', ') || '0 ft.'
}

// ---------- from the library ----------

const clean = (s: unknown) => String(s ?? '').replace(/\s*\r?\n\s*/g, ' ').trim()
const named = (list: any[]) => (list ?? []).map((x) => String(x.name ?? x).toLowerCase()).join(', ')
const resist = (r: any, key: string) => r?.[`${key}_display`] || named(r?.[key])

function usageOf(a: any): Usage | undefined {
  const u = a?.usage_limits
  if (!u) return undefined
  if (u.type === 'RECHARGE_ON_ROLL') return { type: 'recharge', min: Number(u.param) || 6 }
  if (u.type === 'PER_DAY') return { type: 'perDay', times: Number(u.param) || 1 }
  if (u.type === 'RECHARGE_AFTER_REST') return { type: 'rest' }
  return undefined
}

function featuresOf(list: any[], type: string): Feature[] {
  return (list ?? [])
    .filter((a) => a.action_type === type)
    .sort((a, b) => (a.order_in_statblock ?? 0) - (b.order_in_statblock ?? 0))
    .map((a) => {
      const f: Feature = { name: clean(a.name), text: clean(a.desc) }
      const usage = usageOf(a)
      if (usage) f.usage = usage
      if (type === 'LEGENDARY_ACTION' && a.legendary_action_cost > 1) f.cost = Number(a.legendary_action_cost)
      return f
    })
}

/** An Open5e creature as a sheet. Action text comes from `desc`, as in the library mapping (the structured attack data has mistakes). */
export function sheetFromCreature(e: LibraryEntry): Sheet {
  const d = e.data ?? {}
  const s = emptySheet(d.ruleset === '5e-2024' ? '5e-2024' : '5e')
  s.name = e.name
  s.size = String(d.size?.name ?? '')
  s.type = String(d.type?.name ?? '').toLowerCase()
  s.alignment = String(d.alignment ?? '')
  for (const [short, long] of [['str', 'strength'], ['dex', 'dexterity'], ['con', 'constitution'], ['int', 'intelligence'], ['wis', 'wisdom'], ['cha', 'charisma']] as const) {
    const v = Number(d.ability_scores?.[long])
    if (Number.isFinite(v)) s.abilities[short] = v
  }
  s.ac = { value: Number(d.armor_class) || 10, note: String(d.armor_detail ?? '') }
  s.hp = { max: Number(d.hit_points) || 1, formula: String(d.hit_dice ?? '') }
  // speed_all pads every mode with a derived value; speed holds only what is printed
  s.speed = {}
  for (const m of SPEED_MODES) { const v = Number(d.speed?.[m]) || 0; if (v) s.speed[m] = v }
  if (!Object.keys(s.speed).length) s.speed.walk = 0
  if (d.speed_all?.hover && s.speed.fly) s.speed.hover = true
  for (const [short, long] of [['str', 'strength'], ['dex', 'dexterity'], ['con', 'constitution'], ['int', 'intelligence'], ['wis', 'wisdom'], ['cha', 'charisma']] as const) {
    if (d.saving_throws?.[long] != null) s.saves[short] = Number(d.saving_throws[long])
  }
  for (const [k, v] of Object.entries(d.skill_bonuses ?? {})) s.skills[k.replace(/_/g, ' ')] = Number(v)
  if (d.initiative_bonus != null) s.initiative = Number(d.initiative_bonus)
  for (const k of SENSES) { const v = Number(d[`${k}_range`]); if (v) s.senses[k] = v }
  if (d.passive_perception != null) s.passivePerception = Number(d.passive_perception)
  const r = d.resistances_and_immunities
  s.vulnerabilities = resist(r, 'damage_vulnerabilities')
  s.resistances = resist(r, 'damage_resistances')
  s.immunities = resist(r, 'damage_immunities')
  s.conditionImmunities = resist(r, 'condition_immunities')
  s.languages = String(d.languages?.as_string ?? '')
  const cr = Number(d.challenge_rating)
  if (Number.isFinite(cr)) s.cr = cr
  if (d.experience_points != null) s.xp = Number(d.experience_points)
  s.features.traits = (d.traits ?? []).map((t: any) => ({ name: clean(t.name), text: clean(t.desc) }))
  const acts = d.actions ?? []
  s.features.actions = featuresOf(acts, 'ACTION')
  s.features.bonus = featuresOf(acts, 'BONUS_ACTION')
  s.features.reactions = featuresOf(acts, 'REACTION')
  s.features.legendary = featuresOf(acts, 'LEGENDARY_ACTION')
  return s
}

// ---------- from the old string-based stat block data ----------

const num = (text: string | undefined) => {
  const m = /-?\d+/.exec(String(text ?? '').replace('−', '-'))
  return m ? Number(m[0]) : undefined
}
const bonus = (text: string) => num(text.replace(/^[^+\-−\d]*/, ''))

function parseSpeed(text: string): Sheet['speed'] {
  const out: Sheet['speed'] = {}
  for (const part of text.split(/[,;]/)) {
    const m = /^\s*(?:(burrow|climb|crawl|fly|swim|walk)\s+)?(\d+)/i.exec(part)
    if (m) out[(m[1]?.toLowerCase() as SpeedMode) ?? 'walk'] = Number(m[2])
    if (/hover/i.test(part)) out.hover = true
  }
  return out
}

function parseFeatures(text: string | undefined): Feature[] {
  const out: Feature[] = []
  for (const line of String(text ?? '').split('\n')) {
    const t = line.trim()
    if (!t) continue
    const m = /^\*\*\*(.+?)\*\*\*\s*(.*)$/.exec(t)
    if (!m) { out.push({ name: t.replace(/\*/g, ''), text: '' }); continue }
    let name = m[1].trim().replace(/\.$/, '')
    const f: Feature = { name, text: m[2].trim() }
    const recharge = /\(Recharge (\d)/i.exec(name)
    const perDay = /\((\d+)\s*\/\s*Day/i.exec(name)
    const cost = /\(Costs (\d+) Actions?\)/i.exec(name)
    if (recharge) f.usage = { type: 'recharge', min: Number(recharge[1]) }
    else if (perDay) f.usage = { type: 'perDay', times: Number(perDay[1]) }
    else if (/\(Recharges after/i.test(name)) f.usage = { type: 'rest' }
    if (cost) f.cost = Number(cost[1])
    name = name.replace(/\s*\((Recharge[^)]*|\d+\s*\/\s*Day[^)]*|Recharges after[^)]*|Costs \d+ Actions?)\)/i, '').trim()
    f.name = name
    out.push(f)
  }
  return out
}

/** Reads the string fields of a monster stat block into a sheet. Anything unreadable falls back to the sheet's default. */
export function sheetFromLegacy(data: Record<string, string>, templateId = '5e-monster'): Sheet {
  const s = emptySheet(templateId === '5e-monster-2024' ? '5e-2024' : '5e')
  s.name = data.name ?? ''
  const [head, ...rest] = String(data.type ?? '').split(',')
  const words = head.trim().split(/\s+/)
  const sizes = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']
  if (sizes.includes(words[0]?.toLowerCase())) { s.size = words[0]; s.type = words.slice(1).join(' ').toLowerCase() } else s.type = head.trim().toLowerCase()
  s.alignment = rest.join(',').trim()
  for (const a of ABILITIES) { const v = num(data[a]); if (v != null) s.abilities[a] = v }
  const ac = /^\s*(\d+)\s*(?:\((.*)\))?/.exec(data.ac ?? '')
  if (ac) s.ac = { value: Number(ac[1]), note: ac[2] ?? '' }
  const hp = /^\s*(\d+)\s*(?:\((.*)\))?/.exec(data.hp ?? '')
  if (hp) s.hp = { max: Number(hp[1]), formula: hp[2] ?? '' }
  if (data.speed) s.speed = parseSpeed(data.speed)
  for (const part of String(data.saves ?? '').split(',')) {
    const m = /^\s*(str|dex|con|int|wis|cha)\w*\s+([+\-−]?\d+)/i.exec(part)
    if (m) s.saves[m[1].toLowerCase() as Ability] = bonus(m[2])!
  }
  for (const a of ABILITIES) { const v = data[`${a}_save`]; if (v) { const n = bonus(v); if (n != null) s.saves[a] = n } }
  for (const part of String(data.skills ?? '').split(',')) {
    const m = /^\s*([A-Za-z' ]+?)\s+([+\-−]\d+)/.exec(part)
    if (m) s.skills[m[1].toLowerCase()] = bonus(m[2])!
  }
  const init = bonus(String(data.init ?? '').split('(')[0])
  if (init != null && data.init) s.initiative = init
  for (const part of String(data.senses ?? '').split(',')) {
    const m = /^\s*(blindsight|darkvision|tremorsense|truesight)\s+(\d+)/i.exec(part)
    if (m) s.senses[m[1].toLowerCase() as Sense] = Number(m[2])
    const p = /passive Perception\s+(\d+)/i.exec(part)
    if (p) s.passivePerception = Number(p[1])
  }
  s.vulnerabilities = data.vuln ?? ''
  s.resistances = data.resist ?? ''
  s.immunities = data.immune ?? ''
  s.conditionImmunities = data.condImmune ?? ''
  s.languages = data.languages ?? ''
  const cr = crFromText(data.cr ?? '')
  if (cr != null) s.cr = cr
  const xp = /([\d,]+)\s*XP|XP\s*([\d,]+)/i.exec(data.cr ?? '')
  if (xp) s.xp = Number((xp[1] ?? xp[2]).replace(/,/g, ''))
  s.features = { traits: parseFeatures(data.traits), actions: parseFeatures(data.actions), bonus: parseFeatures(data.bonus), reactions: parseFeatures(data.reactions), legendary: parseFeatures(data.legendary) }
  return s
}

// ---------- rolls found in feature text ----------

export interface FeatureRolls { attack: number | null; damage: { expr: string; type: string }[]; save: { ability: string; dc: number } | null }

/** The attack bonus, damage dice and saving throw written into a feature's text ("+4 to hit", "7 (2d4 + 2) piercing damage", "DC 13 Dexterity saving throw"). */
export function rollsIn(text: string): FeatureRolls {
  const hit = /([+\-−]\d+)\s+to hit/i.exec(text)
  const damage = [...text.matchAll(/\((\d+d\d+(?:\s*[+\-−]\s*\d+)?)\)\s*([a-z]+)?\s*damage/gi)].map((m) => ({ expr: m[1].replace(/\s+/g, '').replace('−', '-'), type: m[2] ?? '' }))
  const save = /DC\s*(\d+)\s*(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s*saving throw/i.exec(text)
  return { attack: hit ? Number(hit[1].replace('−', '-')) : null, damage, save: save ? { ability: save[2], dc: Number(save[1]) } : null }
}

/** The same path patch the server applies (`hp.max`, `abilities.str`; null removes), so the screen can follow an edit before it is saved. */
export function patchSheetLocal(sheet: Sheet, patch: Record<string, unknown>): Sheet {
  const next: any = structuredClone(sheet)
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split('.')
    let at = next
    for (const k of keys.slice(0, -1)) { if (!at[k] || typeof at[k] !== 'object') at[k] = {}; at = at[k] }
    const last = keys[keys.length - 1]
    if (value === null) delete at[last]; else at[last] = value
  }
  return next
}
