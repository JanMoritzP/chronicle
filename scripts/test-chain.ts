import { isChainSource, runChain, trailingToken, type ChainExtras, type Json } from '../web/src/editor/chain'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const extras: ChainExtras = {
  'stat-5e-monster': { label: 'Stat block: Monster', nodes: () => [{ type: 'statblock', attrs: { template: '5e-monster', data: {} } }] },
  'npc': { label: 'NPC', nodes: () => [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Name' }] }, { type: 'paragraph' }] },
  'pin': { label: 'Pin on map', action: 'pin' },
}
const ok = (src: string) => { const r = runChain(src, extras); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r }
const nodes = (src: string) => ok(src).nodes
const types = (ns: Json[]) => ns.map((n) => n.type).join()
const textOf = (n: Json): string => n.text ?? (n.content ?? []).map(textOf).join('')
const err = (src: string) => { const r = runChain(src, extras); return r.ok ? null : r }

// operators
let n = nodes('h2+p')
check('+ puts blocks after each other', types(n) === 'heading,paragraph' && n[0].attrs?.level === 2)
n = nodes('ul>li*3')
check('> nests and * repeats', types(n) === 'bulletList' && n[0].content!.length === 3 && n[0].content!.every((i) => i.type === 'listItem'))
check('every list item starts with a paragraph', n[0].content!.every((i) => i.content![0].type === 'paragraph'))
n = nodes('h2{Plot hooks}+ul>li{One}+li{Two}')
check('text goes into a block', textOf(n[0]) === 'Plot hooks')
check('+ inside a nest adds siblings to the inner block', n.length === 2 && n[1].content!.length === 2 && textOf(n[1].content![1]) === 'Two')
n = nodes('(h3+p)*3')
check('a group repeats', types(n) === 'heading,paragraph,heading,paragraph,heading,paragraph')
n = nodes('(h3{Day $}+p)*3')
check('$ counts the repeats', n.filter((x) => x.type === 'heading').map(textOf).join() === 'Day 1,Day 2,Day 3')
n = nodes('li*3{Item $$}'.replace('li', 'ol>li'))
check('$$ pads and the suffix order does not matter', textOf(n[0]) === 'Item 01Item 02Item 03')
check('\\$ is a dollar sign and \\} is a brace', textOf(nodes('p{Cost: \\$5 \\}}')[0]) === 'Cost: $5 }')
check('a lone $ outside a repeat is 1', textOf(nodes('p{#$}')[0]) === '#1')
n = nodes('ul>li*2>ul>li*2')
check('lists nest and the inner list gets a leading paragraph', n[0].content![0].content![0].type === 'paragraph' && n[0].content![0].content![1].type === 'bulletList')
check('the repeat of an outer item repeats everything inside', n[0].content!.length === 2 && n[0].content!.every((i) => i.content![1].content!.length === 2))

// blocks
n = nodes('h2{Hooks}>ul>li*3')
check('a leaf block hoists its children after it', types(n) === 'heading,bulletList' && textOf(n[0]) === 'Hooks')
n = nodes('table3x4')
check('table3x4 is 3 rows of 4 with a header row', n[0].content!.length === 3 && n[0].content![0].content!.length === 4 && n[0].content![0].content![0].type === 'tableHeader' && n[0].content![1].content![0].type === 'tableCell')
check('table alone is 3 by 3', nodes('table')[0].content!.length === 3 && nodes('table2')[0].content![0].content!.length === 2)
n = nodes('task>li*2')
check('a checklist makes task items', n[0].type === 'taskList' && n[0].content!.every((i) => i.type === 'taskItem' && i.attrs?.checked === false))
n = nodes('ol>p{a}+p{b}')
check('a block that is not an li is wrapped in one', n[0].content!.length === 2 && n[0].content!.every((i) => i.type === 'listItem'))
n = nodes('quote>p*2')
check('a quote holds blocks', n[0].type === 'blockquote' && n[0].content!.length === 2)
check('an empty quote still has a paragraph', nodes('quote')[0].content![0].type === 'paragraph')
check('todo carries its message', nodes('todo{Roll initiative}')[0].content![0].attrs?.message === 'Roll initiative')
check('code keeps its text', nodes('code{x = 1}')[0].content![0].text === 'x = 1')
check('aliases from the slash menu work', types(nodes('(bullet>li)+(checklist>li)+divider')) === 'bulletList,taskList,horizontalRule')
check('names are case blind', types(nodes('H2+P')) === 'heading,paragraph')

// extras
n = nodes('h2{Goblins}+stat-5e-monster')
check('a stat block can be chained', types(n) === 'heading,statblock')
check('a template can be chained and is a copy', (() => { const a = nodes('npc*2'); a[0].attrs = { changed: true }; return a.length === 4 && a[2].attrs?.level === 2 })())
let r = ok('h2{Inn}+pin')
check('a dialog at the end is reported as the action', r.action === 'pin' && types(r.nodes) === 'heading' && r.summary.includes('Pin on map'), r.summary)
check('a dialog in the middle is refused', err('pin+p')?.error.includes('last') === true)
check('a dialog cannot be repeated', err('pin*2') !== null)
check('a dialog cannot have children', err('pin>p') !== null)

// summary
check('summary counts what comes out', ok('(h3+p)*3+ul>li*2').summary === '3× Heading 3, 3× Text, Bullet list (2 items)', ok('(h3+p)*3+ul>li*2').summary)

// errors and half typed input
check('li outside a list is an error', err('li')?.error.includes('inside a list') === true)
check('text on a list is an error', err('ul{x}') !== null)
check('an unknown block is an error', err('foo')?.partial === true && err('h2+foo+p')?.partial === false)
check('a trailing operator is still typing', err('h2+')?.partial === true && err('ul>')?.partial === true && err('li*')?.partial === true)
check('an open brace or paren is still typing', err('h2{Hook')?.partial === true && err('(h2+p')?.partial === true)
check('a stray character is a real error', err('h2)')?.partial === false && err('h2 +p')?.partial === false)
check('repeat is capped', err('p*51') !== null && err('p*50') === null)
check('the whole chain is capped', err('(p*50)*50')?.error.includes('300') === true)
check('table size is capped', err('table30x2') !== null)

// recognising chains
check('plain words are not chains', !isChainSource('h2') && !isChainSource('stat') && !isChainSource(''))
check('operators and table sizes are chains', isChainSource('h2+p') && isChainSource('h2{x}') && isChainSource('table3x4') && isChainSource('ul>li*3'))
check('trailing token', trailingToken('h2+ul>li')?.token === 'li' && trailingToken('h2+ul>li')?.start === 6)
check('no token after an operator, a count or inside text', trailingToken('h2+') === null && trailingToken('li*3') === null && trailingToken('p{ab') === null && trailingToken('p{a}') === null)

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\nall passed')
