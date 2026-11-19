// node scripts/smoke-table.mjs http://localhost:3222 gm testpass123
// The live table: scenes, tokens, who sees what, who may do what.
import sharp from 'sharp'
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

/** A table connection that remembers everything it was told. */
function open(cookie, ws) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(`${base.replace('http', 'ws')}/api/table/${ws}`, { headers: { cookie, origin: base } })
    const c = {
      sock, msgs: [], closed: false,
      send: (m) => sock.send(JSON.stringify(m)),
      has: (pred) => c.msgs.some(pred),
      async until(pred, ms = 1500) {
        const end = Date.now() + ms
        while (Date.now() < end) { const m = c.msgs.find(pred); if (m) return m; await sleep(15) }
        return null
      },
      mark: () => c.msgs.length,
      since: (n, pred) => c.msgs.slice(n).filter(pred),
    }
    sock.on('message', (raw) => c.msgs.push(JSON.parse(raw.toString())))
    sock.on('close', () => { c.closed = true })
    sock.on('open', () => resolve(c))
    sock.on('error', (e) => reject(e))
    sock.on('unexpected-response', (_req, res) => reject(Object.assign(new Error('refused'), { status: res.statusCode })))
  })
}

const suffix = Math.floor(Math.random() * 1e6)
const gmCookie = await login(user, pass)
const ws = (await call('POST', '/api/workspaces', { name: 'table-test-' + suffix }, gmCookie)).data.id
const ws2 = (await call('POST', '/api/workspaces', { name: 'table-other-' + suffix }, gmCookie)).data.id
const mkUser = async (name, role, worlds) => {
  const r = await call('POST', '/api/users', { username: `${name}${suffix}`, password: 'password123', role, worldIds: worlds }, gmCookie)
  return { id: r.data.id, cookie: await login(`${name}${suffix}`, 'password123') }
}
const alice = await mkUser('alice', 'editor', [ws])
const bob = await mkUser('bob', 'editor', [ws])
const eve = await mkUser('eve', 'editor', [ws2])
const watcher = await mkUser('watcher', 'viewer', [ws])

let refused = null
try { await open(eve.cookie, ws) } catch (e) { refused = e }
check('a person without the world cannot sit at its table', refused?.status === 404, String(refused?.status))
let anon = null
try { await open('', ws) } catch (e) { anon = e }
check('an anonymous connection is refused', anon?.status === 401)
let foreign = null
try {
  const s = await new Promise((res, rej) => { const w = new WebSocket(`${base.replace('http', 'ws')}/api/table/${ws}`, { headers: { cookie: gmCookie, origin: 'http://evil.example' } }); w.on('open', () => res(w)); w.on('unexpected-response', (_q, r) => rej({ status: r.statusCode })); w.on('error', rej) })
  s.close()
} catch (e) { foreign = e }
check('a page from another site cannot open the table', foreign?.status === 403)

const gm = await open(gmCookie, ws)
const snap = await gm.until((m) => m.t === 'snapshot')
check('GM gets a snapshot as GM, with no scenes yet', snap?.you.role === 'gm' && snap.scenes.length === 0 && snap.sceneId === null)

gm.send({ t: 'scene.create', name: 'Crypt', op: 'a' })
const sc = await gm.until((m) => m.t === 'scene')
check('GM creates a scene; it becomes the active one', sc?.scene.name === 'Crypt' && sc.active === sc.scene.id)
const crypt = sc.scene.id
check('a new scene has a 70 px grid in feet', sc.scene.gridSize === 70 && sc.scene.grid === 'square' && sc.scene.unit === 'ft' && sc.scene.diagonal === '5-10-5')
await gm.until((m) => m.t === 'view' && m.sceneId === crypt)

const pa = await open(alice.cookie, ws)
const psnap = await pa.until((m) => m.t === 'snapshot')
check('a player follows the active scene', psnap?.you.role === 'player' && psnap.sceneId === crypt && psnap.scenes.length === 1)
const pb = await open(bob.cookie, ws)
await pb.until((m) => m.t === 'snapshot')
const sp = await open(watcher.cookie, ws)
const ssnap = await sp.until((m) => m.t === 'snapshot')
check('a viewer of the world is a spectator', ssnap?.you.role === 'spectator')
check('everyone sees who is online', (await gm.until((m) => m.t === 'online' && m.users.length === 4))?.users.length === 4)

