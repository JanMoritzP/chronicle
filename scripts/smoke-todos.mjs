// node scripts/smoke-todos.mjs http://localhost:3222 gm testpass123
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
const ws = (await call('POST', '/api/workspaces', { name: 'todo-test-' + Math.floor(Math.random() * 1e6) })).data.id

const todo = (message, done = false, id) => ({ type: 'todo', attrs: { ...(id ? { id } : {}), message, done } })
const p = (...c) => ({ type: 'paragraph', content: c })
const t = (text) => ({ type: 'text', text })
const doc = { type: 'doc', content: [
  p(t('The innkeeper hides a secret. '), todo('decide what the secret is'), t(' Players may find out.')),
  { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('Back door key '), todo('who has the second key?', true, 'fixed-id-1'))] }] },
] }
const page = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Inn', content: doc })).data

let list = (await call('GET', `/api/workspaces/${ws}/todos`)).data
check('both markers are indexed on create', list.length === 2, String(list.length))
const open = list.find((x) => !x.done)
const done = list.find((x) => x.done)
check('marker without an id got one assigned', !!open?.id && open.id.length > 8)
check('given id is kept', done?.id === 'fixed-id-1')
check('message stored', open?.message === 'decide what the secret is')
check('context is the surrounding text without the marker', open?.context === 'The innkeeper hides a secret. Players may find out.', open?.context)
check('page title is reported', open?.pageTitle === 'Inn')
check('open ones sort before done ones', list[0].done === false && list[1].done === true)

const boot = (await call('GET', `/api/workspaces/${ws}/bootstrap`)).data
check('bootstrap carries the open count per page', boot.pages.find((x) => x.id === page.id)?.todos === 1)

// the full page keeps the id, so the editor and the Todos tab agree on it
const full = (await call('GET', `/api/pages/${page.id}`)).data
const ids = []
const walk = (n) => { if (n.type === 'todo') ids.push(n.attrs.id); n.content?.forEach(walk) }
walk(full.content)
check('stored document has the ids', ids.includes(open.id) && ids.includes('fixed-id-1'))

// a todo is not words: it must not count towards the word count or the search text
check('todo text is not in the page text', !full.text?.includes('decide what the secret') )

// toggling from the tab
check('tick a todo', (await call('PATCH', `/api/pages/${page.id}/todos/${open.id}`, { done: true })).status === 200)
list = (await call('GET', `/api/workspaces/${ws}/todos`)).data
const ticked = list.find((x) => x.id === open.id)
check('it is now done and has a done time', ticked.done && ticked.doneAt > 0)
check('open count dropped to zero', (await call('GET', `/api/workspaces/${ws}/bootstrap`)).data.pages.find((x) => x.id === page.id).todos === 0)
check('untick', (await call('PATCH', `/api/pages/${page.id}/todos/${open.id}`, { done: false })).status === 200)
check('edit the message', (await call('PATCH', `/api/pages/${page.id}/todos/${open.id}`, { message: 'pick the secret' })).status === 200)
check('message changed in the list', (await call('GET', `/api/workspaces/${ws}/todos`)).data.find((x) => x.id === open.id).message === 'pick the secret')
const after = (await call('GET', `/api/pages/${page.id}`)).data
const found = []
const walk2 = (n) => { if (n.type === 'todo') found.push(n); n.content?.forEach(walk2) }
walk2(after.content)
check('the page document changed, not just the index', found.find((n) => n.attrs.id === open.id)?.attrs.message === 'pick the secret' && found.length === 2)
check('surrounding text is untouched', after.content.content[0].content.length === 3)
check('unknown todo is 404', (await call('PATCH', `/api/pages/${page.id}/todos/nope`, { done: true })).status === 404)
check('bad body is 400', (await call('PATCH', `/api/pages/${page.id}/todos/${open.id}`, { done: 'yes' })).status === 400)

