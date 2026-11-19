// node scripts/smoke-multiuser.mjs http://localhost:3222 gm testpass123 http://localhost:3223 admin adminpass123
// World access, the admin dashboard, live co-editing and the live event stream.
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import { WebSocket } from 'ws'

const [base = 'http://localhost:3000', user = 'gm', pass, adminBase = 'http://localhost:3001', adminUser = 'admin', adminPass] = process.argv.slice(2)
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(root, method, url, body, cookie = '') {
  const r = await fetch(root + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => null), set: r.headers.get('set-cookie') }
}
const app = (m, u, b, c) => call(base, m, u, b, c)
const adm = (m, u, b, c) => call(adminBase, m, u, b, c)
const loginApp = async (u, p) => { const r = await app('POST', '/api/auth/login', { username: u, password: p }); return r.set?.split(';')[0] }

const suffix = Math.floor(Math.random() * 1e6)
const owner = await loginApp(user, pass)
const adminLogin = await adm('POST', '/api/login', { username: adminUser, password: adminPass })
const ac = adminLogin.set?.split(';')[0]
check('admin signs in on its own port', adminLogin.status === 200 && !!ac)
check('admin API refuses anonymous requests', (await adm('GET', '/api/overview')).status === 401)
check('notebook login does not open the dashboard', (await adm('GET', '/api/overview', null, owner)).status === 401)
check('dashboard login does not open the notebook', (await app('GET', '/api/workspaces', null, ac)).status === 401)
check('dashboard serves its page', (await fetch(adminBase + '/')).status === 200)

