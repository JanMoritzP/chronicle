// node scripts/smoke-plugins.mjs http://localhost:3222 gm testpass123
// Starts a fake sprite-admin itself, so no other program is needed. The server must run on this machine.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

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

// a stand-in for sprite-admin: remembers what it was sent, refuses ids that contain "refuse"
const received = []
const fake = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const id = new URL(req.url, 'http://x').searchParams.get('id')
    const ok = req.headers['x-sprite-admin'] === '1' && !id.includes('refuse')
    if (ok) received.push({ id, bytes: Buffer.concat(chunks).length })
    res.writeHead(ok ? 200 : 422, { 'content-type': 'application/json' })
    res.end(JSON.stringify(ok ? { ok: true, warnings: [] } : { ok: false, errors: ['refused for the test'] }))
  })
})
await new Promise((r) => fake.listen(0, '127.0.0.1', r))
const fakeUrl = `http://127.0.0.1:${fake.address().port}`
const contractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-contract-'))

const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })
cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
const ws = (await call('POST', '/api/workspaces', { name: 'Plug {test} ' + Math.floor(Math.random() * 1e6) })).data.id

const raw = (name, bytes, type = 'application/octet-stream') => fetch(`${base}/api/workspaces/${ws}/images?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': type, cookie }, body: bytes }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))

// the raw endpoint works with no plugin at all
let r = await raw('first.png', png(3, 2))
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
check('wrong type is refused', (await call('PATCH', '/api/plugins/image-administration', { config: { sendImage: 'yes' } })).status === 400)
check('unknown plugin is 404', (await call('PATCH', '/api/plugins/nope', { enabled: true })).status === 404)
r = await call('PATCH', '/api/plugins/image-administration', { config: { contractDir, url: fakeUrl }, enabled: true })
check('turn on with settings', r.status === 200 && r.data.active && r.data.enabled, JSON.stringify(r.data).slice(0, 120))

// a picture added now lands in the contract and at the fake sprite-admin
r = await raw('Dragon {lair}.png', png(8, 4), 'image/png')
check('upload with the plugin on still succeeds', r.status === 200 && !r.data.warnings, JSON.stringify(r.data))
const file = path.join(contractDir, 'contracts', `chronicle-${ws}.json`)
check('a contract file was written for the world', fs.existsSync(file))
const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
const sprite = doc.sprites?.[0]
check('contract is version 1.0 with one sprite', doc.contract === '1.0' && doc.sprites.length === 1)
check('sprite has id, target, description and spec', sprite?.id.startsWith('chronicle/') && sprite.target.endsWith('.png') && sprite.description && sprite.spec.width === 8 && sprite.spec.height === 4 && sprite.spec.formats[0] === 'png', JSON.stringify(sprite)?.slice(0, 160))
check('braces in names are escaped for placeholders', sprite?.description.includes('{{lair}}') && !/(^|[^{])\{lair\}/.test(sprite.description))
check('the folder is declared once with its title', Object.keys(doc.folders ?? {}).length === 1)
check('the picture reached image administration under that id', received.some((x) => x.id === sprite?.id && x.bytes > 0), JSON.stringify(received))

r = await raw('second.png', png(2, 2))
const doc2 = JSON.parse(fs.readFileSync(file, 'utf8'))
check('a second picture is added to the same file', doc2.sprites.length === 2 && new Set(doc2.sprites.map((s) => s.id)).size === 2)

// multipart (the editor's own route) goes through the same pipeline
const fd = new FormData()
fd.append('file', new Blob([png(5, 5)], { type: 'image/png' }), 'multipart.png')
const mp = await fetch(`${base}/api/workspaces/${ws}/uploads`, { method: 'POST', body: fd, headers: { cookie } })
check('the editor upload route feeds the plugin too', mp.status === 200 && JSON.parse(fs.readFileSync(file, 'utf8')).sprites.length === 3)

// failure: image administration refuses -> the upload stays, the user is told, the entry waits
const before = received.length
r = await raw('refuse me.png', png(4, 4))
check('a refusing image administration does not break the upload', r.status === 200 && r.data.warnings?.length === 1, JSON.stringify(r.data))
check('the refused picture is still in the contract', JSON.parse(fs.readFileSync(file, 'utf8')).sprites.length === 4 && received.length === before)
const retried = await call('POST', '/api/plugins/image-administration/retry', {})
check('the retry route answers', retried.status === 200 && /still not accepted/.test(retried.data.message), JSON.stringify(retried.data))
check('plugin routes need the owner', (await call('POST', '/api/plugins/image-administration/retry', {}, false)).status === 401)
check('unknown plugin route is 404', (await call('POST', '/api/plugins/image-administration/nothing', {})).status === 404)

// deleting a picture takes its entry out of the contract
const up = (await call('GET', `/api/workspaces/${ws}/uploads`)).data.items.find((i) => i.filename === 'second.png')
await call('DELETE', `/api/uploads/${up.id}`)
check('deleting a picture removes its sprite', JSON.parse(fs.readFileSync(file, 'utf8')).sprites.length === 3)

// contract only mode and sound
await call('PATCH', '/api/plugins/image-administration', { config: { sendImage: false } })
const n = received.length
await raw('quiet.png', png(2, 3))
check('without sending, only the contract changes', JSON.parse(fs.readFileSync(file, 'utf8')).sprites.length === 4 && received.length === n)

// turning off stops it; the settings stay
r = await call('PATCH', '/api/plugins/image-administration', { enabled: false })
check('turn off', r.status === 200 && !r.data.active && !r.data.enabled)
await raw('after-off.png', png(2, 2))
check('a picture added while off is not entered', JSON.parse(fs.readFileSync(file, 'utf8')).sprites.length === 4)
check('plugin routes are gone while off', (await call('POST', '/api/plugins/image-administration/retry', {})).status === 404)
r = await call('PATCH', '/api/plugins/image-administration', { enabled: true })
check('turn on again keeps the settings', r.data.active && r.data.config.find((f) => f.key === 'contractDir').value === contractDir)
const bf = await call('POST', '/api/plugins/image-administration/backfill', {})
check('backfill adds pictures from while it was off', bf.status === 200 && /^[1-9]\d* added/.test(bf.data.message) && JSON.parse(fs.readFileSync(file, 'utf8')).sprites.length >= 5, JSON.stringify(bf.data))

// a plugin that is off at the end, a clean world
await call('PATCH', '/api/plugins/image-administration', { enabled: false, config: { contractDir: '' } })
const vid = (await call('GET', '/api/users')).data.find((u) => u.username === vname)?.id
if (vid) await call('DELETE', `/api/users/${vid}`)
await call('DELETE', `/api/workspaces/${ws}`)
fake.close()
fs.rmSync(contractDir, { recursive: true, force: true })
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
