import { parse as parseYaml, stringify as toYaml } from 'yaml'
import type { LibraryCategory, PageMeta, PageType } from '../types'
import { LIBRARY_CATEGORIES } from './library'
import { runChain, type Json } from '../editor/chain'

/** A field is plain text, long text, or a link to library entries (class, species, spells...) that can also point at imported pages. */
export interface FieldDef { key: string; label: string; placeholder?: string; multiline?: boolean; library?: LibraryCategory; multi?: boolean }
export type Block =
  | { type: 'image'; key: string; label?: string; shape: 'square' | 'circle' | 'wide' | 'tall' }
  | { type: 'statblock'; key: string; template: string }
  | { type: 'fields'; title?: string; fields: FieldDef[] }
  | { type: 'body' }

export interface Layout {
  columns: 'single' | 'side-right' | 'side-left'
  /** width of the side column in px */
  sideWidth: number
  /** columns: the text stays in its own column beside the side; wrap: the text runs on underneath the side once it ends */
  flow: 'columns' | 'wrap'
  /** columns flow only: the side stays in view while a long text scrolls past */
  sticky: boolean
  /** new pages get the top and side zones as boxes in their text, which can be moved, floated and resized; pages without the box keep the fixed zones */
  inText: boolean
  top: Block[]
  side: Block[]
  main: Block[]
  bottom: Block[]
}

export interface ResolvedType {
  id: string
  name: string
  icon: string
  tag: string
  builtin: boolean
  source: string
  layout: Layout
}

export const SHAPES = ['square', 'circle', 'wide', 'tall'] as const

function block(raw: any, where: string): Block {
  if (typeof raw === 'string') raw = { type: raw }
  if (!raw || typeof raw !== 'object') throw new Error(`${where}: each block must be an object like { type: image }`)
  switch (raw.type) {
    case 'body': return { type: 'body' }
    case 'image': {
      const shape = SHAPES.includes(raw.shape) ? raw.shape : 'square'
      return { type: 'image', key: String(raw.key ?? 'portrait'), label: raw.label ? String(raw.label) : undefined, shape }
    }
    case 'statblock': return { type: 'statblock', key: String(raw.key ?? 'main'), template: String(raw.template ?? '5e-monster') }
    case 'fields': {
      if (!Array.isArray(raw.fields)) throw new Error(`${where}: a "fields" block needs a fields: list`)
      const fields = raw.fields.map((f: any, i: number): FieldDef => {
        if (typeof f === 'string') return { key: f.toLowerCase().replace(/\W+/g, '_'), label: f }
        if (!f?.key) throw new Error(`${where}: field #${i + 1} has no key`)
        const library = LIBRARY_CATEGORIES.find((c) => c.id === f.library)?.id
        return { key: String(f.key), label: String(f.label ?? f.key), placeholder: f.placeholder ? String(f.placeholder) : undefined, multiline: library ? false : !!f.multiline, library, multi: library && f.multi === true ? true : undefined }
      })
      return { type: 'fields', title: raw.title ? String(raw.title) : undefined, fields }
    }
    default: throw new Error(`${where}: unknown block type "${raw.type}" (use image, statblock, fields or body)`)
  }
}

function zone(raw: any, name: string): Block[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new Error(`"${name}" must be a list of blocks`)
  return raw.map((b, i) => block(b, `${name}[${i + 1}]`))
}

/** Turns arbitrary parsed JSON/YAML into a well-formed layout; throws a readable Error when it can't. */
export function normalizeLayout(raw: any): Layout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The layout must be an object with top / side / main / bottom lists.')
  const columns = raw.columns === 'side-left' || raw.columns === 'single' ? raw.columns : 'side-right'
  const l: Layout = {
    columns,
    sideWidth: Math.min(520, Math.max(160, Number(raw.sideWidth) || 280)),
    flow: raw.flow === 'wrap' ? 'wrap' : 'columns',
    sticky: raw.sticky === true,
    inText: raw.inText === true,
    top: zone(raw.top, 'top'), side: zone(raw.side, 'side'), main: zone(raw.main, 'main'), bottom: zone(raw.bottom, 'bottom'),
  }
  const has = (b: Block[]) => b.some((x) => x.type === 'body')
  if (![l.top, l.side, l.main, l.bottom].some(has)) l.main.push({ type: 'body' })
  if (l.columns === 'single') { l.main = [...l.side, ...l.main]; l.side = []; l.flow = 'columns'; l.sticky = false }
  return l
}

