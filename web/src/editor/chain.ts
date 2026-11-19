/**
 * Emmet-style chains for the slash menu: "/h2{Hooks}+ul>li*3" becomes a heading and a three item list.
 *
 *   a>b   b inside a            a+b   b after a
 *   a*3   a three times         (a+b)*3   a group three times
 *   a{x}  text for a            $     the number of the repeat inside the text ($$ pads to two digits, \$ is a dollar sign)
 *
 * Pure functions on strings and TipTap JSON, so the grammar can be tested without an editor.
 */

export type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string }

/** A block the world adds on top of the built-in ones: a stat block or template (nodes), or a dialog such as the map pin picker (action). */
export interface ExtraTag { label: string; nodes?: () => Json[]; action?: string }
export type ChainExtras = Record<string, ExtraTag>

export type ChainResult =
  | { ok: true; nodes: Json[]; action: string | null; summary: string }
  | { ok: false; error: string; partial: boolean }

export const CHAIN_TAGS: { name: string; label: string }[] = [
  { name: 'h1', label: 'Heading 1' }, { name: 'h2', label: 'Heading 2' }, { name: 'h3', label: 'Heading 3' }, { name: 'h4', label: 'Heading 4' },
  { name: 'p', label: 'Text' }, { name: 'ul', label: 'Bullet list' }, { name: 'ol', label: 'Numbered list' }, { name: 'task', label: 'Checklist' },
  { name: 'li', label: 'List item' }, { name: 'quote', label: 'Quote' }, { name: 'code', label: 'Code block' }, { name: 'hr', label: 'Divider' },
  { name: 'table', label: 'Table, e.g. table3x4' }, { name: 'todo', label: 'Todo' },
  { name: 'callout', label: 'Note box' }, { name: 'warning', label: 'Warning box' }, { name: 'aloud', label: 'Read-aloud box' }, { name: 'secret', label: 'Secret box (closed in shared pages)' },
  { name: 'fold', label: 'Collapsible section, e.g. fold{Title}' }, { name: 'cols', label: 'Columns, e.g. cols3' }, { name: 'col', label: 'Column' },
  { name: 'toc', label: 'Table of contents' }, { name: 'date', label: 'The date today' }, { name: 'roll', label: 'Roll table, e.g. roll20' },
]

/** Ready-made structures. They sit below the world's own templates, so a template with the same name wins. */
export const PRESETS: Record<string, { label: string; sub: string; chain: string }> = {
  npc: { label: 'NPC sheet', sub: 'Name, look, voice, goal and a secret', chain: 'h2{Name}+(ul>li{Race and class}+li{Look}+li{Voice and manner}+li{Wants})+h3{Secrets}+secret>p' },
  place: { label: 'Place', sub: 'Name, sights, people and a secret', chain: 'h2{Name}+h3{Sights and sounds}+p+h3{Who is here}+(ul>li*3)+h3{Secrets}+secret>p' },
  encounter: { label: 'Encounter', sub: 'Setting, foes, terrain, loot and outcome', chain: 'h2{Encounter}+p{Where and why}+(ul>li{Foes}+li{Terrain and hazards}+li{Treasure})+h3{Outcome}+p' },
}
CHAIN_TAGS.push(...Object.entries(PRESETS).map(([name, p]) => ({ name, label: p.label })))

const ALIASES: Record<string, string> = { text: 'p', bullet: 'ul', number: 'ol', checklist: 'task', divider: 'hr', img: 'image', blockquote: 'quote', warn: 'warning', note: 'callout', info: 'callout', columns: 'cols' }
const CALLOUTS: Record<string, string> = { callout: 'info', warning: 'warning', aloud: 'aloud', secret: 'secret' }
const DICE = [4, 6, 8, 10, 12, 20]
const LISTS = { ul: ['bulletList', 'listItem'], ol: ['orderedList', 'listItem'], task: ['taskList', 'taskItem'] } as const
type ListTag = keyof typeof LISTS
type Parent = ListTag | 'cols' | null
const isList = (n: string): n is ListTag => n in LISTS

const MAX_REPEAT = 50
const MAX_BLOCKS = 300
const MAX_TABLE = 20

