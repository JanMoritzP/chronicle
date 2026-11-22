// Connects Chronicle to the image administration program (sprite-admin) over HTTP only; no file access to it.
//  1. Scrape: every empty picture slot becomes one requested image (POST /api/requests) with an exact size, so the
//     admin's fit editor can scale and crop a person's upload to it. Slots: every image block of a page's special page
//     type (portrait and others), "[image: ...]" lines in page text, pins without a detail map, tokens without a
//     picture (one request per name), handouts without a picture, scenes without a background.
//     Requests are filed in folders: chronicle/<world>/<pages|text|maps|tokens|handouts|scenes>/...
//  2. Push: the admin POSTs every valid upload to this plugin's webhook, with the bytes, format and a hash.
//  3. Catch up: on start-up and on a timer, GET /api/events and GET /api/file fetch whatever was missed.
// A received image is stored like any upload (quota, hooks) and fills the slot it was requested for. Handling is idempotent:
// the same image arriving twice (push and catch-up) changes nothing the second time.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const FORMATS = ['png', 'jpg', 'webp']
const BATCH = 50

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const slug = (text, fallback) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback
/** Text fields of a request expand {placeholders}, so braces from a page title must be doubled. */
const literal = (text) => text.replace(/[{}]/g, (c) => c + c)
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y) }
const messages = (list) => (list ?? []).map((e) => (typeof e === 'string' ? e : e.message ?? JSON.stringify(e))).join('; ')

let timer
export function deactivate() { clearInterval(timer) }

