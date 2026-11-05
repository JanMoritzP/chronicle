// node scripts/smoke-copy.mjs http://localhost:3222 gm testpass123
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let cookie = ''
async function call(method, url, body, raw) {
  const r = await fetch(base + url, { method, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) }, body: raw ? body : body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => null), set: r.headers.get('set-cookie') }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

cookie = (await call('POST', '/api/auth/login', { username: user, password: pass })).set.split(';')[0]
const A = (await call('POST', '/api/workspaces', { name: 'CopySrc' })).data
const B = (await call('POST', '/api/workspaces', { name: 'CopyDst' })).data

// a real image upload
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'dot.png')
const up = (await call('POST', `/api/workspaces/${A.id}/uploads`, form, true)).data

const folder = (await call('POST', `/api/workspaces/${A.id}/folders`, { name: 'NPCs' })).data
const mkPage = (title, content, extra = {}) => call('POST', `/api/workspaces/${A.id}/pages`, { title, content, ...extra }).then((r) => r.data)
const doc = (...nodes) => ({ type: 'doc', content: nodes })
const p = (...inline) => ({ type: 'paragraph', content: inline })
const link = (pg, anchor = null) => ({ type: 'wikilink', attrs: { name: pg.title, pageId: pg.id, anchor, anchorText: null, alias: null } })

const keep = await mkPage('Keep Me', doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'History' }] }, p({ type: 'text', text: 'old stories' })))
const side = await mkPage('Side Quest', doc(p({ type: 'text', text: 'a side quest' })))
const hero = await mkPage('Hero', doc(
  p({ type: 'text', text: 'knows ' }, link(keep), { type: 'text', text: ' and ' }, link(side)),
  { type: 'image', attrs: { src: up.url, alt: 'dot' } },
  { type: 'embed', attrs: { pageId: keep.id, name: keep.title, anchor: null } },
), { folderId: folder.id, tags: ['npc', 'main'], props: { portrait: up.url } })
await call('POST', `/api/workspaces/${A.id}/relations`, { sourceId: hero.id, targetId: keep.id, kind: 'sibling' })

// ---- preview lists what is linked ----
const pv = (await call('POST', '/api/copy/preview', { pageIds: [hero.id], targetWorkspaceId: B.id })).data
check('preview lists both linked pages', pv.linked.length === 2 && pv.linked.some((l) => l.title === 'Keep Me'), JSON.stringify(pv.linked.map((l) => l.title)))
check('embed + link counted as 2 mentions', pv.linked.find((l) => l.title === 'Keep Me').mentions === 2)

// ---- copy only Hero: links become ghosts ----
const c1 = await call('POST', '/api/copy', { pageIds: [hero.id], targetWorkspaceId: B.id })
check('copy ok', c1.status === 200, JSON.stringify(c1.data).slice(0, 120))
check('3 link/embed targets became ghosts', c1.data.ghostLinks === 3, String(c1.data.ghostLinks))
check('image duplicated once', c1.data.images === 1)
const newHero = (await call('GET', `/api/pages/${c1.data.pages[0].to}`)).data
const flat = JSON.stringify(newHero.content)
check('no source ids left in the copy', !flat.includes(keep.id) && !flat.includes(side.id) && !flat.includes(hero.id))
check('ghost names kept', flat.includes('Keep Me') && flat.includes('Side Quest'))
check('image url points to a new upload', !flat.includes(up.id) && newHero.props.portrait !== up.url && flat.includes(newHero.props.portrait))
check('copied image is readable', (await fetch(base + newHero.props.portrait, { headers: { cookie } })).status === 200)
check('tags copied', newHero.tags.includes('npc') && newHero.tags.includes('main'))
const bs = (await call('GET', `/api/workspaces/${B.id}/bootstrap`)).data
const dstFolder = bs.folders.find((f) => f.name === 'NPCs')
check('folder recreated', !!dstFolder && bs.pages[0].folderId === dstFolder.id)
check('links are unresolved ghosts', bs.links.filter((l) => l.sourceId === newHero.id).every((l) => l.targetId === null) && bs.links.length === 3, String(bs.links.length))
check('original untouched', (await call('GET', `/api/pages/${hero.id}`)).data.content.content[0].content.some((n) => n.attrs?.pageId === keep.id))

// ---- later copying the missing page makes the ghosts live ----
const c2 = await call('POST', '/api/copy', { pageIds: [keep.id], targetWorkspaceId: B.id })
const keepCopy = c2.data.pages[0].to
const bs2 = (await call('GET', `/api/workspaces/${B.id}/bootstrap`)).data
check('ghosts resolve once the page exists', bs2.links.filter((l) => l.sourceId === newHero.id && l.targetName === 'Keep Me').every((l) => l.targetId === keepCopy))
check('other ghost stays a ghost', bs2.links.filter((l) => l.targetName === 'Side Quest').every((l) => l.targetId === null))

// ---- copying together keeps ids and relations ----
const C = (await call('POST', '/api/workspaces', { name: 'CopyDst2' })).data
const c3 = await call('POST', '/api/copy', { pageIds: [hero.id, keep.id, side.id], targetWorkspaceId: C.id })
const bs3 = (await call('GET', `/api/workspaces/${C.id}/bootstrap`)).data
check('all links resolve when everything is copied', c3.data.ghostLinks === 0 && bs3.links.length === 3 && bs3.links.every((l) => l.targetId), JSON.stringify(c3.data).slice(0, 100))
check('relation between copied pages carried over', (await call('GET', `/api/workspaces/${C.id}/relations`)).data.length === 1)

// ---- title collisions get renamed, never merged ----
const c4 = await call('POST', '/api/copy', { pageIds: [side.id], targetWorkspaceId: C.id })
check('duplicate title renamed', c4.data.pages[0].renamed && c4.data.pages[0].title === 'Side Quest (copy)', c4.data.pages[0].title)
const c5 = await call('POST', '/api/copy', { pageIds: [side.id], targetWorkspaceId: C.id })
check('second collision numbered', c5.data.pages[0].title === 'Side Quest (copy 2)', c5.data.pages[0].title)

// ---- guards ----
check('same world rejected', (await call('POST', '/api/copy', { pageIds: [hero.id], targetWorkspaceId: A.id })).status === 400)
check('missing target rejected', (await call('POST', '/api/copy', { pageIds: [hero.id], targetWorkspaceId: 'nope' })).status === 404)
check('unknown page rejected', (await call('POST', '/api/copy', { pageIds: ['nope'], targetWorkspaceId: B.id })).status === 404)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
