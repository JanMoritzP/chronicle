// Uploads a child map inside the first map: node scripts/seed-child-map.mjs http://localhost:3222 gm testpass123 "Test World"
import sharp from 'sharp'
const [base, user, pass, wsName = 'Test World'] = process.argv.slice(2)
const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })
const cookie = login.headers.get('set-cookie').split(';')[0]
const j = (u) => fetch(base + u, { headers: { cookie } }).then((r) => r.json())
const ws = (await j('/api/workspaces')).find((w) => w.name === wsName)
const parent = (await j(`/api/workspaces/${ws.id}/maps`))[0]
const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#9bb98a' } }).png().toBuffer()
const form = new FormData()
form.append('name', 'Harbour town')
form.append('parentMapId', parent.id)
form.append('file', new Blob([png], { type: 'image/png' }), 'harbour.png')
const r = await fetch(`${base}/api/workspaces/${ws.id}/maps`, { method: 'POST', headers: { cookie }, body: form })
console.log(r.status, JSON.stringify(await r.json()))
