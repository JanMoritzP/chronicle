import { ABILITIES, emptyCharacter, type Ability, type Feature, type InventoryItem, type Proficiency, type Sheet } from './sheet'

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

/** Reads a character from whatever file the person chose, and says what is wrong with it if it cannot. */
export function importCharacter(raw: unknown, ruleset: Sheet['ruleset'] = '5e'): Result & { from?: string } {
  const r = raw as any
  if (!r || typeof r !== 'object') return { error: 'That file is not a character.' }
  if (r.format === CHARACTER_FORMAT && r.sheet && typeof r.sheet === 'object') return { sheet: { ...(r.sheet as Sheet), kind: 'character' }, from: 'Chronicle' }
  if (r.system?.abilities) return { ...fromFoundry(r, ruleset), from: 'Foundry' }
  if (Array.isArray(r.data?.stats) || Array.isArray(r.stats)) return { ...fromBeyond(r, ruleset), from: 'D&D Beyond' }
  if (Array.isArray(r.attribs) || Array.isArray(r.character?.attribs)) return { ...fromRoll20(r, ruleset), from: 'Roll20' }
  return { error: 'That file is not a character this can read: Chronicle, Foundry D&D 5e, D&D Beyond or Roll20.' }
}

/** A character as a file other people can import. */
export const exportCharacter = (sheet: Sheet) => ({ format: CHARACTER_FORMAT, v: 1, sheet })
