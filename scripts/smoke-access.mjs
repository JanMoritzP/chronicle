// node scripts/smoke-access.mjs http://localhost:3222 gm testpass123
// Who sees what: GMs of a world, access rules on pages and folders, and secret boxes kept from players everywhere a page
// shows up (the page, the bootstrap, links, todos, history, live editing, the live stream).
import { WebSocket } from 'ws'

const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(method, url, body, cookie = '') {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => null), set: r.headers.get('set-cookie') }
}
const login = async (u, p) => (await call('POST', '/api/auth/login', { username: u, password: p })).set?.split(';')[0]

/** Opens the live document of a page; resolves with how the server answered. */
function collab(cookie, pageId) {
  return new Promise((resolve) => {
    const sock = new WebSocket(`${base.replace('http', 'ws')}/api/collab/${pageId}`, { headers: { cookie, origin: base } })
    let opened = false
    sock.on('open', () => { opened = true; setTimeout(() => { resolve({ open: sock.readyState === WebSocket.OPEN, sock }) }, 300) })
    sock.on('close', (code) => { if (!opened) return; resolve({ open: false, code, sock }) })
    sock.on('unexpected-response', (_q, res) => resolve({ open: false, status: res.statusCode, sock }))
    sock.on('error', () => {})
  })
}

const suffix = Math.floor(Math.random() * 1e6)
const gmCookie = await login(user, pass)
const ws = (await call('POST', '/api/workspaces', { name: 'access-test-' + suffix }, gmCookie)).data.id
const mk = async (name, role) => {
  const r = await call('POST', '/api/users', { username: `${name}${suffix}`, password: 'password123', role, worldIds: [ws] }, gmCookie)
  return { id: r.data.id, cookie: await login(`${name}${suffix}`, 'password123') }
}
const alice = await mk('alice', 'editor')
const bob = await mk('bob', 'editor')
const cora = await mk('cora', 'editor')
const vera = await mk('vera', 'viewer')

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const secret = (text, reveal) => ({ type: 'callout', attrs: { kind: 'secret', ...(reveal ? { reveal } : {}) }, content: [para(text)] })
const page = async (title, content, extra = {}) => (await call('POST', `/api/workspaces/${ws}/pages`, { title, ...(content ? { content: { type: 'doc', content } } : {}), ...extra }, gmCookie)).data

// ---------- roles ----------
check('a GM can make a member a GM', (await call('PUT', `/api/workspaces/${ws}/members/${cora.id}`, { role: 'gm' }, gmCookie)).status === 200)
const members = (await call('GET', `/api/workspaces/${ws}/members`, null, gmCookie)).data
check('the member list shows the GM role', members.some((m) => m.id === cora.id && m.role === 'gm'))
check('an editor can not change roles', (await call('PUT', `/api/workspaces/${ws}/members/${bob.id}`, { role: 'gm' }, alice.cookie)).status === 403)
check('a read-only account can not become a GM', (await call('PUT', `/api/workspaces/${ws}/members/${vera.id}`, { role: 'gm' }, gmCookie)).status === 400)
const worlds = (await call('GET', '/api/workspaces', null, cora.cookie)).data
check('the GM sees their role in the world list', worlds.find((w) => w.id === ws)?.role === 'gm')

// ---------- secrets ----------
const lairLink = { type: 'paragraph', content: [{ type: 'wikilink', attrs: { name: 'Lair' } }] }
const plot = await page('Plot', [para('The duke is kind.'), { type: 'callout', attrs: { kind: 'secret' }, content: [para('The duke is the villain.'), lairLink] }, para('Everyone likes him.')])
const forAlice = await page('Letter', [para('A letter.'), secret('Alice may read this.', [alice.id])])
const pAlice = (await call('GET', `/api/pages/${plot.id}`, null, alice.cookie)).data
const txt = (d) => JSON.stringify(d)
check('a player gets the page without its secret', !txt(pAlice.content).includes('villain') && txt(pAlice.content).includes('Everyone likes him') && pAlice.secretsHidden === true)
const pCora = (await call('GET', `/api/pages/${plot.id}`, null, cora.cookie)).data
check('a GM of the world reads the secret', txt(pCora.content).includes('villain') && !pCora.secretsHidden)
check('a secret can name a player who may read it', txt((await call('GET', `/api/pages/${forAlice.id}`, null, alice.cookie)).data.content).includes('Alice may read'))
check('and stays closed to the others', !txt((await call('GET', `/api/pages/${forAlice.id}`, null, bob.cookie)).data.content).includes('Alice may read'))
const bootAlice = (await call('GET', `/api/workspaces/${ws}/bootstrap`, null, alice.cookie)).data
check('the search text in the bootstrap leaves the secret out', !bootAlice.pages.find((p) => p.id === plot.id).text.includes('villain'))
check('the bootstrap says what the person is in the world', bootAlice.role === 'editor' && (await call('GET', `/api/workspaces/${ws}/bootstrap`, null, cora.cookie)).data.role === 'gm')
check('a link that only sits in a secret is left out', !bootAlice.links.some((l) => l.sourceId === plot.id && l.targetName === 'Lair'))
check('the GM sees that link', (await call('GET', `/api/workspaces/${ws}/bootstrap`, null, gmCookie)).data.links.some((l) => l.sourceId === plot.id && l.targetName === 'Lair'))
check('a player can not change the text of a page with secrets', (await call('PATCH', `/api/pages/${plot.id}`, { content: { type: 'doc', content: [para('gone')] } }, alice.cookie)).status === 403)
check('but can still change its title', (await call('PATCH', `/api/pages/${plot.id}`, { title: 'The plot' }, alice.cookie)).status === 200)
const versions = (await call('GET', `/api/pages/${plot.id}/versions`, null, alice.cookie)).data
if (versions.length) {
  const v = (await call('GET', `/api/versions/${versions[versions.length - 1].id}`, null, alice.cookie)).data
  check('older versions leave the secret out too', !txt(v.content).includes('villain'))
}
let live = await collab(alice.cookie, plot.id)
check('a player does not join the live document of a page with a secret kept from them', !live.open)
live.sock.close()
live = await collab(cora.cookie, plot.id)
check('a GM joins it', live.open)
live.sock.close()
check('only a GM can export the world', (await call('GET', `/api/workspaces/${ws}/export`, null, alice.cookie)).status === 403)

