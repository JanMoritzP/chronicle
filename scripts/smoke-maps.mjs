// Map/timeline smoke test: node scripts/smoke-maps.mjs http://localhost:3222 gm testpass123
import sharp from 'sharp'
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let cookie = ''
async function call(method, url, body) {
  const r = await fetch(base + url, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => null), set: r.headers.get('set-cookie') }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const login = await call('POST', '/api/auth/login', { username: user, password: pass })
cookie = login.set.split(';')[0]
const ws = (await call('POST', '/api/workspaces', { name: 'MapWorld' })).data

const png = await sharp({ create: { width: 3000, height: 1700, channels: 3, background: '#c9b48a' } }).png().toBuffer()
const form = new FormData()
form.append('name', 'Test continent')
form.append('file', new Blob([png], { type: 'image/png' }), 'continent.png')
const up = await fetch(`${base}/api/workspaces/${ws.id}/maps`, { method: 'POST', headers: { cookie }, body: form })
const map = await up.json()
check('map upload accepted', up.status === 200 && map.status === 'processing', JSON.stringify(map).slice(0, 80))

let m
for (let i = 0; i < 40; i++) {
  m = (await call('GET', `/api/maps/${map.id}`)).data
  if (m.status !== 'processing') break
  await new Promise((r) => setTimeout(r, 250))
}
check('tiling finished', m.status === 'ready', m.error ?? '')
check('dimensions stored', m.width === 3000 && m.height === 1700 && m.maxZoom === 4, `${m.width}x${m.height} z${m.maxZoom}`)
check('has default layer', m.layers.length === 1)

const tile = await fetch(`${base}/api/maps/${map.id}/t/0/0/0.webp`, { headers: { cookie } })
check('tile served with long cache', tile.status === 200 && /immutable/.test(tile.headers.get('cache-control') ?? ''))
const edge = await fetch(`${base}/api/maps/${map.id}/t/4/6/11.webp`, { headers: { cookie } })
check('bottom-right edge tile exists at full zoom', edge.status === 200)
const em = await sharp(Buffer.from(await edge.arrayBuffer())).metadata()
check('edge tile padded to 256', em.width === 256 && em.height === 256, `${em.width}x${em.height}`)
check('tile needs auth', (await fetch(`${base}/api/maps/${map.id}/t/0/0/0.webp`)).status === 401)
check('tile path traversal rejected', (await fetch(`${base}/api/maps/${map.id}/t/0/0/..%2F..%2F..%2Fsource.png`, { headers: { cookie } })).status === 404)

const pt = (await call('POST', `/api/maps/${map.id}/items`, { kind: 'point', title: 'Town', geometry: [100, 200] })).data
check('point created', pt.kind === 'point' && pt.geometry[0] === 100)
check('bad geometry rejected', (await call('POST', `/api/maps/${map.id}/items`, { kind: 'polygon', geometry: [[0, 0], [1, 1]] })).status === 400)
const line = (await call('POST', `/api/maps/${map.id}/items`, { kind: 'line', geometry: [[0, 0], [50, 50], [90, 20]] })).data
check('line created', line.kind === 'line')
const j = await call('PATCH', `/api/items/${line.id}`, { timeMode: 'journey', journey: { mode: 'horse', waypoints: [{ arrive: null, depart: 10 }, { arrive: 12, depart: 12 }, { arrive: 15, depart: null }] } })
check('line becomes journey', j.status === 200 && j.data.timeMode === 'journey')
const bad = await call('PATCH', `/api/items/${line.id}`, { keyframes: [{ t: 5, geometry: [[0, 0], [1, 1]] }] })
check('journey with keyframes rejected', bad.status === 400)
check('point cannot be journey', (await call('PATCH', `/api/items/${pt.id}`, { timeMode: 'journey' })).status === 400)

const child = await call('PATCH', `/api/maps/${map.id}`, { parentMapId: map.id })
check('self parent rejected', child.status === 400)

const cal = await call('GET', `/api/workspaces/${ws.id}/calendar`)
check('default calendar', cal.data.custom === false && cal.data.calendar.units.length === 12)
const put = await call('PUT', `/api/workspaces/${ws.id}/calendar`, {
  yearLabel: 'Year', startYear: 1, levels: 2, level1Label: 'Season', level2Label: 'Month', dayLabel: 'Day', yearDays: 0,
  units: [{ name: 'Summer', children: [{ name: 'Glorsh', days: 20 }, { name: 'Brun', days: 25 }] }],
})
check('two-level calendar saved', put.status === 200)
check('calendar with empty season rejected', (await call('PUT', `/api/workspaces/${ws.id}/calendar`, {
  yearLabel: 'Year', startYear: 1, levels: 2, dayLabel: 'Day', units: [{ name: 'Winter' }] })).status === 400)

const ev = (await call('POST', `/api/workspaces/${ws.id}/events`, { title: 'Coronation', tStart: 100 })).data
check('event created', !!ev.id)
check('event end before start rejected', (await call('POST', `/api/workspaces/${ws.id}/events`, { title: 'x', tStart: 10, tEnd: 5 })).status === 400)
check('events listed', (await call('GET', `/api/workspaces/${ws.id}/events`)).data.length === 1)

await call('DELETE', `/api/maps/${map.id}`)
check('map delete cascades items', (await call('GET', `/api/maps/${map.id}`)).status === 404)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