export function activate(ctx) {
  const stateFile = path.join(ctx.dataDir, 'state.json')
  // lastSeq: the highest admin event handled. slots: sprite id -> { ws, page, name, sha, upload, seq, error }
  let state = { lastSeq: 0, slots: {} }
  try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) } } catch { /* first start */ }
  const save = () => { fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state)); fs.renameSync(stateFile + '.tmp', stateFile) }

  // images are applied one at a time, so a push and a catch-up never race
  let queue = Promise.resolve()
  const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => undefined); return run }

  const ready = () => { const c = ctx.config.get(); return !!(c.url && c.adminToken) }
  const refreshStatus = (note = '') => {
    const cfg = ctx.config.get()
    if (!cfg.url || !cfg.adminToken) return ctx.setStatus('Set the address and the admin token to start.')
    if (!cfg.webhookToken) note ||= 'No webhook token set: pushed images are refused, images arrive by catch-up only.'
    const slots = Object.values(state.slots)
    const got = slots.filter((s) => s.sha).length
    const bad = slots.filter((s) => s.error).length
    ctx.setStatus(`${slots.length} requested, ${got} received${bad ? `, ${bad} could not be applied` : ''}. ${note}`.trim())
  }

  async function admin(route, init = {}) {
    const cfg = ctx.config.get()
    const r = await fetch(`${cfg.url.replace(/\/+$/, '')}${route}`, {
      ...init, headers: { ...init.headers, Authorization: `Bearer ${cfg.adminToken}` }, signal: AbortSignal.timeout(15000),
    })
    return r
  }

  // ---------- 1. scrape the application and request images ----------

  /** What a slot is, whatever version saved it: version 2.0 slots are page portraits and have no kind or key. */
  const slotKey = (s) => `${s.kind ?? 'page'}|${s.ws}|${s.ref ?? s.page}|${s.key ?? (s.kind && s.kind !== 'page' ? '' : 'portrait')}`

  // Folders in image administration, one tree per world: chronicle/<world>/<category>/...
  //   pages/<page>/<picture>   text/<page>/<picture>   maps/<page>   tokens/<name>   handouts/<title>   scenes/<scene>
  function scrape() {
    const cfg = ctx.config.get()
    const types = new Set(String(cfg.pageTypes).split(',').map((t) => t.trim()).filter(Boolean))
    const mapTypes = new Set(String(cfg.mapPageTypes).split(',').map((t) => t.trim()).filter(Boolean))
    const format = FORMATS.includes(cfg.format) ? cfg.format : 'png'
    const dims = (w, h) => ({ width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) })
    const sprites = []
    const known = new Set(Object.values(state.slots).map(slotKey))
    const pageTypeOf = new Map(ctx.pages.list().map((p) => [p.id, p.type]))
    const pageDir = (p, title) => `${slug(title, 'page')}-${p.slice(0, 8)}`
    // one request for one empty slot; `path` is its place inside the world's folder, `ref`/`key` what the picture goes to
    const want = (kind, ws, ref, key, folderPath, label, size, what) => {
      const k = slotKey({ kind, ws, ref, key })
      if (known.has(k)) return // already requested; the same id again would only replace the request
      known.add(k)
      const world = ctx.worldName(ws) ?? 'World'
      const root = `${slug(world, 'world')}-${ws.slice(0, 8)}`
      sprites.push({
        id: `chronicle/${root}/${folderPath}`,
        description: literal(`${what} "${label.trim() || 'Untitled'}" in the world "${world}", from Chronicle, a worldbuilding notebook for tabletop role-playing campaigns. No text in the picture.`),
        spec: { ...size, formats: [format] },
        target: `${cfg.targetFolder || 'chronicle'}/${root}/${folderPath}.${format}`,
        _slot: { kind, ws, ref, key, name: slug(folderPath.split('/').slice(-2).join('-'), 'image'), title: label.trim() },
      })
    }
    if (cfg.requestPages) {
      // every image block of a page's special page type: the thumbnail ("portrait") and any further picture of a custom type
      const side = Math.round(cfg.width), tall = Math.round(cfg.width * 4 / 3), wide = Math.round(cfg.wideWidth)
      for (const s of ctx.pages.imageSlots()) {
        if (s.value || (types.size && !types.has(s.type))) continue
        const size = s.shape === 'wide' ? dims(wide, wide * 7 / 16) : s.shape === 'tall' ? dims(side, tall) : dims(side, cfg.height)
        want('page', s.ws, s.page, s.key, `pages/${pageDir(s.page, s.title)}/${slug(s.key, 'picture')}`, s.title, size, `${s.label || s.key} picture (${s.shape}) for the ${s.type} page`)
      }
    }
    if (cfg.requestText) {
      // a paragraph that is only "[image: what it shows]" asks for a picture right there in the text
      for (const t of ctx.pages.textImages()) {
        want('text', t.ws, t.page, t.hash, `text/${pageDir(t.page, t.title)}/${slug(t.description, 'picture')}-${t.hash}`, t.description, dims(cfg.textWidth, cfg.textHeight), `Illustration in the text of the page "${t.title}", showing`)
      }
    }
    if (cfg.requestMaps) {
      // a pin on a map that points at a page, with no map behind it: a detail map of that place
      for (const pin of ctx.maps.pins()) {
        const type = pageTypeOf.get(pin.pageId) ?? ''
        if (mapTypes.size && !mapTypes.has(type)) continue
        want('map', pin.ws, pin.pageId, '', `maps/${pageDir(pin.pageId, pin.title)}`, pin.title, dims(cfg.mapWidth, cfg.mapHeight), 'Top-down detail map of')
      }
    }
    if (cfg.requestTokens) {
      // tokens of one name share a picture, so a name is requested once
      for (const t of ctx.table.tokens()) {
        const name = t.name.trim()
        if (t.image || !name) continue
        const hash = crypto.createHash('sha1').update(name.toLowerCase()).digest('hex').slice(0, 6)
        want('token', t.ws, name.toLowerCase(), '', `tokens/${slug(name, 'token')}-${hash}`, name, dims(cfg.tokenSize, cfg.tokenSize), 'Top-down game token picture, centred on a transparent or plain background, for the token')
      }
    }
    if (cfg.requestHandouts) {
      for (const h of ctx.table.handouts()) {
        if (!h.image) want('handout', h.ws, h.id, '', `handouts/${slug(h.title, 'handout')}-${h.id.slice(0, 8)}`, h.title, dims(cfg.handoutWidth, cfg.handoutHeight), 'Picture for the handout')
      }
    }
    if (cfg.requestScenes) {
      // the frame is the scene's own size, so the background fits it exactly
      for (const s of ctx.table.scenes()) {
        if (!s.bg) want('scene', s.ws, s.id, '', `scenes/${slug(s.name, 'scene')}-${s.id.slice(0, 8)}`, s.name, dims(s.width, s.height), 'Battle map background for the scene')
      }
    }
    return sprites
  }

  /** Requests an image for every page that needs one and has not been asked for. Returns how many were sent. */
  function requestImages() {
    return serial(async () => {
      if (!ready()) throw new Error('Set the address and the admin token first.')
      const wanted = scrape()
      for (let i = 0; i < wanted.length; i += BATCH) {
        const chunk = wanted.slice(i, i + BATCH)
        const r = await admin('/api/requests', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sprites: chunk.map(({ _slot, ...sprite }) => sprite) }),
        })
        const body = await r.json().catch(() => ({}))
        // 422 means the data is wrong and nothing changed: show the reasons to the owner
        if (!r.ok || body.ok === false) throw new Error(`Image administration refused the request: ${messages(body.errors) || r.status}`)
        for (const s of chunk) state.slots[s.id] = { ...s._slot, sha: '', upload: '', seq: 0, error: '' }
        save()
      }
      refreshStatus()
      return wanted.length
    })
  }

  // ---------- 2. receive images ----------

  /** Stores one image and makes it the portrait of the page it was requested for. Same bytes twice: nothing happens. */
  function apply(id, bytes, format, seq) {
    return serial(async () => {
      const slot = state.slots[id]
      if (!slot) return 'unknown'
      const sha = sha256(bytes)
      if (slot.sha === sha) { if (seq > slot.seq) { slot.seq = seq; save() } return 'same' }
      try {
        const kind = slot.kind ?? 'page'
        let up = { id: '', url: '' }
        if (kind === 'map') {
          // a map keeps its own tiled copy of the picture, so it is not an upload; a new picture re-tiles the same map
          if (slot.map && ctx.maps.exists(slot.map)) await ctx.maps.replace(slot.map, bytes)
          else slot.map = await ctx.maps.create(slot.ws, slot.ref, slot.title || slot.name, bytes)
        } else {
          up = await ctx.uploads.add(slot.ws, `${slot.name}.${format || 'png'}`, bytes, 'image administration')
          const ok = {
            page: () => ctx.pages.setImage(slot.ref ?? slot.page, slot.key || 'portrait', up.url),
            // the first picture replaces the [image: ...] line, a later one the picture that stands there
            text: () => ctx.pages.fillTextImage(slot.ref, slot.key, up.url, slot.url),
            token: () => ctx.table.setTokenImages(slot.ws, slot.ref, up.url) > 0 || 'tokens',
            handout: () => ctx.table.setHandoutImage(slot.ref, up.url),
            scene: () => ctx.table.setSceneBackground(slot.ref, up.url),
          }[kind]()
          if (ok === 'tokens') ctx.log.info(`${id}: no token without a picture is left, the picture is in the asset library`)
          else if (!ok) throw new Error(`The ${kind} no longer exists`)
        }
        Object.assign(slot, { sha, upload: up.id, url: up.url, seq: Math.max(seq, slot.seq), error: '' })
        return 'applied'
      } catch (err) {
        slot.error = err.message
        throw err
      } finally { save(); refreshStatus() }
    })
  }

  ctx.route('POST', '/webhook', { access: 'none' }, async (req, reply) => {
    const token = ctx.config.get().webhookToken
    if (!token) return reply.code(503).send({ error: 'No webhook token is set in Chronicle' })
    if (!same(String(req.headers.authorization ?? ''), `Bearer ${token}`)) return reply.code(401).send({ error: 'unauthorized' })
    const bytes = req.body
    if (!Buffer.isBuffer(bytes) || !bytes.length) return reply.code(400).send({ error: 'The image is the request body' })
    const id = String(req.headers['x-sprite-id'] ?? '')
    // a wrong hash is corruption on the way: answer 5xx so the admin sends it again (other 4xx are dropped)
    if (sha256(bytes) !== String(req.headers['x-sprite-sha256'] ?? '').toLowerCase()) return reply.code(502).send({ error: 'The hash does not match the image' })
    const seq = Number(req.headers['x-sprite-seq']) || 0
    let result
    try { result = await apply(id, bytes, String(req.headers['x-sprite-format'] ?? ''), seq) } catch (err) {
      // a picture Chronicle cannot keep (for example SVG) will not get better by retrying; a full disk or quota might
      return reply.code(/not a PNG|must be a PNG/.test(err.message) ? 415 : 500).send({ error: err.message })
    }
    if (result === 'unknown') return reply.code(404).send({ error: 'Chronicle did not request that image' })
    if (seq === state.lastSeq + 1) { state.lastSeq = seq; save() }
    return reply.code(204).send()
  })

  // ---------- 3. catch up ----------

  /** Fetches every upload event since the last one handled. Stops at the first transport failure, so nothing is skipped. */
  function catchUp() {
    return (async () => {
      if (!ready()) throw new Error('Set the address and the admin token first.')
      const r = await admin(`/api/events?since=${state.lastSeq}`)
      if (!r.ok) throw new Error(`Image administration answered ${r.status} for the events`)
      const { events = [] } = await r.json()
      let applied = 0
      for (const e of events) {
        if (state.slots[e.id]) {
          const f = await admin(`/api/file?id=${encodeURIComponent(e.id)}`)
          if (!f.ok) throw new Error(`Image administration answered ${f.status} for ${e.id}`)
          const bytes = Buffer.from(await f.arrayBuffer())
          if (sha256(bytes) !== (f.headers.get('x-sprite-sha256') ?? sha256(bytes)).toLowerCase()) throw new Error(`The hash of ${e.id} does not match`)
          try { if ((await apply(e.id, bytes, e.format, e.seq)) === 'applied') applied++ } catch { /* recorded on the slot; retrying cannot help */ }
        }
        state.lastSeq = Math.max(state.lastSeq, e.seq)
        save()
      }
      refreshStatus()
      return applied
    })()
  }

  /** One round: ask for what is missing, then fetch what arrived. */
  async function round() {
    const asked = await requestImages()
    const got = await catchUp()
    return `${asked} requested, ${got} received.`
  }
  const quiet = () => round().catch((err) => { ctx.log.warn(err.message); refreshStatus(`Last try failed: ${err.message}`) })

  const schedule = () => {
    clearInterval(timer)
    const minutes = Number(ctx.config.get().pollMinutes)
    if (minutes > 0) timer = setInterval(quiet, minutes * 60_000)
  }
  ctx.config.onChange(() => { refreshStatus(); schedule() })

  ctx.route('POST', '/request', async () => ({ message: `${await requestImages()} new images requested.` }))
  ctx.route('POST', '/catchup', async () => ({ message: `${await catchUp()} new images received.` }))

  refreshStatus()
  schedule()
  if (ready()) setTimeout(quiet, 0)
}
