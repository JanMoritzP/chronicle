// Turns the first line into a journey and the second marker into a timed one: node scripts/seed-items.mjs http://localhost:3222 gm testpass123 "Test World"
const [base, user, pass, wsName = 'Test World'] = process.argv.slice(2)
const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })
const cookie = login.headers.get('set-cookie').split(';')[0]
const call = async (method, u, body) => {
  const r = await fetch(base + u, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => null) }
}
const ws = (await call('GET', '/api/workspaces')).data.find((w) => w.name === wsName)
const map = (await call('GET', `/api/workspaces/${ws.id}/maps`)).data[0]
const m = (await call('GET', `/api/maps/${map.id}`)).data
const line = m.items.find((i) => i.kind === 'line')
const pts = m.items.filter((i) => i.kind === 'point')
console.log('map', map.id, 'items', m.items.length)
const j = await call('PATCH', `/api/items/${line.id}`, { timeMode: 'journey', journey: { mode: 'horse', waypoints: [{ arrive: null, depart: 10 }, { arrive: null, depart: null }, { arrive: 20, depart: null }] } })
console.log('journey', j.status, j.data?.error ?? '')
const [x, y] = pts[1].geometry
const t = await call('PATCH', `/api/items/${pts[1].id}`, { timeMode: 'timed', style: { color: '#2e5fa3', glide: true }, keyframes: [{ t: 5, geometry: [x, y] }, { t: 30, geometry: [x - 600, y + 400] }] })
console.log('timed', t.status, t.data?.error ?? '')
