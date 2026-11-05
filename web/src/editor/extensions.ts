import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import UniqueID from '@tiptap/extension-unique-id'
import { Placeholder } from '@tiptap/extensions'
import { Embed } from './Embed'
import { SlashCommands } from './slash'
import { StatBlock } from './StatBlock'
import { Todo } from './Todo'
import { WikiLinking, Wikilink } from './wikilink'

export function buildExtensions(opts: { readOnly?: boolean } = {}) {
  const base = [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
    Image.configure({ allowBase64: false }),
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    UniqueID.configure({ types: ['heading', 'todo'], attributeName: 'id' }),
    Todo,
    Wikilink,
    Embed,
    StatBlock,
  ]
  if (opts.readOnly) return base
  return [
    ...base,
    Placeholder.configure({ placeholder: "Write something… type {{ to link a page, / for commands" }),
    WikiLinking,
    SlashCommands,
  ]
}