class ChainError extends Error {
  constructor(message: string, readonly partial = false, readonly unknown?: string) { super(message) }
}
function fail(message: string, partial = false): never { throw new ChainError(message, partial) }

type El = { kind: 'el'; name: string; text: string | null; count: number; children: Item[] }
type Group = { kind: 'group'; count: number; items: Item[] }
type Item = El | Group

const NAME = /[\p{L}\p{N}-]/u

function parse(src: string): Item[] {
  let i = 0
  const atEnd = () => i >= src.length

  function sibs(): Item[] {
    const out = [item()]
    while (src[i] === '+') { i++; out.push(item()) }
    return out
  }

  function item(): Item {
    if (atEnd()) fail('Keep typing: a block name comes next.', true)
    let node: Item
    if (src[i] === '(') {
      i++
      const items = sibs()
      if (src[i] !== ')') return fail(atEnd() ? 'Close the group with )' : `Unexpected "${src[i]}"`, atEnd())
      i++
      node = { kind: 'group', count: 1, items }
    } else {
      const start = i
      while (!atEnd() && NAME.test(src[i])) i++
      if (i === start) return fail(`Unexpected "${src[i]}"`)
      node = { kind: 'el', name: src.slice(start, i).toLowerCase(), text: null, count: 1, children: [] }
    }
    while (!atEnd() && (src[i] === '{' || src[i] === '*')) {
      if (src[i] === '{') {
        if (node.kind !== 'el') return fail('Text goes on a block, not on a group.')
        if (node.text !== null) return fail('A block takes one {text}.')
        let j = i + 1
        let text = ''
        while (j < src.length && src[j] !== '}') {
          if (src[j] === '\\' && j + 1 < src.length) { text += src[j] + src[j + 1]; j += 2 } else text += src[j++]
        }
        if (j >= src.length) return fail('Close the text with }', true)
        node.text = text
        i = j + 1
      } else {
        i++
        const s = i
        while (!atEnd() && /\d/.test(src[i])) i++
        if (i === s) return fail(atEnd() ? 'Keep typing: how many?' : 'A number goes after *', atEnd())
        node.count = Number(src.slice(s, i))
        if (node.count < 1 || node.count > MAX_REPEAT) return fail(`Repeat between 1 and ${MAX_REPEAT} times.`)
      }
    }
    if (src[i] === '>') {
      if (node.kind !== 'el') return fail('Nest inside a block, not a group.')
      i++
      node.children = sibs()
    }
    return node
  }

  const items = sibs()
  if (!atEnd()) fail(`Unexpected "${src[i]}"`)
  return items
}

function subst(raw: string, n: number): string {
  let out = ''
  for (let i = 0; i < raw.length;) {
    const c = raw[i]
    if (c === '\\' && i + 1 < raw.length) { out += raw[i + 1]; i += 2 }
    else if (c === '$') {
      let j = i
      while (raw[j] === '$') j++
      out += String(n).padStart(j - i, '0')
      i = j
    } else { out += c; i++ }
  }
  return out
}

const para = (text: string | null): Json => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })

/** List items must start with a paragraph, so one is added in front of a nested list or other block. */
function listItem(type: string, blocks: Json[]): Json {
  return { type, ...(type === 'taskItem' ? { attrs: { checked: false } } : {}), content: blocks[0]?.type === 'paragraph' ? blocks : [para(null), ...blocks] }
}

const column = (blocks: Json[]): Json => ({ type: 'column', content: blocks.length ? blocks : [para(null)] })

/** A random table: one row per face of the die, ready to be filled in. */
function rollTable(die: number): Json {
  const row = (cell: string, a: string, b: string): Json => ({ type: 'tableRow', content: [a, b].map((t) => ({ type: cell, content: [para(t)] })) })
  return { type: 'table', content: [row('tableHeader', `d${die}`, 'Result'), ...Array.from({ length: die }, (_, i) => row('tableCell', String(i + 1), ''))] }
}

function table(rows: number, cols: number): Json {
  const row = (cell: string): Json => ({ type: 'tableRow', content: Array.from({ length: cols }, () => ({ type: cell, content: [para(null)] })) })
  return { type: 'table', content: [row('tableHeader'), ...Array.from({ length: rows - 1 }, () => row('tableCell'))] }
}

