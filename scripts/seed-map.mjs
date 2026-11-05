// Uploads a generated test map: node scripts/seed-map.mjs http://localhost:3222 gm testpass123 "Test World"
import sharp from 'sharp'
const [base, user, pass, wsName = 'Test World'] = process.argv.slice(2)
const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })
const cookie = login.headers.get('set-cookie').split(';')[0]
const j = (u, o = {}) => fetch(base + u, { ...o, headers: { cookie, 'content-type': 'application/json', ...(o.headers ?? {}) } }).then((r) => r.json())
const ws = (await j('/api/workspaces')).find((w) => w.name === wsName)
const W = 4000, H = 2400
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#7aa6c2"/>
  <path d="M500 700 Q900 200 1700 350 T2800 500 Q3500 700 3400 1400 T2600 2100 Q1600 2300 900 1900 T500 700Z" fill="#c9b27c" stroke="#6b5a3a" stroke-width="8"/>
  <path d="M1200 800 L1500 600 L1800 850 L2100 650 L2400 900 L2200 1100 L1400 1100Z" fill="#8a7a6a" stroke="#4a3f33" stroke-width="6"/>
  <circle cx="1000" cy="1500" r="180" fill="#5f8f4e"/>
  <circle cx="3000" cy="1200" r="140" fill="#4f7f45"/>
  <text x="200" y="120" font-size="120" fill="#fff" font-family="sans-serif">NORTHWEST CORNER</text>
  <text x="${W - 1150}" y="${H - 60}" font-size="120" fill="#fff" font-family="sans-serif">SOUTHEAST CORNER</text>
  <g stroke="#ffffff55" stroke-width="3">${Array.from({ length: 16 }, (_, i) => `<line x1="${(i + 1) * 250}" y1="0" x2="${(i + 1) * 250}" y2="${H}"/>`).join('')}${Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="${(i + 1) * 250}" x2="${W}" y2="${(i + 1) * 250}"/>`).join('')}</g>
</svg>`
const png = await sharp(Buffer.from(svg)).png().toBuffer()
const form = new FormData()
form.append('name', 'Aldoria')
form.append('file', new Blob([png], { type: 'image/png' }), 'aldoria.png')
const r = await fetch(`${base}/api/workspaces/${ws.id}/maps`, { method: 'POST', headers: { cookie }, body: form })
console.log(r.status, JSON.stringify(await r.json()))
