import { Extension, type Editor } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import {
  AlignLeft, CalendarDays, CheckSquare, Code, FileInput, Heading1, Heading2, Heading3, Image as ImageIcon, LayoutTemplate, List, ListOrdered, ListTodo,
  BookOpen, CalendarClock, CircleHelp, ChevronsRight, ChevronsUpDown, Columns2, Dices, Info, Landmark, ListTree, Lock, MapPin, Swords, TriangleAlert, User, Minus, Quote, Shield, Sparkles, Users, Table as TableIcon,
} from 'lucide-react'
import { createElement } from 'react'
import { fuzzy } from '../lib/fuzzy'
import { currentTemplates } from './useTemplates'
import { CHAIN_TAGS, PRESETS, isChainSource, runChain, trailingToken, type ChainExtras } from './chain'
import { suggestRender, type SuggestItem } from './suggest'
import { useStore } from '../store'

interface Cmd {
  id: string
  label: string
  sub: string
  keywords?: string
  icon: any
  run: (editor: Editor, range: { from: number; to: number }) => void
}

/** Opens a file picker and uploads the chosen image; wired up by the page component. */
export const imagePicker: { pick: ((editor: Editor) => void) | null } = { pick: null }
/** Opens the page picker for /embed; wired up by the page component. */
export const embedPicker: { pick: ((editor: Editor, range: { from: number; to: number }) => void) | null } = { pick: null }

/** /pin and /teven open dialogs owned by the page component. */
export const worldPicker: { pin: ((editor: Editor, range: { from: number; to: number }) => void) | null; event: ((editor: Editor, range: { from: number; to: number }) => void) | null; relation: ((editor: Editor, range: { from: number; to: number }) => void) | null } = { pin: null, event: null, relation: null }

/** Menu commands that insert exactly what the same name inserts in a chain. */
const viaChain = (src: string) => (e: Editor, r: { from: number; to: number }) => {
  const res = runChain(src)
  if (res.ok) e.chain().focus().deleteRange(r).insertContent(res.nodes).run()
}
const PRESET_ICONS: Record<string, any> = { npc: User, place: Landmark, encounter: Swords }

