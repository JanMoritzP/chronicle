// node scripts/smoke-templates.mjs http://localhost:3222 gm testpass123
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let cookie = ''
async function call(method, url, body, useCookie = true) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(useCookie && cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })
cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
const ws = (await call('POST', '/api/workspaces', { name: 'tpl-test-' + Math.floor(Math.random() * 1e6) })).data.id
const ws2 = (await call('POST', '/api/workspaces', { name: 'tpl-other-' + Math.floor(Math.random() * 1e6) })).data.id

const p = (...c) => ({ type: 'paragraph', content: c })
const t = (text) => ({ type: 'text', text })
const doc = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2, id: 'h-keep' }, content: [t('Appearance')] },
  p(t('Describe them. '), { type: 'todo', attrs: { id: 'td-keep', message: 'pick a name', done: true } }),
  { type: 'statblock', attrs: { template: '5e-monster', data: {} } },
] }

let r = await call('POST', `/api/workspaces/${ws}/templates`, { name: 'NPC Sheet', description: 'A character', content: doc })
check('create template', r.status === 200 && r.data.id, JSON.stringify(r.data).slice(0, 80))
const tpl = r.data
check('slug derived from the name', tpl.slug === 'npc-sheet', tpl.slug)
check('heading id is stripped', !JSON.stringify(tpl.content).includes('h-keep'))
check('todo id is stripped and the todo reset to open', !JSON.stringify(tpl.content).includes('td-keep') && tpl.content.content[1].content[1].attrs.done === false)
check('stat block kept', tpl.content.content[2].type === 'statblock')

r = await call('POST', `/api/workspaces/${ws}/templates`, { name: 'npc  sheet!' })
check('same slug is a conflict', r.status === 409, r.data.error)
r = await call('POST', `/api/workspaces/${ws}/templates`, { name: '!!!' })
check('name without letters is rejected', r.status === 400)
r = await call('POST', `/api/workspaces/${ws}/templates`, { name: '' })
check('empty name is rejected', r.status === 400)
r = await call('POST', `/api/workspaces/${ws}/templates`, { name: 'Ünïcode Böss' })
check('unicode names keep their letters', r.status === 200 && r.data.slug === 'ünïcode-böss', r.data.slug)
r = await call('POST', `/api/workspaces/${ws2}/templates`, { name: 'NPC Sheet' })
check('the same name in another world is fine', r.status === 200)

const boot = (await call('GET', `/api/workspaces/${ws}/bootstrap`)).data
check('bootstrap carries the templates', boot.templates?.length === 2 && boot.templates.some((x) => x.id === tpl.id))
check('and only those of this world', !boot.templates.some((x) => x.name === 'NPC Sheet' && x.id !== tpl.id))

r = await call('PATCH', `/api/templates/${tpl.id}`, { description: 'Updated' })
check('edit the description', r.status === 200 && r.data.description === 'Updated' && r.data.slug === 'npc-sheet')
r = await call('PATCH', `/api/templates/${tpl.id}`, { name: 'Villain' })
check('renaming changes the slug', r.status === 200 && r.data.slug === 'villain')
r = await call('PATCH', `/api/templates/${tpl.id}`, { name: 'Ünïcode Böss' })
check('renaming onto an existing slug is a conflict', r.status === 409)
r = await call('PATCH', `/api/templates/${tpl.id}`, { content: { type: 'doc', content: [p(t('new body'))] } })
check('replace the content', r.status === 200 && r.data.content.content[0].content[0].text === 'new body')
check('unknown template is 404', (await call('PATCH', '/api/templates/nope', { name: 'x' })).status === 404)
check('bad content is 400', (await call('PATCH', `/api/templates/${tpl.id}`, { content: { nope: 1 } })).status === 400)

// export keeps them
const exp = await fetch(`${base}/api/workspaces/${ws}/export`, { headers: { cookie } })
check('export still works with templates', exp.status === 200)

// viewer: reads through bootstrap, cannot change
const name = 'tv' + Math.floor(Math.random() * 1e6)
await call('POST', '/api/users', { username: name, password: 'viewerpass1', role: 'viewer' })
const vl = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: 'viewerpass1' }) })
const owner = cookie
cookie = vl.headers.get('set-cookie')?.split(';')[0] ?? ''
check('viewer sees templates', (await call('GET', `/api/workspaces/${ws}/bootstrap`)).data.templates?.length === 2)
check('viewer cannot create', (await call('POST', `/api/workspaces/${ws}/templates`, { name: 'x' })).status === 403)
check('viewer cannot edit', (await call('PATCH', `/api/templates/${tpl.id}`, { name: 'x' })).status === 403)
check('viewer cannot delete', (await call('DELETE', `/api/templates/${tpl.id}`)).status === 403)
cookie = owner
check('anonymous cannot create', (await call('POST', `/api/workspaces/${ws}/templates`, { name: 'x' }, false)).status === 401)

check('delete', (await call('DELETE', `/api/templates/${tpl.id}`)).status === 200)
check('deleting again is 404', (await call('DELETE', `/api/templates/${tpl.id}`)).status === 404)
check('slug is free again', (await call('POST', `/api/workspaces/${ws}/templates`, { name: 'Villain' })).status === 200)

// restoring a snapshot keeps templates (they are a content table)
const b = (await call('POST', '/api/backups', {})).data
const file = b?.name ?? b?.file
if (file) {
  await call('POST', `/api/workspaces/${ws}/templates`, { name: 'After backup' })
  const rr = await call('POST', `/api/backups/${encodeURIComponent(file)}/restore`, {})
  check('restore works', rr.status === 200, JSON.stringify(rr.data).slice(0, 80))
  const after = (await call('GET', `/api/workspaces/${ws}/bootstrap`)).data.templates.map((x) => x.name)
  check('restore brings back the templates of that moment', after.includes('Villain') && !after.includes('After backup'), after.join(','))
} else console.log('SKIP  backup/restore (could not create a backup)', JSON.stringify(b).slice(0, 80))

const uid = (await call('GET', '/api/users')).data.find((u) => u.username === name)?.id
if (uid) await call('DELETE', `/api/users/${uid}`)
await call('DELETE', `/api/workspaces/${ws}`)
await call('DELETE', `/api/workspaces/${ws2}`)
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
