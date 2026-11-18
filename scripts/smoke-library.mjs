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

const anon = await fetch(base + '/api/library/index')
check('library needs a login', anon.status === 401)
console.log(wasEmpty ? 'First download done.' : 'Library already existed.')
if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\nAll library checks passed')