// a world with a page, made by the owner
const world = (await app('POST', '/api/workspaces', { name: 'Access test ' + suffix }, owner)).data
const page = (await app('POST', `/api/workspaces/${world.id}/pages`, { title: 'Shared page', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Start. ' }, { type: 'todo', attrs: { id: 'todo-1', message: 'Check it', done: false } }] }] } }, owner)).data

// accounts made by the admin start with no worlds
const mk = async (name, role) => (await adm('POST', '/api/users', { username: `${name}${suffix}`, password: 'password123', role }, ac)).data
const alice = await mk('alice', 'editor'), bob = await mk('bob', 'viewer'), carol = await mk('carol', 'editor')
const aliceC = await loginApp(`alice${suffix}`, 'password123'), bobC = await loginApp(`bob${suffix}`, 'password123'), carolC = await loginApp(`carol${suffix}`, 'password123')
check('new account sees no worlds', (await app('GET', '/api/workspaces', null, aliceC)).data.length === 0)
check('cannot read a page of a world you are not in', (await app('GET', `/api/pages/${page.id}`, null, aliceC)).status === 404)
check('cannot load the bootstrap of a foreign world', (await app('GET', `/api/workspaces/${world.id}/bootstrap`, null, aliceC)).status === 404)
check('cannot create pages in a foreign world', (await app('POST', `/api/workspaces/${world.id}/pages`, { title: 'x' }, aliceC)).status === 404)
check('cannot patch a foreign page', (await app('PATCH', `/api/pages/${page.id}`, { title: 'hacked' }, aliceC)).status === 404)
check('cannot open the live stream of a foreign world', (await fetch(`${base}/api/live?ws=${world.id}`, { headers: { cookie: aliceC } })).status === 404)

// the admin gives access
const put = (w, u, role) => adm('PUT', `/api/worlds/${w}/members/${u}`, { role }, ac)
check('admin adds an editor', (await put(world.id, alice.id, 'editor')).status === 200)
check('admin adds a viewer', (await put(world.id, bob.id, 'viewer')).status === 200)
check('editor now sees the world with editor role', (await app('GET', '/api/workspaces', null, aliceC)).data.find((w) => w.id === world.id)?.role === 'editor')
check('viewer sees it read-only', (await app('GET', '/api/workspaces', null, bobC)).data.find((w) => w.id === world.id)?.role === 'viewer')
check('editor reads the page', (await app('GET', `/api/pages/${page.id}`, null, aliceC)).status === 200)
check('viewer reads the page', (await app('GET', `/api/pages/${page.id}`, null, bobC)).status === 200)
check('viewer cannot write', (await app('PATCH', `/api/pages/${page.id}`, { title: 'nope' }, bobC)).status === 403)
check('viewer cannot create', (await app('POST', `/api/workspaces/${world.id}/pages`, { title: 'nope' }, bobC)).status === 403)
check('outsider still sees nothing', (await app('GET', `/api/pages/${page.id}`, null, carolC)).status === 404)
check('outsider cannot copy pages out of the world', (await app('POST', '/api/copy', { pageIds: [page.id], targetWorkspaceId: world.id }, carolC)).status === 404)
check('editor cannot delete a world', (await app('DELETE', `/api/workspaces/${world.id}`, null, aliceC)).status === 403)
const other = (await app('POST', '/api/workspaces', { name: 'Alice own ' + suffix }, aliceC)).data
check('editor can make a world of their own and open it', (await app('GET', `/api/workspaces/${other.id}/bootstrap`, null, aliceC)).status === 200)
check('owner still reaches every world', (await app('GET', `/api/workspaces/${other.id}/bootstrap`, null, owner)).status === 200)
check('folder in another world is refused', (await app('POST', `/api/workspaces/${world.id}/folders`, { name: 'f', parentId: (await app('POST', `/api/workspaces/${other.id}/folders`, { name: 'theirs' }, aliceC)).data.id }, owner)).status === 400)
const ov = (await adm('GET', '/api/overview', null, ac)).data
check('overview lists members and online people', ov.worlds.find((w) => w.id === world.id)?.members.length === 2 && Array.isArray(ov.online))
check('last owner cannot be demoted', (await adm('PATCH', `/api/users/${ov.users.find((u) => u.role === 'owner').id}`, { role: 'editor' }, ac)).status === 400)

// ---------- admin dashboard stream ----------
check('the dashboard stream refuses anonymous requests', (await fetch(`${adminBase}/api/events`)).status === 401)
const dash = new AbortController()
const stream = await fetch(`${adminBase}/api/events`, { headers: { cookie: ac }, signal: dash.signal })
check('the dashboard stream opens', stream.status === 200 && (stream.headers.get('content-type') ?? '').includes('text/event-stream'))
let notices = 0
;(async () => {
  const rd = stream.body.getReader()
  const dec = new TextDecoder()
  try { for (;;) { const { done, value } = await rd.read(); if (done) break; notices += (dec.decode(value).match(/"k":"online"/g) ?? []).length } } catch { /* aborted */ }
})()
await sleep(400)
const seenBefore = notices
const comesOnline = await fetch(`${base}/api/live?c=smoke-dash`, { headers: { cookie: aliceC } })
await sleep(700)
check('someone coming online is announced to the dashboard', notices > seenBefore)
const seenOnline = notices
await comesOnline.body.cancel()
await sleep(700)
check('someone leaving is announced to the dashboard', notices > seenOnline)
dash.abort()

// ---------- live event stream ----------
const events = []
const live = await fetch(`${base}/api/live?ws=${world.id}&c=smoke-owner`, { headers: { cookie: owner } })
const reader = live.body.getReader()
;(async () => {
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read().catch(() => ({ done: true }))
    if (done) return
    buf += dec.decode(value)
    for (let i; (i = buf.indexOf('\n\n')) >= 0;) {
      const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '))
      buf = buf.slice(i + 2)
      if (line) events.push(JSON.parse(line.slice(6)))
    }
  }
})()
await sleep(300)
await fetch(`${base}/api/workspaces/${world.id}/pages`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: aliceC, 'x-client-id': 'smoke-alice' }, body: JSON.stringify({ title: 'Made by alice' }) })
await sleep(300)
check('other people are told about a new page', events.some((e) => e.k === 'refresh' && e.area === 'pages'))
check('presence lists who is online', events.some((e) => e.k === 'presence' && e.users.some((u) => u.username === user)))
const before = events.length
await fetch(`${base}/api/workspaces/${world.id}/pages`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: owner, 'x-client-id': 'smoke-owner' }, body: JSON.stringify({ title: 'Made by owner' }) })
await sleep(300)
check('a tab is not told about its own change', !events.slice(before).some((e) => e.k === 'refresh'))

// ---------- live co-editing ----------
function join(cookie, who) {
  const doc = new Y.Doc()
  const state = { doc, synced: false, closed: null, notices: [] }
  const ws = new WebSocket(`${base.replace('http', 'ws')}/api/collab/${page.id}`, { headers: { cookie } })
  state.ws = ws
  ws.binaryType = 'arraybuffer'
  ws.on('open', () => {
    const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); syncProtocol.writeSyncStep1(enc, doc); ws.send(encoding.toUint8Array(enc))
  })
  ws.on('message', (data, isBinary) => {
    if (!isBinary) { state.notices.push(JSON.parse(data.toString())); return }
    const dec = decoding.createDecoder(new Uint8Array(data))
    if (decoding.readVarUint(dec) !== 0) return
    const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0)
    const step = syncProtocol.readSyncMessage(dec, enc, doc, ws)
    if (step === 1) state.synced = true
    if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc))
  })
  doc.on('update', (u, origin) => {
    if (origin === ws) return
    const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); syncProtocol.writeUpdate(enc, u); ws.send(encoding.toUint8Array(enc))
  })
  ws.on('close', (code) => { state.closed = code })
  ws.on('unexpected-response', (_req, res) => { state.closed = res.statusCode })
  ws.on('error', () => {})
  return state
}
const textOf = (d) => d.getXmlFragment('default').toString()
const a = join(aliceC, 'alice'), o = join(owner, 'owner')
await sleep(500)
check('both editors load the shared page', a.synced && o.synced && textOf(a.doc).includes('Start.'))
check('an outsider cannot join', await (async () => { const c = join(carolC, 'carol'); await sleep(400); return c.closed === 404 })())
const para = (d) => d.getXmlFragment('default').get(0).get(0)
a.doc.transact(() => para(a.doc).insert(0, 'ALICE '))
o.doc.transact(() => para(o.doc).insert(para(o.doc).length, ' OWNER'))
await sleep(400)
check('simultaneous typing converges', textOf(a.doc) === textOf(o.doc) && textOf(a.doc).includes('ALICE') && textOf(a.doc).includes('OWNER'))
await sleep(2200)
const saved = (await app('GET', `/api/pages/${page.id}`, null, owner)).data
check('the server saves the shared text to the page', JSON.stringify(saved.content).includes('ALICE') && JSON.stringify(saved.content).includes('OWNER'))
check('saved page keeps search text up to date', saved.wordCount >= 3)
check('page-saved notice reaches the live stream', events.some((e) => e.k === 'page-saved' && e.id === page.id))

