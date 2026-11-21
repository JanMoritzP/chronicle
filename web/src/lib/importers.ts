import { ABILITIES, emptyCharacter, emptyPf2eCharacter, PF_SKILLS, type Ability, type Feature, type InventoryItem, type Proficiency, type Rank, type Sheet } from './sheet'

// Characters from elsewhere: a Chronicle character file, a Foundry VTT D&D 5e actor, a D&D Beyond character (the JSON its character service gives),
// a Roll20 character (the attributes of its D&D 5e sheet). Each is mapped onto the character sheet as far as it carries the same things;
// anything it does not say stays as a new character has it. Pure functions, tested without a browser.

export const CHARACTER_FORMAT = 'chronicle-character'

const num = (v: unknown, lo: number, hi: number, fallback: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback }
const text = (v: unknown, max: number) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max)
const plain = (html: unknown, max = 1800) => text(html, 20000).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
const weightOf = (v: unknown) => { const w = typeof v === 'object' && v ? (v as { value?: unknown }).value : v; const n = Number(w); return Number.isFinite(n) && n > 0 ? Math.min(100000, Math.round(n * 100) / 100) : undefined }

const FOUNDRY_SKILL: Record<string, string> = { acr: 'acrobatics', ani: 'animal handling', arc: 'arcana', ath: 'athletics', dec: 'deception', his: 'history', ins: 'insight', itm: 'intimidation', inv: 'investigation', med: 'medicine', nat: 'nature', prc: 'perception', prf: 'performance', per: 'persuasion', rel: 'religion', slt: 'sleight of hand', ste: 'stealth', sur: 'survival' }
const ABILITY_BY_NAME: Record<string, Ability> = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' }

type Result = { sheet: Sheet } | { error: string }
const base = (name: string, ruleset: Sheet['ruleset']): Sheet => ({ ...emptyCharacter(ruleset), name: text(name, 300) || 'Imported character' })

export function fromFoundry(a: any, ruleset: Sheet['ruleset'] = '5e'): Result {
  const sys = a?.system
  if (!sys?.abilities) return { error: 'That Foundry actor has no ability scores.' }
  const s = base(a.name, ruleset)
  for (const k of ABILITIES) s.abilities[k] = num(sys.abilities[k]?.value, 0, 60, 10)
  const hp = sys.attributes?.hp ?? {}
  s.hp = { max: num(hp.max, 0, 100000, 10), formula: '', current: num(hp.value, -9999, 100000, num(hp.max, 0, 100000, 10)), temp: num(hp.temp, 0, 100000, 0) }
  s.ac = { value: num(sys.attributes?.ac?.value ?? sys.attributes?.ac?.flat, 0, 99, 10), note: '' }
  s.speed = { walk: num(sys.attributes?.movement?.walk, 0, 1000, 30) }
  s.profs = { saves: ABILITIES.filter((k) => Number(sys.abilities[k]?.proficient) > 0), skills: {} }
  for (const [code, v] of Object.entries<any>(sys.skills ?? {})) {
    const name = FOUNDRY_SKILL[code]
    const val = Number(v?.value)
    if (name && val > 0) s.profs.skills[name] = (val >= 2 ? 'e' : 'p') as Proficiency
  }
  const items: any[] = Array.isArray(a.items) ? a.items : []
  s.classes = items.filter((i) => i.type === 'class').map((i) => ({ name: text(i.name, 60), level: num(i.system?.levels, 0, 20, 1), ...(i.system?.subclass ? { subclass: text(i.system.subclass, 60) } : {}) })).slice(0, 6)
  if (!s.classes.length) s.classes = [{ name: text(sys.details?.class, 60), level: num(sys.details?.level, 1, 20, 1) }]
  s.species = text(items.find((i) => i.type === 'race')?.name ?? sys.details?.race, 80)
  s.background = text(items.find((i) => i.type === 'background')?.name ?? sys.details?.background, 80)
  s.alignment = text(sys.details?.alignment, 80)
  const gear = new Set(['weapon', 'equipment', 'consumable', 'loot', 'tool', 'backpack'])
  s.inventory = items.filter((i) => gear.has(i.type)).slice(0, 200).map((i): InventoryItem => ({ name: text(i.name, 120), qty: num(i.system?.quantity, 0, 99999, 1), equipped: !!i.system?.equipped, note: '', ...(weightOf(i.system?.weight) !== undefined ? { weight: weightOf(i.system?.weight) } : {}), ...(Number(i.system?.attunement) === 2 || i.system?.attuned ? { attuned: true } : {}) }))
  const feats = items.filter((i) => i.type === 'feat').slice(0, 60).map((i): Feature => ({ name: text(i.name, 200), text: plain(i.system?.description?.value) }))
  s.features = { ...s.features, traits: feats }
  const spells = items.filter((i) => i.type === 'spell').map((i) => `${i.system?.level ?? 0 ? `Level ${i.system.level}: ` : 'Cantrip: '}${text(i.name, 80)}`)
  s.spells = spells.join('\n').slice(0, 8000)
  const cur = sys.currency ?? {}
  s.currency = { cp: num(cur.cp, 0, 1e7, 0), sp: num(cur.sp, 0, 1e7, 0), ep: num(cur.ep, 0, 1e7, 0), gp: num(cur.gp, 0, 1e7, 0), pp: num(cur.pp, 0, 1e7, 0) }
  return { sheet: s }
}

