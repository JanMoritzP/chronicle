// node scripts/smoke-share.mjs http://localhost:3222 gm testpass123
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let cookie = ''
async function call(method, url, body, opts = {}) {
  const ck = opts.anon ? '' : opts.cookie ?? cookie
  const raw = body instanceof FormData
  const r = await fetch(base + url, { method, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(ck ? { cookie: ck } : {}) }, body: raw ? body : body ? JSON.stringify(body) : undefined })
  const type = r.headers.get('content-type') ?? ''
  return { status: r.status, data: type.includes('json') ? await r.json().catch(() => null) : null, set: r.headers.get('set-cookie'), type }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

cookie = (await call('POST', '/api/auth/login', { username: user, password: pass })).set.split(';')[0]
const W = (await call('POST', '/api/workspaces', { name: 'ShareWorld' })).data
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const mkUpload = async () => { const f = new FormData(); f.append('file', new Blob([png], { type: 'image/png' }), 'x.png'); return (await call('POST', `/api/workspaces/${W.id}/uploads`, f)).data }
const imgShared = await mkUpload()
const imgPrivate = await mkUpload()

const doc = (...nodes) => ({ type: 'doc', content: nodes })
const p = (...inline) => ({ type: 'paragraph', content: inline })
const t = (text) => ({ type: 'text', text })
const link = (pg, extra = {}) => ({ type: 'wikilink', attrs: { name: pg.title, pageId: pg.id, anchor: null, anchorText: null, alias: null, ...extra } })
const mk = (title, content, extra = {}) => call('POST', `/api/workspaces/${W.id}/pages`, { title, content, ...extra }).then((r) => r.data)

const secret = await mk('Secret Plot', doc(p(t('the villain is the mayor'))))
const friend = await mk('Friend', doc(p(t('a friendly face'))))
const hero = await mk('Hero', doc(
  p(t('Knows '), link(friend), t(' and '), link(secret), t(' and '), link(secret, { alias: 'someone' })),
  { type: 'image', attrs: { src: imgShared.url, alt: 'ok' } },
  { type: 'embed', attrs: { pageId: secret.id, name: secret.title, anchor: null } },
  { type: 'embed', attrs: { pageId: friend.id, name: friend.title, anchor: null } },
), { props: { portrait: imgShared.url } })
await mk('Other', doc({ type: 'image', attrs: { src: imgPrivate.url } }))

// ---- sharing ----
check('anonymous cannot create a share', (await call('POST', `/api/pages/${hero.id}/share`, null, { anon: true })).status === 401)
const s1 = await call('POST', `/api/pages/${hero.id}/share`)
check('create share returns a token', s1.status === 200 && s1.data.token?.length >= 20, s1.data?.token)
const token = s1.data.token
check('creating again returns the same token', (await call('POST', `/api/pages/${hero.id}/share`)).data.token === token)
check('status endpoint', (await call('GET', `/api/pages/${hero.id}/share`)).data.token === token && (await call('GET', `/api/pages/${secret.id}/share`)).data.token === null)

// ---- anonymous reading ----
let pub = await call('GET', `/api/public/${token}`, null, { anon: true })
check('shared page readable without login', pub.status === 200 && pub.data.title === 'Hero')
let flat = JSON.stringify(pub.data.content)
check('private page text never leaks', !flat.includes('villain') && !flat.includes('mayor'))
check('link to unshared page becomes plain text', flat.includes('"Secret Plot"') && !flat.includes(secret.id) && flat.includes('someone'))
check('private page id never leaks', !JSON.stringify(pub.data).includes(secret.id) && !JSON.stringify(pub.data).includes(friend.id))
check('link to unshared page has no link mark', !/Secret Plot[^}]*"link"/.test(flat))
check('own page ids are not exposed in links', !flat.includes('pageId'))
check('wikilinks are gone from the public doc', !flat.includes('wikilink'))
check('embed of unshared page is dropped', !flat.includes('embed') && !flat.includes('mayor'))
check('image rewritten to the public route', flat.includes(`/api/public/img/${imgShared.id}`) && !flat.includes('/api/uploads/'))
check('portrait rewritten', pub.data.portrait === `/api/public/img/${imgShared.id}`)

