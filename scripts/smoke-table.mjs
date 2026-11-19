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

// walls, light and fog
gm.send({ t: 'scene.update', id: crypt, patch: { fog: true, darkness: 0.8 } })
const fogScene = await pa.until((m) => m.t === 'scene' && m.scene.fog === true)
check('the GM turns fog and darkness on for a scene', fogScene?.scene.darkness === 0.8)
pa.send({ t: 'scene.update', id: crypt, patch: { fog: false }, op: 'pfog' })
check('players cannot turn fog off', !!(await pa.until((m) => m.t === 'nack' && m.op === 'pfog')))
gm.send({ t: 'wall.add', sceneId: crypt, walls: [{ x1: 0, y1: 0, x2: 700, y2: 0 }, { x1: 700, y1: 0, x2: 700, y2: 400, kind: 'door' }, { x1: 0, y1: 400, x2: 700, y2: 400, kind: 'secret' }, { x1: 5, y1: 5, x2: 5, y2: 5 }] })
const wl = await pa.until((m) => m.t === 'walls' && m.walls.length === 3)
check('walls are stored and sent to everyone, empty ones dropped', !!wl)
check('a secret door looks like a wall to players', wl.walls.some((w) => w.y1 === 400 && w.kind === 'wall') && wl.walls.some((w) => w.kind === 'door'))
const gwl = await gm.until((m) => m.t === 'walls' && m.walls.length === 3)
check('but not to the GM', gwl.walls.some((w) => w.kind === 'secret'))
pa.send({ t: 'wall.add', sceneId: crypt, walls: [{ x1: 1, y1: 1, x2: 9, y2: 9 }], op: 'pw' })
check('players cannot draw walls', !!(await pa.until((m) => m.t === 'nack' && m.op === 'pw')))
const door = gwl.walls.find((w) => w.kind === 'door')
pa.send({ t: 'door.toggle', id: door.id, op: 'pd' })
check('players cannot open doors unless the table allows it', !!(await pa.until((m) => m.t === 'nack' && m.op === 'pd')))
gm.send({ t: 'door.toggle', id: door.id })
check('the GM opens a door', !!(await pa.until((m) => m.t === 'walls' && m.walls.find((w) => w.id === door.id)?.open === true)))
gm.send({ t: 'settings.set', patch: { playersOpenDoors: true } })
await pa.until((m) => m.t === 'settings' && m.settings.playersOpenDoors)
pa.send({ t: 'door.toggle', id: door.id })
check('a player can once the table allows it', !!(await gm.until((m) => m.t === 'walls' && m.walls.find((w) => w.id === door.id)?.open === false)))
const secret = gwl.walls.find((w) => w.kind === 'secret')
pa.send({ t: 'door.toggle', id: secret.id, op: 'ps' })
check('a secret door cannot be opened by a player', !!(await pa.until((m) => m.t === 'nack' && m.op === 'ps')))
gm.send({ t: 'wall.update', id: secret.id, patch: { kind: 'wall' } })
check('the GM changes a wall', !!(await gm.until((m) => m.t === 'walls' && m.walls.find((w) => w.id === secret.id)?.kind === 'wall')))
gm.send({ t: 'wall.delete', ids: [secret.id] })
check('and deletes one', !!(await pa.until((m) => m.t === 'walls' && m.walls.length === 2)))

