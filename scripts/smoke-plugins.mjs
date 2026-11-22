// node scripts/smoke-plugins.mjs http://localhost:3222 gm testpass123
// Starts a fake image administration itself, so no other program is needed. The server must run on this machine.
import crypto from 'node:crypto'
import http from 'node:http'
import zlib from 'node:zlib'
import sharp from 'sharp'
import { WebSocket } from 'ws'

const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let cookie = ''
async function call(method, url, body, useCookie = true) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(useCookie && cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

function png(w, h) {
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } let x = 0xffffffff; for (const b of buf) x = t[(x ^ b) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
// a map is tiled with a transparent background: a solid black picture would count as blank, so use a colour
const beige = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#c9b48a' } }).png().toBuffer()
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

// a stand-in for image administration: keeps requests, events and files; refuses ids that contain "invalid"
const TOKEN = 'admin-secret', HOOK = 'hook-secret'
const requests = new Map()      // sprite id -> sprite as requested, with its project (ids are unique in this test: one world)
const projectsSeen = new Map()  // project id -> { name, description, folders }
const events = []               // { project, seq, id, ... }: every project counts its own events
const files = new Map()         // "project|id" -> bytes
let calls = 0
const fake = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    calls++
    const url = new URL(req.url, 'http://x')
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { ok: false, errors: ['no token'] })
    const pid = url.searchParams.get('project') || 'default'
    if (req.method === 'POST' && url.pathname === '/api/requests') {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      const { sprites = [] } = body
      const named = body.project?.id ?? 'default'
      const errors = sprites.flatMap((x) => [!x.id && 'id', !x.description && 'description', !(x.spec?.width > 0 && x.spec?.height > 0) && 'exact size', !/\.(png|jpg|webp)$/.test(x.target ?? '') && 'target', x.description?.includes('invalid') && 'refused for the test'].filter(Boolean))
      if (errors.length) return json(422, { ok: false, errors })
      const prev = projectsSeen.get(named) ?? { folders: {} }
      projectsSeen.set(named, { name: body.project?.name, description: body.project?.description, folders: { ...prev.folders, ...(body.folders ?? {}) } })
      for (const x of sprites) requests.set(x.id, { ...x, _project: named })
      return json(200, { ok: true, sprites: sprites.map((x) => x.id), project: named })
    }
    if (url.pathname === '/api/events') {
      if (pid !== 'default' && !projectsSeen.has(pid)) return json(404, { ok: false, errors: ['unknown project'] })
      return json(200, { events: events.filter((e) => e.project === pid && e.seq > Number(url.searchParams.get('since') ?? 0)) })
    }
    if (url.pathname === '/api/file') {
      const id = url.searchParams.get('id')
      if (!files.has(`${pid}|${id}`)) return json(404, { ok: false })
      const bytes = files.get(`${pid}|${id}`)
      res.writeHead(200, { 'content-type': 'image/png', 'X-Sprite-Sha256': sha(bytes) })
      return res.end(bytes)
    }
    json(404, { ok: false })
  })
})
await new Promise((r) => fake.listen(0, '127.0.0.1', r))
const fakeUrl = `http://127.0.0.1:${fake.address().port}`

/** What a person's upload in the admin does: record the event, then (unless push is false) push it to the webhook. */
async function upload(id, bytes, { push = true, token = HOOK, hash, project = requests.get(id)?._project ?? 'default' } = {}) {
  files.set(`${project}|${id}`, bytes)
  const seq = events.filter((e) => e.project === project).length + 1
  events.push({ project, seq, id, format: 'png', bytes: bytes.length, sha256: sha(bytes) })
  if (!push) return null
  return fetch(`${base}/api/plugins/image-administration/webhook`, {
    method: 'POST', body: bytes,
    headers: { 'content-type': 'image/png', 'x-sprite-project': project, 'x-sprite-id': id, 'x-sprite-seq': String(seq), 'x-sprite-format': 'png', 'x-sprite-sha256': hash ?? sha(bytes), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  })
}

const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })
cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
const ws = (await call('POST', '/api/workspaces', { name: 'Plug {test} ' + Math.floor(Math.random() * 1e6) })).data.id

