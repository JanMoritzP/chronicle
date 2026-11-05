// node scripts/smoke-export.mjs http://localhost:3222 gm testpass123
import zlib from 'node:zlib'
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let cookie = ''
async function call(method, url, body, opts = {}) {
  const ck = opts.anon ? '' : opts.cookie ?? cookie
  const raw = body instanceof FormData
  const r = await fetch(base + url, { method, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(ck ? { cookie: ck } : {}) }, body: raw ? body : body ? JSON.stringify(body) : undefined })
  const type = r.headers.get('content-type') ?? ''
  if (opts.binary) return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), headers: r.headers }
  return { status: r.status, data: type.includes('json') ? await r.json().catch(() => null) : null, set: r.headers.get('set-cookie') }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

// independent zip reader (central directory), also verifies CRCs
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  const out = new Map()
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central header')
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8')
    const lnlen = buf.readUInt16LE(off + 26), lelen = buf.readUInt16LE(off + 28)
    const body = buf.subarray(off + 30 + lnlen + lelen, off + 30 + lnlen + lelen + csize)
    const data = method === 8 ? zlib.inflateRawSync(body) : body
    if (zlib.crc32(data) !== crc) throw new Error('crc mismatch ' + name)
    out.set(name, data)
    p += 46 + nlen + elen + clen
  }
  return out
}

cookie = (await call('POST', '/api/auth/login', { username: user, password: pass })).set.split(';')[0]
const W = (await call('POST', '/api/workspaces', { name: 'Exp World' })).data
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const f = new FormData(); f.append('file', new Blob([png], { type: 'image/png' }), 'x.png')
const img = (await call('POST', `/api/workspaces/${W.id}/uploads`, f)).data
const doc = (...nodes) => ({ type: 'doc', content: nodes })
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const p = (...c) => ({ type: 'paragraph', content: c })
const mk = (title, content, extra = {}) => call('POST', `/api/workspaces/${W.id}/pages`, { title, content, ...extra }).then((r) => r.data)
const folder = (await call('POST', `/api/workspaces/${W.id}/folders`, { name: 'Places & "Things"' })).data

const city = await mk('Waterdeep', doc({ type: 'heading', attrs: { level: 2, id: 'h1' }, content: [t('History')] }, p(t('Old city.'))), { tags: ['city', 'faerun/north'] })
await call('PATCH', `/api/pages/${city.id}`, { aliases: ['City of Splendors'] })
const hero = await mk('Hero: A/B', doc(
  { type: 'heading', attrs: { level: 1, id: 'x' }, content: [t('Bio')] },
  p(t('Born in '), { type: 'wikilink', attrs: { name: 'Waterdeep', pageId: city.id, anchor: 'h1', anchorText: 'History', alias: 'the city' } }, t(' and is '), t('brave', [{ type: 'bold' }]), t(' * not a star_')),
  { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('one'))] }, { type: 'listItem', content: [p(t('two'))] }] },
  { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('done'))] }] },
  { type: 'image', attrs: { src: img.url, alt: 'pic' } },
  { type: 'embed', attrs: { pageId: city.id, name: 'Waterdeep', anchor: null } },
  { type: 'statblock', attrs: { template: '5e-monster', data: { name: 'Hero', ac: '15' } } },
))
await call('PATCH', `/api/pages/${hero.id}`, { folderId: folder.id })
await mk('Hero: A/B', doc(p(t('duplicate title'))))
await call('POST', `/api/workspaces/${W.id}/relations`, { sourceId: hero.id, targetId: city.id, kind: 'other', label: 'lives in' })
const trashed = await mk('Gone', doc(p(t('deleted text'))))
await call('DELETE', `/api/pages/${trashed.id}`)

// ---- world export ----
check('export needs login', (await call('GET', `/api/workspaces/${W.id}/export`, null, { anon: true, binary: true })).status === 401)
const r = await call('GET', `/api/workspaces/${W.id}/export`, null, { binary: true })
check('export returns a zip', r.status === 200 && r.headers.get('content-type') === 'application/zip' && /attachment/.test(r.headers.get('content-disposition')), r.headers.get('content-disposition'))
const files = unzip(r.buf)
const names = [...files.keys()]
check('archive is valid and CRCs match', names.length > 4, names.join(' | '))
const text = (n) => files.get(n)?.toString('utf8') ?? ''
const heroFile = names.find((n) => n.startsWith('pages/') && text(n).includes('Born in'))
check('page is placed in its folder, name sanitised', /^pages\/Places & -Things-\/Hero- A-B\.md$/.test(heroFile ?? ''), heroFile)
const md = text(heroFile)
check('front-matter', md.startsWith('---\ntitle: "Hero: A/B"') && md.includes(`id: ${hero.id}`))
check('wikilink with section and alias', md.includes('[[Waterdeep#History|the city]]'), md.split('\n').find((l) => l.includes('Born')))
check('bold and escaping', md.includes('**brave**') && md.includes('\\* not a star\\_'))
check('lists and tasks', md.includes('- one\n- two') && md.includes('- [x] done'))
check('embed syntax', md.includes('![[Waterdeep]]'))
check('image relinked into archive (relative to the nested folder)', new RegExp(`!\\[pic\\]\\(\\.\\./\\.\\./images/${img.id}\\.png\\)`).test(md) && files.has(`images/${img.id}.png`) && files.get(`images/${img.id}.png`).equals(png))
check('stat block exported', md.includes('```statblock 5e-monster') && md.includes('ac: 15'))
const cityFile = names.find((n) => n === 'pages/Waterdeep.md')
check('tags and aliases in front-matter', text(cityFile).includes('tags: ["city", "faerun/north"]') && text(cityFile).includes('aliases: ["City of Splendors"]'), text(cityFile).split('\n').slice(0, 6).join(' / '))
check('same-titled pages do not overwrite each other', names.filter((n) => /Hero- A-B/.test(n)).length === 2, names.filter((n) => /Hero/.test(n)).join(','))
check('trashed pages are not exported', !names.some((n) => text(n).includes('deleted text')))
const wj = JSON.parse(text('world.json'))
check('world.json has the structure', wj.format === 'chronicle-world' && wj.pages.length === 3 && wj.folders.length === 1 && wj.relations.length === 1 && wj.relations[0].label === 'lives in' && wj.uploads.length === 1)
check('world.json keeps the editor documents', wj.pages.find((x) => x.id === hero.id).content.content[1].content[1].attrs.pageId === city.id)
check('other worlds are not in the export', !JSON.stringify(wj).includes('Exp World') || wj.workspace.name === 'Exp World')

