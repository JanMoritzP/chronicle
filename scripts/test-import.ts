// npx esbuild scripts/test-import.ts --bundle --platform=node --format=esm --outfile=$env:TEMP\test-import.mjs "--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);"; node $env:TEMP\test-import.mjs
// The importer's pure parts: Markdown and BBCode to HTML, format detection, page planning and link resolution.
import { bbcodeToHtml } from '../web/src/lib/import/bbcode'
import { detect, pageFinder, parseCsv, plan, pmToHtml, type SourceFile } from '../web/src/lib/import/formats'
import { blocks, frontMatter, inlineTags, logseqProperties, stripComments, type InlineHooks } from '../web/src/lib/import/markdown'
import { readZip } from '../web/src/lib/import/zip'
import { deflateRawSync } from 'node:zlib'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const hooks: InlineHooks = {
  wikilink: (t, alias, anchor) => `<W t="${t}"${alias ? ` a="${alias}"` : ''}${anchor ? ` h="${anchor}"` : ''}>`,
  embed: (t, size) => `<E t="${t}"${size ? ` s="${size}"` : ''}>`,
  image: (src, alt) => `<I src="${src}" alt="${alt}">`,
  link: (href, text) => `<L href="${href}">${text}</L>`,
}
const md = (s: string) => blocks(s, hooks)

// ---------- Markdown ----------
check('headings, deeper ones kept at level 4', md('# One\n###### Six') === '<h1>One</h1><h4>Six</h4>')
check('paragraph lines keep their breaks', md('a\nb\n\nc') === '<p>a<br>b</p><p>c</p>')
check('bold, italic, strike, highlight, code', md('**b** *i* _j_ ~~s~~ ==h== `c*d`') === '<p><strong>b</strong> <em>i</em> <em>j</em> <s>s</s> <mark>h</mark> <code>c*d</code></p>')
check('snake_case words stay as they are', md('a_b_c') === '<p>a_b_c</p>')
check('HTML in the text is shown, not run', md('<script>x</script>') === '<p>&lt;script&gt;x&lt;/script&gt;</p>')
check('wikilinks with section and alias', md('[[Duke#Past|the duke]]') === '<p><W t="Duke" a="the duke" h="Past"></p>')
check('embeds with a size', md('![[map.png|300]]') === '<p><E t="map.png" s="300"></p>')
check('images and links', md('![a](pics/x.png) [t](Other.md)') === '<p><I src="pics/x.png" alt="a"> <L href="Other.md">t</L></p>')
check('bare web addresses become links', md('see https://example.com/x.') === '<p>see <a href="https://example.com/x">https://example.com/x</a>.</p>')
check('bullet lists nest by indentation', md('- a\n  - b\n- c') === '<ul><li><p>a</p><ul><li><p>b</p></li></ul></li><li><p>c</p></li></ul>')
check('numbered lists keep their start', md('3. x\n4. y') === '<ol start="3"><li><p>x</p></li><li><p>y</p></li></ol>')
check('task lists', md('- [ ] open\n- [x] done') === '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>open</p></li><li data-type="taskItem" data-checked="true"><p>done</p></li></ul>')
check('fenced code', md('```js\nlet a = 1 < 2\n```') === '<pre><code class="language-js">let a = 1 &lt; 2</code></pre>')
check('tables', md('| a | b |\n|---|:-:|\n| 1 | 2 |') === '<table><tbody><tr><th><p>a</p></th><th><p>b</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>')
check('quotes', md('> said\n> more') === '<blockquote><p>said<br>more</p></blockquote>')
check('Obsidian callouts become boxes', md('> [!warning] Careful\n> deep water') === '<div data-callout data-kind="warning"><p><strong>Careful</strong></p><p>deep water</p></div>')
check('a GM callout becomes a secret', md('> [!gm]\n> the twist').includes('data-kind="secret"'))
check('a folding callout becomes a fold', md('> [!note]- Lore\n> old').startsWith('<div data-fold data-title="Lore">'))
check('setext headings and rules', md('Title\n===\n\n---') === '<h1>Title</h1><hr>')
check('front matter is split off', frontMatter('---\ntags: [a]\n---\nbody').body === 'body' && frontMatter('---\ntags: [a]\n---\nbody').yaml === 'tags: [a]')
check('tags in the text are found, numbers are not', JSON.stringify(inlineTags('#npc and #place/city but #1 and `#code`')) === '["npc","place/city"]')
check('Obsidian comments are left out', stripComments('a %%hidden%% b') === 'a  b')
const lp = logseqProperties('title:: Real name\ntags:: npc, villain\n- block\n  id:: 64b0c1e2-0000-0000-0000-000000000000\n- ((64b0c1e2-0000-0000-0000-000000000000))')
check('Logseq page properties are read', lp.props.title === 'Real name' && lp.props.tags === 'npc, villain')
check('Logseq block ids and references are left out', !md(lp.body).includes('64b0'))