// tokens
gm.send({ t: 'token.add', sceneId: crypt, token: { name: 'Aria', x: 140, y: 140, owners: [alice.id] } })
gm.send({ t: 'token.add', sceneId: crypt, token: { name: 'Orc', x: 700, y: 210, hidden: true } })
gm.send({ t: 'token.add', sceneId: crypt, token: { name: 'Bram', x: 280, y: 140, owners: [bob.id] } })
const aria = (await pa.until((m) => m.t === 'token' && m.token.name === 'Aria')).token
const bram = (await pb.until((m) => m.t === 'token' && m.token.name === 'Bram')).token
const orc = (await gm.until((m) => m.t === 'token' && m.token.name === 'Orc')).token
await sleep(150)
check('players see visible tokens', pa.has((m) => m.t === 'token' && m.token.name === 'Bram') && !!aria)
check('players never receive a hidden token', !pa.has((m) => JSON.stringify(m).includes('Orc')) && !sp.has((m) => JSON.stringify(m).includes('Orc')))
check('the GM sees the hidden token', orc.hidden === true)

// moving
let n = pa.mark()
pa.send({ t: 'token.move', moves: [{ id: aria.id, x: 210, y: 140 }] })
const moved = await pb.until((m) => m.t === 'token' && m.token.id === aria.id && m.token.x === 210)
check('a player moves their own token and everyone sees it', !!moved && !!(await gm.until((m) => m.t === 'token' && m.token.id === aria.id && m.token.x === 210)))
n = pa.mark()
pa.send({ t: 'token.move', moves: [{ id: bram.id, x: 999, y: 999 }] })
const reset = await pa.until((m) => m.t === 'token' && m.token.id === bram.id && m.token.x === 280)
check("a player cannot move someone else's token and is told where it really is", !!reset)
sp.send({ t: 'token.move', moves: [{ id: aria.id, x: 5, y: 5 }] })
await sleep(150)
check('a spectator cannot move anything', !gm.has((m) => m.t === 'token' && m.token.id === aria.id && m.token.x === 5))
gm.send({ t: 'token.update', id: bram.id, patch: { locked: true } })
await pb.until((m) => m.t === 'token' && m.token.locked)
pb.send({ t: 'token.move', moves: [{ id: bram.id, x: 300, y: 300 }] })
await sleep(150)
check('a locked token does not move for its owner', !gm.has((m) => m.t === 'token' && m.token.id === bram.id && m.token.x === 300))
gm.send({ t: 'token.move', moves: [{ id: bram.id, x: 350, y: 140 }] })
check('the GM moves a locked token', !!(await pb.until((m) => m.t === 'token' && m.token.id === bram.id && m.token.x === 350)))

// players may turn their token but not rename it
pa.send({ t: 'token.update', id: aria.id, patch: { rotation: 90 }, op: 'rot' })
check('a player can turn their own token', !!(await gm.until((m) => m.t === 'token' && m.token.id === aria.id && m.token.rotation === 90)))
pa.send({ t: 'token.update', id: aria.id, patch: { name: 'Hacker' }, op: 'ren' })
check('a player cannot rename it', !!(await pa.until((m) => m.t === 'nack' && m.op === 'ren')))

// visibility changes
n = pa.mark()
gm.send({ t: 'token.update', id: orc.id, patch: { hidden: false } })
check('revealing a token sends it to the players', !!(await pa.until((m) => m.t === 'token' && m.token.name === 'Orc')))
gm.send({ t: 'token.update', id: orc.id, patch: { hidden: true } })
check('hiding it again removes it from their table', !!(await pa.until((m) => m.t === 'token.remove' && m.ids.includes(orc.id))))
n = pa.mark()
gm.send({ t: 'token.update', id: orc.id, patch: { owners: [alice.id] } })
await sleep(200)
check('the owner of a hidden token still sees it', pa.since(n, (m) => m.t === 'token' && m.token.id === orc.id && m.token.hidden).length > 0)
gm.send({ t: 'token.update', id: orc.id, patch: { owners: [] } })
await pa.until((m, i) => m.t === 'token.remove' && m.ids.includes(orc.id) && pa.msgs.lastIndexOf(m) > 0)