// ---------- page rules ----------
const hidden = await page('Lair', [para('Under the castle.')])
check('a GM sets a page to GMs only', (await call('PUT', `/api/pages/${hidden.id}/access`, { rule: { everyone: 'none' } }, gmCookie)).status === 200)
check('an editor can not set rules', (await call('PUT', `/api/pages/${plot.id}/access`, { rule: { everyone: 'none' } }, alice.cookie)).status === 403)
check('a hidden page does not exist for a player', (await call('GET', `/api/pages/${hidden.id}`, null, alice.cookie)).status === 404)
check('nor can they change it', (await call('PATCH', `/api/pages/${hidden.id}`, { title: 'x' }, alice.cookie)).status === 404)
const boot2 = (await call('GET', `/api/workspaces/${ws}/bootstrap`, null, alice.cookie)).data
check('a hidden page is not in the bootstrap', !boot2.pages.some((p) => p.id === hidden.id))
check('the GM sees it with its rule', (await call('GET', `/api/workspaces/${ws}/bootstrap`, null, gmCookie)).data.pages.find((p) => p.id === hidden.id)?.access?.everyone === 'none')
live = await collab(alice.cookie, hidden.id)
check('a player can not open its live document', !live.open)
live.sock.close()

await call('PUT', `/api/pages/${hidden.id}/access`, { rule: { everyone: 'none', people: { [bob.id]: 'view' } } }, gmCookie)
check('a rule can open a page to one person', (await call('GET', `/api/pages/${hidden.id}`, null, bob.cookie)).status === 200)
check('who then only reads it', (await call('PATCH', `/api/pages/${hidden.id}`, { title: 'Bob was here' }, bob.cookie)).status === 403)
check('the others still do not see it', (await call('GET', `/api/pages/${hidden.id}`, null, alice.cookie)).status === 404)
check('the page says how far this person reaches', (await call('GET', `/api/pages/${hidden.id}`, null, bob.cookie)).data.level === 'view')

const open = await page('Notice board', [para('Anyone may write here.')])
await call('PUT', `/api/pages/${open.id}/access`, { rule: { everyone: 'edit' } }, gmCookie)
check('a rule can let a reader write a page', (await call('PATCH', `/api/pages/${open.id}`, { title: 'Notices' }, vera.cookie)).status === 200)
check('but only its text and sheet', (await call('PATCH', `/api/pages/${open.id}`, { tags: ['x'] }, vera.cookie)).status === 403)

// ---------- folder rules ----------
const folder = (await call('POST', `/api/workspaces/${ws}/folders`, { name: 'GM notes' }, gmCookie)).data
await call('PUT', `/api/folders/${folder.id}/access`, { rule: { everyone: 'none' } }, gmCookie)
const inFolder = await page('Next session', [para('Ambush at the bridge.')], { folderId: folder.id })
check('a page in a hidden folder is hidden', (await call('GET', `/api/pages/${inFolder.id}`, null, alice.cookie)).status === 404)
const boot3 = (await call('GET', `/api/workspaces/${ws}/bootstrap`, null, alice.cookie)).data
check('and so is the folder', !boot3.folders.some((f) => f.id === folder.id))
check('a player can not add pages to it', (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Sneaky', folderId: folder.id }, alice.cookie)).status === 403)
const mine = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'My notes' }, alice.cookie)).data
check('a player can not move a page somewhere others see it differently', (await call('PATCH', `/api/pages/${mine.id}`, { folderId: folder.id }, alice.cookie)).status === 403)
const own = await page('Open in hidden folder', [para('ok')], { folderId: folder.id })
await call('PUT', `/api/pages/${own.id}/access`, { rule: { everyone: 'view' } }, gmCookie)
check('a page rule beats the folder rule', (await call('GET', `/api/pages/${own.id}`, null, alice.cookie)).status === 200)
check('and then the folder shows, as the way to the page', (await call('GET', `/api/workspaces/${ws}/bootstrap`, null, alice.cookie)).data.folders.some((f) => f.id === folder.id))

// ---------- lists ----------
await page('Todo in secret', [{ type: 'callout', attrs: { kind: 'secret' }, content: [{ type: 'paragraph', content: [{ type: 'todo', attrs: { id: 'td' + suffix, message: 'plant the clue', done: false } }] }] }])
const todos = (await call('GET', `/api/workspaces/${ws}/todos`, null, alice.cookie)).data
check('a todo inside a secret is not listed for players', !todos.some((t) => t.message === 'plant the clue'))
check('nor are todos of hidden pages', !todos.some((t) => t.pageId === inFolder.id))
check('the GM sees it', (await call('GET', `/api/workspaces/${ws}/todos`, null, gmCookie)).data.some((t) => t.message === 'plant the clue'))
check('the trash leaves hidden pages out', (await call('DELETE', `/api/pages/${inFolder.id}`, null, gmCookie)).status === 200 && !(await call('GET', `/api/workspaces/${ws}/trash`, null, alice.cookie)).data.some((p) => p.id === inFolder.id))

await call('DELETE', `/api/workspaces/${ws}`, null, gmCookie)
await sleep(100)
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