gm.send({ t: 'token.update', id: orc.id, patch: { data: { light: { bright: 20, dim: 40, color: '#ffcc66' } } } })
const lit = await pa.until((m) => m.t === 'lights' && m.lights.length === 1)
check('light from a token, even a hidden one, is sent to everyone', lit?.lights[0].bright === 20 && lit.lights[0].id === orc.id)
gm.send({ t: 'token.move', moves: [{ id: orc.id, x: 640, y: 210 }] })
check('the light follows the token', !!(await pa.until((m) => m.t === 'lights' && m.lights[0]?.x === 640)))
gm.send({ t: 'token.update', id: orc.id, patch: { data: { light: { bright: -5 } } }, op: 'badl' })
check('a bad light is refused', !!(await gm.until((m) => m.t === 'nack' && m.op === 'badl')))
gm.send({ t: 'token.update', id: orc.id, patch: { data: { vision: { sight: 'far' } } }, op: 'badv' })
check('a bad vision value is refused', !!(await gm.until((m) => m.t === 'nack' && m.op === 'badv')))
gm.send({ t: 'token.update', id: orc.id, patch: { data: {} } })
check('removing the light turns it off', !!(await pa.until((m) => m.t === 'lights' && m.lights.length === 0)))

pa.send({ t: 'fog.save', sceneId: crypt, mask: Buffer.from('fogpicture').toString('base64') })
await sleep(150)
const pa2 = await open(alice.cookie, ws)
const alSnap = await pa2.until((m) => m.t === 'snapshot')
check("explored fog is stored for the player and comes back with the view", alSnap?.fog === Buffer.from('fogpicture').toString('base64') && alSnap.walls.length === 2)
check("and is not given to others", (await (async () => { const g = await open(gmCookie, ws); const s = await g.until((m) => m.t === 'snapshot'); g.sock.close(); return s })()).fog === null)
pa2.sock.close()
sp.send({ t: 'fog.save', sceneId: crypt, mask: 'AAAA' })
pa.send({ t: 'fog.reset', sceneId: crypt, op: 'pfr' })
check('players cannot reset fog', !!(await pa.until((m) => m.t === 'nack' && m.op === 'pfr')))
gm.send({ t: 'fog.reset', sceneId: crypt })
check('the GM resets fog for everyone', !!(await pa.until((m) => m.t === 'fog.reset' && m.sceneId === crypt)))
gm.send({ t: 'scene.update', id: crypt, patch: { fog: false, darkness: 0 } })
await pa.until((m) => m.t === 'scene' && m.scene.fog === false)
gm.send({ t: 'wall.delete', ids: gwl.walls.filter((w) => w.id !== secret.id).map((w) => w.id) })