const b = join(bobC, 'bob')
await sleep(400)
check('a viewer sees the live text', b.synced && textOf(b.doc).includes('ALICE'))
b.doc.transact(() => para(b.doc).insert(0, 'BOB '))
await sleep(500)
check('a viewer cannot change the page', !textOf(a.doc).includes('BOB') && !textOf(o.doc).includes('BOB'))
b.ws.close()

// todo toggled from the Todos tab while the page is open goes through the live document
const toggled = await app('PATCH', `/api/pages/${page.id}/todos/todo-1`, { done: true }, owner)
await sleep(300)
check('todo change reaches open editors', toggled.status === 200 && /done="true"/.test(textOf(a.doc)))

// a document replaced over REST makes open editors reload
const replaced = await app('PATCH', `/api/pages/${page.id}`, { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Restored text' }] }] } }, owner)
await sleep(400)
check('REST replacement tells open editors to reload', replaced.status === 200 && a.notices.some((n) => n.t === 'reload') && a.closed === 4001)
const o2 = join(owner, 'owner2')
await sleep(400)
check('after a reload the new text is what people get', o2.synced && textOf(o2.doc).includes('Restored text') && !textOf(o2.doc).includes('ALICE'))

// field-level props patch
const typed = await app('PATCH', `/api/pages/${page.id}`, { propsPatch: { data: { race: 'Elf' }, type: 'person' } }, owner)
const typed2 = await app('PATCH', `/api/pages/${page.id}`, { propsPatch: { data: { home: 'Waterdeep' } } }, aliceC)
const props = (await app('GET', `/api/pages/${page.id}`, null, owner)).data.props
check('two people editing different fields do not overwrite each other', typed.status === 200 && typed2.status === 200 && props.data?.race === 'Elf' && props.data?.home === 'Waterdeep' && props.type === 'person')

// access taken away mid-session
const joinedAlice = join(aliceC, 'alice2')
await sleep(400)
check('admin removes a person from the world', (await adm('DELETE', `/api/worlds/${world.id}/members/${alice.id}`, null, ac)).status === 200)
await sleep(400)
check('their editing session is closed', joinedAlice.closed === 4003)
check('they can no longer read the world', (await app('GET', `/api/pages/${page.id}`, null, aliceC)).status === 404)
check('a viewer account stays read-only even with editor membership', await (async () => {
  await put(world.id, bob.id, 'editor')
  return (await app('PATCH', `/api/pages/${page.id}`, { title: 'still no' }, bobC)).status === 403
})())

// an admin changing someone else's access does not reset a table that is open elsewhere
{
  const sock = new WebSocket(`${base.replace('http', 'ws')}/api/table/${world.id}`, { headers: { cookie: owner, origin: base } })
  const got = []
  sock.on('message', (m) => got.push(JSON.parse(m.toString()).t))
  await new Promise((r) => sock.on('open', r))
  await sleep(400)
  const before = got.filter((t) => t === 'snapshot').length
  await put(world.id, carol.id, 'viewer')
  await put(world.id, carol.id, 'editor')
  await sleep(500)
  check('the table of someone else is not reset by an access change', before === 1 && got.filter((t) => t === 'snapshot').length === 1, JSON.stringify(got))
  sock.close()
}

// cleanup
o.ws.close(); o2.ws.close(); a.ws.close(); await reader.cancel().catch(() => {})
for (const id of [alice.id, bob.id, carol.id]) await adm('DELETE', `/api/users/${id}`, null, ac)
await adm('DELETE', `/api/worlds/${world.id}`, null, ac)
await adm('DELETE', `/api/worlds/${other.id}`, null, ac)
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