// ---------- BBCode and other documents ----------
const bb = bbcodeToHtml('[h2]Lore[/h2]\n[b]Bold[/b] and @[Varn](location:abc-1)\n\n[aloud]Hear ye[/aloud]', hooks)
check('BBCode headings, bold and mentions', bb.includes('<h2>Lore</h2>') && bb.includes('<strong>Bold</strong>') && bb.includes('<W t="Varn">'))
check('World Anvil read-aloud boxes', bb.includes('data-kind="aloud"'))
const pm = pmToHtml({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hi' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }, { type: 'mention', attrs: { label: 'Duke' } }] }] }, hooks)
check('documents from editors like ProseMirror', pm === '<h2>Hi</h2><p><strong>x</strong><W t="Duke"></p>')
check('CSV with quotes and commas', JSON.stringify(parseCsv('Name,Note\n"Smith, J","said ""hi"""\n')) === '[["Name","Note"],["Smith, J","said \\"hi\\""]]')

// ---------- detection and plans ----------
const enc = new TextEncoder()
const file = (path: string, s = ''): SourceFile => ({ path, read: async () => enc.encode(s) })
check('an Obsidian vault', detect([file('Vault/.obsidian/app.json'), file('Vault/a.md')]) === 'obsidian')
check('a Logseq graph', detect([file('g/logseq/config.edn'), file('g/pages/a.md')]) === 'logseq')
check('a Notion export', detect([file('Export/Page 0123456789abcdef0123456789abcdef.md')]) === 'notion')
check('plain Markdown', detect([file('notes/a.md'), file('notes/b.md')]) === 'markdown')
check('HTML pages', detect([file('site/a.html')]) === 'html')

const vault = [
  file('Vault/.obsidian/app.json', '{}'),
  file('Vault/People/Duke Aldric.md', '---\naliases: [The Duke]\ntags: [npc]\nfaction: Silver Hand\n---\nRules [[Varn]]. #villain'),
  file('Vault/Places/Varn.md', 'A town. ![[varn.png]]'),
  file('Vault/Places/varn.png', 'x'),
  file('Vault/notes.docx', ''),
]
const p = await plan(vault)
const duke = p.pages.find((x) => x.title === 'Duke Aldric')
check('a vault plans its pages and pictures', p.format === 'obsidian' && p.pages.length === 2 && p.pictures.size === 1)
check('folders come from the vault without its own top folder', JSON.stringify(duke?.folder) === '["People"]')
check('aliases and tags come from front matter and the text', JSON.stringify(duke?.aliases) === '["The Duke"]' && duke!.tags.includes('npc') && duke!.tags.includes('villain'))
check('Word files are listed as left out', p.skipped.some((s) => s.path.endsWith('.docx')))
const ids = new Map(p.pages.map((x, i) => [x.key, 'id' + i]))
const find = pageFinder(p.pages, ids, [{ id: 'old', title: 'Old page', aliases: [] }])
check('links find imported pages by name', find('Varn', 'Vault/People/Duke Aldric.md')?.id === ids.get('Vault/Places/Varn.md'))
check('and by alias', find('The Duke', 'Vault/Places/Varn.md')?.title === 'Duke Aldric')
check('and by relative path', find('../Places/Varn.md', 'Vault/People/Duke Aldric.md')?.title === 'Varn')
check('and pages the world already has', find('old page', 'x.md')?.id === 'old')
const html = await duke!.html({ page: (t, f) => find(t, f), picture: async () => '/api/uploads/u1' })
check('a page links to the others with their ids', html.includes('pageid="' + ids.get('Vault/Places/Varn.md') + '"'))
check('front matter that is not a name or a tag shows as a table', html.includes('<th><p>faction</p></th>'))
const varn = p.pages.find((x) => x.title === 'Varn')!
check('pictures get the address they were uploaded to', (await varn.html({ page: () => null, picture: async () => '/api/uploads/u1' })).includes('src="/api/uploads/u1"'))
check('a picture that is not in the import is dropped', !(await varn.html({ page: () => null, picture: async () => null })).includes('<img'))

const notion = await plan([
  file('Export/Campaign 0123456789abcdef0123456789abcdef.md', '# Campaign\n[Duke](Campaign%200123456789abcdef0123456789abcdef/Duke%20fedcba9876543210fedcba9876543210.md)'),
  file('Export/Campaign 0123456789abcdef0123456789abcdef/Duke fedcba9876543210fedcba9876543210.md', '# Duke\nText'),
])
check('Notion ids are taken off titles and folders', notion.pages.some((x) => x.title === 'Duke' && x.folder[0] === 'Campaign'))
const nIds = new Map(notion.pages.map((x, i) => [x.key, 'n' + i]))
const nFind = pageFinder(notion.pages, nIds, [])
const camp = notion.pages.find((x) => x.title === 'Campaign')!
const campHtml = await camp.html({ page: (t, f) => nFind(t, f), picture: async () => null })
check('Notion links between files become page links', campHtml.includes('data-wikilink') && campHtml.includes('name="Duke"'))
check('the repeated title heading is left out', !campHtml.includes('<h1>'))

const wa = await plan([file('wa/articles.json', JSON.stringify({ articles: [{ title: 'Varn', entityClass: 'Location', category: { title: 'Places' }, content: '[b]River[/b] town', sidebarcontent: 'Pop 300' }] }))])
check('a World Anvil export', wa.format === 'worldanvil' && wa.pages[0]?.title === 'Varn' && wa.pages[0].folder[0] === 'Places')
const roam = await plan([file('roam.json', JSON.stringify([{ title: 'Daily', 'create-time': 1, children: [{ string: '**hi** [[Duke]]', children: [{ string: 'nested' }] }] }]))])
check('a Roam export', roam.format === 'roam' && roam.pages[0].title === 'Daily')
check('Roam blocks become nested lists', (await roam.pages[0].html({ page: () => null, picture: async () => null })).includes('<ul><li><p><strong>hi</strong>'))

// ---------- zip ----------
function zip(entries: [string, string][]): Blob {
  const parts: Uint8Array[] = []
  const dirs: Uint8Array[] = []
  let off = 0
  for (const [name, body] of entries) {
    const n = enc.encode(name)
    const data = deflateRawSync(enc.encode(body))
    const raw = enc.encode(body).length
    const local = new Uint8Array(30 + n.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(6, 0x800, true); lv.setUint16(8, 8, true)
    lv.setUint32(18, data.length, true); lv.setUint32(22, raw, true); lv.setUint16(26, n.length, true)
    local.set(n, 30)
    const cd = new Uint8Array(46 + n.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(8, 0x800, true); cv.setUint16(10, 8, true)
    cv.setUint32(20, data.length, true); cv.setUint32(24, raw, true); cv.setUint16(28, n.length, true); cv.setUint32(42, off, true)
    cd.set(n, 46)
    parts.push(local, data)
    dirs.push(cd)
    off += local.length + data.length
  }
  const size = dirs.reduce((s, d) => s + d.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, size, true); ev.setUint32(16, off, true)
  return new Blob([...parts, ...dirs, end] as BlobPart[])
}
const z = await readZip(zip([['Vault/Über.md', 'Grüße [[Varn]]'], ['Vault/sub/', '']]))
check('a zip is read, with UTF-8 names', z.length === 1 && z[0].path === 'Vault/Über.md')
check('and its deflated files are unpacked', new TextDecoder().decode(await z[0].read()) === 'Grüße [[Varn]]')

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
