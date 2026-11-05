// Smoke test against a running server: node scripts/smoke.mjs http://localhost:3111 gm testpass123
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let cookie = ''
async function call(method, url, body, ck = cookie) {
  const r = await fetch(base + url, {
    method, headers: { 'content-type': 'application/json', ...(ck ? { cookie: ck } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const set = r.headers.get('set-cookie')
  const data = await r.json().catch(() => null)
  return { status: r.status, data, set }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

check('unauthenticated /me -> 401', (await call('GET', '/api/auth/me')).status === 401)
check('wrong password -> 401', (await call('POST', '/api/auth/login', { username: user, password: 'wrong' })).status === 401)
const login = await call('POST', '/api/auth/login', { username: user, password: pass })
check('login ok', login.status === 200 && login.data.role === 'owner')
cookie = login.set.split(';')[0]
check('cookie is HttpOnly', /httponly/i.test(login.set))

const ws = (await call('POST', '/api/workspaces', { name: 'World' })).data
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Meets ' }, { type: 'wikilink', attrs: { name: 'Bob' } }] }] }
const alice = (await call('POST', `/api/workspaces/${ws.id}/pages`, { title: 'Alice', content: doc })).data
let boot = (await call('GET', `/api/workspaces/${ws.id}/bootstrap`)).data
check('link to missing page is unresolved', boot.links.length === 1 && boot.links[0].targetId === null)
const bob = (await call('POST', `/api/workspaces/${ws.id}/pages`, { title: 'Bob' })).data
boot = (await call('GET', `/api/workspaces/${ws.id}/bootstrap`)).data
check('creating Bob resolves the dangling link', boot.links[0].targetId === bob.id)
check('word count extracted', boot.pages.find((p) => p.title === 'Alice').wordCount === 2)

await call('PATCH', `/api/pages/${bob.id}`, { title: 'Robert' })
boot = (await call('GET', `/api/workspaces/${ws.id}/bootstrap`)).data
check('link stays attached after rename (id based)', boot.links[0].targetId === bob.id)

await call('DELETE', `/api/pages/${bob.id}`)
boot = (await call('GET', `/api/workspaces/${ws.id}/bootstrap`)).data
check('deleted page leaves bootstrap', !boot.pages.some((p) => p.id === bob.id))
check('deleted page is in trash', (await call('GET', `/api/workspaces/${ws.id}/trash`)).data.some((p) => p.id === bob.id))
await call('POST', `/api/pages/${bob.id}/restore`)
boot = (await call('GET', `/api/workspaces/${ws.id}/bootstrap`)).data
check('restore brings it back', boot.pages.some((p) => p.id === bob.id))

const playerName = 'player' + Date.now()
const u = await call('POST', '/api/users', { username: playerName, password: 'playerpass1', role: 'viewer' })
check('create viewer', u.status === 200)
const v = await call('POST', '/api/auth/login', { username: playerName, password: 'playerpass1' }, '')
const vc = v.set.split(';')[0]
check('viewer can read', (await call('GET', `/api/pages/${alice.id}`, null, vc)).status === 200)
check('viewer cannot write', (await call('PATCH', `/api/pages/${alice.id}`, { title: 'x' }, vc)).status === 403)
check('viewer cannot manage users', (await call('GET', '/api/users', null, vc)).status === 403)
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
