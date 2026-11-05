// node scripts/smoke-relations.mjs http://localhost:3222 gm testpass123
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let cookie = ''
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => null), set: r.headers.get('set-cookie') }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const login = await call('POST', '/api/auth/login', { username: user, password: pass })
cookie = login.set.split(';')[0]
const ws = (await call('POST', '/api/workspaces', { name: 'RelWorld' })).data
const page = async (title) => (await call('POST', `/api/workspaces/${ws.id}/pages`, { title })).data
const [a, b, c] = [await page('Aldric'), await page('Brenna'), await page('Cade')]
const rel = (s, t, kind, label) => call('POST', `/api/workspaces/${ws.id}/relations`, { sourceId: s.id, targetId: t.id, kind, label })

check('parent link created', (await rel(a, b, 'parent')).status === 200)
check('duplicate rejected', (await rel(a, b, 'parent')).status === 409)
check('self relation rejected', (await rel(a, a, 'spouse')).status === 400)
check('ancestor loop rejected', (await rel(b, a, 'parent')).status === 400)
check('grandchild loop rejected', (await rel(b, c, 'parent')).status === 200 && (await rel(c, a, 'parent')).status === 400)
check('spouse stored once in either direction', (await rel(a, c, 'spouse')).status === 200 && (await rel(c, a, 'spouse')).status === 409)
const o = await rel(a, b, 'other', 'rival of')
check('custom relation keeps label', o.status === 200 && o.data.label === 'rival of')
check('label can be edited', (await call('PATCH', `/api/relations/${o.data.id}`, { label: 'old friend of' })).data.label === 'old friend of')
check('foreign page rejected', (await rel(a, { id: 'nope' }, 'spouse')).status === 400)
const list = (await call('GET', `/api/workspaces/${ws.id}/relations`)).data
check('list has all', list.length === 4, String(list.length))
await call('DELETE', `/api/pages/${b.id}`)
check('trashed page hides its relations', (await call('GET', `/api/workspaces/${ws.id}/relations`)).data.length === 1)
check('delete relation', (await call('DELETE', `/api/relations/${list[3].id}`)).status === 200)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
