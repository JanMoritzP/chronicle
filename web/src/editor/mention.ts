import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { createElement } from 'react'
import { AtSign } from 'lucide-react'
import { fuzzy } from '../lib/fuzzy'
import { worldPeople } from '../lib/people'
import { useStore } from '../store'
import { suggestRender, type SuggestItem } from './suggest'

/** Typing @ and a name leaves a comment for that person. */
export const Mentions = Extension.create({
  name: 'mentions',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('mention'),
        char: '@',
        startOfLine: false,
        // an address such as a@b.com is not a mention
        allowedPrefixes: [' ', '\n'],
        allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
        items: async ({ query }): Promise<SuggestItem[]> => {
          const st = useStore.getState()
          if (!st.wsId) return []
          const me = st.account?.username ?? st.user?.username ?? ''
          const people = await worldPeople(st.wsId)
          return people
            .map((p) => ({ p, hit: fuzzy(query, p.username) }))
            .filter((x) => x.hit)
            .sort((a, b) => b.hit!.score - a.hit!.score)
            .slice(0, 8)
            .map(({ p, hit }) => ({
              key: p.username,
              label: p.username,
              sub: p.username === me ? 'You, as a reminder' : p.role === 'viewer' ? 'Can read this world' : 'Comment for this person',
              indices: hit!.indices,
              icon: createElement(AtSign, { size: 16 }),
              run: (range) => {
                this.editor.chain().focus().deleteRange(range)
                  .insertContent([{ type: 'comment', attrs: { to: p.username, from: me, message: '', done: false } }]).run()
              },
            }))
        },
        render: suggestRender as any,
      }),
    ]
  },
})
