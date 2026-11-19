// Callouts, collapsible sections, columns and contents: storage, secrets in shared pages, Markdown export.
// node scripts/smoke-blocks.mjs http://localhost:3222 gm testpass123
import zlib from 'node:zlib'
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let cookie = ''
async function call(method, url, body, opts = {}) {
  const ck = opts.anon ? '' : cookie
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined })
  if (opts.binary) return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }
  const type = r.headers.get('content-type') ?? ''
  return { status: r.status, data: type.includes('json') ? await r.json().catch(() => null) : null, set: r.headers.get('set-cookie') }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  const out = new Map()
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8')
    const lnlen = buf.readUInt16LE(off + 26), lelen = buf.readUInt16LE(off + 28)
    const body = buf.subarray(off + 30 + lnlen + lelen, off + 30 + lnlen + lelen + csize)
    out.set(name, method === 8 ? zlib.inflateRawSync(body) : body)
    p += 46 + nlen + elen + clen
  }
  return out
}

cookie = (await call('POST', '/api/auth/login', { username: user, password: pass })).set.split(';')[0]
const W = (await call('POST', '/api/workspaces', { name: 'Blocks World' })).data
const t = (text) => ({ type: 'text', text })
const p = (...c) => ({ type: 'paragraph', content: c })
const doc = (...nodes) => ({ type: 'doc', content: nodes })
const callout = (kind, ...blocks) => ({ type: 'callout', attrs: { kind }, content: blocks })
const mk = (title, content) => call('POST', `/api/workspaces/${W.id}/pages`, { title, content }).then((r) => r.data)

const content = doc(
  { type: 'heading', attrs: { level: 2 }, content: [t('Intro')] },
  { type: 'toc' },
  callout('info', p(t('plain note text'))),
  callout('warning', p(t('careful here'))),
  callout('aloud', p(t('read this aloud'))),
  callout('secret', p(t('the butler did it'))),
  { type: 'fold', attrs: { title: 'Details' }, content: [p(t('folded text')), callout('secret', p(t('nested secret text')))] },
  { type: 'columns', content: [{ type: 'column', content: [p(t('left side'))] }, { type: 'column', content: [p(t('right side'))] }] },
)
const page = await mk('Blocks', content)
check('page with the new blocks is saved', !!page?.id)
const stored = (await call('GET', `/api/pages/${page.id}`)).data
check('the blocks come back unchanged', JSON.stringify(stored.content.content.slice(0, 8).map((n) => n.type)) === JSON.stringify(['heading', 'toc', 'callout', 'callout', 'callout', 'callout', 'fold', 'columns']) && stored.content.content[6].attrs.title === 'Details')
check('words inside the blocks are counted', stored.wordCount >= 20, String(stored.wordCount))

// ---- shared page ----
const token = (await call('POST', `/api/pages/${page.id}/share`)).data.token
const pub = await call('GET', `/api/public/${token}`, null, { anon: true })
const flat = JSON.stringify(pub.data.content)
check('shared page shows notes, warnings and read-aloud text', flat.includes('plain note text') && flat.includes('careful here') && flat.includes('read this aloud'))
check('shared page shows folds and columns', flat.includes('folded text') && flat.includes('left side') && flat.includes('right side') && flat.includes('"toc"'))
check('a secret never leaves with its text', !flat.includes('butler') && !flat.includes('nested secret text'))
check('a secret is still marked as one', (flat.match(/"kind":"secret"/g) ?? []).length === 2 && flat.includes('stays closed'))

// a page that embeds a page with a secret
const host = await mk('Host', doc(p(t('host text')), { type: 'embed', attrs: { pageId: page.id, name: page.title, anchor: null } }))
const hostToken = (await call('POST', `/api/pages/${host.id}/share`)).data.token
await call('POST', `/api/pages/${page.id}/share`)
const hostPub = JSON.stringify((await call('GET', `/api/public/${hostToken}`, null, { anon: true })).data.content)
check('a secret does not leak through an embed', hostPub.includes('plain note text') && !hostPub.includes('butler') && !hostPub.includes('nested secret text'))

// ---- Markdown export ----
const zip = await call('GET', `/api/workspaces/${W.id}/export`, null, { binary: true })
const files = unzip(zip.buf)
const md = [...files].find(([n]) => n.startsWith('pages/') && n.includes('Blocks'))?.[1].toString('utf8') ?? ''
check('export writes notes as labelled quotes', md.includes('> **Note**') && md.includes('> plain note text') && md.includes('> **Warning**') && md.includes('> **Read aloud**'))
check('export keeps secrets for the owner', md.includes('> **Secret**') && md.includes('the butler did it'))
check('export writes folds as details', md.includes('<summary>Details</summary>') && md.includes('folded text') && md.includes('</details>'))
check('export keeps column text in order', md.indexOf('left side') > 0 && md.indexOf('left side') < md.indexOf('right side'))

await call('DELETE', `/api/workspaces/${W.id}`)
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
