import { Node, Extension, mergeAttributes, type Editor } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { FilePlus2, FileText, Hash } from 'lucide-react'
import { createElement } from 'react'
import { useStore } from '../store'
import { PageIcon } from '../components/TypeIcon'
import { findPageByName } from '../lib/data'
import { parseLinkText, resolveLink, searchPages, searchSections } from '../lib/linkSearch'
import { suggestRender, type SuggestItem } from './suggest'

export const WIKI_KEY = new PluginKey('wikiSuggest')

function openNav(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  return e.ctrlKey || e.metaKey ? { newTab: true } : e.shiftKey ? { split: true } : {}
}

function WikilinkView({ node }: NodeViewProps) {
  const pages = useStore((s) => s.data.pages)
  const { name, pageId, alias, anchor, anchorText } = node.attrs
  const page = pageId ? pages.find((p) => p.id === pageId) : findPageByName(pages, name)
  const heading = page && anchor ? page.outline.find((h) => h.id === anchor) : undefined
  const section = heading?.text ?? anchorText
  const shown = alias || `${page?.title || name}${section ? ` › ${section}` : ''}`

  const go = async (e: { preventDefault: () => void; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    e.preventDefault()
    const st = useStore.getState()
    const target = page ?? (await st.createPageFromName(name))
    if (target) st.navigate({ type: 'page', id: target.id, anchor: anchor || undefined }, openNav(e))
  }
  return (
    <NodeViewWrapper
      as="span"
      className={`wikilink ${page ? '' : 'missing'}`}
      contentEditable={false}
      data-page-id={page?.id ?? ''}
      data-anchor={anchor ?? ''}
      onClick={go}
      onAuxClick={(e: React.MouseEvent) => {
        if (e.button === 1) go({ preventDefault: () => e.preventDefault(), ctrlKey: true, metaKey: false, shiftKey: false })
      }}
    >
      {shown || 'link'}
    </NodeViewWrapper>
  )
}

export const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      name: { default: '' },
      pageId: { default: null },
      anchor: { default: null },
      anchorText: { default: null },
      alias: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-wikilink': '' }), node.attrs.alias || node.attrs.name]
  },
  addNodeView() {
    return ReactNodeViewRenderer(WikilinkView, { as: 'span' } as any)
  },
})

export function insertLink(editor: Editor, range: { from: number; to: number }, attrs: Record<string, any>) {
  editor.chain().focus().insertContentAt(range, { type: 'wikilink', attrs }).run()
}

/** Page + section suggestions for the text typed between {{ and the cursor. */
function wikiItems(editor: Editor, query: string): SuggestItem[] {
  const { name, section, alias, hasPipe } = parseLinkText(query)
  const pick = (attrs: Record<string, any>) => (range: { from: number; to: number }) => {
    insertLink(editor, range, attrs)
    if (!attrs.pageId && attrs.name) useStore.getState().createPageFromName(attrs.name)
  }
  const items: SuggestItem[] = []

  // {{Name|shown text}}: stop searching, offer one confirm entry
  if (hasPipe) {
    const r = resolveLink(name, section)
    const best = r.pageId ? null : searchPages(name, 1)[0]
    const target = best ? resolveLink(best.page.title, section) : r
    items.push({
      key: 'alias',
      group: 'Link',
      label: `${target.name}${target.anchorText ? ` › ${target.anchorText}` : ''} shown as “${alias || target.name}”`,
      icon: createElement(FileText, { size: 15 }),
      run: pick({ name: target.name, pageId: target.pageId, anchor: target.anchor, anchorText: target.anchorText, alias: alias || null }),
    })
    return items
  }

  // {{Name#Section}}: sections of one page
  if (section !== null) {
    const exact = resolveLink(name, null)
    const page = useStore.getState().data.pages.find((p) => p.id === exact.pageId) ?? searchPages(name, 1)[0]?.page
    if (page) {
      for (const h of searchSections(page, section, 14)) {
        items.push({
          key: `s:${page.id}:${h.heading.id}`,
          group: page.title || 'Untitled',
          label: h.heading.text,
          sub: `Heading ${h.heading.level}`,
          indices: h.hit.indices,
          icon: createElement(Hash, { size: 15 }),
          run: pick({ name: page.title, pageId: page.id, anchor: h.heading.id, anchorText: h.heading.text }),
        })
      }
      if (!items.length && section) {
        items.push({
          key: 'sec-text',
          group: page.title || 'Untitled',
          label: `Link to “${section}”`,
          sub: 'Section not found yet',
          icon: createElement(Hash, { size: 15 }),
          run: pick({ name: page.title, pageId: page.id, anchor: null, anchorText: section }),
        })
      }
    }
    return items
  }

  // plain query: pages first, then sections of any page matching the letters
  const hits = searchPages(name, 8)
  for (const h of hits) {
    items.push({
      key: `p:${h.page.id}`,
      group: 'Pages',
      label: h.page.title || 'Untitled',
      sub: h.via === 'alias' ? 'alias' : h.page.hasStats ? 'Has stat block' : undefined,
      indices: h.via === 'title' ? h.hit.indices : [],
      icon: createElement(PageIcon, { page: h.page, size: 15 }),
      run: pick({ name: h.page.title, pageId: h.page.id, anchor: null, anchorText: null }),
    })
  }
  if (name.length >= 2) {
    const secs: { page: any; h: any; score: number }[] = []
    for (const p of useStore.getState().data.pages) {
      for (const s of searchSections(p, name, 3)) secs.push({ page: p, h: s, score: s.hit.score })
    }
    secs.sort((a, b) => b.score - a.score)
    for (const s of secs.slice(0, 5)) {
      items.push({
        key: `s:${s.page.id}:${s.h.heading.id}`,
        group: 'Sections',
        label: s.h.heading.text,
        sub: s.page.title || 'Untitled',
        indices: s.h.hit.indices,
        icon: createElement(Hash, { size: 15 }),
        run: pick({ name: s.page.title, pageId: s.page.id, anchor: s.h.heading.id, anchorText: s.h.heading.text }),
      })
    }
  }
  const exact = hits.some((h) => h.page.title.trim().toLowerCase() === name.toLowerCase())
  if (name && !exact) {
    items.push({
      key: 'create',
      group: 'New',
      label: `Create “${name}”`,
      icon: createElement(FilePlus2, { size: 15 }),
      run: pick({ name, pageId: null, anchor: null, anchorText: null }),
    })
  }
  return items
}

