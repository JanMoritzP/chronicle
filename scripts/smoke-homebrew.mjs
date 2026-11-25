// node scripts/smoke-homebrew.mjs http://localhost:3222 gm testpass123
// Homebrew libraries: making one, putting entries in, the index, pictures, export, import (with and without replacing), deleting.
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let cookie = ''
async function call(method, url, body, headers = {}) {
  const raw = body instanceof Uint8Array
  const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { 'content-type': raw ? 'application/octet-stream' : 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) })
  const text = await r.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data, headers: r.headers }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })
cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''

// a 1x1 PNG
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

const name = 'Smoke homebrew ' + Math.floor(Math.random() * 1e6)
let r = await call('POST', '/api/library/collections', { name, author: 'Tester' })
check('make a library', r.status === 200 && r.data.id, JSON.stringify(r.data).slice(0, 100))
const lib = r.data
r = await call('POST', '/api/library/collections', { name: '' })
check('a library needs a name', r.status === 400)

r = await call('POST', '/api/library/assets', png)
check('store a picture for the library', r.status === 200 && /^\/api\/library\/assets\/[a-f0-9]{32}$/.test(r.data.url), JSON.stringify(r.data))
const pic = r.data.url
r = await call('POST', '/api/library/assets', Uint8Array.from(Buffer.from('not a picture')))
check('something that is not a picture is refused', r.status === 415)
r = await call('GET', pic)
check('the picture is served', r.status === 200 && r.headers.get('content-type') === 'image/png')

