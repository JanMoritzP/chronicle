// node scripts/smoke-history.mjs http://localhost:3222 gm testpass123
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
async function call(cookie, method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }
const login = async (u, p) => (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).headers.get('set-cookie')?.split(';')[0] ?? ''

const gm = await login(user, pass)
const suffix = Math.floor(Math.random() * 1e6)
const ws = (await call(gm, 'POST', '/api/workspaces', { name: 'hist-test-' + suffix })).data.id
const alice = (await call(gm, 'POST', '/api/users', { username: `hist-alice${suffix}`, password: 'password123', role: 'editor' })).data
const aliceC = await login(`hist-alice${suffix}`, 'password123')
const viewer = (await call(gm, 'POST', '/api/users', { username: `hist-viewer${suffix}`, password: 'password123', role: 'viewer' })).data
const viewerC = await login(`hist-viewer${suffix}`, 'password123')

const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const textOf = (d) => d.content[0].content[0].text

let r = await call(gm, 'POST', `/api/workspaces/${ws}/pages`, { title: 'Alpha', content: doc('first text'), tags: ['one'], props: { data: { race: 'Elf' } } })
const page = r.data
check('create page', r.status === 200 && page.id)
let versions = (await call(gm, 'GET', `/api/pages/${page.id}/versions`)).data
check('a new page has no history yet', Array.isArray(versions) && versions.length === 0)

// first edit: the starting state is kept as an earlier version, then the edit is recorded with its author
r = await call(gm, 'PATCH', `/api/pages/${page.id}`, { title: 'Beta', content: doc('second text'), tags: ['two'], aliases: ['Bee'], props: { data: { race: 'Dwarf' } } })
check('edit saved', r.status === 200)
versions = (await call(gm, 'GET', `/api/pages/${page.id}/versions`)).data
check('the starting state and the edit are both in the history', versions.length === 2, `got ${versions.length}`)
check('the edit names its author', versions[0].authorName === 'gm', JSON.stringify(versions[0]))
check('the starting state has no author', versions[1].authorName === null)
const baseline = versions[1]

r = await call(gm, 'PATCH', `/api/pages/${page.id}`, { content: doc('second text, more') })
versions = (await call(gm, 'GET', `/api/pages/${page.id}/versions`)).data
check('another edit by the same person soon after folds into the same entry', versions.length === 2 && versions[0].wordCount > 0)
let v = (await call(gm, 'GET', `/api/versions/${versions[0].id}`)).data
check('the folded entry holds the latest text', textOf(v.content) === 'second text, more')

r = await call(aliceC, 'PATCH', `/api/pages/${page.id}`, { content: doc('alice was here') })
versions = (await call(gm, 'GET', `/api/pages/${page.id}/versions`)).data
check('an edit by someone else is its own entry', versions.length === 3 && versions[0].authorName === `hist-alice${suffix}`, JSON.stringify(versions.map((x) => x.authorName)))
const aliceVersion = versions[0]

r = await call(gm, 'PATCH', `/api/pages/${page.id}`, { content: doc('alice was here') })
versions = (await call(gm, 'GET', `/api/pages/${page.id}/versions`)).data
check('saving identical content adds nothing', versions.length === 3)

// restore the starting state
r = await call(viewerC, 'POST', `/api/versions/${baseline.id}/restore`)
check('a viewer cannot restore', r.status === 403)
r = await call(gm, 'POST', `/api/versions/${baseline.id}/restore`)
check('restore succeeds', r.status === 200 && r.data.title === 'Alpha', JSON.stringify(r.data).slice(0, 100))
check('restore brings back the tags', JSON.stringify(r.data.tags) === JSON.stringify(['one']))
check('restore brings back the aliases', r.data.aliases.length === 0)
const full = (await call(gm, 'GET', `/api/pages/${page.id}`)).data
check('restore brings back the text', textOf(full.content) === 'first text')
check('restore brings back the special-page fields', full.props?.data?.race === 'Elf', JSON.stringify(full.props))
const before = versions.length
versions = (await call(gm, 'GET', `/api/pages/${page.id}/versions`)).data
check('the restore is a history entry by the person who did it', versions[0].reason === 'restore' && versions[0].authorName === 'gm' && versions[0].restoredFrom === baseline.createdAt, JSON.stringify(versions[0]))
check('nothing was lost: every earlier entry is still there', versions.length >= before + 1 && versions.some((x) => x.id === aliceVersion.id))

// and undo the restore by restoring what was there before
const alicePreview = (await call(gm, 'GET', `/api/versions/${aliceVersion.id}`)).data
check('an older entry still opens', textOf(alicePreview.content) === 'alice was here' && alicePreview.authorName === `hist-alice${suffix}`)
r = await call(gm, 'POST', `/api/versions/${aliceVersion.id}/restore`)
check('restoring a restore point goes back', r.status === 200 && r.data.title === 'Beta')
const back = (await call(gm, 'GET', `/api/pages/${page.id}`)).data
check('and the text is back', textOf(back.content) === 'alice was here' && back.props?.data?.race === 'Dwarf')

r = await call(gm, 'POST', `/api/versions/nope/restore`)
check('unknown version is a 404', r.status === 404)

await call(gm, 'DELETE', `/api/workspaces/${ws}`)
await call(gm, 'DELETE', `/api/users/${alice.id}`)
await call(gm, 'DELETE', `/api/users/${viewer.id}`)
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