const COMMANDS: Cmd[] = [
  { id: 'h1', label: 'Heading 1', sub: 'Large section heading', keywords: 'title', icon: Heading1, run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run() },
  { id: 'h2', label: 'Heading 2', sub: 'Medium section heading', icon: Heading2, run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
  { id: 'h3', label: 'Heading 3', sub: 'Small section heading', icon: Heading3, run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run() },
  { id: 'text', label: 'Text', sub: 'Plain paragraph', icon: AlignLeft, run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { id: 'bullet', label: 'Bullet list', sub: 'Unordered list', keywords: 'ul', icon: List, run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { id: 'number', label: 'Numbered list', sub: 'Ordered list', keywords: 'ol', icon: ListOrdered, run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { id: 'todo', label: 'Todo', sub: 'Leave a marker with a note; all todos are collected in the Todos tab', keywords: 'task fixme remember later open', icon: ListTodo, run: (e, r) => e.chain().focus().deleteRange(r).insertContent([{ type: 'todo', attrs: { message: '', done: false } }]).run() },
  { id: 'checklist', label: 'Checklist', sub: 'Checkboxes inside the text', keywords: 'task check list', icon: CheckSquare, run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { id: 'quote', label: 'Quote', sub: 'Highlighted block', keywords: 'callout', icon: Quote, run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { id: 'code', label: 'Code block', sub: 'Monospace', icon: Code, run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { id: 'divider', label: 'Divider', sub: 'Horizontal rule', keywords: 'hr line', icon: Minus, run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { id: 'table', label: 'Table', sub: '3 × 3 table', icon: TableIcon, run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: 'image', label: 'Image', sub: 'Upload from your device', keywords: 'picture photo portrait', icon: ImageIcon, run: (e, r) => { e.chain().focus().deleteRange(r).run(); imagePicker.pick?.(e) } },
  { id: 'embed', label: 'Embed page', sub: 'Show another page or section here', keywords: 'transclude include', icon: FileInput, run: (e, r) => embedPicker.pick?.(e, r) },
  { id: 'pin', label: 'Pin on map', sub: 'Mark where this page is on a map', keywords: 'map marker location place', icon: MapPin, run: (e, r) => { e.chain().focus().deleteRange(r).run(); worldPicker.pin?.(e, r) } },
  { id: 'teven', label: 'Timeline event', sub: 'Give this page a date on the timeline', keywords: 'date calendar time when', icon: CalendarDays, run: (e, r) => { e.chain().focus().deleteRange(r).run(); worldPicker.event?.(e, r) } },
  { id: 'chain', label: 'Chain blocks', sub: 'Combine blocks in one go, e.g. h2{Hooks}+ul>li*3', keywords: 'emmet abbreviation combine nest repeat', icon: Sparkles, run: (e, r) => { e.chain().focus().insertContentAt(r.to, 'h2{Title}+ul>li*3').run() } },
  { id: 'callout', label: 'Note box', sub: 'Highlighted box for a note', keywords: 'callout info highlight', icon: Info, run: viaChain('callout') },
  { id: 'warning', label: 'Warning box', sub: 'Highlighted box for a danger or a rule to remember', keywords: 'callout caution danger', icon: TriangleAlert, run: viaChain('warning') },
  { id: 'aloud', label: 'Read-aloud box', sub: 'Text to read to the players', keywords: 'callout boxed text describe narration', icon: BookOpen, run: viaChain('aloud') },
  { id: 'secret', label: 'Secret', sub: 'Only you see it: shared pages keep it closed', keywords: 'callout gm hidden private spoiler', icon: Lock, run: viaChain('secret') },
  { id: 'fold', label: 'Collapsible section', sub: 'A titled section that can be closed', keywords: 'toggle accordion details spoiler', icon: ChevronsUpDown, run: viaChain('fold') },
  { id: 'columns', label: 'Columns', sub: 'Two columns side by side (cols3 for three)', keywords: 'layout side', icon: Columns2, run: viaChain('cols') },
  { id: 'toc', label: 'Table of contents', sub: 'Links to the headings of this page', keywords: 'outline contents headings', icon: ListTree, run: viaChain('toc') },
  { id: 'date', label: 'Date today', sub: 'The real date, e.g. for session notes', keywords: 'day time now', icon: CalendarClock, run: viaChain('date') },
  { id: 'roll', label: 'Roll table', sub: 'A d6 table to fill in (roll20 for a d20)', keywords: 'random dice table', icon: Dices, run: viaChain('roll') },
  ...Object.entries(PRESETS).map<Cmd>(([id, p]) => ({ id, label: p.label, sub: p.sub, keywords: 'preset starter structure', icon: PRESET_ICONS[id], run: viaChain(id) })),
  { id: 'relation', label: 'Relation', sub: 'Link to a parent, spouse, sibling or custom relationship', keywords: 'family tree parent child spouse sibling rival ally', icon: Users, run: (e, r) => { e.chain().focus().deleteRange(r).run(); worldPicker.relation?.(e, r) } },
  { id: 'help', label: 'Manual', sub: 'All commands, chains and shortcuts', keywords: 'help guide commands syntax how', icon: CircleHelp, run: (e, r) => { e.chain().focus().deleteRange(r).run(); useStore.getState().navigate({ type: 'manual' }) } },
]

/** The built-in commands for the manual, in menu order. */
export const COMMAND_LIST = COMMANDS.filter((c) => c.id !== 'help').map((c) => ({ id: c.id, label: c.label, sub: c.sub }))

function statCommands(): Cmd[] {
  return currentTemplates().map<Cmd>((t) => ({
    id: `stat-${t.id}`,
    label: `Stat block: ${t.name}`,
    sub: t.builtin ? 'Structured stats, shown in hover previews' : 'Your own stat block form',
    keywords: 'stats statblock monster character npc custom form',
    icon: Shield,
    run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'statblock', attrs: { template: t.id, data: {} } }).run(),
  }))
}

/** The world's own templates, inserted as ordinary content at the cursor. They come first so "/name" wins ties against built-in commands. */
function templateCommands(): Cmd[] {
  return (useStore.getState().data.templates ?? []).map<Cmd>((t) => ({
    id: t.slug,
    label: t.name,
    sub: t.description || 'Template',
    keywords: 'template',
    icon: LayoutTemplate,
    run: (e, r) => e.chain().focus().deleteRange(r).insertContent(structuredClone(t.content?.content ?? [])).run(),
  }))
}

/** Dialog commands (image, embed, pin...) may end a chain; the dialog opens once the rest is inserted. */
const ACTION_IDS = ['image', 'embed', 'pin', 'teven', 'relation']

function chainExtras(): ChainExtras {
  const out: ChainExtras = {}
  for (const t of useStore.getState().data.templates ?? []) out[t.slug] = { label: t.name, nodes: () => structuredClone(t.content?.content ?? []) }
  for (const t of currentTemplates()) out[`stat-${t.id}`] = { label: `Stat block: ${t.name}`, nodes: () => [{ type: 'statblock', attrs: { template: t.id, data: {} } }] }
  for (const id of ACTION_IDS) {
    const c = COMMANDS.find((x) => x.id === id)
    if (c) out[id] = { label: c.label, action: id }
  }
  return out
}

function chainItems(editor: Editor, query: string): SuggestItem[] {
  const extras = chainExtras()
  const res = runChain(query, extras)
  const out: SuggestItem[] = []
  if (res.ok) {
    out.push({
      key: 'chain', label: query, sub: res.summary || 'Nothing to insert', icon: createElement(Sparkles, { size: 16 }),
      run: (range) => {
        editor.chain().focus().deleteRange(range).insertContent(res.nodes).run()
        const act = res.action && COMMANDS.find((c) => c.id === res.action)
        const at = editor.state.selection.from
        if (act) act.run(editor, { from: at, to: at })
      },
    })
  } else {
    out.push({ key: 'chain-error', label: query, sub: res.error, icon: createElement(Sparkles, { size: 16 }), disabled: true, typing: res.partial, run: () => {} })
  }
  // finish the block name being typed: "ul>l" offers li
  const tok = trailingToken(query)
  if (tok) {
    const lower = tok.token.toLowerCase()
    const names = [...new Map([...CHAIN_TAGS, ...Object.entries(extras).map(([name, e]) => ({ name, label: e.label }))].map((t) => [t.name, t])).values()]
    for (const t of names.filter((n) => n.name.startsWith(lower) && n.name !== lower).slice(0, 6)) {
      out.push({
        key: `chain-${t.name}`, label: query.slice(0, tok.start) + t.name, sub: t.label, icon: createElement(ChevronsRight, { size: 16 }),
        run: (range) => { editor.chain().focus().insertContentAt({ from: range.to - tok.token.length, to: range.to }, t.name).run() },
      })
    }
  }
  return out
}

function items(editor: Editor, query: string): SuggestItem[] {
  if (isChainSource(query)) return chainItems(editor, query)
  if (/\s/.test(query)) return []
  const out: { cmd: Cmd; score: number; indices: number[] }[] = []
  const all = [...templateCommands(), ...COMMANDS, ...statCommands()]
  for (const [order, cmd] of all.entries()) {
    const hit = fuzzy(query, cmd.label)
    const kw = query && cmd.keywords ? fuzzy(query, cmd.keywords) : null
    const idHit = query ? fuzzy(query, cmd.id) : null
    const best = [hit, idHit, kw].filter(Boolean).sort((a, b) => b!.score - a!.score)[0]
    // small bonus for list order so ties (e.g. "/stat") keep the declared order instead of favouring short labels
    if (best) out.push({ cmd, score: best.score + (best === idHit ? 20 : 0) + (all.length - order) * 2, indices: best === hit ? hit!.indices : [] })
  }
  out.sort((a, b) => b.score - a.score)
  // a bare "/" lists everything in declared order; the popup scrolls
  return (query ? out.slice(0, 12) : out).map(({ cmd, indices }) => ({
    key: cmd.id,
    label: cmd.label,
    sub: cmd.sub,
    indices,
    icon: createElement(cmd.icon, { size: 16 }),
    run: (range) => cmd.run(editor, range),
  }))
}

export const SlashCommands = Extension.create({
  name: 'slashCommands',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('slash'),
        char: '/',
        startOfLine: false,
        // a chain may hold spaces inside {text}; items() returns nothing for any other query with a space
        allowSpaces: true,
        allowedPrefixes: [' ', '\n'],
        allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
        items: ({ query }) => items(this.editor, query),
        render: suggestRender as any,
      }),
    ]
  },
})