// combat
const pg = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Quick goblin', props: { type: 'monster', sheet: { v: 1, ruleset: '5e', name: 'Quick goblin', size: 'Small', type: 'humanoid', alignment: '', abilities: { str: 8, dex: 20, con: 10, int: 10, wis: 8, cha: 8 }, ac: { value: 15, note: '' }, hp: { max: 7, formula: '' }, speed: { walk: 30 }, saves: {}, skills: {}, senses: {}, vulnerabilities: '', resistances: '', immunities: '', conditionImmunities: '', languages: '', features: { traits: [], actions: [], bonus: [], reactions: [], legendary: [] } } } }, gmCookie)).data
gm.send({ t: 'token.add', sceneId: crypt, token: { name: 'Goblin', x: 420, y: 420, hidden: true } })
const gob = (await gm.until((m) => m.t === 'token' && m.token.name === 'Goblin')).token
gm.send({ t: 'token.update', id: gob.id, patch: { pageId: pg.id } })
pa.send({ t: 'combat.add', tokenIds: [aria.id], op: 'pca' })
check('players cannot start a combat', !!(await pa.until((m) => m.t === 'nack' && m.op === 'pca')))
gm.send({ t: 'combat.add', tokenIds: [aria.id, bram.id, gob.id] })
const c1 = await gm.until((m) => m.t === 'combat' && m.combat.list.length === 3)
check('the GM adds tokens to the order', !!c1 && c1.combat.list.map((x) => x.name).sort().join() === 'Aria,Bram,Goblin')
const pc1 = await pa.until((m) => m.t === 'combat' && m.combat.list.length === 2)
check('players do not see a hidden combatant', !!pc1 && !pc1.combat.list.some((x) => x.name === 'Goblin'))
gm.send({ t: 'combat.add', tokenIds: [aria.id] })
await sleep(150)
check('a token is added once', gm.msgs.filter((m) => m.t === 'combat').at(-1).combat.list.length === 3)
const cAria = c1.combat.list.find((x) => x.name === 'Aria')
pa.send({ t: 'combat.init', id: cAria.id, value: 17 })
check('a player sets the initiative of their own token', !!(await gm.until((m) => m.t === 'combat' && m.combat.list.find((x) => x.name === 'Aria')?.init === 17)))
const cBram = c1.combat.list.find((x) => x.name === 'Bram')
pa.send({ t: 'combat.init', id: cBram.id, value: 99, op: 'pci' })
check("but not of someone else's", !!(await pa.until((m) => m.t === 'nack' && m.op === 'pci')))
n = pb.mark()
gm.send({ t: 'combat.roll' })
const rolledAll = await gm.until((m) => m.t === 'combat' && m.combat.list.every((x) => x.init !== null))
check('the GM rolls for everyone without initiative, using the sheet', !!rolledAll)
const gobInit = rolledAll.combat.list.find((x) => x.name === 'Goblin').init
check('a creature with a sheet adds its Dexterity bonus (+5)', gobInit >= 6 && gobInit <= 25)
await sleep(150)
check('a hidden combatant rolls privately', !pb.since(n, (m) => m.t === 'chat.msg' && JSON.stringify(m).includes('Goblin')).length && gm.has((m) => m.t === 'chat.msg' && m.msg.kind === 'gmroll' && JSON.stringify(m).includes('Goblin')))
check('the others roll in the open', pb.since(n, (m) => m.t === 'chat.msg' && m.msg.kind === 'roll' && JSON.stringify(m).includes('Bram')).length > 0)
gm.send({ t: 'combat.init', id: cAria.id, value: 30 })
gm.send({ t: 'combat.init', id: cBram.id, value: 12 })
gm.send({ t: 'combat.control', action: 'start' })
const started = await pa.until((m) => m.t === 'combat' && m.combat.active && m.combat.round === 1 && m.combat.turn === cAria.id)
check('starting gives the highest the first turn and shows it to players', !!started)
pb.send({ t: 'combat.control', action: 'next', op: 'pbn' })
check("a player cannot end someone else's turn", !!(await pb.until((m) => m.t === 'nack' && m.op === 'pbn')))
pa.send({ t: 'combat.control', action: 'next' })
const second = await gm.until((m) => m.t === 'combat' && m.combat.round === 1 && m.combat.turn !== cAria.id && m.combat.active)
check('the player whose turn it is ends it', !!second)
gm.send({ t: 'combat.flag', id: cBram.id, done: true })
await gm.until((m) => m.t === 'combat' && m.combat.list.find((x) => x.id === cBram.id)?.done)
gm.send({ t: 'combat.control', action: 'prev' })
check('the GM steps back', !!(await gm.until((m) => m.t === 'combat' && m.combat.turn === cAria.id && gm.msgs.indexOf(m) > gm.msgs.indexOf(second))))
gm.send({ t: 'combat.flag', id: c1.combat.list.find((x) => x.name === 'Goblin').id, hidden: false })
check('revealing a combatant shows it to players', !!(await pa.until((m) => m.t === 'combat' && m.combat.list.some((x) => x.name === 'Goblin'))))
gm.send({ t: 'token.delete', ids: [gob.id] })
check('deleting a token takes it out of the order', !!(await gm.until((m) => m.t === 'combat' && !m.combat.list.some((x) => x.name === 'Goblin'))))
gm.send({ t: 'combat.control', action: 'end' })
check('ending stops the combat but keeps the list', !!(await pa.until((m) => m.t === 'combat' && !m.combat.active && m.combat.list.length === 2)))
gm.send({ t: 'combat.control', action: 'clear' })
check('clearing empties it', !!(await pa.until((m) => m.t === 'combat' && m.combat.list.length === 0)))
pa.send({ t: 'combat.control', action: 'clear', op: 'pcc' })
check('players cannot clear it', !!(await pa.until((m) => m.t === 'nack' && m.op === 'pcc')))

