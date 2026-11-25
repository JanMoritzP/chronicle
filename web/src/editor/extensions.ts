import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import UniqueID from '@tiptap/extension-unique-id'
import { Placeholder } from '@tiptap/extensions'
import type { CollabProvider } from '../lib/collab'
import { Aside, Callout, Column, Columns, Fold, Toc } from './blocks'
import { BlockMove } from './blockMove'
import { FlowImage } from './ImageNode'
import { Comment } from './Comment'
import { Mentions } from './mention'
import { Embed } from './Embed'
import { SlashCommands } from './slash'
import { StatBlock } from './StatBlock'
import { Todo } from './Todo'
import { WikiLinking, Wikilink } from './wikilink'

export interface CollabOptions { provider: CollabProvider; user: { name: string; color: string } }

export function buildExtensions(opts: { readOnly?: boolean; collab?: CollabOptions } = {}) {
  const base = [
    // with a shared document the collaboration extension keeps the undo history (so undo never reverts someone else's typing)
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, ...(opts.collab ? { undoRedo: false } : {}) }),
    FlowImage,
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    // column widths can be dragged while writing; readers see the widths that were set
    TableKit.configure({ table: { resizable: !opts.readOnly } }),
    UniqueID.configure({ types: ['heading', 'todo', 'comment'], attributeName: 'id' }),
    Todo,
    Comment,
    Callout,
    Fold,
    Columns,
    Column,
    Toc,
    Aside,
    Wikilink,
    Embed,
    StatBlock,
  ]
  if (opts.readOnly) return base
  return [
    ...base,
    Placeholder.configure({ placeholder: "Write something… type {{ to link a page, / for commands, @ to leave a comment" }),
    WikiLinking,
    SlashCommands,
    Mentions,
    BlockMove,
    ...(opts.collab ? [
      Collaboration.configure({ document: opts.collab.provider.doc }),
      CollaborationCaret.configure({ provider: opts.collab.provider, user: opts.collab.user }),
    ] : []),
  ]
}
