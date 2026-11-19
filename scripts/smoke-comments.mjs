// node scripts/smoke-comments.mjs http://localhost:3222 gm testpass123
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
const ws = (await call('POST', '/api/workspaces', { name: 'comment-test-' + Math.floor(Math.random() * 1e6) })).data.id
await call('PATCH', `/api/workspaces/${ws}`, { settings: { newPageTodo: '' } })

const comment = (message, to, done = false, id) => ({ type: 'comment', attrs: { ...(id ? { id } : {}), from: user, to, message, done } })
const p = (...c) => ({ type: 'paragraph', content: c })
const t = (text) => ({ type: 'text', text })
const doc = { type: 'doc', content: [
  p(t('The mayor lies. '), comment('is this too obvious?', user), t(' Players may notice.')),
  p(t('Second line '), comment('check the dates', 'someone-else', true, 'fixed-id-1')),
] }
const page = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Mayor', content: doc })).data

const people = await call('GET', `/api/workspaces/${ws}/people`)
check('people lists the owner for the @ menu', people.status === 200 && people.data.some((x) => x.username === user && x.role === 'owner'))
check('people needs login', (await call('GET', `/api/workspaces/${ws}/people`, null, false)).status === 401)

let list = (await call('GET', `/api/workspaces/${ws}/comments`)).data
check('both comments are indexed on create', list.length === 2, String(list.length))
const open = list.find((x) => !x.done)
const done = list.find((x) => x.done)
check('comment without an id got one assigned', !!open?.id && open.id.length > 8)
check('given id is kept', done?.id === 'fixed-id-1')
check('sender, recipient and message are stored', open?.from === user && open?.to === user && open?.message === 'is this too obvious?')
check('context is the surrounding text without the comment', open?.context === 'The mayor lies. Players may notice.', open?.context)
check('page title is reported', open?.pageTitle === 'Mayor')
check('open ones sort before resolved ones', list[0].done === false && list[1].done === true)
check('comments need login', (await call('GET', `/api/workspaces/${ws}/comments`, null, false)).status === 401)

// resolve and edit through the API
let r = await call('PATCH', `/api/pages/${page.id}/comments/${open.id}`, { done: true })
check('resolve succeeds', r.status === 200)
list = (await call('GET', `/api/workspaces/${ws}/comments`)).data
check('resolved comment is marked done with a time', list.find((x) => x.id === open.id)?.done === true && list.find((x) => x.id === open.id)?.doneAt > 0)
r = await call('PATCH', `/api/pages/${page.id}/comments/${open.id}`, { done: false, message: 'reworded' })
list = (await call('GET', `/api/workspaces/${ws}/comments`)).data
check('reopen and edit the message', list.find((x) => x.id === open.id)?.done === false && list.find((x) => x.id === open.id)?.message === 'reworded')
check('bad body is refused', (await call('PATCH', `/api/pages/${page.id}/comments/${open.id}`, { done: 'yes' })).status === 400)
check('unknown comment is a 404', (await call('PATCH', `/api/pages/${page.id}/comments/nope`, { done: true })).status === 404)

// the page text and the todo list are not touched by comments
const full = (await call('GET', `/api/pages/${page.id}`)).data
check('comment text is not part of the page text', !String(full.text ?? '').includes('reworded') && !String(full.text ?? '').includes('check the dates'))
check('comments do not count as todos', (await call('GET', `/api/workspaces/${ws}/todos`)).data.length === 0)

// nothing leaves through a shared page, a template or the export except the owner's own Markdown
const share = await call('POST', `/api/pages/${page.id}/share`)
const pub = await call('GET', `/api/public/${share.data.token}`, null, false)
check('shared page has no comments', pub.status === 200 && !JSON.stringify(pub.data).includes('comment') && !JSON.stringify(pub.data).includes('reworded'))
const tpl = await call('POST', `/api/workspaces/${ws}/templates`, { name: 'With comments', content: full.content })
check('template creation succeeds', tpl.status === 200 || tpl.status === 201, String(tpl.status))
check('template keeps no comments', !JSON.stringify(tpl.data).includes('"comment"'))

r = await call('DELETE', `/api/pages/${page.id}/comments/${open.id}`)
list = (await call('GET', `/api/workspaces/${ws}/comments`)).data
check('delete removes the comment from page and index', r.status === 200 && list.length === 1 && !JSON.stringify((await call('GET', `/api/pages/${page.id}`)).data.content).includes(open.id))
check('deleting it again is a 404', (await call('DELETE', `/api/pages/${page.id}/comments/${open.id}`)).status === 404)

// trashed pages drop out of the list
await call('DELETE', `/api/pages/${page.id}`)
check('comments of a trashed page are hidden', (await call('GET', `/api/workspaces/${ws}/comments`)).data.length === 0)

await call('DELETE', `/api/workspaces/${ws}`)
if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\nall passed')