export function fromBeyond(raw: any, ruleset: Sheet['ruleset'] = '5e'): Result {
  const d = raw?.data ?? raw
  if (!Array.isArray(d?.stats)) return { error: 'That D&D Beyond file has no ability scores.' }
  const s = base(d.name, ruleset)
  const ids: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']
  for (const st of d.stats) { const k = ids[Number(st.id) - 1]; if (k) s.abilities[k] = num(st.value, 0, 60, 10) }
  const max = num((d.overrideHitPoints ?? ((d.baseHitPoints ?? 0) + (d.bonusHitPoints ?? 0))), 0, 100000, 10)
  s.hp = { max, formula: '', current: Math.max(-9999, max - num(d.removedHitPoints, 0, 100000, 0)), temp: num(d.temporaryHitPoints, 0, 100000, 0) }
  s.classes = (Array.isArray(d.classes) ? d.classes : []).slice(0, 6).map((c: any) => ({ name: text(c.definition?.name, 60), level: num(c.level, 0, 20, 1), ...(c.subclassDefinition?.name ? { subclass: text(c.subclassDefinition.name, 60) } : {}) }))
  if (!(s.classes ?? []).length) s.classes = [{ name: '', level: 1 }]
  s.species = text(d.race?.fullName ?? d.race?.baseRaceName, 80)
  s.background = text(d.background?.definition?.name, 80)
  s.inventory = (Array.isArray(d.inventory) ? d.inventory : []).slice(0, 200).map((i: any): InventoryItem => ({ name: text(i.definition?.name, 120), qty: num(i.quantity, 0, 99999, 1), equipped: !!i.equipped, note: '', ...(weightOf(i.definition?.weight) !== undefined ? { weight: weightOf(i.definition?.weight) } : {}), ...(i.isAttuned ? { attuned: true } : {}) }))
  const cur = d.currencies ?? {}
  s.currency = { cp: num(cur.cp, 0, 1e7, 0), sp: num(cur.sp, 0, 1e7, 0), ep: num(cur.ep, 0, 1e7, 0), gp: num(cur.gp, 0, 1e7, 0), pp: num(cur.pp, 0, 1e7, 0) }
  return { sheet: s }
}

