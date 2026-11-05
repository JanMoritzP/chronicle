// node scripts/smoke-pagetypes.mjs http://localhost:3222 gm testpass123
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
const ws = (await call('POST', '/api/workspaces', { name: 'pt-test-' + Math.floor(Math.random() * 1e6) })).data.id

const def = { columns: 'side-left', side: [{ type: 'image', key: 'portrait' }], main: [{ type: 'body' }] }
let r = await call('POST', `/api/workspaces/${ws}/page-types`, { name: 'Deity', icon: 'sparkles', tag: '#Deity Pantheon', source: 'columns: side-left', definition: def })
check('create page type', r.status === 200 && r.data.id, JSON.stringify(r.data).slice(0, 80))
const pt = r.data
check('tag is cleaned', pt.tag === 'deity-pantheon', pt.tag)

r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Sol', props: { type: pt.id }, tags: [pt.tag] })
check('create page with type', r.status === 200)
const pageId = r.data.id

r = await call('GET', `/api/workspaces/${ws}/bootstrap`)
check('bootstrap has page types', r.data.pageTypes?.length === 1 && r.data.pageTypes[0].definition.columns === 'side-left')
check('bootstrap page carries type', r.data.pages.find((p) => p.id === pageId)?.type === pt.id)
check('page has auto tag', r.data.pages.find((p) => p.id === pageId)?.tags.includes('deity-pantheon'))

r = await call('PATCH', `/api/page-types/${pt.id}`, { name: 'God', icon: 'crown', tag: 'god', source: '{}', definition: { main: [] } })
check('patch page type', r.status === 200 && r.data.name === 'God')

r = await call('PATCH', `/api/pages/${pageId}`, { props: { type: pt.id, data: { domain: 'sun' } } })
check('patch page props returns type', r.status === 200 && r.data.type === pt.id)

r = await call('POST', `/api/workspaces/${ws}/page-types`, { name: '', definition: {} })
check('empty name rejected', r.status === 400)

r = await call('DELETE', `/api/page-types/${pt.id}`)
check('delete page type', r.status === 200)
r = await call('GET', `/api/workspaces/${ws}/bootstrap`)
check('type gone from bootstrap', r.data.pageTypes.length === 0)

await call('DELETE', `/api/workspaces/${ws}`)
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)