/** Source may be JSON, YAML, or Markdown with YAML front matter (the part between --- lines). */
export function parseSource(source: string): Layout {
  const text = source.trim()
  if (!text) throw new Error('The definition is empty.')
  const fm = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(text)
  let data: any
  try {
    data = fm ? parseYaml(fm[1]) : text.startsWith('{') ? JSON.parse(text) : parseYaml(text)
  } catch (e: any) {
    throw new Error(`Could not read the definition: ${String(e.message ?? e).split('\n')[0]}`)
  }
  return normalizeLayout(data)
}

/** The layout as YAML: what the source tab and the database store. */
export function layoutToSource(layout: Layout): string {
  return toYaml(layout, { indent: 2 })
}

/** Every value key a layout uses: image keys, statblock keys and field keys. */
export function layoutKeys(layout: Layout): string[] {
  const out: string[] = []
  for (const zone of [layout.top, layout.side, layout.main, layout.bottom])
    for (const b of zone) {
      if (b.type === 'fields') out.push(...b.fields.map((f) => f.key))
      else if (b.type !== 'body') out.push(b.key)
    }
  return out
}

/** Keys used twice would make two controls store the same value. */
export function duplicateKeys(layout: Layout): string[] {
  const seen = new Set<string>(), dup = new Set<string>()
  for (const k of layoutKeys(layout)) { if (k && seen.has(k)) dup.add(k); seen.add(k) }
  return [...dup]
}

/** A key that is free, for new blocks and fields. */
export function freshKey(layout: Layout, base: string): string {
  const used = new Set(layoutKeys(layout))
  let k = base, n = 2
  while (used.has(k)) k = `${base}_${n++}`
  return k
}

const f = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, ...extra })