// permissions and settings
pa.send({ t: 'token.add', sceneId: crypt, token: { name: 'Pet' }, op: 'pet' })
check('players cannot add tokens by default', !!(await pa.until((m) => m.t === 'nack' && m.op === 'pet')))
pa.send({ t: 'settings.set', patch: { playersCreateTokens: true }, op: 'set' })
check('players cannot change the table settings', !!(await pa.until((m) => m.t === 'nack' && m.op === 'set')))
gm.send({ t: 'settings.set', patch: { playersCreateTokens: true } })
await pa.until((m) => m.t === 'settings' && m.settings.playersCreateTokens)
pa.send({ t: 'token.add', sceneId: crypt, token: { name: 'Pet', hidden: true, owners: [bob.id] } })
const pet = (await pa.until((m) => m.t === 'token' && m.token.name === 'Pet'))?.token
check('a player adds a token that is theirs, visible and unlocked', pet?.hidden === false && pet.owners.length === 1 && pet.owners[0] === alice.id)
pa.send({ t: 'token.delete', ids: [pet.id], op: 'del' })
check('only the GM deletes tokens', !!(await pa.until((m) => m.t === 'nack' && m.op === 'del')))
gm.send({ t: 'token.delete', ids: [pet.id] })
check('the GM deletes a token and everyone is told', !!(await pb.until((m) => m.t === 'token.remove' && m.ids.includes(pet.id))))

// hit points, armor class, conditions
gm.send({ t: 'token.stat', id: bram.id, stat: { hp: { value: 20, max: 20 }, ac: 15, hpPrivate: true } })
const gmHp = await gm.until((m) => m.t === 'token' && m.token.id === bram.id && m.token.data.hp?.value === 20)
check('the GM sets hit points and armor class', gmHp?.token.data.ac === 15)
check('the owner sees them on a private token', !!(await pb.until((m) => m.t === 'token' && m.token.id === bram.id && m.token.data.hp?.value === 20)))
await sleep(150)
check('other players do not see private hit points', pa.has((m) => m.t === 'token' && m.token.id === bram.id) && !pa.has((m) => m.t === 'token' && m.token.id === bram.id && m.token.data.hp !== undefined))
pb.send({ t: 'token.stat', id: bram.id, damage: 5 })
check('an owner hurts their own token', !!(await gm.until((m) => m.t === 'token' && m.token.id === bram.id && m.token.data.hp?.value === 15)))
pa.send({ t: 'token.stat', id: bram.id, damage: 1, op: 'hit' })
check("a player cannot change someone else's hit points", !!(await pa.until((m) => m.t === 'nack' && m.op === 'hit')))
pb.send({ t: 'token.stat', id: bram.id, stat: { hpPrivate: false }, op: 'priv' })
check('only the GM chooses who sees hit points', !!(await pb.until((m) => m.t === 'nack' && m.op === 'priv')))
gm.send({ t: 'token.stat', id: bram.id, stat: { hp: { temp: 3 } } })
await gm.until((m) => m.t === 'token' && m.token.id === bram.id && m.token.data.hp?.temp === 3)
gm.send({ t: 'token.stat', id: bram.id, damage: 5 })
const soaked = await gm.until((m) => m.t === 'token' && m.token.id === bram.id && m.token.data.hp?.temp === 0 && m.token.data.hp.value === 13)
check('damage wears down temporary hit points first', soaked?.token.data.hp.value === 13)
gm.send({ t: 'token.stat', id: bram.id, damage: -100 })
check('healing stops at the maximum', !!(await gm.until((m) => m.t === 'token' && m.token.id === bram.id && m.token.data.hp?.value === 20)))
gm.send({ t: 'token.stat', id: bram.id, damage: 999 })
check('hit points do not drop below zero', !!(await gm.until((m) => m.t === 'token' && m.token.id === bram.id && m.token.data.hp?.value === 0)))
pb.send({ t: 'token.stat', id: bram.id, stat: { conditions: ['prone', 'prone', 'poisoned'] } })
const cond = await pa.until((m) => m.t === 'token' && m.token.id === bram.id && m.token.data.conditions?.length === 2)
check('conditions are shown to everyone, once each', !!cond)
gm.send({ t: 'settings.set', patch: { playersEditOwnStats: false } })
await pb.until((m) => m.t === 'settings' && !m.settings.playersEditOwnStats)
pb.send({ t: 'token.stat', id: bram.id, damage: -1, op: 'off' })
check('the GM can switch off players editing stats', !!(await pb.until((m) => m.t === 'nack' && m.op === 'off')))
gm.send({ t: 'settings.set', patch: { playersEditOwnStats: true } })
await pb.until((m) => m.t === 'settings' && m.settings.playersEditOwnStats)
gm.send({ t: 'token.stat', id: bram.id, stat: { hp: { value: 'lots' } }, op: 'bad' })
check('a wrong hit point value is refused', !!(await gm.until((m) => m.t === 'nack' && m.op === 'bad')))

