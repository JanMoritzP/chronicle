// node scripts/smoke-library.mjs http://localhost:3222 gm testpass123
// Downloads the real Open5e library into the throwaway server (about a minute), so it needs internet.
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let cookie = ''
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })
cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''

let r = await call('GET', '/api/library/status')
check('status works before any download', r.status === 200 && typeof r.data.count === 'number', JSON.stringify(r.data))
const wasEmpty = r.data.count === 0

r = await call('POST', '/api/library/refresh')
check('refresh starts', r.status === 200 && r.data.running === true)
const started = Date.now()
for (;;) {
  await new Promise((res) => setTimeout(res, 3000))
  r = await call('GET', '/api/library/status')
  if (!r.data.running || Date.now() - started > 240_000) break
}
check('download finished without error', !r.data.running && !r.data.error, r.data.error ?? '')
const status = r.data
check('every category has entries', ['creature', 'magicitem', 'item', 'spell', 'class', 'species', 'background', 'feat', 'condition'].every((c) => status.byCategory[c] > 0), JSON.stringify(status.byCategory))

r = await call('GET', '/api/library/index')
const idx = r.data
check('index has rows and sources', r.status === 200 && idx.rows.length === status.count && Object.keys(idx.sources).length > 5)
const goblins = idx.rows.filter((x) => x[1] === 'creature' && x[2].toLowerCase() === 'goblin')
check('one Goblin only, from the 5e 2014 SRD', goblins.length === 1 && goblins[0][3] === 'srd-2014', JSON.stringify(goblins))
const names = idx.rows.map((x) => x[1] + ':' + x[2].toLowerCase().replace(/[^a-z0-9]/g, ''))
check('no duplicate names within a category (parents aside)', new Set(idx.rows.filter((x) => x[1] !== 'class' && x[1] !== 'species').map((x) => x[1] + ':' + x[2].toLowerCase().replace(/[^a-z0-9]/g, ''))).size === idx.rows.filter((x) => x[1] !== 'class' && x[1] !== 'species').length, names.length + ' rows')

r = await call('GET', '/api/library/entries/' + encodeURIComponent(goblins[0][0]))
check('creature entry has full data', r.status === 200 && r.data.data.armor_class > 0 && Array.isArray(r.data.data.actions) && r.data.sourceName, r.data.sourceName)
const camels = idx.rows.filter((x) => x[2] === 'Camel' && x[3] === 'srd-2024').map((x) => x[1]).sort().join()
check('same API key in two categories stays two entries', camels === 'creature,item', camels)
r = await call('GET', '/api/library/entries/nope-not-there')
check('missing entry is 404', r.status === 404)
r = await call('GET', '/api/library/entries/' + encodeURIComponent('../etc/passwd'))
check('bad key is rejected', r.status === 400 || r.status === 404)

// A second refresh changes nothing, so the log gets no new lines
const second = await call('POST', '/api/library/refresh')
check('second refresh starts', second.status === 200)
for (;;) { await new Promise((res) => setTimeout(res, 3000)); r = await call('GET', '/api/library/status'); if (!r.data.running) break }
check('second refresh keeps the same count', r.data.count === status.count && !r.data.error)

// ---- links from pages into the library ----
const key = goblins[0][0]
const fire = idx.rows.find((x) => x[2] === 'Fireball' && x[1] === 'spell')[0]
const ws = (await call('POST', '/api/workspaces', { name: 'lib-links-' + Math.floor(Math.random() * 1e6) })).data.id
const ws2 = (await call('POST', '/api/workspaces', { name: 'lib-other-' + Math.floor(Math.random() * 1e6) })).data.id
const link = (attrs) => ({ type: 'text', text: 'x' }, { type: 'wikilink', attrs: { name: 'Goblin', pageId: null, anchor: null, anchorText: null, alias: null, ...attrs } })
const docWith = (...nodes) => ({ type: 'doc', content: [{ type: 'paragraph', content: nodes }] })
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Ambush', content: docWith(link({ libKey: key }), link({ libKey: key, alias: 'the little thing' })) })
const ambush = r.data
r = await call('GET', `/api/workspaces/${ws}/links`)
const rows = r.data.filter((l) => l.sourceId === ambush.id)
check('library links are stored with their key and no target page', rows.length === 2 && rows.every((l) => l.libKey === key && l.targetId === null), JSON.stringify(rows))