/** Matches "{{text" up to the cursor on the current line. The range also swallows an auto-inserted "}}" after the cursor. */
function findWikiMatch({ $position }: { $position: any }) {
  const parent = $position.parent
  if (!parent.isTextblock) return null
  const before: string = parent.textBetween(0, $position.parentOffset, undefined, '\ufffc')
  const open = before.lastIndexOf('{{')
  if (open < 0) return null
  const typed = before.slice(open + 2)
  if (typed.includes('}}') || typed.includes('\ufffc')) return null
  const after: string = parent.textBetween($position.parentOffset, parent.content.size, undefined, '\ufffc')
  const closeLen = after.startsWith('}}') ? 2 : 0
  const start = $position.start()
  return {
    range: { from: start + open, to: $position.pos + closeLen },
    query: typed,
    text: before.slice(open) + after.slice(0, closeLen),
  }
}

// After typing "}" to close a link we consume the auto-inserted "}}"; swallow the second "}" the user types next.
let swallow: { pos: number; at: number } | null = null

export const WikiLinking = Extension.create({
  name: 'wikiLinking',
  addProseMirrorPlugins() {
    const editor = this.editor
    const suggestion = Suggestion({
      editor,
      pluginKey: WIKI_KEY,
      char: '{{',
      findSuggestionMatch: findWikiMatch as any,
      allowSpaces: true,
      items: ({ query }) => wikiItems(editor, query),
      render: suggestRender as any,
    })
    const autoClose = new Plugin({
      key: new PluginKey('wikiAutoClose'),
      props: {
        handleTextInput(view, from, to, text) {
          const { state } = view
          if (text === '{' && from === to) {
            const prev = state.doc.textBetween(Math.max(0, from - 1), from, undefined, '\ufffc')
            if (prev === '{') {
              const tr = state.tr.insertText('{}}', from, to)
              tr.setSelection(TextSelection.create(tr.doc, from + 1))
              view.dispatch(tr)
              return true
            }
          }
          if (text === '}' && from === to) {
            if (swallow && swallow.pos === from && Date.now() - swallow.at < 3000) {
              swallow = null
              return true
            }
            const $p = state.doc.resolve(from)
            const after = $p.parent.textBetween($p.parentOffset, $p.parent.content.size, undefined, '\ufffc')
            const before = $p.parent.textBetween(0, $p.parentOffset, undefined, '\ufffc')
            const open = before.lastIndexOf('{{')
            if (after.startsWith('}}') && open >= 0 && !before.slice(open + 2).includes('}}')) {
              const { name, section, alias } = parseLinkText(before.slice(open + 2))
              if (!name) return false
              const r = resolveLink(name, section)
              const start = $p.start() + open
              const node = state.schema.nodes.wikilink.create({
                name: r.name,
                pageId: r.pageId,
                anchor: r.anchor,
                anchorText: r.anchorText,
                alias: alias || null,
              })
              view.dispatch(state.tr.replaceWith(start, from + 2, node))
              swallow = { pos: start + 1, at: Date.now() }
              if (!r.pageId) useStore.getState().createPageFromName(name)
              return true
            }
          }
          return false
        },
        handleKeyDown(view, event) {
          if (event.key !== 'Backspace') return false
          const { state } = view
          const { empty, from } = state.selection
          if (!empty) return false
          const around = state.doc.textBetween(Math.max(0, from - 2), Math.min(state.doc.content.size, from + 2), undefined, '\ufffc')
          if (around === '{{}}') {
            view.dispatch(state.tr.delete(from - 2, from + 2))
            return true
          }
          return false
        },
      },
    })
    return [suggestion, autoClose]
  },
})