// chat and dice
const aliceName = `alice${suffix}`
pa.send({ t: 'chat', text: 'Hello table' })
check('talk reaches everyone', !!(await gm.until((m) => m.t === 'chat.msg' && m.msg.parts[0]?.text === 'Hello table' && m.msg.name === aliceName)) && !!(await sp.until((m) => m.t === 'chat.msg' && m.msg.parts[0]?.text === 'Hello table')))
pa.send({ t: 'chat', text: '/roll 2d20kh1+3 perception' })
const rolled = await pb.until((m) => m.t === 'chat.msg' && m.msg.kind === 'roll')
const rr = rolled?.msg.parts[0].roll
check('a roll is made by the server and shown to everyone', rr && rr.label === 'perception' && rr.total === rr.terms[0].dice.filter((d) => !d.dropped).reduce((a, d) => a + d.v, 0) + 3 && rr.total >= 4 && rr.total <= 23)
pa.send({ t: 'chat', text: `/w bob${suffix} the key is under the mat` })
check('a whisper reaches its target', !!(await pb.until((m) => m.t === 'chat.msg' && m.msg.kind === 'whisper' && m.msg.parts[0].text === 'the key is under the mat')))
await sleep(150)
check('a whisper reaches nobody else, not even the GM', !gm.has((m) => m.t === 'chat.msg' && m.msg.kind === 'whisper') && !sp.has((m) => m.t === 'chat.msg' && m.msg.kind === 'whisper'))
pa.send({ t: 'chat', text: '/gmroll 1d20' })
check('a GM roll reaches the GM', !!(await gm.until((m) => m.t === 'chat.msg' && m.msg.kind === 'gmroll')))
await sleep(150)
check('and nobody else', !pb.has((m) => m.t === 'chat.msg' && m.msg.kind === 'gmroll'))
pa.send({ t: 'chat', text: '/w nobody hi', op: 'who' })
check('a whisper to nobody says so', !!(await pa.until((m) => m.t === 'nack' && m.op === 'who')))
pa.send({ t: 'chat', text: '/roll banana', op: 'ban' })
check('a bad roll says so', !!(await pa.until((m) => m.t === 'nack' && m.op === 'ban')))
sp.send({ t: 'chat', text: '/roll 1d20', op: 'spr' })
check('spectators cannot roll', !!(await sp.until((m) => m.t === 'nack' && m.op === 'spr')))
sp.send({ t: 'chat', text: 'nice map' })
check('but they can talk', !!(await gm.until((m) => m.t === 'chat.msg' && m.msg.parts[0]?.text === 'nice map')))
gm.send({ t: 'chat', text: 'The door creaks open.', as: 'Narrator' })
check('the GM can speak as someone else', !!(await pb.until((m) => m.t === 'chat.msg' && m.msg.name === 'Narrator')))
pa.send({ t: 'chat', text: 'hi', as: 'Narrator' })
check('a player cannot', !!(await pb.until((m) => m.t === 'chat.msg' && m.msg.parts[0]?.text === 'hi' && m.msg.name === aliceName)))

// ephemeral things
n = pb.mark()
pa.send({ t: 'ping', x: 50, y: 60 })
check('a ping reaches the others on the scene', !!(await pb.until((m) => m.t === 'ping' && m.x === 50 && m.name === `alice${suffix}`)))
pa.send({ t: 'ruler', points: [{ x: 0, y: 0 }, { x: 70, y: 70 }] })
check('a ruler is shared', !!(await gm.until((m) => m.t === 'ruler' && m.points?.length === 2)))
gm.send({ t: 'settings.set', patch: { playersPing: false } })
await pa.until((m) => m.t === 'settings' && !m.settings.playersPing)
n = pb.mark()
pa.send({ t: 'ping', x: 1, y: 1 })
await sleep(200)
check('pings can be switched off for players', pb.since(n, (m) => m.t === 'ping').length === 0)
sp.send({ t: 'ping', x: 2, y: 2 })
await sleep(150)
check('a spectator cannot ping', !gm.has((m) => m.t === 'ping' && m.x === 2))

// bad input
gm.send({ t: 'token.update', id: aria.id, patch: { size: 9999 }, op: 'big' })
check('out of range values are refused', !!(await gm.until((m) => m.t === 'nack' && m.op === 'big')))
gm.send({ t: 'token.update', id: aria.id, patch: { image: 'https://evil.example/x.png' }, op: 'img' })
check('an outside image address is refused', !!(await gm.until((m) => m.t === 'nack' && m.op === 'img')))
gm.send({ t: 'nonsense', op: 'junk' })
check('an unknown message is refused', !!(await gm.until((m) => m.t === 'nack' && m.op === 'junk')))
gm.send({ t: 'token.update', id: aria.id, patch: { pageId: 'not-a-page' }, op: 'pg' })
check('a page that is not in the world cannot be linked', !!(await gm.until((m) => m.t === 'nack' && m.op === 'pg')))