// encounters
const enc = (await call('POST', `/api/workspaces/${ws}/encounters`, { name: 'Goblin ambush', party: [3, 3, 3, 3], monsters: [{ pageId: pg.id, count: 3 }] }, gmCookie)).data
check('an encounter is saved', enc?.id && enc.monsters[0].count === 3 && enc.party.length === 4)
check('players cannot read encounters', (await call('GET', `/api/workspaces/${ws}/encounters`, null, alice.cookie)).status === 403)
n = pa.mark()
gm.send({ t: 'encounter.stage', id: enc.id, sceneId: crypt, x: 100, y: 100, hidden: true, combat: true })
const staged = await gm.until((m) => m.t === 'staged')
check('staging reports how many tokens it placed', staged?.count === 3)
await sleep(300)
const placed = gm.msgs.filter((m) => m.t === 'token' && m.token.name.startsWith('Quick goblin ')).map((m) => m.token)
check('the creatures are placed hidden, named, linked to their page, with hit points', placed.length === 3 && placed.every((t) => t.hidden && t.pageId === pg.id && t.data.hp?.max === 7 && t.data.ac === 15 && t.data.hpPrivate) && new Set(placed.map((t) => t.name)).size === 3)
check('players are not told about them', pa.since(n, (m) => JSON.stringify(m).includes('Quick goblin')).length === 0)
const fight = gm.msgs.filter((m) => m.t === 'combat').at(-1).combat
check('with combat on, they are in the order with initiative rolled', fight.list.filter((x) => x.name.startsWith('Quick goblin')).length === 3 && fight.list.filter((x) => x.name.startsWith('Quick goblin')).every((x) => x.init !== null && x.hidden))
pa.send({ t: 'encounter.stage', id: enc.id, sceneId: crypt, x: 0, y: 0, op: 'pst' })
check('players cannot stage encounters', !!(await pa.until((m) => m.t === 'nack' && m.op === 'pst')))
const encUpd = await call('PATCH', `/api/encounters/${enc.id}`, { name: 'Goblin ambush 2', party: [4], monsters: [] }, gmCookie)
check('an encounter can be changed', encUpd.data.name === 'Goblin ambush 2' && encUpd.data.monsters.length === 0)
const foreignPage = (await call('POST', `/api/workspaces/${ws2}/pages`, { title: 'Elsewhere' }, gmCookie)).data
check("a creature from another world is refused", (await call('POST', `/api/workspaces/${ws}/encounters`, { name: 'Bad', monsters: [{ pageId: foreignPage.id, count: 1 }] }, gmCookie)).status === 400)
check('an encounter can be deleted', (await call('DELETE', `/api/encounters/${enc.id}`, null, gmCookie)).status === 200 && (await call('GET', `/api/workspaces/${ws}/encounters`, null, gmCookie)).data.length === 0)
gm.send({ t: 'combat.control', action: 'clear' })
gm.send({ t: 'token.delete', ids: placed.map((t) => t.id) })
await sleep(200)

