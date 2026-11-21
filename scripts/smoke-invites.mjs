// node scripts/smoke-invites.mjs http://localhost:3222 gm testpass123
// Each call comes from a made-up address (the server trusts X-Forwarded-For), so the per-address rate limit does not get in the way.
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

async function call(method, url, body, cookie = '') {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' }
}
const login = async (u, p) => (await call('POST', '/api/auth/login', { username: u, password: p })).cookie
const suffix = Math.floor(Math.random() * 1e6)

const gm = await login(user, pass)
const ws = (await call('POST', '/api/workspaces', { name: `invite-test-${suffix}` }, gm)).data.id
const other = (await call('POST', '/api/workspaces', { name: `invite-other-${suffix}` }, gm)).data.id
const mate = (await call('POST', '/api/users', { username: `mate${suffix}`, password: 'password123', role: 'editor', worldIds: [ws] }, gm)).data
const mateC = await login(`mate${suffix}`, 'password123')

let r = await call('GET', `/api/workspaces/${ws}/invites`, null, mateC)
check('only the owner account sees invite links', r.status === 403)
r = await call('POST', `/api/workspaces/${ws}/invites`, { role: 'editor', days: 7, maxUses: 5 }, mateC)
check('and only the owner makes them', r.status === 403)
r = await call('POST', `/api/workspaces/${ws}/invites`, { role: 'editor', days: 7, maxUses: 5 }, gm)
check('a link cannot be made while invites are off for the world', r.status === 409)
r = await call('PATCH', `/api/workspaces/${ws}`, { settings: { invites: true } }, gm)
check('the owner switches invites on', r.status === 200 && r.data.settings.invites === true)
r = await call('POST', `/api/workspaces/${ws}/invites`, { role: 'editor', days: 7, maxUses: 1 }, gm)
check('a link is made and the token is only shown now', r.status === 200 && r.data.token?.length > 30 && r.data.path === `/join/${r.data.token}`)
const one = r.data
r = await call('GET', `/api/workspaces/${ws}/invites`, null, gm)
check('the list never contains the token', r.status === 200 && r.data.length === 1 && !JSON.stringify(r.data).includes(one.token) && r.data[0].status === 'open' && r.data[0].uses === 0)

r = await call('GET', `/api/public/invite/${one.token}`)
check('anyone can see which world and role a link is for, and nothing else', r.status === 200 && r.data.world === `invite-test-${suffix}` && r.data.role === 'editor' && Object.keys(r.data).sort().join() === 'role,world')
r = await call('GET', '/api/public/invite/not-a-real-token')
check('an unknown link is not found', r.status === 404)

r = await call('POST', `/api/public/invite/${one.token}/join`, { mode: 'new', username: 'ab', password: 'short' })
check('a weak password is refused', r.status === 400)
r = await call('POST', `/api/public/invite/${one.token}/join`, { mode: 'new', username: user, password: 'password123' })
check('a name that is taken is refused', r.status === 409)
r = await call('POST', `/api/public/invite/${one.token}/join`, { mode: 'new', username: `newbie${suffix}`, password: 'password123' })
const newbieC = r.cookie
check('a new person joins, is signed in and is a player', r.status === 200 && !!newbieC && r.data.role === 'editor' && r.data.worldId === ws)
r = await call('GET', '/api/auth/me', null, newbieC)
check('the session works', r.status === 200 && r.data.username === `newbie${suffix}`)
r = await call('GET', '/api/workspaces', null, newbieC)
check('they see the one world and nothing else', r.data.length === 1 && r.data[0].id === ws && r.data[0].role === 'editor')
r = await call('GET', `/api/workspaces/${other}/bootstrap`, null, newbieC)
check('another world stays closed to them', r.status === 404)
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Hello from a player' }, newbieC)
check('as a player they can write in the world', r.status === 200)
r = await call('POST', `/api/workspaces/${ws}/invites`, { role: 'editor', days: null, maxUses: null }, newbieC)
check('but not make invites of their own', r.status === 403)
r = await call('GET', `/api/public/invite/${one.token}`)
check('a link for one person is used up after one', r.status === 404)
r = await call('GET', `/api/workspaces/${ws}/invites`, null, gm)
check('the owner sees it used up', r.data[0].status === 'used up' && r.data[0].uses === 1)

// a spectator link, and a person who already has an account
r = await call('POST', `/api/workspaces/${ws}/invites`, { role: 'viewer', days: 1, maxUses: null }, gm)
const watch = r.data
r = await call('POST', `/api/public/invite/${watch.token}/join`, { mode: 'new', username: `watcher${suffix}`, password: 'password123' })
const watcherC = r.cookie
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Nope' }, watcherC)
check('someone who joins as a spectator cannot write', r.status === 403)
r = await call('GET', `/api/workspaces/${ws}/bootstrap`, null, watcherC)
check('but can read', r.status === 200)