// scenes and backgrounds
const form = async (cookie, world, buf) => {
  const f = new FormData()
  f.append('file', new Blob([buf], { type: 'image/png' }), 'map.png')
  const r = await fetch(`${base}/api/workspaces/${world}/uploads`, { method: 'POST', headers: { cookie }, body: f })
  return r.json()
}
const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#335' } }).png().toBuffer()
const up = await form(gmCookie, ws, png)
gm.send({ t: 'scene.update', id: crypt, patch: { bg: up.url, gridSize: 80 } })
const upd = await gm.until((m) => m.t === 'scene' && m.scene.bg === up.url)
check('a background sets the scene size from the image', upd?.scene.width === 640 && upd.scene.height === 480 && upd.scene.gridSize === 80)
const foreignUp = await form(gmCookie, ws2, png)
gm.send({ t: 'scene.update', id: crypt, patch: { bg: foreignUp.url }, op: 'fb' })
check("another world's image cannot be a background", !!(await gm.until((m) => m.t === 'nack' && m.op === 'fb')))
pa.send({ t: 'scene.update', id: crypt, patch: { name: 'Mine' }, op: 'sn' })
check('players cannot change scenes', !!(await pa.until((m) => m.t === 'nack' && m.op === 'sn')))

gm.send({ t: 'scene.create', name: 'Tavern' })
const tav = (await gm.until((m) => m.t === 'scene' && m.scene.name === 'Tavern')).scene.id
gm.send({ t: 'token.add', sceneId: tav, token: { name: 'Barkeep', x: 70, y: 70 } })
await sleep(150)
check('a token on another scene is not sent to those looking elsewhere', !pa.has((m) => m.t === 'token' && m.token.name === 'Barkeep'))
n = pa.mark()
gm.send({ t: 'scene.activate', id: tav })
const view = await pa.until((m) => m.t === 'view' && m.sceneId === tav)
check('activating a scene moves the players to it with its tokens', !!view && view.tokens.some((t) => t.name === 'Barkeep') && !view.tokens.some((t) => t.name === 'Aria'))
const gview = await gm.until((m) => m.t === 'view' && m.sceneId === tav)
check('the GM who activated it comes along', !!gview)
gm.send({ t: 'view', sceneId: crypt })
check('the GM can look at another scene without moving the players', !!(await gm.until((m) => m.t === 'view' && m.sceneId === crypt)))
pa.send({ t: 'view', sceneId: crypt })
await sleep(150)
check('a player cannot choose their own scene', !pa.has((m) => m.t === 'view' && m.sceneId === crypt))

// persistence: a new connection sees the table as it was left
const gm2 = await open(gmCookie, ws)
const again = await gm2.until((m) => m.t === 'snapshot')
check('a new connection sees the stored table', again?.scenes.length === 2 && again.active === tav && again.settings.playersCreateTokens === true, JSON.stringify({ n: again?.scenes.length, a: again?.active === tav, s: again?.settings }))
check('chat history comes with the snapshot, without private messages', again?.chat.some((x) => x.parts[0]?.text === 'Hello table') && !again.chat.some((x) => x.kind === 'whisper'))
gm2.send({ t: 'view', sceneId: crypt })
const back = await gm2.until((m) => m.t === 'view' && m.sceneId === crypt)
check('tokens are stored with their positions', back?.tokens.find((t) => t.name === 'Aria')?.x === 210 && back.tokens.some((t) => t.name === 'Orc' && t.hidden))

gm.send({ t: 'scene.delete', id: tav })
const gone = await pa.until((m) => m.t === 'scene.remove' && m.id === tav)
check('deleting the active scene moves the table to another', gone?.active === crypt && !!(await pa.until((m) => m.t === 'view' && m.sceneId === crypt && pa.msgs.indexOf(m) > pa.msgs.indexOf(gone))))

for (const c of [gm, gm2, pa, pb, sp]) c.sock.close()
await call('DELETE', `/api/workspaces/${ws}`, null, gmCookie)
await call('DELETE', `/api/workspaces/${ws2}`, null, gmCookie)
for (const u of [bob, eve, watcher]) await call('DELETE', `/api/users/${u.id}`, null, gmCookie)
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
