// Creates family pages and some relations: node scripts/seed-family.mjs http://localhost:3222 gm testpass123 "Test World"
const [base, user, pass, wsName = 'Test World'] = process.argv.slice(2)
const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })
const cookie = login.headers.get('set-cookie').split(';')[0]
const call = (method, url, body) => fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())
const ws = (await call('GET', '/api/workspaces')).find((w) => w.name === wsName)
const mk = async (title) => (await call('POST', `/api/workspaces/${ws.id}/pages`, { title }))
const p = {}
for (const n of ['Old King Aldric', 'Queen Maren', 'Prince Dorian', 'Princess Elara', 'Lady Sylva', 'Young Tomas', 'Little Wren', 'Baron Vex']) p[n] = await mk(n)
const rel = (a, b, kind, label = '') => call('POST', `/api/workspaces/${ws.id}/relations`, { sourceId: p[a].id, targetId: p[b].id, kind, label })
await rel('Old King Aldric', 'Queen Maren', 'spouse')
for (const c of ['Prince Dorian', 'Princess Elara']) { await rel('Old King Aldric', c, 'parent'); await rel('Queen Maren', c, 'parent') }
await rel('Prince Dorian', 'Princess Elara', 'sibling')
await rel('Prince Dorian', 'Lady Sylva', 'spouse')
for (const c of ['Young Tomas', 'Little Wren']) { await rel('Prince Dorian', c, 'parent'); await rel('Lady Sylva', c, 'parent') }
await rel('Baron Vex', 'Old King Aldric', 'other', 'rival of')
console.log('seeded', Object.keys(p).length)
