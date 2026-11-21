// node scripts/smoke-macros.mjs http://localhost:3222 gm testpass123
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
const ws = (await call('POST', '/api/workspaces', { name: `macro-test-${suffix}` }, gm)).data.id
const other = (await call('POST', '/api/workspaces', { name: `macro-other-${suffix}` }, gm)).data.id
const mk = async (name, role, worlds) => {
  await call('POST', '/api/users', { username: `${name}${suffix}`, password: 'password123', role, worldIds: worlds }, gm)
  return login(`${name}${suffix}`, 'password123')
}
const ann = await mk('ann', 'editor', [ws])
const ben = await mk('ben', 'editor', [ws])
const eve = await mk('eve', 'editor', [other])
const vic = await mk('vic', 'viewer', [ws])

let r = await call('POST', `/api/workspaces/${ws}/macros`, { name: 'Attack', text: '/roll 1d20+5 attack' }, ann)
check('a player saves a macro of their own', r.status === 200 && r.data.mine === true && r.data.shared === false)
const annMacro = r.data.id
r = await call('GET', `/api/workspaces/${ws}/macros`, null, ben)
check('another player does not see it', r.status === 200 && r.data.length === 0)
r = await call('POST', `/api/workspaces/${ws}/macros`, { name: 'Everyone', text: 'hello', shared: true }, ann)
check('only the GM account can share a macro', r.status === 403)
r = await call('POST', `/api/workspaces/${ws}/macros`, { name: 'Initiative', text: '/roll 1d20 initiative', shared: true }, gm)
check('the GM shares one', r.status === 200 && r.data.shared === true)
const shared = r.data.id
r = await call('GET', `/api/workspaces/${ws}/macros`, null, ben)
check('everyone sees a shared macro, and it is not theirs', r.data.length === 1 && r.data[0].id === shared && r.data[0].mine === false)
r = await call('PATCH', `/api/macros/${shared}`, { name: 'Hijack', text: 'x' }, ben)
check("a player cannot change the GM's macro", r.status === 403)
r = await call('PATCH', `/api/macros/${annMacro}`, { name: 'Attack!', text: '/roll 1d20+6 attack' }, ann)
check('a player changes their own', r.status === 200 && r.data.name === 'Attack!')
r = await call('PATCH', `/api/macros/${annMacro}`, { name: 'Attack!', text: 'x' }, ben)
check("a player cannot change another player's macro", r.status === 403)
r = await call('PATCH', `/api/macros/${annMacro}`, { name: 'Attack!', text: 'x', shared: true }, ann)
check('and cannot share it by editing', r.status === 403)
r = await call('POST', `/api/workspaces/${ws}/macros`, { name: 'Spectate', text: 'hi' }, vic)
check('a spectator cannot save macros', r.status === 403)
r = await call('GET', `/api/workspaces/${ws}/macros`, null, eve)
check('someone outside the world cannot read them', r.status === 404)
r = await call('DELETE', `/api/macros/${annMacro}`, null, eve)
check('nor delete them', r.status === 404)
r = await call('POST', `/api/workspaces/${ws}/macros`, { name: '', text: 'x' }, ann)
check('a macro needs a name', r.status === 400)
r = await call('POST', `/api/workspaces/${ws}/macros`, { name: 'Long', text: 'x'.repeat(2001) }, ann)
check('and is not too long', r.status === 400)
r = await call('DELETE', `/api/macros/${annMacro}`, null, ben)
check("a player cannot delete another's macro", r.status === 403)
r = await call('DELETE', `/api/macros/${annMacro}`, null, gm)
check('the GM account can delete any macro', r.status === 200)
r = await call('GET', `/api/workspaces/${ws}/macros`, null, ann)
check('and it is gone', r.data.length === 1)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
