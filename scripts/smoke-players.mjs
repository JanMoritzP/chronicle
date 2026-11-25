// node scripts/smoke-players.mjs http://localhost:3222 gm testpass123
// Who plays a character: a member who only reads the world may change the page of the character they play (its text and
// sheet, nothing else), and at the table they become a player who moves that character's tokens.
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

function open(cookie, ws) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(`${base.replace('http', 'ws')}/api/table/${ws}`, { headers: { cookie, origin: base } })
    const c = {
      sock, msgs: [],
      send: (m) => sock.send(JSON.stringify(m)),
      mark: () => c.msgs.length,
      async after(n, pred, ms = 1500) {
        const end = Date.now() + ms
        while (Date.now() < end) { const m = c.msgs.slice(n).find(pred); if (m) return m; await sleep(15) }
        return null
      },
    }
    sock.on('message', (raw) => c.msgs.push(JSON.parse(raw.toString())))
    sock.on('open', () => resolve(c))
    sock.on('error', reject)
    sock.on('unexpected-response', (_q, res) => reject(Object.assign(new Error('refused'), { status: res.statusCode })))
  })
}

const suffix = Math.floor(Math.random() * 1e6)
const gmCookie = await login(user, pass)
const ws = (await call('POST', '/api/workspaces', { name: 'players-test-' + suffix }, gmCookie)).data.id
const mk = async (name, role) => {
  const r = await call('POST', '/api/users', { username: `${name}${suffix}`, password: 'password123', role, worldIds: [ws] }, gmCookie)
  return { id: r.data.id, cookie: await login(`${name}${suffix}`, 'password123') }
}
const reader = await mk('reader', 'viewer')
const other = await mk('other', 'viewer')

const hero = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Hero', props: { type: 'person' } }, gmCookie)).data
const lore = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Secret lore' }, gmCookie)).data

check('a reader cannot change a page they do not play', (await call('PATCH', `/api/pages/${hero.id}`, { title: 'Mine now' }, reader.cookie)).status === 403)
const people = (await call('GET', `/api/workspaces/${ws}/people`, null, gmCookie)).data
check('the people of a world come with their ids and what they may do here', people.some((p) => p.id === reader.id && p.role === 'viewer'))
check('only members can be named as players', (await call('PATCH', `/api/pages/${hero.id}`, { propsPatch: { players: ['nobody'] } }, gmCookie)).status === 400)

// the GM puts a token of the hero on the table before naming the player, so linking and naming are both checked
const gm = await open(gmCookie, ws)
let n = gm.mark()
gm.send({ t: 'scene.create', name: 'Road' })
const scene = (await gm.after(n, (m) => m.t === 'scene')).scene
n = gm.mark()
gm.send({ t: 'token.add', sceneId: scene.id, token: { name: 'Hero', x: 105, y: 105, pageId: hero.id } })
const tok = (await gm.after(n, (m) => m.t === 'token' && m.token.name === 'Hero')).token

const r0 = await open(reader.cookie, ws)
const s0 = await r0.after(0, (m) => m.t === 'snapshot')
check('a reader who plays nothing only watches the table', s0?.you.role === 'spectator')

n = r0.mark()
const named = await call('PATCH', `/api/pages/${hero.id}`, { propsPatch: { players: [reader.id] } }, gmCookie)
check('the GM names who plays a character', named.status === 200)
const snap = await r0.after(n, (m) => m.t === 'snapshot')
check('the reader becomes a player at the table at once', snap?.you.role === 'player')
const owned = await gm.after(0, (m) => m.t === 'token' && m.token.id === tok.id && m.token.owners.includes(reader.id))
check('and moves the tokens of their character', !!owned)
n = gm.mark()
r0.send({ t: 'token.move', moves: [{ id: tok.id, x: 175, y: 105 }] })
check('the move reaches the table', !!(await gm.after(n, (m) => m.t === 'token' && m.token.id === tok.id && m.token.x === 175)))

check('the player changes the text and sheet of their character', (await call('PATCH', `/api/pages/${hero.id}`, { title: 'Hero of the road', propsPatch: { sheet: { v: 1, ruleset: '5e', kind: 'character', name: 'Hero', size: 'Medium', type: 'humanoid', alignment: '', abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, ac: { value: 12, note: '' }, hp: { max: 10, formula: '', current: 10 }, speed: { walk: 30 }, saves: {}, skills: {}, senses: {}, vulnerabilities: '', resistances: '', immunities: '', conditionImmunities: '', languages: '', features: { traits: [], actions: [], bonus: [], reactions: [], legendary: [] } } } }, reader.cookie)).status === 200)
check('but not its tags, its type or who plays it', (await call('PATCH', `/api/pages/${hero.id}`, { tags: ['mine'] }, reader.cookie)).status === 403
  && (await call('PATCH', `/api/pages/${hero.id}`, { propsPatch: { type: null } }, reader.cookie)).status === 403
  && (await call('PATCH', `/api/pages/${hero.id}`, { propsPatch: { players: [reader.id, other.id] } }, reader.cookie)).status === 403)
check('nor replace its props wholesale', (await call('PATCH', `/api/pages/${hero.id}`, { props: { players: [other.id] } }, reader.cookie)).status === 403)
check('nor delete it', (await call('DELETE', `/api/pages/${hero.id}`, null, reader.cookie)).status === 403)
check('other pages stay read-only for them', (await call('PATCH', `/api/pages/${lore.id}`, { title: 'x' }, reader.cookie)).status === 403)
check('and another reader cannot change the hero', (await call('PATCH', `/api/pages/${hero.id}`, { title: 'x' }, other.cookie)).status === 403)

// a token linked later takes the players of its page too
n = gm.mark()
gm.send({ t: 'token.add', sceneId: scene.id, token: { name: 'Horse', x: 245, y: 105 } })
const horse = (await gm.after(n, (m) => m.t === 'token' && m.token.name === 'Horse')).token
n = gm.mark()
gm.send({ t: 'token.update', id: horse.id, patch: { pageId: hero.id } })
check('linking a token to a character gives it to the people who play it', !!(await gm.after(n, (m) => m.t === 'token' && m.token.id === horse.id && m.token.owners.includes(reader.id))))

n = r0.mark()
await call('PATCH', `/api/pages/${hero.id}`, { propsPatch: { players: [] } }, gmCookie)
check('taking the player away takes the tokens back', !!(await gm.after(0, (m) => m.t === 'token' && m.token.id === tok.id && !m.token.owners.includes(reader.id) && m.token.x === 175)))
check('and they watch again', (await r0.after(n, (m) => m.t === 'snapshot'))?.you.role === 'spectator')
check('and can no longer change the page', (await call('PATCH', `/api/pages/${hero.id}`, { title: 'x' }, reader.cookie)).status === 403)

gm.sock.close(); r0.sock.close()
await call('DELETE', `/api/workspaces/${ws}`, null, gmCookie)
if (failed) { console.log(`${failed} failed`); process.exit(1) }
console.log('all passed')