// drawing
pa.send({ t: 'draw.add', sceneId: crypt, kind: 'free', points: [{ x: 10, y: 10 }, { x: 40, y: 30 }, { x: 80, y: 20 }], color: '#ff5252', width: 4 })
const sketch = await gm.until((m) => m.t === 'draw' && m.drawing.kind === 'free' && m.drawing.points.length === 3)
check('a player draws and everyone sees it', !!sketch && !!(await pb.until((m) => m.t === 'draw' && m.drawing.id === sketch.drawing.id)) && sketch.drawing.userId === alice.id)
gm.send({ t: 'draw.add', sceneId: crypt, kind: 'text', points: [{ x: 200, y: 200 }], color: '#ffffff', width: 6, text: 'Secret trap here', gmOnly: true })
const note = await gm.until((m) => m.t === 'draw' && m.drawing.text === 'Secret trap here')
await sleep(200)
check('a GM-only drawing is not sent to players', !!note && note.drawing.gmOnly && !pa.has((m) => JSON.stringify(m).includes('Secret trap')))
pa.send({ t: 'draw.add', sceneId: crypt, kind: 'text', points: [{ x: 5, y: 5 }], color: '#ffffff', width: 6, text: 'mine', gmOnly: true })
const mine = await gm.until((m) => m.t === 'draw' && m.drawing.text === 'mine')
check('a player cannot make a drawing GM-only', mine?.drawing.gmOnly === false)
pb.send({ t: 'draw.delete', ids: [sketch.drawing.id], op: 'pbd' })
check("a player cannot remove someone else's drawing", !!(await pb.until((m) => m.t === 'nack' && m.op === 'pbd')))
pa.send({ t: 'draw.delete', ids: [sketch.drawing.id] })
check('but can remove their own', !!(await gm.until((m) => m.t === 'draw.remove' && m.ids.includes(sketch.drawing.id))))
pa.send({ t: 'draw.add', sceneId: crypt, kind: 'line', points: [{ x: 0, y: 0 }, { x: 9, y: 9 }], color: 'red', width: 4, op: 'bc' })
check('a bad colour is refused', !!(await pa.until((m) => m.t === 'nack' && m.op === 'bc')))
sp.send({ t: 'draw.add', sceneId: crypt, kind: 'line', points: [{ x: 0, y: 0 }, { x: 9, y: 9 }], color: '#fff', width: 4, op: 'spd' })
check('a spectator cannot draw', !!(await sp.until((m) => m.t === 'nack' && m.op === 'spd')))
gm.send({ t: 'settings.set', patch: { playersDraw: false } })
await pa.until((m) => m.t === 'settings' && !m.settings.playersDraw)
pa.send({ t: 'draw.add', sceneId: crypt, kind: 'line', points: [{ x: 0, y: 0 }, { x: 9, y: 9 }], color: '#fff', width: 4, op: 'off' })
check('the GM can switch drawing off for players', !!(await pa.until((m) => m.t === 'nack' && m.op === 'off')))
gm.send({ t: 'settings.set', patch: { playersDraw: true } })
await pa.until((m) => m.t === 'settings' && m.settings.playersDraw)
const pa3 = await open(alice.cookie, ws)
const snap3 = await pa3.until((m) => m.t === 'snapshot')
check('drawings come back with the view, minus the GM-only ones', snap3?.drawings.some((d) => d.text === 'mine') && !snap3.drawings.some((d) => d.text === 'Secret trap here'))
pa3.sock.close()
pa.send({ t: 'draw.clear', sceneId: crypt, op: 'pcl' })
check('players cannot clear the scene', !!(await pa.until((m) => m.t === 'nack' && m.op === 'pcl')))
gm.send({ t: 'draw.clear', sceneId: crypt })
check('the GM clears every drawing', !!(await pa.until((m) => m.t === 'draw.cleared' && m.sceneId === crypt)))