const BUILTIN_LAYOUTS: Record<string, { name: string; icon: string; tag: string; layout: any; /** a chain (see editor/chain.ts) for the text of a new page */ starter?: string }> = {
  person: {
    name: 'Person', icon: 'user', tag: 'person',
    starter: 'p+h2{Appearance}+p+h2{Personality}+p+h2{History}+p+secret',
    layout: { inText: true, columns: 'side-right', flow: 'wrap',
      side: [
        { type: 'image', key: 'portrait', shape: 'square' },
        { type: 'fields', title: 'Details', fields: [f('race', 'Race', { library: 'species' }), f('class', 'Class / Role', { library: 'class' }), f('age', 'Age'), f('alignment', 'Alignment', { library: 'alignment' }), f('affiliation', 'Affiliation'), f('home', 'Home')] },
      ],
      main: [{ type: 'body' }],
    },
  },
  // a character someone plays: the character sheet (drawn by PageView) holds the facts, so the layout is the text alone
  pc: {
    name: 'Player character', icon: 'swords', tag: 'pc',
    starter: 'h2{Backstory}+p+h2{Personality}+p+h2{Goals and bonds}+p+h2{Notes}+p',
    layout: { inText: true, columns: 'single', main: [{ type: 'body' }] },
  },
  monster: {
    name: 'Monster', icon: 'skull', tag: 'monster',
    starter: 'p+h2{Tactics}+p+h2{Lair}+p+h2{Lore}+p',
    layout: { inText: true, columns: 'side-right', sideWidth: 380, flow: 'wrap',
      side: [
        { type: 'statblock', key: 'main', template: '5e-monster' },
        { type: 'fields', title: 'Classification', fields: [f('size', 'Size', { library: 'size' }), f('creature_type', 'Type', { library: 'creaturetype' }), f('alignment', 'Alignment', { library: 'alignment' })] },
        { type: 'image', key: 'portrait', shape: 'wide' },
      ],
      main: [{ type: 'body' }],
    },
  },
  spell: {
    name: 'Spell', icon: 'wand-sparkles', tag: 'spell',
    starter: 'p',
    layout: { inText: true, columns: 'side-right', sideWidth: 380, flow: 'wrap', side: [{ type: 'statblock', key: 'main', template: '5e-spell' }], main: [{ type: 'body' }] },
  },
  item: {
    name: 'Item', icon: 'gem', tag: 'item',
    starter: 'p+h2{History}+p',
    layout: { inText: true, columns: 'side-right', sideWidth: 380, flow: 'wrap', side: [{ type: 'statblock', key: 'main', template: '5e-item' }, { type: 'image', key: 'portrait', shape: 'square' }], main: [{ type: 'body' }] },
  },
  class: {
    name: 'Class', icon: 'shield', tag: 'class',
    starter: 'p+h2{Features}+p',
    layout: { inText: true, columns: 'side-right', flow: 'wrap',
      side: [{ type: 'fields', title: 'Class', fields: [f('hit_die', 'Hit die'), f('saves', 'Saving throws', { library: 'ability', multi: true }), f('primary', 'Primary ability', { library: 'ability', multi: true }), f('subclass_of', 'Subclass of', { library: 'class' })] }],
      main: [{ type: 'body' }],
    },
  },
  species: {
    name: 'Species', icon: 'users', tag: 'species',
    starter: 'p+h2{Traits}+p',
    layout: { inText: true, columns: 'side-right', flow: 'wrap', side: [{ type: 'fields', title: 'Species', fields: [f('subspecies_of', 'Subspecies of', { library: 'species' })] }], main: [{ type: 'body' }] },
  },
  background: { name: 'Background', icon: 'book', tag: 'background', starter: 'p+h2{Benefits}+(ul>li*3)',
    layout: { inText: true, columns: 'single', main: [{ type: 'body' }] } },
  feat: {
    name: 'Feat', icon: 'star', tag: 'feat',
    starter: 'p',
    layout: { inText: true, columns: 'side-right', flow: 'wrap', side: [{ type: 'fields', title: 'Feat', fields: [f('kind', 'Kind'), f('prerequisite', 'Prerequisite')] }], main: [{ type: 'body' }] },
  },
  rule: {
    name: 'Rule', icon: 'scroll', tag: 'rule',
    starter: 'p',
    layout: { inText: true, columns: 'side-right', flow: 'wrap',
      side: [{ type: 'fields', title: 'Details', fields: [f('kind', 'Kind'), f('section', 'Section'), f('ability', 'Ability', { library: 'ability' }), f('script', 'Script'), f('space', 'Space'), f('hit_die', 'Hit die')] }],
      main: [{ type: 'body' }],
    },
  },
  condition: { name: 'Condition', icon: 'flame', tag: 'condition', starter: 'p+(ul>li*2)',
    layout: { inText: true, columns: 'single', main: [{ type: 'body' }] } },
  location: {
    name: 'Location', icon: 'map-pin', tag: 'location',
    starter: 'aloud+h2{Notable places}+(ul>li*3)+h2{People}+(ul>li*2)+h2{History}+p+secret',
    layout: { inText: true, columns: 'side-right', flow: 'wrap',
      top: [{ type: 'image', key: 'portrait', shape: 'wide', label: 'Banner' }],
      side: [{ type: 'fields', title: 'Overview', fields: [f('kind', 'Kind'), f('region', 'Region'), f('population', 'Population'), f('ruler', 'Ruler'), f('danger', 'Danger')] }],
      main: [{ type: 'body' }],
    },
  },
}

const STARTERS: Record<string, string | undefined> = Object.fromEntries(Object.entries(BUILTIN_LAYOUTS).map(([id, t]) => [id, t.starter]))

export const BUILTIN_TYPES: ResolvedType[] = Object.entries(BUILTIN_LAYOUTS).map(([id, t]) => ({
  id, name: t.name, icon: t.icon, tag: t.tag, builtin: true, source: toYaml(t.layout, { indent: 2 }), layout: normalizeLayout(t.layout),
}))