export function fromRoll20(raw: any, ruleset: Sheet['ruleset'] = '5e'): Result {
  const list: { name?: string; current?: unknown; max?: unknown }[] = Array.isArray(raw?.attribs) ? raw.attribs : Array.isArray(raw?.character?.attribs) ? raw.character.attribs : []
  if (!list.length) return { error: 'That Roll20 file has no attributes.' }
  const get = (n: string) => list.find((a) => a.name === n)
  const s = base(raw.name ?? raw.character?.name ?? '', ruleset)
  for (const [n, k] of Object.entries(ABILITY_BY_NAME)) s.abilities[k] = num(get(n)?.current, 0, 60, 10)
  const hp = get('hp')
  s.hp = { max: num(hp?.max ?? hp?.current, 0, 100000, 10), formula: '', current: num(hp?.current, -9999, 100000, num(hp?.max, 0, 100000, 10)), temp: num(get('hp_temp')?.current, 0, 100000, 0) }
  s.ac = { value: num(get('ac')?.current, 0, 99, 10), note: '' }
  const cls = text(get('class')?.current, 60)
  s.classes = [{ name: cls, level: num(get('level')?.current ?? get('base_level')?.current, 1, 20, 1) }]
  s.species = text(get('race')?.current, 80)
  s.background = text(get('background')?.current, 80)
  s.alignment = text(get('alignment')?.current, 80)
  s.speed = { walk: num(String(get('speed')?.current ?? '').match(/\d+/)?.[0], 0, 1000, 30) }
  return { sheet: s }
}

/**
 * A Pathfinder 2e character from Pathbuilder (the JSON its Export button gives): ability scores, hit points, ranks, skills and lores, feats, weapons as strikes,
 * armor, gear and money, and its spells as a list. Pathbuilder writes ranks as 0, 2, 4, 6, 8.
 */