// a character's hit points follow their token
const charSheet = { v: 1, kind: 'character', ruleset: '5e', name: 'Hero', size: '', type: '', alignment: '', abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, ac: { value: 16, note: '' }, hp: { max: 30, formula: '', current: 30, temp: 0 }, speed: { walk: 30 }, saves: {}, skills: {}, senses: {}, vulnerabilities: '', resistances: '', immunities: '', conditionImmunities: '', languages: '', features: { traits: [], actions: [], bonus: [], reactions: [], legendary: [] }, classes: [{ name: 'Fighter', level: 3 }] }
const heroPage = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Hero', props: { type: 'person', sheet: charSheet } }, gmCookie)).data
gm.send({ t: 'token.add', sceneId: crypt, token: { name: 'Hero', x: 70, y: 70, owners: [alice.id] } })
const heroTok = (await gm.until((m) => m.t === 'token' && m.token.name === 'Hero')).token
gm.send({ t: 'token.update', id: heroTok.id, patch: { pageId: heroPage.id } })
gm.send({ t: 'token.stat', id: heroTok.id, stat: { hp: { value: 30, max: 30 } } })
pa.send({ t: 'token.stat', id: heroTok.id, damage: 12 })
await gm.until((m) => m.t === 'token' && m.token.id === heroTok.id && m.token.data.hp?.value === 18)
await sleep(200)
check('damage on the table is on the sheet', (await call('GET', `/api/pages/${heroPage.id}`, null, gmCookie)).data.props.sheet.hp.current === 18)
gm.send({ t: 'token.stat', id: heroTok.id, stat: { hp: { temp: 5 } } })
await sleep(250)
check('and so are temporary hit points', (await call('GET', `/api/pages/${heroPage.id}`, null, gmCookie)).data.props.sheet.hp.temp === 5)
gm.send({ t: 'token.delete', ids: [heroTok.id] })
await sleep(100)

// tiles and templates
const tilePng = await sharp({ create: { width: 300, height: 150, channels: 3, background: '#a52' } }).png().toBuffer()
const tileUpload = async (cookie, world) => {
  const f = new FormData()
  f.append('file', new Blob([tilePng], { type: 'image/png' }), 'table.png')
  return (await fetch(`${base}/api/workspaces/${world}/uploads`, { method: 'POST', headers: { cookie }, body: f })).json()
}
const tileImg = await tileUpload(gmCookie, ws)
pa.send({ t: 'tile.add', sceneId: crypt, image: tileImg.url, x: 100, y: 100, op: 'pt' })
check('players cannot place tiles', !!(await pa.until((m) => m.t === 'nack' && m.op === 'pt')))
gm.send({ t: 'tile.add', sceneId: crypt, image: tileImg.url, x: 350, y: 280 })
const tl = await pa.until((m) => m.t === 'tiles' && m.tiles.length === 1)
check('the GM places a tile; everyone sees it, sized to about three cells', !!tl && tl.tiles[0].w === 210 && tl.tiles[0].h === 105 && tl.tiles[0].layer === 'bg')
const tileId = tl.tiles[0].id
gm.send({ t: 'tile.update', id: tileId, patch: { x: 400, rotation: 45, w: 300, layer: 'overhead' } })
check('a tile is moved, turned, resized and moved to another layer', !!(await pa.until((m) => m.t === 'tiles' && m.tiles[0]?.x === 400 && m.tiles[0].rotation === 45 && m.tiles[0].layer === 'overhead' && m.tiles[0].w === 300)))
gm.send({ t: 'tile.update', id: tileId, patch: { layer: 'gm' } })
check('a tile on the GM layer is taken away from the players', !!(await pa.until((m) => m.t === 'tiles' && m.tiles.length === 0)) && !!(await gm.until((m) => m.t === 'tiles' && m.tiles.length === 1 && m.tiles[0].layer === 'gm')))
gm.send({ t: 'tile.update', id: tileId, patch: { layer: 'bg', hidden: true } })
await sleep(200)
check('and so is a hidden one', !pa.msgs.filter((m) => m.t === 'tiles').at(-1).tiles.length)
gm.send({ t: 'tile.update', id: tileId, patch: { hidden: false } })
await pa.until((m) => m.t === 'tiles' && m.tiles.length === 1)
pa.send({ t: 'tile.update', id: tileId, patch: { x: 1 }, op: 'pu' })
check('players cannot change tiles', !!(await pa.until((m) => m.t === 'nack' && m.op === 'pu')))
gm.send({ t: 'tile.update', id: tileId, patch: { layer: 'sky' }, op: 'bl' })
check('an unknown layer is refused', !!(await gm.until((m) => m.t === 'nack' && m.op === 'bl')))
const otherImg = await tileUpload(gmCookie, ws2)
gm.send({ t: 'tile.add', sceneId: crypt, image: otherImg.url, x: 0, y: 0, op: 'oi' })
check("another world's image cannot be a tile", !!(await gm.until((m) => m.t === 'nack' && m.op === 'oi')))
const pa4 = await open(alice.cookie, ws)
check('tiles come with the view', (await pa4.until((m) => m.t === 'snapshot'))?.tiles.length === 1)
pa4.sock.close()
gm.send({ t: 'tile.delete', ids: [tileId] })
check('the GM removes a tile', !!(await pa.until((m) => m.t === 'tiles' && m.tiles.length === 0)))
for (const kind of ['cone', 'beam', 'blast', 'cube']) {
  pa.send({ t: 'draw.add', sceneId: crypt, kind, points: [{ x: 100, y: 100 }, { x: 240, y: 100 }], color: '#ff5252', width: 3 })
  check(`a ${kind} template can be placed`, !!(await gm.until((m) => m.t === 'draw' && m.drawing.kind === kind)))
}
gm.send({ t: 'draw.clear', sceneId: crypt })
await sleep(100)

