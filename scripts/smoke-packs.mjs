// node scripts/smoke-packs.mjs http://localhost:3222 gm testpass123
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

async function call(method, url, body, cookie = '') {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}
const login = async (u, p) => { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.1.1.' + Math.floor(Math.random() * 250) }, body: JSON.stringify({ username: u, password: p }) }); return r.headers.get('set-cookie')?.split(';')[0] ?? '' }
const suffix = Math.floor(Math.random() * 1e6)

const gm = await login(user, pass)
const ws = (await call('POST', '/api/workspaces', { name: `pack-test-${suffix}` }, gm)).data.id
const mk = async (name, role, worlds) => { await call('POST', '/api/users', { username: `${name}${suffix}`, password: 'password123', role, worldIds: worlds }, gm); return login(`${name}${suffix}`, 'password123') }
const ann = await mk('ann', 'editor', [ws])
const vic = await mk('vic', 'viewer', [ws])

const pack = {
  format: 'chronicle-system', v: 1, id: 'grim-tales', name: 'Grim tales', version: '1.2', author: 'Tester', base: 'pf2e',
  conditions: ['Bleeding', 'Cursed'], damageTypes: ['blood', 'shadow'], initiative: '1d10',
  content: { rollTables: [{ name: 'Omens', entries: 'A raven' }], decks: [{ name: 'Fates', cards: '2x Boon' }], macros: [{ name: 'Brace', text: '/me braces' }] },
}
let r = await call('POST', `/api/workspaces/${ws}/packs`, { pack }, ann)
check('only the owner account installs packs', r.status === 403)
r = await call('POST', `/api/workspaces/${ws}/packs`, { pack: { ...pack, conditons: [] } }, gm)
check('a pack with an unknown field is refused, with the reason', r.status === 400 && /not valid/.test(r.data.error))
r = await call('POST', `/api/workspaces/${ws}/packs`, { pack: { format: 'other' } }, gm)
check('another kind of file is refused', r.status === 400 && /not a Chronicle system pack/.test(r.data.error))
r = await call('POST', `/api/workspaces/${ws}/packs`, { pack }, gm)
check('the owner installs one', r.status === 200 && r.data.id === 'grim-tales' && r.data.content.rollTables === 1 && r.data.imported.macros === 0)
r = await call('POST', `/api/workspaces/${ws}/packs`, { pack }, gm)
check('the same pack twice is refused unless it is to replace', r.status === 409)
r = await call('POST', `/api/workspaces/${ws}/packs`, { pack: { ...pack, version: '1.3' }, replace: true, importContent: true }, gm)
check('it can be replaced, and its content brought in', r.status === 200 && r.data.imported.rollTables === 1 && r.data.imported.decks === 1 && r.data.imported.macros === 1)
r = await call('GET', `/api/workspaces/${ws}/macros`, null, ann)
check('its macros are shared with the players', r.data.some((m) => m.name === 'Brace' && m.shared))
r = await call('GET', `/api/workspaces/${ws}/packs`, null, vic)
check('everyone in the world can read the packs', r.status === 200 && r.data.length === 1 && r.data[0].pack.version === '1.3' && r.data[0].active === false)
r = await call('PATCH', `/api/workspaces/${ws}`, { settings: { pack: 'nothing-here' } }, gm)
check('a pack that is not installed cannot be chosen', r.status === 400)
r = await call('PATCH', `/api/workspaces/${ws}`, { settings: { pack: 'grim-tales' } }, gm)
check('choosing a pack plays by the engine it is built on', r.status === 200 && r.data.settings.pack === 'grim-tales' && r.data.settings.system === 'pf2e')
r = await call('GET', `/api/workspaces/${ws}/packs`, null, ann)
check('it is shown as the active one', r.data[0].active === true)
r = await call('PATCH', `/api/workspaces/${ws}`, { settings: { system: '5e' } }, gm)
check('choosing built-in rules leaves the pack', r.data.settings.system === '5e' && !r.data.settings.pack)
await call('PATCH', `/api/workspaces/${ws}`, { settings: { pack: 'grim-tales' } }, gm)
r = await call('DELETE', `/api/workspaces/${ws}/packs/grim-tales`, null, ann)
check('only the owner removes packs', r.status === 403)
r = await call('DELETE', `/api/workspaces/${ws}/packs/grim-tales`, null, gm)
check('the owner removes one', r.status === 200)
r = await call('GET', `/api/workspaces`, null, gm)
const w = r.data.find((x) => x.id === ws)
check('a world does not keep playing by a pack that is gone', !w.settings.pack)
r = await call('DELETE', `/api/workspaces/${ws}/packs/grim-tales`, null, gm)
check('removing it again says it is not there', r.status === 404)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