interface Ctx { left: number; extras: ChainExtras; action: string | null }

function expandItems(items: Item[], parent: Parent, n: number, ctx: Ctx, top: boolean): Json[] {
  const out: Json[] = []
  items.forEach((it, idx) => {
    for (let k = 1; k <= it.count; k++) {
      const num = it.count > 1 ? k : n
      if (it.kind === 'group') out.push(...expandItems(it.items, parent, num, ctx, false))
      else out.push(...expandEl(it, parent, num, ctx, top && idx === items.length - 1 && it.count === 1))
    }
  })
  return out
}

function expandEl(el: El, parent: Parent, n: number, ctx: Ctx, mayAct: boolean): Json[] {
  if (--ctx.left < 0) fail(`That would add more than ${MAX_BLOCKS} blocks.`)
  const name = ALIASES[el.name] ?? el.name
  const text = el.text === null ? null : subst(el.text, n)
  const noText = () => { if (text !== null) fail(`${el.name} does not take {text}.`) }
  const cols = /^cols(\d+)?$/.exec(name)
  const kids = () => expandItems(el.children, isList(name) ? name : cols ? 'cols' : null, n, ctx, false)

  const h = /^h([1-4])$/.exec(name)
  if (h) return [{ type: 'heading', attrs: { level: Number(h[1]) }, ...(text ? { content: [{ type: 'text', text }] } : {}) }, ...kids()]
  const t = /^table(?:(\d+)(?:x(\d+))?)?$/.exec(name)
  if (t) {
    noText()
    const rows = Number(t[1] ?? 3), cols = Number(t[2] ?? t[1] ?? 3)
    if (rows < 1 || cols < 1 || rows > MAX_TABLE || cols > MAX_TABLE) fail(`A table has 1 to ${MAX_TABLE} rows and columns.`)
    return [table(rows, cols), ...kids()]
  }
  const roll = /^roll(\d+)?$/.exec(name)
  if (roll) {
    noText()
    const die = Number(roll[1] ?? 6)
    if (!DICE.includes(die)) fail(`There is no d${die}. Use ${DICE.map((d) => `d${d}`).join(', ')}.`)
    return [rollTable(die), ...kids()]
  }
  if (cols) {
    noText()
    let list = kids().map((k) => (k.type === 'column' ? k : column([k])))
    if (cols[1]) {
      if (list.length) fail('Write cols3 or cols>col*3, not both.')
      list = Array.from({ length: Number(cols[1]) }, () => column([]))
    }
    if (!list.length) list = [column([]), column([])]
    if (list.length < 2 || list.length > 4) fail('A set of columns has 2 to 4 columns.')
    return [{ type: 'columns', content: list }]
  }
  if (name in CALLOUTS) {
    const blocks = [...(text !== null ? [para(text)] : []), ...kids()]
    return [{ type: 'callout', attrs: { kind: CALLOUTS[name] }, content: blocks.length ? blocks : [para(null)] }]
  }
  if (isList(name)) {
    noText()
    const [list, itemType] = LISTS[name]
    const content = kids().map((k) => (k.type === itemType ? k : listItem(itemType, [k])))
    return [{ type: list, content: content.length ? content : [listItem(itemType, [])] }]
  }
  switch (name) {
    case 'p': return [para(text), ...kids()]
    case 'col':
      if (parent !== 'cols') fail('col goes inside columns: cols>col*2')
      return [column([...(text !== null ? [para(text)] : []), ...kids()])]
    case 'fold': {
      const blocks = kids()
      return [{ type: 'fold', attrs: { title: text ?? '' }, content: blocks.length ? blocks : [para(null)] }]
    }
    case 'toc': noText(); return [{ type: 'toc' }, ...kids()]
    case 'date': noText(); return [para(new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })), ...kids()]
    case 'li':
      if (!parent || parent === 'cols') fail('li goes inside a list: ul>li*3')
      return [listItem(parent === 'task' ? 'taskItem' : 'listItem', [...(text !== null ? [para(text)] : []), ...kids()])]
    case 'quote': {
      const blocks = [...(text !== null ? [para(text)] : []), ...kids()]
      return [{ type: 'blockquote', content: blocks.length ? blocks : [para(null)] }]
    }
    case 'code': return [{ type: 'codeBlock', ...(text ? { content: [{ type: 'text', text }] } : {}) }, ...kids()]
    case 'hr': noText(); return [{ type: 'horizontalRule' }, ...kids()]
    case 'todo': return [{ type: 'paragraph', content: [{ type: 'todo', attrs: { message: text ?? '', done: false } }] }, ...kids()]
  }
  const extra = ctx.extras[name] ?? ctx.extras[el.name]
  if (!extra) {
    const preset = PRESETS[name]
    if (!preset) throw new ChainError(`There is no block called "${el.name}".`, false, el.name)
    noText()
    return [...expandItems(parse(preset.chain), null, n, ctx, false), ...kids()]
  }
  noText()
  if (extra.action) {
    if (!mayAct || el.children.length) fail(`${el.name} opens a dialog, so it has to come last in the chain.`)
    ctx.action = extra.action
    return []
  }
  return [...structuredClone(extra.nodes?.() ?? []), ...kids()]
}