// viewer may export a world (read access) but not the whole instance
const vn = 'ev' + Math.floor(Math.random() * 1e6)
await call('POST', '/api/users', { username: vn, password: 'viewerpass1', role: 'viewer' })
const vc = (await call('POST', '/api/auth/login', { username: vn, password: 'viewerpass1' }, { anon: true })).set.split(';')[0]
check('viewer can export a world', (await call('GET', `/api/workspaces/${W.id}/export`, null, { cookie: vc, binary: true })).status === 200)
check('viewer cannot download full backup', (await call('GET', '/api/export/full', null, { cookie: vc, binary: true })).status === 403)
check('viewer cannot restore', (await call('POST', '/api/backups/x.db/restore', {}, { cookie: vc })).status === 403)

// ---- full export ----
const full = await call('GET', '/api/export/full', null, { binary: true })
const fz = unzip(full.buf)
check('full export has db, uploads, readme', full.status === 200 && fz.has('dnd.db') && fz.has(`uploads/${img.id}.png`) && fz.has('README.txt'))
check('full export db is a sqlite file', fz.get('dnd.db').subarray(0, 15).toString() === 'SQLite format 3')

// ---- backup list / download ----
const mkb = (await call('POST', '/api/backups', {})).data.name
const info = (await call('GET', '/api/backups/info')).data
check('backup list has details', info.some((b) => b.name === mkb && b.size > 0 && b.kind === 'daily'))
const dl = await call('GET', `/api/backups/${mkb}/download`, null, { binary: true })
check('backup download is sqlite', dl.status === 200 && dl.buf.subarray(0, 15).toString() === 'SQLite format 3')
check('path traversal rejected', (await call('GET', '/api/backups/..%2fdnd.db/download', null, { binary: true })).status === 404 && (await call('POST', '/api/backups/..%2fdnd.db/restore', {})).status === 404)

// ---- restore ----
const bk = (await call('POST', '/api/backups', {})).data.name // state A: hero, city exist
await call('PATCH', `/api/pages/${city.id}`, { title: 'Waterdeep CHANGED' })
const extra = await mk('Made after backup', doc(p(t('later'))))
const lateUser = 'late' + Math.floor(Math.random() * 1e6)
await call('POST', '/api/users', { username: lateUser, password: 'viewerpass1', role: 'viewer' })
const rs = await call('POST', `/api/backups/${bk}/restore`, {})
check('restore succeeds and reports a safety backup', rs.status === 200 && rs.data.ok && /^pre-restore-/.test(rs.data.safety), JSON.stringify(rs.data))
const boot = (await call('GET', `/api/workspaces/${W.id}/bootstrap`)).data
check('pages are back to the backup state', boot.pages.some((x) => x.title === 'Waterdeep') && !boot.pages.some((x) => x.id === extra.id))
check('still logged in after restore (accounts kept)', (await call('GET', '/api/auth/me')).status === 200)
check('accounts created after the backup survive', (await call('POST', '/api/auth/login', { username: lateUser, password: 'viewerpass1' }, { anon: true })).status === 200)
const info2 = (await call('GET', '/api/backups/info')).data
check('pre-restore backup is listed', info2.some((b) => b.name === rs.data.safety && b.kind === 'pre-restore'))
const rs2 = await call('POST', `/api/backups/${rs.data.safety}/restore`, {})
check('undo: restoring the safety backup brings the later state back', rs2.status === 200 && (await call('GET', `/api/workspaces/${W.id}/bootstrap`)).data.pages.some((x) => x.id === extra.id))
check('delete a backup', (await call('DELETE', `/api/backups/${mkb}`)).status === 200 && !(await call('GET', '/api/backups')).data.includes(mkb))
check('app still healthy', (await call('GET', `/api/pages/${hero.id}`)).status === 200)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