// Pathfinder 2e
await call('PATCH', `/api/workspaces/${ws}`, { settings: { system: 'pf2e' } }, gmCookie)
pa.send({ t: 'chat', text: '/roll 1d20+40 Athletics dc 20' })
const degr = await gm.until((m) => m.t === 'chat.msg' && m.msg.parts[0]?.roll?.dc === 20)
check('in a Pathfinder world a roll against a DC gets a degree of success', degr?.msg.parts[0].roll.degree === 'critical success')
pa.send({ t: 'chat', text: '/roll 1d20 dc 99' })
check('a DC that cannot be met is a failure of some degree', /failure/.test((await gm.until((m) => m.t === 'chat.msg' && m.msg.parts[0]?.roll?.dc === 99))?.msg.parts[0].roll.degree ?? ''))
const pfPage = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Watcher', props: { type: 'monster', sheet: { v: 1, ruleset: 'pf2e', name: 'Watcher', size: '', type: '', alignment: '', abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, ac: { value: 20, note: '' }, hp: { max: 40, formula: '' }, speed: { walk: 25 }, saves: {}, skills: {}, senses: {}, vulnerabilities: '', resistances: '', immunities: '', conditionImmunities: '', languages: '', features: { traits: [], actions: [], bonus: [], reactions: [], legendary: [] }, pf2e: { level: 5, perception: 20, fort: 12, ref: 12, will: 12, mods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, traits: [], rarity: 'common' } } } }, gmCookie)).data
gm.send({ t: 'token.add', sceneId: crypt, token: { name: 'Watcher', x: 140, y: 420 } })
const pfTok = (await gm.until((m) => m.t === 'token' && m.token.name === 'Watcher')).token
gm.send({ t: 'token.update', id: pfTok.id, patch: { pageId: pfPage.id } })
gm.send({ t: 'combat.add', tokenIds: [pfTok.id] })
gm.send({ t: 'combat.roll' })
const pfInit = await gm.until((m) => m.t === 'combat' && m.combat.list.find((x) => x.name === 'Watcher')?.init != null)
check('a Pathfinder creature rolls initiative with Perception', pfInit.combat.list.find((x) => x.name === 'Watcher').init >= 21 && pfInit.combat.list.find((x) => x.name === 'Watcher').init <= 40)
gm.send({ t: 'combat.control', action: 'clear' })
gm.send({ t: 'token.delete', ids: [pfTok.id] })
await call('PATCH', `/api/workspaces/${ws}`, { settings: { system: '5e' } }, gmCookie)
pa.send({ t: 'chat', text: '/roll 1d20+40 dc 20' })
const five = await gm.until((m) => m.t === 'chat.msg' && m.msg.parts[0]?.roll?.dc === 20 && m.msg.parts[0].roll.degree === 'success')
check('back in 5e the same roll is simply a success', !!five)
await sleep(150)

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