r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Goblin' })
const named = r.data
r = await call('GET', `/api/workspaces/${ws}/links`)
check('a page named like the entry does not capture the library links', r.data.filter((l) => l.sourceId === ambush.id).every((l) => l.targetId === null && l.libKey === key))

// public sharing
r = await call('POST', `/api/pages/${ambush.id}/share`)
const token = r.data.token
const pub = await (await fetch(base + '/api/public/' + token)).json()
const marks = JSON.stringify(pub.content)
check('shared page links the library entry through its own address', marks.includes('?lib=' + encodeURIComponent(key)), marks.slice(0, 160))
let pr = await fetch(base + '/api/public/library/' + encodeURIComponent(key))
check('a linked library entry is public', pr.status === 200 && (await pr.json()).name === 'Goblin')
pr = await fetch(base + '/api/public/library/' + encodeURIComponent(fire))
check('an entry no shared page links to stays private', pr.status === 404)
pr = await fetch(base + '/api/public/library/' + encodeURIComponent('../x'))
check('bad public key is refused', pr.status === 404)

// import: the entry becomes a page, links are moved to it
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Goblin (library)', props: { library: key } })
const imported = r.data
r = await call('GET', `/api/workspaces/${ws}/bootstrap`)
check('imported page remembers its library entry', r.data.pages.find((p) => p.id === imported.id)?.library === key)
r = await call('POST', `/api/workspaces/${ws2}/library-links/repoint`, { libKey: key, pageId: imported.id })
check('repoint refuses a page of another world', r.status === 404)
r = await call('POST', `/api/workspaces/${ws}/library-links/repoint`, { libKey: key, pageId: imported.id })
check('repoint changes the page that linked', r.status === 200 && r.data.changed === 1, JSON.stringify(r.data))
r = await call('GET', '/api/pages/' + ambush.id)
const nodes = JSON.stringify(r.data.content)
check('links now name the page and keep the shown text', nodes.includes(imported.id) && !nodes.includes('libKey":"' + key) && nodes.includes('the little thing'))
r = await call('GET', `/api/workspaces/${ws}/links`)
check('link index follows the repoint', r.data.filter((l) => l.sourceId === ambush.id).every((l) => l.targetId === imported.id && !l.libKey))
pr = await fetch(base + '/api/public/library/' + encodeURIComponent(key))
check('after the repoint the entry is no longer public', pr.status === 404)

// ---- linked fields in special pages ----
const wizard = idx.rows.find((x) => x[2] === 'Wizard' && x[1] === 'class')[0]
const elf = idx.rows.find((x) => x[2] === 'Elf' && x[1] === 'species')[0]
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Sildar', props: { type: 'person', data: { class: [{ name: 'Wizard', libKey: wizard }], spells: [{ name: 'Fireball', libKey: fire }], race: 'Half-elf', home: [{ name: 'Elsewhere' }] } } })
const sildar = r.data
r = await call('GET', `/api/workspaces/${ws}/links`)
let mine = r.data.filter((l) => l.sourceId === sildar.id)
check('linked fields are indexed like text links', mine.length === 2 && mine.some((l) => l.libKey === wizard) && mine.some((l) => l.libKey === fire), JSON.stringify(mine.map((l) => l.libKey)))

r = await call('PATCH', '/api/pages/' + sildar.id, { props: { type: 'person', data: { class: [{ name: 'Wizard', libKey: wizard }], race: [{ name: 'Elf', libKey: elf }] } } })
r = await call('GET', `/api/workspaces/${ws}/links`)
mine = r.data.filter((l) => l.sourceId === sildar.id)
check('saving only the fields refreshes the link index', mine.length === 2 && mine.some((l) => l.libKey === elf) && !mine.some((l) => l.libKey === fire), JSON.stringify(mine.map((l) => l.libKey)))