const mate2 = (await call('POST', '/api/users', { username: `mate2${suffix}`, password: 'password123', role: 'editor', worldIds: [] }, gm)).data
r = await call('POST', `/api/public/invite/${watch.token}/join`, { mode: 'existing', username: `mate2${suffix}`, password: 'wrong-password' })
check('signing in with the wrong password is refused', r.status === 401)
r = await call('POST', `/api/public/invite/${watch.token}/join`, { mode: 'existing', username: user, password: pass })
check('the owner account does not need a link', r.status === 400)
r = await call('POST', `/api/public/invite/${watch.token}/join`, { mode: 'existing', username: `mate2${suffix}`, password: 'password123' })
check('a person with an account joins with it', r.status === 200 && !!r.cookie)
r = await call('GET', '/api/workspaces', null, r.cookie)
check('and now sees the world', r.data.some((w) => w.id === ws))
r = await call('GET', `/api/workspaces/${ws}/invites`, null, gm)
const usedBefore = r.data.find((i) => i.id === watch.id).uses
r = await call('POST', `/api/public/invite/${watch.token}/join`, { mode: 'existing', username: `mate${suffix}`, password: 'password123' })
r = await call('POST', `/api/public/invite/${watch.token}/join`, { mode: 'existing', username: `mate${suffix}`, password: 'password123' })
r = await call('GET', `/api/workspaces/${ws}/invites`, null, gm)
check('someone who is in the world already does not use the link up', r.data.find((i) => i.id === watch.id).uses === usedBefore)

// revoking and switching off
r = await call('POST', `/api/workspaces/${ws}/invites`, { role: 'editor', days: null, maxUses: null }, gm)
const open = r.data
check('a link without an end or a limit works', (await call('GET', `/api/public/invite/${open.token}`)).status === 200)
r = await call('GET', `/api/workspaces/${ws}/invites`, null, gm)
const openId = r.data.find((i) => i.maxUses == null && i.expiresAt == null).id
r = await call('DELETE', `/api/invites/${openId}`, null, mateC)
check('players cannot revoke links', r.status === 403)
r = await call('DELETE', `/api/invites/${openId}`, null, gm)
check('the owner revokes a link', r.status === 200 && (await call('GET', `/api/public/invite/${open.token}`)).status === 404)
r = await call('POST', `/api/workspaces/${ws}/invites`, { role: 'editor', days: null, maxUses: null }, gm)
const again = r.data
await call('PATCH', `/api/workspaces/${ws}`, { settings: { invites: false } }, gm)
check('switching invites off closes every link', (await call('GET', `/api/public/invite/${again.token}`)).status === 404 && (await call('POST', `/api/public/invite/${again.token}/join`, { mode: 'new', username: `late${suffix}`, password: 'password123' })).status === 404)

r = await call('POST', `/api/workspaces/${ws}/invites`, { role: 'owner', days: 1, maxUses: 1 }, gm)
check('an owner link cannot be made', r.status === 400 || r.status === 409)

for (const id of [mate.id, mate2.id]) await call('DELETE', `/api/users/${id}`, null, gm)
const all = await call('GET', '/api/users', null, gm)
for (const u of all.data.filter((x) => new RegExp(`${suffix}$`).test(x.username))) await call('DELETE', `/api/users/${u.id}`, null, gm)
await call('DELETE', `/api/workspaces/${ws}`, null, gm)
await call('DELETE', `/api/workspaces/${other}`, null, gm)
const named = (await call('POST', '/api/workspaces', { name: `invite-named-${suffix}` }, gm)).data.id
await call('PATCH', `/api/workspaces/${named}`, { settings: { invites: true } }, gm)
r = await call('POST', `/api/workspaces/${named}/invites`, { role: 'viewer', days: 1, maxUses: 1, label: 'Tuesday group' }, gm)
const labelled = r.data.id
await call('POST', `/api/workspaces/${named}/invites`, { role: 'viewer', days: 1, maxUses: 1 }, gm)
r = await call('GET', `/api/workspaces/${named}/invites`, null, gm)
check('a link can be given a name, and the list shows it', r.data.find((i) => i.id === labelled)?.label === 'Tuesday group' && r.data.some((i) => i.label === ''))
r = await call('POST', `/api/workspaces/${named}/invites`, { role: 'viewer', days: 1, maxUses: 1, label: 'x'.repeat(41) }, gm)
check('a name has a limit', r.status === 400)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