const cls = { category: 'class', name: 'Storm knight', sub: 'Class · d10 hit die', type: 'class', rules: { die: 10, primary: ['str'], saves: ['str', 'con'], skills: { count: 2, from: ['athletics', 'perception', 'survival'] }, armor: { base: 16, dex: 'none', note: 'chain mail' }, kit: [], features: [{ name: 'Thunder strike', text: 'Once per turn, 1d6 thunder damage.' }], attacks: [] }, portrait: pic, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Knights who ride the storm.' }] }] } }
r = await call('PUT', `/api/library/collections/${lib.id}/entries`, { entry: cls })
check('put a class in the library', r.status === 200 && r.data.key === `class:hb.${lib.id}.storm-knight`, JSON.stringify(r.data))
const key = r.data.key
r = await call('PUT', `/api/library/collections/${lib.id}/entries`, { entry: { ...cls, id: undefined } })
check('the same name again is a second entry', r.status === 200 && r.data.key === `class:hb.${lib.id}.storm-knight-2`, r.data.key)
const second = r.data.key
r = await call('PUT', `/api/library/collections/${lib.id}/entries`, { entry: { ...cls, name: 'Storm knight (revised)' }, key })
check('pushing with the key updates the entry', r.status === 200 && r.data.key === key)
r = await call('PUT', `/api/library/collections/${lib.id}/entries`, { entry: { category: 'nonsense', name: 'x' } })
check('an unknown kind is refused', r.status === 400)
r = await call('PUT', '/api/library/collections/no-such-library/entries', { entry: { category: 'page', name: 'x' } })
check('a missing library is a 404', r.status === 404)
r = await call('PUT', `/api/library/collections/${lib.id}/entries`, { entry: { category: 'page', name: 'The drowned god', text: '# Who\nA god under the sea.\n\n- Tides\n- Salt' } })
check('a plain page with text written by hand', r.status === 200 && r.data.key.startsWith('page:hb.'))

r = await call('GET', '/api/library/status')
check('the status counts homebrew', r.status === 200 && r.data.count >= r.data.open5e + 3 && typeof r.data.version === 'number', JSON.stringify(r.data).slice(0, 120))
r = await call('GET', '/api/library/index')
check('the index has the homebrew entries and their library', r.data.rows.some((x) => x[0] === key && x[2] === 'Storm knight (revised)' && x[3] === `hb:${lib.id}`) && r.data.sources[`hb:${lib.id}`] === name)
r = await call('GET', `/api/library/entries/${encodeURIComponent(key)}`)
check('read an entry', r.status === 200 && r.data.homebrew === lib.id && r.data.sourceName === name && r.data.data.rules.die === 10, JSON.stringify(r.data).slice(0, 120))
r = await call('GET', '/api/library/builder')
check('the character builder sees the class with its rules', r.data.some((e) => e.key === key && e.rules.die === 10 && e.library === name))
r = await call('GET', `/api/library/collections/${lib.id}`)
check('a library lists its entries', r.status === 200 && r.data.entries.length === 3 && r.data.count === 3)

r = await call('GET', `/api/library/collections/${lib.id}/export`)
check('export the library', r.status === 200 && r.data.format === 'chronicle-library' && r.data.entries.length === 3 && /attachment/.test(r.headers.get('content-disposition') ?? ''))
const file = r.data
const storm = file.entries.find((e) => e.name === 'Storm knight (revised)')
check('the export carries the picture inside the file', storm.portrait.startsWith('asset:') && file.assets[storm.portrait.slice(6)]?.startsWith('data:image/png;base64,'))

r = await call('POST', '/api/library/import', { file })
check('importing a library that is already there asks first', r.status === 409 && r.data.exists === true)
r = await call('POST', '/api/library/import', { file: { ...file, entries: [storm] }, replace: true })
check('importing with replace swaps the entries', r.status === 200 && r.data.entries === 1 && r.data.collection.count === 1, JSON.stringify(r.data).slice(0, 120))
r = await call('GET', `/api/library/entries/${encodeURIComponent(key)}`)
check('the replaced entry keeps its key and its picture', r.status === 200 && /^\/api\/library\/assets\/[a-f0-9]{32}$/.test(r.data.data.portrait), r.data.data?.portrait)
r = await call('GET', `/api/library/entries/${encodeURIComponent(second)}`)
check('an entry the file no longer has is gone', r.status === 404)
r = await call('POST', '/api/library/import', { file: { ...file, library: { ...file.library, id: `${lib.id}-copy`, name: name + ' copy' } } })
check('a file with a new id becomes a new library', r.status === 200 && r.data.collection.id === `${lib.id}-copy` && r.data.entries === 3)
r = await call('POST', '/api/library/import', { file: { format: 'something-else' } })
check('a file of another kind is refused with a reason', r.status === 400 && /not a Chronicle library file/.test(r.data.error), r.data.error)

// pages remember the entry they came from or went to
const ws = (await call('POST', '/api/workspaces', { name: 'hb-test-' + Math.floor(Math.random() * 1e6) })).data.id
const page = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Tidekin', props: { type: 'species', rules: { size: 'Medium', speed: 30 } } })).data
r = await call('PATCH', `/api/pages/${page.id}`, { propsPatch: { library: key, rules: { size: 'Small', speed: 25 }, data: { banner: pic, token: pic } } })
check('a page keeps its library entry, rules and pictures', r.status === 200)
r = await call('GET', `/api/pages/${page.id}`)
check('they are saved', r.data.props.library === key && r.data.props.rules.size === 'Small' && r.data.props.data.token === pic, JSON.stringify(r.data.props))
r = await call('PATCH', `/api/pages/${page.id}`, { propsPatch: { rules: null, library: null } })
r = await call('GET', `/api/pages/${page.id}`)
check('and can be taken off again', !('rules' in r.data.props) && !('library' in r.data.props))

r = await call('DELETE', `/api/library/entries/${encodeURIComponent(key)}`)
check('delete an entry', r.status === 200)
r = await call('DELETE', '/api/library/entries/creature:srd_goblin')
check('Open5e entries cannot be deleted', r.status === 404)
r = await call('DELETE', `/api/library/collections/${lib.id}`)
check('delete a library', r.status === 200)
r = await call('DELETE', `/api/library/collections/${lib.id}-copy`)
check('delete the copy', r.status === 200)
r = await call('GET', '/api/library/index')
check('its entries are out of the index', !r.data.rows.some((x) => x[3] === `hb:${lib.id}` || x[3] === `hb:${lib.id}-copy`))
r = await call('GET', pic)
check('pictures nothing uses any more are gone', r.status === 404)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
process.exit(failed ? 1 : 0)