const pageB = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Elf (library)', props: { library: elf } })).data
const otherPage = (await call('POST', `/api/workspaces/${ws2}/pages`, { title: 'Stranger' })).data
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Mira', props: { data: { race: [{ name: 'Elf', pageId: pageB.id }], home: [{ name: 'Stranger', pageId: otherPage.id }] } } })
const mira = r.data
r = await call('GET', `/api/workspaces/${ws}/links`)
mine = r.data.filter((l) => l.sourceId === mira.id)
check('a field entry that points at a page links to it, and one from another world is ignored', mine.length === 1 && mine[0].targetId === pageB.id, JSON.stringify(mine))

const wizardPage = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Wizard (library)', props: { library: wizard } })).data
r = await call('POST', `/api/workspaces/${ws}/library-links/repoint`, { libKey: wizard, pageId: wizardPage.id })
check('repoint also moves linked fields', r.status === 200 && r.data.changed === 1, JSON.stringify(r.data))
r = await call('GET', '/api/pages/' + sildar.id)
const cls = r.data.props?.data?.class?.[0]
check('the field entry now names the page', cls?.pageId === wizardPage.id && !cls.libKey && cls.name === 'Wizard (library)', JSON.stringify(cls))
r = await call('GET', `/api/workspaces/${ws}/links`)
check('and the link index follows', r.data.filter((l) => l.sourceId === sildar.id).some((l) => l.targetId === wizardPage.id))

// ---- linked fields inside stat blocks (special page slot and stat block in the text) ----
const cleric = idx.rows.find((x) => x[2] === 'Cleric' && x[1] === 'class')[0]
const spell = (k, name = 'Cleric') => ({ template: '5e-spell', data: { name: 'Bless', classes: name, 'classes:refs': JSON.stringify([{ name, libKey: k }]) } })
const blessDoc = { type: 'doc', content: [{ type: 'paragraph' }, { type: 'statblock', attrs: spell(cleric) }] }
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Bless', props: { type: 'spell', data: { main: spell(cleric) } }, content: blessDoc })
const bless = r.data
r = await call('GET', `/api/workspaces/${ws}/links`)
mine = r.data.filter((l) => l.sourceId === bless.id)
check('stat block links are indexed, in the slot and in the text', mine.length === 2 && mine.every((l) => l.libKey === cleric), JSON.stringify(mine.map((l) => l.libKey)))

r = await call('POST', `/api/pages/${bless.id}/share`)
const pub2 = await (await fetch(base + '/api/public/' + r.data.token)).json()
const pubText = JSON.stringify(pub2.content)
check('a shared stat block keeps its text but not its links', pubText.includes('"classes":"Cleric"') && !pubText.includes(':refs'), pubText.slice(0, 200))
await call('DELETE', `/api/pages/${bless.id}/share`)

const clericPage = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Cleric (library)', props: { library: cleric } })).data
r = await call('POST', `/api/workspaces/${ws}/library-links/repoint`, { libKey: cleric, pageId: clericPage.id })
check('repoint changes stat block links', r.status === 200 && r.data.changed === 1, JSON.stringify(r.data))
r = await call('GET', '/api/pages/' + bless.id)
const slot = r.data.props.data.main.data
const node = r.data.content.content.find((n) => n.type === 'statblock').attrs.data
check('in the slot the entry names the page', JSON.parse(slot['classes:refs'])[0].pageId === clericPage.id && slot.classes === 'Cleric (library)', JSON.stringify(slot))
check('in the text the entry names the page', JSON.parse(node['classes:refs'])[0].pageId === clericPage.id && node.classes === 'Cleric (library)')
r = await call('GET', `/api/workspaces/${ws}/links`)
check('and the link index follows', r.data.filter((l) => l.sourceId === bless.id).every((l) => l.targetId === clericPage.id))

const anon = await fetch(base + '/api/library/index')
check('library needs a login', anon.status === 401)
console.log(wasEmpty ? 'First download done.' : 'Library already existed.')
if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\nAll library checks passed')
