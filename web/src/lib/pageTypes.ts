import { parse as parseYaml, stringify as toYaml } from 'yaml'
import type { PageMeta, PageType } from '../types'

export interface FieldDef { key: string; label: string; placeholder?: string; multiline?: boolean }
export type Block =
  | { type: 'image'; key: string; label?: string; shape: 'square' | 'circle' | 'wide' | 'tall' }
  | { type: 'statblock'; key: string; template: string }
  | { type: 'fields'; title?: string; fields: FieldDef[] }
  | { type: 'body' }

export interface Layout {
  columns: 'single' | 'side-right' | 'side-left'
  /** width of the side column in px */
  sideWidth: number
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
        return { key: String(f.key), label: String(f.label ?? f.key), placeholder: f.placeholder ? String(f.placeholder) : undefined, multiline: !!f.multiline }
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
    top: zone(raw.top, 'top'), side: zone(raw.side, 'side'), main: zone(raw.main, 'main'), bottom: zone(raw.bottom, 'bottom'),
  }
  const has = (b: Block[]) => b.some((x) => x.type === 'body')
  if (![l.top, l.side, l.main, l.bottom].some(has)) l.main.push({ type: 'body' })
  if (l.columns === 'single') { l.main = [...l.side, ...l.main]; l.side = [] }
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

const BUILTIN_LAYOUTS: Record<string, { name: string; icon: string; tag: string; layout: any }> = {
  person: {
    name: 'Person', icon: 'user', tag: 'person',
    layout: {
      columns: 'side-right',
      side: [
        { type: 'image', key: 'portrait', shape: 'square' },
        { type: 'fields', title: 'Details', fields: [f('race', 'Race'), f('class', 'Class / Role'), f('age', 'Age'), f('alignment', 'Alignment'), f('affiliation', 'Affiliation'), f('home', 'Home')] },
      ],
      main: [{ type: 'body' }],
    },
  },
  monster: {
    name: 'Monster', icon: 'skull', tag: 'monster',
    layout: {
      columns: 'side-right', sideWidth: 380,
      side: [{ type: 'statblock', key: 'main', template: '5e-monster' }, { type: 'image', key: 'portrait', shape: 'wide' }],
      main: [{ type: 'body' }],
    },
  },
  location: {
    name: 'Location', icon: 'map-pin', tag: 'location',
    layout: {
      columns: 'side-right',
      top: [{ type: 'image', key: 'portrait', shape: 'wide', label: 'Banner' }],
      side: [{ type: 'fields', title: 'Overview', fields: [f('kind', 'Kind'), f('region', 'Region'), f('population', 'Population'), f('ruler', 'Ruler'), f('danger', 'Danger')] }],
      main: [{ type: 'body' }],
    },
  },
}

export const BUILTIN_TYPES: ResolvedType[] = Object.entries(BUILTIN_LAYOUTS).map(([id, t]) => ({
  id, name: t.name, icon: t.icon, tag: t.tag, builtin: true, source: toYaml(t.layout, { indent: 2 }), layout: normalizeLayout(t.layout),
}))

export const SAMPLE_SOURCE = `# Layout of a special page. JSON works too (start with { ), as does Markdown with this block as front matter.
# Zones: top (full width), side (narrow column), main (wide column), bottom (full width).
# Blocks: image, statblock, fields, body (the normal text editor).
columns: side-left        # side-left | side-right | single
sideWidth: 300            # px
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