// ---- share the friend: link + embed appear ----
const fs1 = (await call('POST', `/api/pages/${friend.id}/share`)).data.token
pub = await call('GET', `/api/public/${token}`, null, { anon: true })
flat = JSON.stringify(pub.data.content)
check('link to a shared page points at its public url', flat.includes(`/s/${fs1}`))
check('embed of a shared page is inlined', flat.includes('a friendly face'))
check('still no secret', !flat.includes('villain'))

// ---- public images ----
const imgOk = await fetch(base + `/api/public/img/${imgShared.id}`)
check('shared image is public', imgOk.status === 200 && imgOk.headers.get('content-type') === 'image/png')
check('image of an unshared page is not public', (await fetch(base + `/api/public/img/${imgPrivate.id}`)).status === 404)
check('private upload route still needs login', (await fetch(base + imgShared.url)).status === 401)
check('bad image id rejected', (await fetch(base + '/api/public/img/..%2f..%2fdnd.db')).status === 404)

// ---- nothing else is public ----
check('no token, no page', (await call('GET', '/api/public/nope', null, { anon: true })).status === 404)
check('page api still needs login', (await call('GET', `/api/pages/${hero.id}`, null, { anon: true })).status === 401)
check('bootstrap still needs login', (await call('GET', `/api/workspaces/${W.id}/bootstrap`, null, { anon: true })).status === 401)
const list = (await call('GET', `/api/workspaces/${W.id}/shares`)).data
check('share list for the world', list.length === 2 && list.some((s) => s.title === 'Hero'))

// ---- section embeds ----
const sec = await mk('Lore', doc({ type: 'heading', attrs: { level: 2, id: 'h-one' }, content: [t('Open')] }, p(t('open knowledge')), { type: 'heading', attrs: { level: 2, id: 'h-two' }, content: [t('Closed')] }, p(t('closed knowledge'))))
const sec2 = (await call('GET', `/api/pages/${sec.id}`)).data
const openId = sec2.outline[0].id
const host = await mk('Host', doc({ type: 'embed', attrs: { pageId: sec.id, name: 'Lore', anchor: openId } }))
await call('POST', `/api/pages/${host.id}/share`)
await call('POST', `/api/pages/${sec.id}/share`)
const hostTok = (await call('GET', `/api/pages/${host.id}/share`)).data.token
const hp = (await call('GET', `/api/public/${hostTok}`, null, { anon: true })).data
const hf = JSON.stringify(hp.content)
check('section embed only includes that section', hf.includes('open knowledge') && !hf.includes('closed knowledge'), hf.slice(0, 160))

// ---- revoking ----
check('viewer cannot share', await (async () => {
  const vn = 'sv' + Math.floor(Math.random() * 1e6)
  await call('POST', '/api/users', { username: vn, password: 'viewerpass1', role: 'viewer' })
  const vc = (await call('POST', '/api/auth/login', { username: vn, password: 'viewerpass1' }, { anon: true })).set.split(';')[0]
  return (await call('POST', `/api/pages/${secret.id}/share`, null, { cookie: vc })).status === 403
})())
await call('DELETE', `/api/pages/${hero.id}/share`)
check('revoked link stops working', (await call('GET', `/api/public/${token}`, null, { anon: true })).status === 404)
check('revoked page image is closed again', (await fetch(base + `/api/public/img/${imgShared.id}`)).status === 404)
const again = (await call('POST', `/api/pages/${hero.id}/share`)).data.token
check('sharing again makes a new link', again !== token)
await call('DELETE', `/api/pages/${hero.id}`)
check('trashed page is no longer public', (await call('GET', `/api/public/${again}`, null, { anon: true })).status === 404)

// ---- the SPA route exists ----
const html = await fetch(base + `/s/${again}`)
check('/s/:token serves the app shell', html.status === 200 && (html.headers.get('content-type') ?? '').includes('html'))

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