export const SAMPLE_SOURCE = `# Layout of a special page. JSON works too (start with { ), as does Markdown with this block as front matter.
# Zones: top (full width), side (narrow column), main (wide column), bottom (full width).
# Blocks: image, statblock, fields, body (the normal text editor).
columns: side-left        # side-left | side-right | single
sideWidth: 300            # px
flow: wrap                # columns (text stays beside the side) | wrap (text runs on underneath it)
sticky: false             # columns flow only: keep the side in view while scrolling
inText: true              # new pages show top and side as boxes in the text (move, float, resize them there)
top: []
side:
  - type: image
    key: portrait         # "portrait" is also the page's thumbnail
    shape: circle         # square | circle | wide | tall
  - type: fields
    title: Facts
    fields:
      - { key: origin, label: Origin }
      - { key: motto, label: Motto, multiline: true }
      - { key: class, label: Class, library: class }              # links to the library; library: species | class | background | feat | spell | magicitem | item | creature | condition
      - { key: spells, label: Spells, library: spell, multi: true } # multi: several entries
main:
  - type: body
bottom: []
`

export function resolveTypes(custom: PageType[] | undefined): ResolvedType[] {
  const out = [...BUILTIN_TYPES]
  for (const t of custom ?? []) {
    let layout: Layout
    try { layout = normalizeLayout(t.definition) } catch { layout = normalizeLayout({}) }
    out.push({ id: t.id, name: t.name, icon: t.icon, tag: t.tag, builtin: false, source: t.source, layout })
  }
  return out
}

export function typeOf(types: ResolvedType[], page: Pick<PageMeta, 'type'> | null | undefined): ResolvedType | null {
  return page?.type ? types.find((t) => t.id === page.type) ?? null : null
}

/** The zones that can sit in the text as a box. */
export const BOX_ZONES = ['top', 'side', 'bottom'] as const
export type BoxZone = typeof BOX_ZONES[number]

/** The box that holds a zone in the text: the side floats where the side column was, as wide as it was; top and bottom take the whole width. */
export function infoboxNode(layout: Layout, zone: BoxZone): Json {
  const float = layout.columns === 'side-left' ? 'left' : 'right'
  const size = Math.round(Math.min(60, Math.max(28, layout.sideWidth / 8.2)))
  return { type: 'infobox', attrs: zone === 'side' ? { zone, side: float, size } : { zone, side: 'full', size: 100 } }
}

/** The zones a document already shows as boxes in its text. */
export function zonesInText(doc: any): Set<BoxZone> {
  const out = new Set<BoxZone>()
  const walk = (n: any) => {
    if (n?.type === 'infobox') out.add((BOX_ZONES as readonly string[]).includes(n.attrs?.zone) ? n.attrs.zone : 'side')
    else for (const c of n?.content ?? []) walk(c)
  }
  walk(doc)
  return out
}

/** A top zone that is a single picture is drawn as the page's cover, across the whole page above the title. */
export function coverBlock(layout: Layout): Extract<Block, { type: 'image' }> | null {
  const b = layout.top.length === 1 ? layout.top[0] : null
  return b?.type === 'image' ? b : null
}

/** A new page of a type whose layout puts its zones in the text: a box for each zone that has blocks (a cover stays the cover), then the given text or the type's starter. */
export function startingDoc(type: ResolvedType, content?: any): any {
  if (!type.layout.inText) return content
  const has = zonesInText(content)
  const l = type.layout
  const boxes = (['top', 'side'] as const).filter((z) => l[z].length > 0 && !has.has(z) && !(z === 'top' && coverBlock(l))).map((z) => infoboxNode(l, z))
  const bottom = l.bottom.length > 0 && !has.has('bottom') ? [infoboxNode(l, 'bottom')] : []
  const starter = STARTERS[type.id]
  const chain = starter ? runChain(starter) : null
  const body: Json[] = content?.content?.length ? content.content : chain?.ok ? chain.nodes : [{ type: 'paragraph' }]
  return { type: 'doc', content: [...boxes, ...body, ...bottom] }
}
