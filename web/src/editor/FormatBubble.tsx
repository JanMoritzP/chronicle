import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Bold, Code, Heading2, Heading3, Highlighter, Italic, Link, Quote, Strikethrough, Underline } from 'lucide-react'
import type { ReactNode } from 'react'
import { askText } from '../lib/dialog'

/** Formatting for selected text: shows above a selection, so nobody has to remember the keys. */
export function FormatBubble({ editor }: { editor: Editor | null }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => e ? {
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
      highlight: e.isActive('highlight'), code: e.isActive('code'), link: e.isActive('link'),
      h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }), quote: e.isActive('blockquote'),
    } : null,
  })
  if (!editor || !st) return null
  const b = (title: string, on: boolean, run: () => void, icon: ReactNode) => (
    <button type="button" className={`icon-btn${on ? ' on' : ''}`} title={title} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={run}>{icon}</button>
  )
  const chain = () => editor.chain().focus()
  const link = async () => {
    if (st.link) { chain().extendMarkRange('link').unsetLink().run(); return }
    const { from, to } = editor.state.selection
    const href = (await askText('Link to a web address', { label: 'Address', initial: 'https://', okLabel: 'Link' }))?.trim()
    if (!href || href === 'https://') return
    editor.chain().focus().setTextSelection({ from, to }).setLink({ href }).run()
  }
  return (
    <BubbleMenu editor={editor} className="format-bubble" options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor: e, state }) => e.isEditable && !state.selection.empty && state.selection instanceof TextSelection && !e.isActive('codeBlock')}>
      {b('Bold (Ctrl+B)', st.bold, () => chain().toggleBold().run(), <Bold size={15} />)}
      {b('Italic (Ctrl+I)', st.italic, () => chain().toggleItalic().run(), <Italic size={15} />)}
      {b('Underline (Ctrl+U)', st.underline, () => chain().toggleUnderline().run(), <Underline size={15} />)}
      {b('Strikethrough', st.strike, () => chain().toggleStrike().run(), <Strikethrough size={15} />)}
      {b('Highlight', st.highlight, () => chain().toggleHighlight().run(), <Highlighter size={15} />)}
      {b('Code', st.code, () => chain().toggleCode().run(), <Code size={15} />)}
      <span className="format-sep" />
      {b('Heading 2', st.h2, () => chain().toggleHeading({ level: 2 }).run(), <Heading2 size={15} />)}
      {b('Heading 3', st.h3, () => chain().toggleHeading({ level: 3 }).run(), <Heading3 size={15} />)}
      {b('Quote', st.quote, () => chain().toggleBlockquote().run(), <Quote size={15} />)}
      <span className="format-sep" />
      {b(st.link ? 'Remove link' : 'Link to a web address. Type {{ to link a page.', st.link, link, <Link size={15} />)}
    </BubbleMenu>
  )
}