export function fromPathbuilder(raw: any): Result {
  const b = raw?.build
  if (!b?.abilities || typeof b.abilities !== 'object') return { error: 'That Pathbuilder file has no ability scores.' }
  const s = emptyPf2eCharacter()
  s.name = text(b.name, 300) || 'Imported character'
  const level = num(b.level, 1, 20, 1)
  const mod = (score: unknown) => Math.floor((num(score, 1, 60, 10) - 10) / 2)
  const mods = Object.fromEntries(ABILITIES.map((k) => [k, mod(b.abilities[k])])) as Record<Ability, number>
  const rank = (v: unknown): Rank => Math.min(4, Math.max(0, Math.round(Number(v) / 2) || 0)) as Rank
  const pf = s.pf2e!
  pf.level = level
  pf.mods = mods
  const c = pf.char!
  c.ancestry = text(b.ancestry, 80); c.heritage = text(b.heritage, 80); c.background = text(b.background, 80); c.className = text(b.class, 80)
  c.keyAbility = ABILITIES.includes(b.keyability) ? b.keyability : ''
  const p = b.proficiencies ?? {}
  c.ranks = { ...c.ranks, perception: rank(p.perception), fort: rank(p.fortitude), ref: rank(p.reflex), will: rank(p.will), classDc: rank(p.classDC), armor: rank(p.heavy || p.medium || p.light || p.unarmored), skills: {} }
  for (const k of Object.keys(PF_SKILLS)) { const r = rank(p[k]); if (r > 0) c.ranks.skills[k] = r }
  c.lores = (Array.isArray(b.lores) ? b.lores : []).slice(0, 30).map((l: any) => ({ name: text(l?.[0], 60), rank: rank(l?.[1]) }))
  const at = b.attributes ?? {}
  s.hp.max = Math.max(1, num(at.ancestryhp, 0, 999, 8) + (num(at.classhp, 0, 99, 8) + mods.con + num(at.bonushpPerLevel, 0, 99, 0)) * level + num(at.bonushp, 0, 9999, 0))
  s.hp.current = s.hp.max
  s.speed = { walk: num(num(at.speed, 0, 500, 25) + num(at.speedBonus, -100, 500, 0), 0, 500, 25) }
  if (b.acTotal) { c.armor = { name: text((b.armor ?? []).find((a: any) => a.worn)?.name, 80), bonus: num(b.acTotal.acItemBonus, 0, 20, 0), dexCap: null } }
  c.strikes = (Array.isArray(b.weapons) ? b.weapons : []).slice(0, 12).map((w: any) => ({ name: text(w.display || w.name, 80), ability: (/bow|sling|dagger|rapier|whip|dart/i.test(String(w.name)) ? 'dex' : 'str') as 'str' | 'dex', rank: rank(w.prof === 'unarmed' ? p.unarmed : p[String(w.prof ?? '').toLowerCase()] ?? p.simple), item: num(w.pot, 0, 3, 0), damage: /^d\d+$/.test(String(w.die)) ? `1${w.die}` : '1d4', agile: false, note: '' }))
  const feats: Feature[] = (Array.isArray(b.feats) ? b.feats : []).slice(0, 80).map((f: any) => ({ name: text(Array.isArray(f) ? f[0] : f, 200), text: Array.isArray(f) && f[3] ? `Level ${f[3]} ${text(f[2], 40)}`.trim() : '' }))
  s.features = { ...s.features, traits: feats.filter((f) => f.name) }
  s.inventory = (Array.isArray(b.equipment) ? b.equipment : []).slice(0, 200).map((e: any): InventoryItem => ({ name: text(e?.[0], 120), qty: num(e?.[1], 0, 99999, 1), equipped: /invested/i.test(String(e?.[2])), note: '' })).filter((i: InventoryItem) => i.name)
  const m = b.money ?? {}
  s.currency = { cp: num(m.cp, 0, 1e7, 0), sp: num(m.sp, 0, 1e7, 0), ep: 0, gp: num(m.gp, 0, 1e7, 0), pp: num(m.pp, 0, 1e7, 0) }
  const lines: string[] = []
  for (const caster of Array.isArray(b.spellCasters) ? b.spellCasters : []) {
    for (const lv of caster.spells ?? []) if (Array.isArray(lv.list) && lv.list.length) lines.push(`${num(lv.spellLevel, 0, 10, 0) === 0 ? 'Cantrip' : `Level ${lv.spellLevel}`}: ${lv.list.map((n: unknown) => text(n, 60)).join(', ')}`)
    if (caster.magicTradition) c.tradition = text(caster.magicTradition, 20).toLowerCase()
    if (ABILITIES.includes(caster.ability)) c.spellAbility = caster.ability
  }
  s.spells = lines.join('\n').slice(0, 8000)
  return { sheet: s }
}

/** Reads a character from whatever file the person chose, and says what is wrong with it if it cannot. */
export function importCharacter(raw: unknown, ruleset: Sheet['ruleset'] = '5e'): Result & { from?: string } {
  const r = raw as any
  if (!r || typeof r !== 'object') return { error: 'That file is not a character.' }
  if (r.format === CHARACTER_FORMAT && r.sheet && typeof r.sheet === 'object') return { sheet: { ...(r.sheet as Sheet), kind: 'character' }, from: 'Chronicle' }
  if (r.system?.abilities) return { ...fromFoundry(r, ruleset), from: 'Foundry' }
  if (Array.isArray(r.data?.stats) || Array.isArray(r.stats)) return { ...fromBeyond(r, ruleset), from: 'D&D Beyond' }
  if (r.build && typeof r.build === 'object' && r.build.abilities) return { ...fromPathbuilder(r), from: 'Pathbuilder' }
  if (Array.isArray(r.attribs) || Array.isArray(r.character?.attribs)) return { ...fromRoll20(r, ruleset), from: 'Roll20' }
  return { error: 'That file is not a character this can read: Chronicle, Foundry D&D 5e, D&D Beyond, Roll20 or Pathbuilder.' }
}

/** A character as a file other people can import. */
export const exportCharacter = (sheet: Sheet) => ({ format: CHARACTER_FORMAT, v: 1, sheet })
