import { Extension, type Editor } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import {
  AlignLeft, CalendarDays, CheckSquare, Code, FileInput, Heading1, Heading2, Heading3, Image as ImageIcon, LayoutTemplate, List, ListOrdered, ListTodo,
  MapPin, Minus, Quote, Shield, Users, Table as TableIcon,
} from 'lucide-react'
import { createElement } from 'react'
import { fuzzy } from '../lib/fuzzy'
import { currentTemplates } from './useTemplates'
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
  { id: 'relation', label: 'Relation', sub: 'Link to a parent, spouse, sibling or custom relationship', keywords: 'family tree parent child spouse sibling rival ally', icon: Users, run: (e, r) => { e.chain().focus().deleteRange(r).run(); worldPicker.relation?.(e, r) } },
]

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

function items(editor: Editor, query: string): SuggestItem[] {
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
  return out.slice(0, 12).map(({ cmd, indices }) => ({
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
        allowedPrefixes: [' ', '\n'],
        allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
        items: ({ query }) => items(this.editor, query),
        render: suggestRender as any,
      }),
    ]
  },
})
