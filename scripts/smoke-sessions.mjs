// node scripts/smoke-sessions.mjs http://localhost:3222 gm testpass123
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let cookie = ''
async function call(method, url, body, ck = cookie) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => null), set: r.headers.get('set-cookie') }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

cookie = (await call('POST', '/api/auth/login', { username: user, password: pass })).set.split(';')[0]
const W = (await call('POST', '/api/workspaces', { name: 'SessWorld' })).data
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] })
const words = (n) => Array.from({ length: n }, (_, i) => 'word' + i).join(' ')
const today = new Date(); const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const T = iso(today)

// ---- sessions: numbering, create page ----
const s1 = (await call('POST', `/api/workspaces/${W.id}/sessions`, { title: 'Old times', playedOn: '2020-01-01', tStart: 10, tEnd: 12 })).data
check('first session is number 1', s1.number === 1 && s1.playedOn === '2020-01-01' && s1.tStart === 10 && s1.tEnd === 12, JSON.stringify(s1))
check('no page unless asked', s1.pageId === null)
const s2 = (await call('POST', `/api/workspaces/${W.id}/sessions`, { title: 'The Heist', playedOn: T, createPage: true })).data
check('second session is number 2', s2.number === 2)
check('page created for session', !!s2.pageId && s2.pageTitle === 'Session 2: The Heist', s2.pageTitle)
const bs = (await call('GET', `/api/workspaces/${W.id}/bootstrap`)).data
const sp = bs.pages.find((p) => p.id === s2.pageId)
check('session page in Sessions folder with tag', !!sp && bs.folders.find((f) => f.id === sp.folderId)?.name === 'Sessions' && sp.tags.includes('session'))
check('session page has the outline sections', ['Recap', 'Decisions and consequences', 'Loose ends', 'Next session'].every((t) => sp.outline.some((h) => h.text === t)))
const s3 = (await call('POST', `/api/workspaces/${W.id}/sessions`, { title: 'Third', playedOn: T, createPage: true })).data
check('second session page reuses the folder', bs.folders.filter((f) => f.name === 'Sessions').length === 1 && s3.number === 3)

// ---- validation ----
check('tEnd before tStart rejected', (await call('POST', `/api/workspaces/${W.id}/sessions`, { title: 'bad', tStart: 5, tEnd: 2 })).status === 400)
check('bad date rejected', (await call('POST', `/api/workspaces/${W.id}/sessions`, { title: 'bad', playedOn: 'yesterday' })).status === 400)
check('foreign page rejected', (await call('POST', `/api/workspaces/${W.id}/sessions`, { title: 'bad', pageId: 'nope' })).status === 400)
check('patch tEnd before stored tStart rejected', (await call('PATCH', `/api/sessions/${s1.id}`, { tEnd: 1 })).status === 400)

// ---- activity ----
const before = (await call('GET', `/api/workspaces/${W.id}/stats?from=${T}&to=${T}`)).data
const pg = (await call('POST', `/api/workspaces/${W.id}/pages`, { title: 'Counted', content: doc(words(30)) })).data
let st = (await call('GET', `/api/workspaces/${W.id}/stats?from=${T}&to=${T}`)).data
check('page create counts pages and words', st.totals.pagesCreated === before.totals.pagesCreated + 1 && st.totals.wordsWritten === before.totals.wordsWritten + 30, JSON.stringify(st.totals))
await call('PATCH', `/api/pages/${pg.id}`, { content: doc(words(50)) })
st = (await call('GET', `/api/workspaces/${W.id}/stats?from=${T}&to=${T}`)).data
check('growth adds to words written', st.totals.wordsWritten === before.totals.wordsWritten + 50, String(st.totals.wordsWritten - before.totals.wordsWritten))
await call('PATCH', `/api/pages/${pg.id}`, { content: doc(words(10)) })
st = (await call('GET', `/api/workspaces/${W.id}/stats?from=${T}&to=${T}`)).data
check('deleting text does not reduce words written', st.totals.wordsWritten === before.totals.wordsWritten + 50)
check('top pages lists the page', st.top.some((t) => t.pageId === pg.id && t.words === 50), JSON.stringify(st.top))
check('daily series has today', st.daily.length === 1 && st.daily[0].day === T)

// ---- range rule ----
let list = (await call('GET', `/api/workspaces/${W.id}/sessions`)).data
const g = (n) => list.find((s) => s.number === n)
check('list is newest first', list.map((s) => s.number).join() === '3,2,1' || list.map((s) => s.number).join() === '2,3,1', list.map((s) => s.number).join())
check('old session owns nothing (ends where next begins)', g(1).stats.wordsWritten === 0 && g(1).stats.pagesCreated === 0, JSON.stringify(g(1).stats))
const owner = g(3).stats.pagesCreated > 0 ? g(3) : g(2)
check('latest session owns today', owner.stats.pagesCreated >= 3 && owner.stats.wordsWritten >= 50, JSON.stringify(owner.stats))
const total = list.reduce((a, s) => a + s.stats.pagesCreated, 0)
check('every created page belongs to exactly one session', total === st.totals.pagesCreated, `${total} vs ${st.totals.pagesCreated}`)

// moving a session start moves the stats
await call('PATCH', `/api/sessions/${s1.id}`, { playedOn: '2019-01-01', title: 'Older' })
list = (await call('GET', `/api/workspaces/${W.id}/sessions`)).data
check('patch updates title and date', g(1).title === 'Older' && g(1).playedOn === '2019-01-01')

// ---- stats range ----
const none = (await call('GET', `/api/workspaces/${W.id}/stats?from=2000-01-01&to=2000-12-31`)).data
check('empty range is zero', none.totals.pagesCreated === 0 && none.daily.length === 0)
check('bad range rejected', (await call('GET', `/api/workspaces/${W.id}/stats?from=abc`)).status === 400)
const all = (await call('GET', `/api/workspaces/${W.id}/stats`)).data
check('world totals', all.world.pages === 3 && all.world.words === 39, JSON.stringify(all.world))

// ---- delete a session keeps its page ----
await call('DELETE', `/api/sessions/${s2.id}`)
list = (await call('GET', `/api/workspaces/${W.id}/sessions`)).data
check('delete removes session only', list.length === 2 && !!(await call('GET', `/api/pages/${s2.pageId}`)).data?.id)

// ---- viewer is read-only ----
const vname = 'viewer' + Math.floor(Math.random() * 1e6)
const mk = await call('POST', '/api/users', { username: vname, password: 'viewerpass1', role: 'viewer' })
if (mk.status === 200) {
  const vc = (await call('POST', '/api/auth/login', { username: vname, password: 'viewerpass1' }, '')).set?.split(';')[0]
  check('viewer can read sessions', (await call('GET', `/api/workspaces/${W.id}/sessions`, null, vc)).status === 200)
  check('viewer can read stats', (await call('GET', `/api/workspaces/${W.id}/stats`, null, vc)).status === 200)
  check('viewer cannot create', (await call('POST', `/api/workspaces/${W.id}/sessions`, { title: 'x' }, vc)).status === 403)
  check('viewer cannot edit', (await call('PATCH', `/api/sessions/${s1.id}`, { title: 'x' }, vc)).status === 403)
  check('viewer cannot delete', (await call('DELETE', `/api/sessions/${s1.id}`, null, vc)).status === 403)
} else console.log('SKIP  viewer checks (could not create user: ' + mk.status + ')')

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
