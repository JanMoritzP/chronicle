// node scripts/smoke-worlds.mjs http://localhost:3222 gm testpass123
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

let r = await call('POST', '/api/workspaces', { name: 'world-test-' + rnd })
const ws = r.data.id
check('new world has the default starter todo', r.data.settings?.newPageTodo === 'Fill me')

const todoOf = (doc) => JSON.stringify(doc).match(/"type":"todo","attrs":\{[^}]*\}/)?.[0] ?? ''

r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Blank' })
let page = (await call('GET', `/api/pages/${r.data.id}`)).data
check('blank page starts with a todo', todoOf(page.content).includes('"message":"Fill me"') && todoOf(page.content).includes('"id"'), todoOf(page.content))
r = await call('GET', `/api/workspaces/${ws}/todos`)
check('the starter todo is listed', r.data.length === 1 && r.data[0].message === 'Fill me' && !r.data[0].done)

const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Template text' }] }] }
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'With content', content: body })
page = (await call('GET', `/api/pages/${r.data.id}`)).data
check('supplied content is kept and the todo follows it', page.content.content[0].content[0].text === 'Template text' && page.content.content.length === 2 && todoOf(page.content).includes('Fill me'))

r = await call('PATCH', `/api/workspaces/${ws}`, { settings: { newPageTodo: 'Add a summary' } })
check('settings update', r.status === 200 && r.data.settings.newPageTodo === 'Add a summary', JSON.stringify(r.data))
r = await call('GET', '/api/workspaces')
check('settings listed with the world', r.data.find((w) => w.id === ws)?.settings.newPageTodo === 'Add a summary')
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Custom' })
page = (await call('GET', `/api/pages/${r.data.id}`)).data
check('new pages use the custom todo text', todoOf(page.content).includes('Add a summary'))

r = await call('PATCH', `/api/workspaces/${ws}`, { settings: { newPageTodo: '' } })
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'None' })
page = (await call('GET', `/api/pages/${r.data.id}`)).data
check('an empty text turns the todo off', todoOf(page.content) === '')
r = await call('PATCH', `/api/workspaces/${ws}`, { settings: { newPageTodo: 'x'.repeat(201) } })
check('too long todo text is refused', r.status === 400)
r = await call('PATCH', `/api/workspaces/nope`, { name: 'x' })
check('unknown world is 404', r.status === 404)

// share links stop working with the world
r = await call('POST', `/api/pages/${page.id}/share`)
const token = r.data?.token
if (token) {
  r = await call('GET', `/api/public/${token}`)
  check('shared page is public', r.status === 200, String(r.status))
}
r = await call('DELETE', `/api/workspaces/${ws}`)
check('delete world', r.status === 200)
r = await call('GET', '/api/workspaces')
check('deleted world is gone from the list', !r.data.some((w) => w.id === ws))
r = await call('GET', `/api/workspaces/${ws}/bootstrap`)
check('deleted world has no bootstrap', r.status === 404, String(r.status))
if (token) {
  r = await call('GET', `/api/public/${token}`)
  check('shared page of a deleted world is gone', r.status === 404, String(r.status))
}

// stat block look
const ws2 = (await call('POST', '/api/workspaces', { name: 'look-test-' + rnd })).data.id
r = await call('POST', `/api/workspaces/${ws2}/stat-templates`, { name: 'Classic', sections: [{ kind: 'abilities', layout: 'table', saves: true }], look: { style: 'classic', accent: '#7a200d', columns: 2 } })
check('stat form keeps its look', r.status === 200 && r.data.look.style === 'classic' && r.data.look.columns === 2, JSON.stringify(r.data.look))
r = await call('POST', `/api/workspaces/${ws2}/stat-templates`, { name: 'Old style', sections: [{ kind: 'title', key: 'name' }] })
check('a form without a look still saves', r.status === 200 && JSON.stringify(r.data.look) === '{}')
r = await call('GET', `/api/workspaces/${ws2}/bootstrap`)
check('bootstrap carries the look', r.data.statTemplates.some((t) => t.look?.style === 'classic'))
await call('DELETE', `/api/workspaces/${ws2}`)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