const PLURAL = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

function label(n: Json): string {
  const items = n.content?.length ?? 0
  switch (n.type) {
    case 'heading': return `Heading ${n.attrs?.level}`
    case 'paragraph': return n.content?.[0]?.type === 'todo' ? 'Todo' : 'Text'
    case 'bulletList': return `Bullet list (${PLURAL(items, 'item')})`
    case 'orderedList': return `Numbered list (${PLURAL(items, 'item')})`
    case 'taskList': return `Checklist (${PLURAL(items, 'item')})`
    case 'blockquote': return 'Quote'
    case 'callout': return ({ info: 'Note box', warning: 'Warning box', aloud: 'Read-aloud box', secret: 'Secret box' } as Record<string, string>)[String(n.attrs?.kind)] ?? 'Note box'
    case 'fold': return 'Collapsible section'
    case 'columns': return `Columns (${items})`
    case 'toc': return 'Table of contents'
    case 'codeBlock': return 'Code block'
    case 'horizontalRule': return 'Divider'
    case 'table': return `Table (${items} × ${n.content?.[0]?.content?.length ?? 0})`
    case 'statblock': return 'Stat block'
    default: return 'Content'
  }
}

/** "2× Heading 2, Bullet list (3 items)": what the chain will insert, in order of first appearance. */
function describe(nodes: Json[]): string {
  const counts = new Map<string, number>()
  for (const n of nodes) { const l = label(n); counts.set(l, (counts.get(l) ?? 0) + 1) }
  return [...counts].map(([l, c]) => (c > 1 ? `${c}× ${l}` : l)).join(', ')
}

/** Characters that make a slash query a chain instead of a command name. */
export const isChainSource = (q: string) => /[>+*(){}]/.test(q) || /^table\d/i.test(q)

/** The block name being typed at the end of the chain, if any, so the menu can offer to complete it. */
export function trailingToken(src: string): { token: string; start: number } | null {
  let inText = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') { i++; continue }
    if (inText) { if (c === '}') inText = false } else if (c === '{') inText = true
  }
  if (inText) return null
  let i = src.length
  while (i > 0 && NAME.test(src[i - 1])) i--
  if (i === src.length || src[i - 1] === '*') return null
  return { token: src.slice(i), start: i }
}

export function runChain(src: string, extras: ChainExtras = {}): ChainResult {
  try {
    const items = parse(src)
    const ctx: Ctx = { left: MAX_BLOCKS, extras, action: null }
    const nodes = expandItems(items, null, 1, ctx, true)
    const dialog = Object.values(extras).find((x) => x.action === ctx.action)?.label
    const summary = [describe(nodes), ctx.action ? `opens ${dialog ?? 'a dialog'}` : ''].filter(Boolean).join(', ')
    return { ok: true, nodes, action: ctx.action, summary }
  } catch (e) {
    if (!(e instanceof ChainError)) throw e
    const tok = trailingToken(src)
    // an unknown name at the very end is most likely half typed
    return { ok: false, error: e.message, partial: e.partial || (e.unknown !== undefined && tok?.token.toLowerCase() === e.unknown) }
  }
}