const raw = (name, bytes, type = 'application/octet-stream') => fetch(`${base}/api/workspaces/${ws}/images?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': type, cookie }, body: bytes }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))

// the raw endpoint works with no plugin at all
let r = await raw('first.png', png(3, 2))
const r0 = r.data
check('raw upload stores a picture', r.status === 200 && r.data.url?.startsWith('/api/uploads/'), JSON.stringify(r.data))
check('and the picture can be read back', (await fetch(base + r.data.url, { headers: { cookie } })).headers.get('content-type') === 'image/png')
r = await raw('notes.png', Buffer.from('this is not a picture'))
check('something that is not a picture is refused', r.status === 415, JSON.stringify(r.data))
r = await raw('empty.png', Buffer.alloc(0))
check('an empty body is refused', r.status === 400 || r.status === 415, String(r.status))

// plugin list and permissions
let list = (await call('GET', '/api/plugins')).data
const p = list.find((x) => x.id === 'image-administration')
check('the bundled plugin is found and off', p && p.bundled && !p.enabled && !p.active, JSON.stringify(p)?.slice(0, 100))
check('anonymous cannot list plugins', (await call('GET', '/api/plugins', null, false)).status === 401)
const vname = 'pv' + Math.floor(Math.random() * 1e6)
await call('POST', '/api/users', { username: vname, password: 'viewerpass1', role: 'viewer' })
const vl = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: vname, password: 'viewerpass1' }) })
const owner = cookie
cookie = vl.headers.get('set-cookie')?.split(';')[0] ?? ''
check('a viewer cannot list or change plugins', (await call('GET', '/api/plugins')).status === 403 && (await call('PATCH', '/api/plugins/image-administration', { enabled: true })).status === 403)
cookie = owner

// settings
check('unknown setting is refused', (await call('PATCH', '/api/plugins/image-administration', { config: { nope: 'x' } })).status === 400)
check('wrong type is refused', (await call('PATCH', '/api/plugins/image-administration', { config: { width: 'wide' } })).status === 400)
check('unknown plugin is 404', (await call('PATCH', '/api/plugins/nope', { enabled: true })).status === 404)

// pages: three without a portrait (one needs braces escaped, one will be refused), one with a portrait, one of no listed type
const mk = (title, props) => call('POST', `/api/workspaces/${ws}/pages`, { title, props }).then((x) => x.data)
const hero = await mk('Hero {Elf}', { type: 'person' })
const wolf = await mk('Wolf', { type: 'monster' })
await mk('Has Portrait', { type: 'person', portrait: r0.url })
await mk('Plain Note', {})
const bad = await mk('invalid one', { type: 'person' })
const portraitOf = async (id) => (await call('GET', `/api/pages/${id}`)).data.props?.portrait

// the webhook does not exist while the plugin is off
check('webhook is 404 while the plugin is off', (await upload('x', png(2, 2))).status === 404)
r = await call('PATCH', '/api/plugins/image-administration', { config: { url: fakeUrl, adminToken: TOKEN, webhookToken: HOOK, pollMinutes: 0, width: 300, height: 200, format: 'webp' }, enabled: true })
check('turn on with settings', r.status === 200 && r.data.active && r.data.enabled, JSON.stringify(r.data).slice(0, 120))

// 1. request: only pages that need a portrait, with an exact size and the right extension
r = await call('POST', '/api/plugins/image-administration/request', {})
check('a 422 from image administration is shown and nothing is recorded', r.status === 500 && /refused for the test/.test(r.data.error) && requests.size === 0, JSON.stringify(r.data))
await call('DELETE', `/api/pages/${bad.id}`)
r = await call('POST', '/api/plugins/image-administration/request', {})
check('request answers', r.status === 200 && /2 new/.test(r.data.message), JSON.stringify(r.data))
const heroReq = [...requests.values()].find((s) => s.description.includes('Hero'))
check('one request per page that lacks a portrait', requests.size === 2 && [...requests.values()].every((s) => !s.description.includes('Plain') && !s.description.includes('Has Portrait')))
check('exact size, format and target extension', heroReq?.spec.width === 300 && heroReq.spec.height === 200 && heroReq.spec.formats[0] === 'webp' && heroReq.target.endsWith('.webp') && heroReq.id.startsWith('pages/'), JSON.stringify(heroReq)?.slice(0, 200))
check('titles go into descriptions as they are', heroReq.description.includes('{Elf}') && !heroReq.description.includes('{{'))
const proj = heroReq._project
check('the world became a project named after it', proj.startsWith('plug-test-') && projectsSeen.get(proj)?.name.startsWith('Plug {test}'), proj)
await call('POST', '/api/plugins/image-administration/request', {})
check('asking again does not request the same pages twice', requests.size === 2)
const late = await mk('Latecomer', { type: 'location' })
r = await call('POST', '/api/plugins/image-administration/request', {})
check('a new page is requested later', /1 new/.test(r.data.message) && requests.size === 3, JSON.stringify(r.data))
const wolfReq = [...requests.values()].find((s) => s.description.includes('Wolf'))
const lateReq = [...requests.values()].find((s) => s.description.includes('Latecomer'))

// 2. push: token, hash and bytes are checked, the image becomes the portrait
r = await upload(heroReq.id, png(3, 3), { token: 'wrong' })
check('wrong webhook token is refused', r.status === 401)
r = await upload(heroReq.id, png(3, 3), { hash: 'ab'.repeat(32) })
check('a wrong hash is answered 502 so it is retried', r.status === 502)
check('and nothing was applied', !(await portraitOf(hero.id)))
const bytes = png(3, 3)
r = await upload(heroReq.id, bytes)
check('a valid push is acknowledged', r.status === 204, String(r.status))
const first = await portraitOf(hero.id)
check('the page now has the picture as its portrait', first?.startsWith('/api/uploads/') && (await fetch(base + first, { headers: { cookie } })).status === 200, String(first))
const count = (await call('GET', `/api/workspaces/${ws}/uploads`)).data.items.length
r = await upload(heroReq.id, bytes)
check('the same image again is idempotent', r.status === 204 && (await portraitOf(hero.id)) === first && (await call('GET', `/api/workspaces/${ws}/uploads`)).data.items.length === count)
r = await upload(heroReq.id, png(4, 4))
check('a replacement image replaces the portrait', r.status === 204 && (await portraitOf(hero.id)) !== first)
r = await upload('never/asked', png(2, 2), { project: proj })
check('an image nobody requested is refused', r.status === 404)
r = await upload(wolfReq.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))
check('a format Chronicle cannot keep is refused without a retry', r.status === 415 && !(await portraitOf(wolf.id)), String(r.status))

// 3. catch up: pushes that never arrived are fetched; the highest seq is remembered
await upload(wolfReq.id, png(5, 5), { push: false })
await upload(lateReq.id, png(6, 6), { push: false })
check('a missed push is not applied yet', !(await portraitOf(wolf.id)))
r = await call('POST', '/api/plugins/image-administration/catchup', {})
check('catch-up fetches the missed images', r.status === 200 && !!(await portraitOf(wolf.id)) && !!(await portraitOf(late.id)), JSON.stringify(r.data))
const seen = calls
r = await call('POST', '/api/plugins/image-administration/catchup', {})
check('catch-up again fetches nothing', /^0 new/.test(r.data.message) && calls - seen === 1, JSON.stringify(r.data))
check('plugin routes need the owner', (await call('POST', '/api/plugins/image-administration/catchup', {}, false)).status === 401)
check('unknown plugin route is 404', (await call('POST', '/api/plugins/image-administration/nothing', {})).status === 404)

// 4. the tabletop: scene background, tokens (one request per name) and handouts, applied live to everyone at the table
const sock = new WebSocket(`${base.replace('http', 'ws')}/api/table/${ws}`, { headers: { cookie, origin: base } })
const msgs = []
sock.on('message', (raw) => msgs.push(JSON.parse(raw.toString())))
await new Promise((res, rej) => { sock.on('open', res); sock.on('error', rej) })
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const wait = async (pred) => { for (let i = 0; i < 100; i++) { const m = msgs.findLast(pred); if (m) return m; await sleep(20) } return null }
sock.send(JSON.stringify({ t: 'scene.create', name: 'Crypt', op: 'a' }))
const sceneMsg = await wait((m) => m.t === 'scene' && m.scene?.name === 'Crypt')
const sceneId = sceneMsg?.scene.id
for (const name of ['Orc', 'Orc', 'Aria']) sock.send(JSON.stringify({ t: 'token.add', sceneId, token: { name, x: 70, y: 70 } }))
sock.send(JSON.stringify({ t: 'handout.save', title: 'Old Map', text: 'x', image: '' }))
await wait((m) => m.t === 'handouts' && m.handouts.some((h) => h.title === 'Old Map'))
await sleep(200)
const sizeBefore = requests.size
r = await call('POST', '/api/plugins/image-administration/request', {})
const fresh = [...requests.values()].slice(sizeBefore)
check('scene, two token names and a handout are requested', r.status === 200 && /4 new/.test(r.data.message) && fresh.length === 4, JSON.stringify(r.data))
const sceneReq = fresh.find((s) => s.id.startsWith('tabletop/scenes/'))
const orcReq = fresh.find((s) => s.id.startsWith('tabletop/tokens/orc'))
const ariaReq = fresh.find((s) => s.id.startsWith('tabletop/tokens/aria'))
const handReq = fresh.find((s) => s.id.startsWith('tabletop/handouts/'))
check('the scene is requested at its own size', sceneReq?.spec.width === sceneMsg.scene.width && sceneReq.spec.height === sceneMsg.scene.height, JSON.stringify(sceneReq?.spec))
check('tokens are square and handouts have their own size', orcReq?.spec.width === 256 && orcReq.spec.height === 256 && handReq?.spec.width === 1024 && handReq.spec.height === 768)
check('names carry no ids: no hash anywhere in a request id', [...requests.keys()].every((id) => !/-[0-9a-f]{6,8}(\/|$)/.test(id)), [...requests.keys()].join(' '))
check('all four targets end in the format', fresh.every((s) => s.target.endsWith('.webp')))
r = await upload(sceneReq.id, png(9, 9))
const bgMsg = await wait((m) => m.t === 'scene' && m.scene?.id === sceneId && m.scene.bg?.startsWith('/api/uploads/'))
check('the scene background is set and announced live', r.status === 204 && !!bgMsg)
r = await upload(orcReq.id, png(4, 4))
const orcs = async () => { await sleep(150); const last = new Map(); for (const m of msgs) if (m.t === 'token' && m.token) last.set(m.token.id, m.token); return [...last.values()].filter((t) => t.name === 'Orc') }
check('both tokens of that name get the picture', r.status === 204 && (await orcs()).length === 2 && (await orcs()).every((t) => t.image?.startsWith('/api/uploads/')))
check('the other token is untouched', ![...msgs].some((m) => m.t === 'token' && m.token?.name === 'Aria' && m.token.image))
r = await upload(handReq.id, png(5, 5))
const handMsg = await wait((m) => m.t === 'handouts' && m.handouts.some((h) => h.title === 'Old Map' && h.image?.startsWith('/api/uploads/')))
check('the handout gets its picture live', r.status === 204 && !!handMsg)
const again = requests.size
await call('POST', '/api/plugins/image-administration/request', {})
check('filled slots and requested ones are not asked for again', requests.size === again && !requests.has(undefined) && [...requests.values()].length === sizeBefore + 4)
sock.close()
// turning a kind off stops its requests
await call('PATCH', '/api/plugins/image-administration', { config: { requestScenes: false } })

// 5. pictures inside page text, further image blocks of a custom page type, and detail maps behind pins
const doc = (...paras) => ({ type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) })
const campaign = (await call('POST', `/api/workspaces/${ws}/folders`, { name: 'Campaign' })).data
const npcs = (await call('POST', `/api/workspaces/${ws}/folders`, { name: 'NPCs', parentId: campaign.id })).data
const story = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Harbour Tale', folderId: campaign.id, content: doc('It was dusk.', '[image: harbour at dusk]', 'The end.') })).data
const pt = (await call('POST', `/api/workspaces/${ws}/page-types`, { name: 'Shrine', definition: { top: [], side: [{ type: 'image', key: 'portrait', shape: 'tall' }, { type: 'image', key: 'banner', shape: 'wide' }], main: [{ type: 'body' }], bottom: [] } })).data
const shrine = (await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Moon Shrine', folderId: npcs.id, props: { type: pt.id } })).data
const town = await mk('Harbour Town', { type: 'location', portrait: r0.url })
const mapFd = new FormData()
mapFd.append('name', 'World map')
mapFd.append('file', new Blob([png(40, 30)], { type: 'image/png' }), 'world.png')
const world = await fetch(`${base}/api/workspaces/${ws}/maps`, { method: 'POST', body: mapFd, headers: { cookie } }).then((x) => x.json())
await call('POST', `/api/maps/${world.id}/items`, { kind: 'point', geometry: [10, 10], title: 'Harbour', pageId: town.id })
const before5 = requests.size
r = await call('POST', '/api/plugins/image-administration/request', {})
const fresh5 = [...requests.values()].slice(before5)
check('text line, two shrine pictures and a detail map are requested', r.status === 200 && fresh5.length === 4, JSON.stringify(r.data) + fresh5.map((s) => s.id).join(' '))
const textReq = fresh5.find((s) => s.description.startsWith('Illustration'))
const tallReq = fresh5.find((s) => s.id.endsWith('/portrait') && s.description.includes('Moon Shrine'))
const bannerReq = fresh5.find((s) => s.id.endsWith('/banner'))
const mapReq = fresh5.find((s) => s.id.endsWith('/map'))
check('the real names of the folders reach the admin as titles', projectsSeen.get(proj).folders['pages/campaign']?.title === 'Campaign' && projectsSeen.get(proj).folders['pages/campaign/npcs']?.title === 'NPCs' && projectsSeen.get(proj).folders['pages/campaign/npcs/moon-shrine']?.title === 'Moon Shrine', JSON.stringify(projectsSeen.get(proj).folders))
check('the folders of the adventure are kept, with names only', textReq.id.startsWith(`pages/campaign/harbour-tale/harbour-at-dusk`) && tallReq.id === `pages/campaign/npcs/moon-shrine/portrait` && mapReq.id === `pages/harbour-town/map`, [textReq.id, tallReq.id, mapReq.id].join(' '))
check('both pictures of one page share its folder', tallReq.id.replace(/\/portrait$/, '') === bannerReq.id.replace(/\/banner$/, ''))
check('shapes decide the size, a map has its own', tallReq.spec.width === 300 && tallReq.spec.height === 400 && bannerReq.spec.width === 1024 && bannerReq.spec.height === 448 && mapReq.spec.width === 4096 && textReq.spec.width === 800, JSON.stringify([tallReq.spec, bannerReq.spec, mapReq.spec, textReq.spec]))
check('no map is requested for a page type that was not chosen', !fresh5.some((s) => s.id.endsWith('/map') && s.description.includes('Moon')))
r = await upload(textReq.id, png(6, 4))
const textUrl = (await call('GET', `/api/pages/${story.id}`)).data.content.content.find((n) => n.type === 'image')?.attrs.src
check('the [image: ...] line became the picture', r.status === 204 && textUrl?.startsWith('/api/uploads/') && !JSON.stringify((await call('GET', `/api/pages/${story.id}`)).data.content).includes('[image:'), String(textUrl))
r = await upload(textReq.id, png(7, 5))
const textUrl2 = (await call('GET', `/api/pages/${story.id}`)).data.content.content.filter((n) => n.type === 'image')
check('a replacement swaps that picture and adds no second one', r.status === 204 && textUrl2.length === 1 && textUrl2[0].attrs.src !== textUrl)
r = await upload(bannerReq.id, png(8, 3))
let sp = (await call('GET', `/api/pages/${shrine.id}`)).data.props
check('a custom image block fills the page data, the portrait key stays empty', r.status === 204 && sp.data?.banner?.startsWith('/api/uploads/') && !sp.portrait, JSON.stringify(sp))
r = await upload(tallReq.id, png(3, 4))
sp = (await call('GET', `/api/pages/${shrine.id}`)).data.props
check('the portrait key fills the thumbnail', r.status === 204 && sp.portrait?.startsWith('/api/uploads/'))
r = await upload(mapReq.id, await beige(600, 400))
const maps = (await call('GET', `/api/workspaces/${ws}/maps`)).data
const detail = maps.find((m) => m.parentMapId === world.id)
check('a pushed picture becomes a detail map under the map with the pin', r.status === 204 && detail?.name === 'Harbour Town', JSON.stringify(maps.map((m) => m.name)))
const pins = (await call('GET', `/api/maps/${world.id}`)).data.items
check('and the pin opens it', pins.find((i) => i.pageId === town.id)?.targetMapId === detail?.id)
let ready = null
for (let i = 0; i < 100 && ready?.status !== 'ready'; i++) { await sleep(100); ready = (await call('GET', `/api/maps/${detail.id}`)).data }
check('the new map is tiled', ready?.status === 'ready' && ready.width === 600 && ready.height === 400, JSON.stringify(ready?.status) + ready?.error)
r = await upload(mapReq.id, await beige(900, 600))
for (let i = 0; i < 100 && !(ready?.status === 'ready' && ready.width === 900); i++) { await sleep(100); ready = (await call('GET', `/api/maps/${detail.id}`)).data }
check('a replacement re-tiles the same map', r.status === 204 && ready.width === 900 && (await call('GET', `/api/workspaces/${ws}/maps`)).data.length === 2)
const again5 = requests.size
await call('POST', '/api/plugins/image-administration/request', {})
check('nothing is requested twice', requests.size === again5)
// two pages with the same title in the same place get a number, nothing else
await mk('Twin', { type: 'person' })
await mk('Twin', { type: 'person' })
await call('POST', '/api/plugins/image-administration/request', {})
const twinId = 'pages/twin/portrait'
check('equal names are told apart by a number', requests.has(`pages/twin/portrait`) && requests.has(`pages/twin-2/portrait`))
// a second world is a second project, with the same folder layout inside
const ws2 = (await call('POST', '/api/workspaces', { name: 'Other Tale ' + Math.floor(Math.random() * 1e6) })).data.id
const other = (await call('POST', `/api/workspaces/${ws2}/pages`, { title: 'Other Hero', props: { type: 'person' } })).data
r = await call('POST', '/api/plugins/image-administration/request', {})
const otherReq = requests.get('pages/other-hero/portrait')
check('another world gets its own project', /^1 new/.test(r.data.message) && otherReq?._project?.startsWith('other-tale-') && otherReq._project !== proj, JSON.stringify(r.data))
check('and both projects have their own pages folder', requests.get(twinId)._project === proj)
r = await upload('pages/other-hero/portrait', png(5, 6))
check('a push names its project, so the right page gets the picture', r.status === 204 && !!((await call('GET', `/api/pages/${other.id}`)).data.props?.portrait))
r = await upload('pages/other-hero/portrait', png(7, 7), { push: false })
r = await call('POST', '/api/plugins/image-administration/catchup', {})
check('catch-up asks every project for its own events', r.status === 200 && /^1 new/.test(r.data.message), JSON.stringify(r.data))
await call('DELETE', `/api/workspaces/${ws2}`)
// forgetting starts over: everything still empty is requested again
r = await call('POST', '/api/plugins/image-administration/forget', {})
check('forget clears what the plugin remembers', r.status === 200 && /forgot/i.test(r.data.message), JSON.stringify(r.data))
r = await call('POST', '/api/plugins/image-administration/request', {})
check('and the empty slots are requested again', /^[1-9]d* new/.test(r.data.message), JSON.stringify(r.data))

// a wrong admin token is reported to the owner; with no webhook token pushes are refused
await call('PATCH', '/api/plugins/image-administration', { config: { adminToken: 'nope' } })
r = await call('POST', '/api/plugins/image-administration/catchup', {})
check('image administration refusing the token is reported', r.status === 500 && /401/.test(r.data.error), JSON.stringify(r.data))
await call('PATCH', '/api/plugins/image-administration', { config: { adminToken: TOKEN, webhookToken: '' } })
r = await upload(wolfReq.id, png(7, 7))
check('without a webhook token pushes are refused', r.status === 503)

// turning off stops it; the settings stay
r = await call('PATCH', '/api/plugins/image-administration', { enabled: false })
check('turn off', r.status === 200 && !r.data.active && !r.data.enabled)
check('the webhook is gone while off', (await upload(wolfReq.id, png(8, 8))).status === 404)
r = await call('PATCH', '/api/plugins/image-administration', { enabled: true })
check('turn on again keeps the settings', r.data.active && r.data.config.find((f) => f.key === 'url').value === fakeUrl)

// a plugin that is off at the end, a clean world
await call('PATCH', '/api/plugins/image-administration', { enabled: false, config: { adminToken: '', url: '' } })
const vid = (await call('GET', '/api/users')).data.find((u) => u.username === vname)?.id
if (vid) await call('DELETE', `/api/users/${vid}`)
await call('DELETE', `/api/workspaces/${ws}`)
fake.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
