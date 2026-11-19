// npx esbuild scripts/test-ydoc.ts --bundle --platform=node --format=esm --outfile=%TEMP%/test-ydoc.mjs ; node %TEMP%/test-ydoc.mjs
import * as Y from 'yjs'
import type { DocNode } from '../server/src/doc'
import { editTodoIn, fragmentToDoc, seedFragment } from '../server/src/ydoc'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const doc: DocNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2, id: 'h1' }, content: [{ type: 'text', text: 'Waterdeep' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The city of ' },
        { type: 'text', text: 'splendours', marks: [{ type: 'bold' }, { type: 'italic' }] },
        { type: 'text', text: ' and ', marks: [] },
        { type: 'wikilink', attrs: { name: 'Neverwinter', pageId: 'p2', alias: null } },
        { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }] },
        { type: 'todo', attrs: { id: 't1', message: 'Fill me', done: false } },
      ],
    },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
    { type: 'paragraph' },
    { type: 'statblock', attrs: { data: { name: 'Orc', hp: 15 } } },
  ],
}

const a = new Y.Doc()
seedFragment(a, doc)
const back = fragmentToDoc(a)
// null attributes are not stored, so they are absent after the trip; everything else must be identical
const norm = (n: DocNode): DocNode => {
  const out: DocNode = { ...n }
  if (n.attrs) out.attrs = Object.fromEntries(Object.entries(n.attrs).filter(([, v]) => v !== null))
  if (out.attrs && !Object.keys(out.attrs).length) delete out.attrs
  if (n.marks && !n.marks.length) delete out.marks
  if (n.content) out.content = n.content.map(norm)
  return out
}
check('JSON survives a trip through Yjs', JSON.stringify(norm(doc)) === JSON.stringify(back), JSON.stringify(back).slice(0, 300))

const b = new Y.Doc()
Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
check('a second client gets the same document', JSON.stringify(fragmentToDoc(b)) === JSON.stringify(back))

// two people typing into the same paragraph at once
const p = (d: Y.Doc) => (d.getXmlFragment('default').get(1) as Y.XmlElement).get(0) as Y.XmlText
p(a).insert(0, 'A:')
p(b).insert(p(b).length, ' B')
Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
check('concurrent edits merge to the same text on both sides', JSON.stringify(fragmentToDoc(a)) === JSON.stringify(fragmentToDoc(b)))
const text = JSON.stringify(fragmentToDoc(a))
check('both edits are present', text.includes('A:The city of') && text.includes(' B'))

check('todo can be toggled in the live document', editTodoIn(a, 't1', { done: true }) && JSON.stringify(fragmentToDoc(a)).includes('"done":true'))
check('todo can be removed', editTodoIn(a, 't1', null) && !JSON.stringify(fragmentToDoc(a)).includes('t1'))
check('unknown todo reports missing', !editTodoIn(a, 'nope', { done: true }))

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
