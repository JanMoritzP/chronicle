// node scripts/smoke-auth.mjs http://localhost:3222 gm testpass123
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
async function call(method, url, body, cookie = '', headers = {}) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => null), set: r.headers.get('set-cookie') }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }
const login = async (u, p, headers) => { const r = await call('POST', '/api/auth/login', { username: u, password: p }, '', headers); return { ...r, cookie: r.set?.split(';')[0] } }

const owner = await login(user, pass)
const name = 'pw' + Math.floor(Math.random() * 1e6)
await call('POST', '/api/users', { username: name, password: 'firstpass1', role: 'editor' }, owner.cookie)
const a = await login(name, 'firstpass1')
const b = await login(name, 'firstpass1')
check('two devices logged in', a.status === 200 && b.status === 200)

check('password change needs login', (await call('POST', '/api/auth/password', { current: 'firstpass1', next: 'secondpass2' })).status === 401)
check('wrong current password refused', (await call('POST', '/api/auth/password', { current: 'nope-nope', next: 'secondpass2' }, a.cookie)).status === 403)
check('short new password refused', (await call('POST', '/api/auth/password', { current: 'firstpass1', next: 'short' }, a.cookie)).status === 400)
check('change succeeds', (await call('POST', '/api/auth/password', { current: 'firstpass1', next: 'secondpass2' }, a.cookie)).status === 200)
check('this device stays logged in', (await call('GET', '/api/auth/me', null, a.cookie)).status === 200)
check('other device is logged out', (await call('GET', '/api/auth/me', null, b.cookie)).status === 401)
check('old password no longer works', (await login(name, 'firstpass1')).status === 401)
check('new password works', (await login(name, 'secondpass2')).status === 200)

const id = (await call('GET', '/api/users', null, owner.cookie)).data.find((u) => u.username === name).id
check('editor cannot set someone else\'s password', (await call('POST', `/api/users/${id}/password`, { password: 'hackedpass1' }, a.cookie)).status === 403)
check('owner sets a password', (await call('POST', `/api/users/${id}/password`, { password: 'ownerset123' }, owner.cookie)).status === 200)
check('that user is logged out everywhere', (await call('GET', '/api/auth/me', null, a.cookie)).status === 401)
check('and can log in with the owner-set password', (await login(name, 'ownerset123')).status === 200)
check('unknown user id 404', (await call('POST', '/api/users/nope/password', { password: 'whatever123' }, owner.cookie)).status === 404)
check('owner keeps own session after setting own password', await (async () => {
  const me = (await call('GET', '/api/auth/me', null, owner.cookie)).data
  return (await call('POST', `/api/users/${me.id}/password`, { password: pass }, owner.cookie)).status === 200 && (await call('GET', '/api/auth/me', null, owner.cookie)).status === 200
})())

// cookie flags depend on how the request arrived
check('plain http login has no Secure flag (LAN use)', !/;\s*Secure/i.test(owner.set ?? ''))
const viaProxy = await login(user, pass, { 'x-forwarded-proto': 'https' })
check('login through the https proxy is Secure + HttpOnly', /;\s*Secure/i.test(viaProxy.set ?? '') && /HttpOnly/i.test(viaProxy.set ?? ''))
check('anonymous requests get no content', (await call('GET', '/api/workspaces')).status === 401)

await call('DELETE', `/api/users/${id}`, null, owner.cookie)
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
