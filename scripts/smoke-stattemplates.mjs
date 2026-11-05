// node scripts/smoke-stattemplates.mjs http://localhost:3222 gm testpass123
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
const rnd = Math.floor(Math.random() * 1e6)
const ws = (await call('POST', '/api/workspaces', { name: 'st-test-' + rnd })).data.id
const ws2 = (await call('POST', '/api/workspaces', { name: 'st-target-' + rnd })).data.id

const sections = [
  { kind: 'title', key: 'name' },
  { kind: 'rows', fields: [{ key: 'level', label: 'Level', type: 'number' }, { key: 'alive', label: 'Alive', type: 'checkbox' }, { key: 'mood', label: 'Mood', type: 'select', options: ['calm', 'angry'] }] },
  { kind: 'list', key: 'loot', heading: 'Loot' },
]
let r = await call('POST', `/api/workspaces/${ws}/stat-templates`, { name: 'Ship', sections })
check('create stat template', r.status === 200 && r.data.id && r.data.sections.length === 3, JSON.stringify(r.data).slice(0, 80))
const tpl = r.data

r = await call('GET', `/api/workspaces/${ws}/bootstrap`)
check('bootstrap has stat templates', r.data.statTemplates?.length === 1 && r.data.statTemplates[0].sections[1].fields[2].options[1] === 'angry')

r = await call('PATCH', `/api/stat-templates/${tpl.id}`, { name: 'Vessel', sections: sections.slice(0, 2) })
check('patch stat template', r.status === 200 && r.data.name === 'Vessel' && r.data.sections.length === 2)

r = await call('POST', `/api/workspaces/${ws}/stat-templates`, { name: '', sections: [] })
check('empty name rejected', r.status === 400)

const doc = { type: 'doc', content: [{ type: 'statblock', attrs: { template: tpl.id, data: { name: 'Black Pearl', level: '3' } } }] }
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Pearl', content: doc })
const pageId = r.data.id
check('page with custom stat block', r.status === 200 && pageId)

r = await call('POST', '/api/copy', { pageIds: [pageId], targetWorkspaceId: ws2 })
check('copy to another world', r.status === 200, JSON.stringify(r.data).slice(0, 80))
r = await call('GET', `/api/workspaces/${ws2}/bootstrap`)
const copied = r.data.statTemplates?.[0]
check('template copied along', r.data.statTemplates?.length === 1 && copied.name === 'Vessel')
r = await call('GET', `/api/pages/${r.data.pages[0].id}`)
const node = r.data.content?.content?.[0]
check('copied block points at copied template', node?.attrs?.template === copied?.id && copied?.id !== tpl.id)

r = await call('DELETE', `/api/stat-templates/${tpl.id}`)
check('delete stat template', r.status === 200)
r = await call('GET', `/api/workspaces/${ws}/bootstrap`)
check('gone from bootstrap', r.data.statTemplates.length === 0)

await call('DELETE', `/api/workspaces/${ws}`)
await call('DELETE', `/api/workspaces/${ws2}`)
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)