// editing the page by hand keeps the index in step, including a removed marker
const edited = { ...after.content, content: [after.content.content[0]] }
await call('PATCH', `/api/pages/${page.id}`, { content: edited })
list = (await call('GET', `/api/workspaces/${ws}/todos`)).data
check('removing a marker in the editor removes it from the list', list.length === 1 && list[0].id === open.id)

// delete from the tab
check('delete a todo', (await call('DELETE', `/api/pages/${page.id}/todos/${open.id}`)).status === 200)
check('list is empty', (await call('GET', `/api/workspaces/${ws}/todos`)).data.length === 0)
const emptied = (await call('GET', `/api/pages/${page.id}`)).data
check('the marker is gone from the page but its sentence stays', JSON.stringify(emptied.content).includes('The innkeeper hides a secret.') && !JSON.stringify(emptied.content).includes('"todo"'))
check('deleting again is 404', (await call('DELETE', `/api/pages/${page.id}/todos/${open.id}`)).status === 404)

// trash hides todos, restore brings them back
const p2 = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Cellar', content: { type: 'doc', content: [p(todo('count the barrels'))] } })).data
check('todo on second page', (await call('GET', `/api/workspaces/${ws}/todos`)).data.length === 1)
await call('DELETE', `/api/pages/${p2.id}`)
check('todos of trashed pages are hidden', (await call('GET', `/api/workspaces/${ws}/todos`)).data.length === 0)
await call('POST', `/api/pages/${p2.id}/restore`, {})
check('and return on restore', (await call('GET', `/api/workspaces/${ws}/todos`)).data.length === 1)

// sharing must not leak them
const share = (await call('POST', `/api/pages/${p2.id}/share`, {})).data
const pub = (await call('GET', `/api/public/${share.token}`, null, false)).data
check('public page has no todo markers', !JSON.stringify(pub.content).includes('todo') && !JSON.stringify(pub.content).includes('barrels'))

// export is readable
const exp = await fetch(`${base}/api/workspaces/${ws}/export`, { headers: { cookie } })
check('world export still works with todos', exp.status === 200)
const zip = Buffer.from(await exp.arrayBuffer())
// minimal zip reader: walk the central directory, inflate each entry
const zlib = await import('node:zlib')
function unzip(buf) {
  const out = {}
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0, n = buf.readUInt16LE(eocd + 10); i < n; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + size)
    out[name] = method === 8 ? zlib.inflateRawSync(raw) : raw
    p += 46 + nameLen + extra + comment
  }
  return out
}
const files = unzip(zip)
const md = Object.entries(files).find(([n]) => n.startsWith('pages/') && n.includes('Cellar'))?.[1]?.toString('utf8') ?? ''
check('export shows the todo as readable text', md.includes('**TODO:** count the barrels'), md.trim())
const worldJson = files['world.json']?.toString('utf8') ?? ''
check('world.json keeps the marker so it can be restored', worldJson.includes('"todo"') && worldJson.includes('count the barrels'))

// a viewer can read but not change
const name = 'tv' + Math.floor(Math.random() * 1e6)
await call('POST', '/api/users', { username: name, password: 'viewerpass1', role: 'viewer' })
const vl = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: 'viewerpass1' }) })
const owner = cookie
cookie = vl.headers.get('set-cookie')?.split(';')[0] ?? ''
check('viewer can read the list', (await call('GET', `/api/workspaces/${ws}/todos`)).status === 200)
const tid = (await call('GET', `/api/workspaces/${ws}/todos`)).data[0].id
check('viewer cannot tick', (await call('PATCH', `/api/pages/${p2.id}/todos/${tid}`, { done: true })).status === 403)
check('viewer cannot delete', (await call('DELETE', `/api/pages/${p2.id}/todos/${tid}`)).status === 403)
cookie = owner
check('anonymous cannot read', (await call('GET', `/api/workspaces/${ws}/todos`, null, false)).status === 401)

const uid = (await call('GET', '/api/users')).data.find((u) => u.username === name)?.id
if (uid) await call('DELETE', `/api/users/${uid}`)
await call('DELETE', `/api/workspaces/${ws}`)
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
