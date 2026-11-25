// Connects Chronicle to the image administration program (sprite-admin) over HTTP only; no file access to it.
// Every world (adventure) of Chronicle gets its own project there, created by the first request for it.
//  1. Scrape: every empty picture slot becomes one requested image (POST /api/requests) with an exact size, so the
//     admin's fit editor can scale and crop a person's upload to it. Slots: every image block of a page's special page
//     type (portrait and others), "[image: ...]" lines in page text, pins without a detail map, tokens without a
//     picture (one request per name), handouts without a picture, scenes without a background.
//     Inside a project the folders follow the adventure: pages/<folders>/<page>/<picture>, tabletop/...
//  2. Push: the admin POSTs every valid upload to this plugin's webhook, with the bytes, project, format and a hash.
//  3. Catch up: on start-up and on a timer, GET /api/events and GET /api/file fetch whatever was missed, per project.
// A received image is stored like any upload (quota, hooks) and fills the slot it was requested for. Handling is idempotent:
// the same image arriving twice (push and catch-up) changes nothing the second time.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const FORMATS = ['png', 'jpg', 'webp']
const BATCH = 50
const DEFAULT = 'default'

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const slug = (text, fallback) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y) }
const messages = (list) => (list ?? []).map((e) => (typeof e === 'string' ? e : e.message ?? JSON.stringify(e))).join('; ')
const skey = (project, id) => `${project}|${id}`

let timer
export function deactivate() { clearInterval(timer) }

export function activate(ctx) {
  const stateFile = path.join(ctx.dataDir, 'state.json')
  // seq: project -> highest admin event handled. projects: world id -> project id.
  // slots: "<project>|<sprite id>" -> { project, id, kind, ws, ref, key, name, title, dir, sha, upload, url, seq, error }
  let state = { seq: {}, projects: {}, slots: {} }
  try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) } } catch { /* first start */ }
  // older versions had one project and one event counter
  if (state.lastSeq) { state.seq[DEFAULT] = Math.max(state.seq[DEFAULT] ?? 0, state.lastSeq); delete state.lastSeq }
  for (const [k, s] of Object.entries(state.slots)) {
    if (k.includes('|')) continue
    delete state.slots[k]
    state.slots[skey(DEFAULT, k)] = { ...s, project: DEFAULT, id: k }
  }
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
    const projects = new Set(slots.map((s) => s.project)).size
    ctx.setStatus(`${slots.length} requested in ${projects} project${projects === 1 ? '' : 's'}, ${got} received${bad ? `, ${bad} could not be applied` : ''}. ${note}`.trim())
  }

  async function admin(route, init = {}) {
    const cfg = ctx.config.get()
    const base = cfg.url.trim().replace(/\/+$/, '')
    try {
      return await fetch(`${base}${route}`, {
        ...init, headers: { ...init.headers, Authorization: `Bearer ${cfg.adminToken}` }, signal: AbortSignal.timeout(15000),
      })
    } catch (err) {
      // Node only says "fetch failed"; the reason (refused, unknown host, timeout, bad address) is in the cause
      const why = err.name === 'TimeoutError' ? 'no answer within 15 seconds' : err.cause?.code ? `${err.cause.code}${err.cause.message ? `: ${err.cause.message}` : ''}` : err.cause?.message ?? err.message
      throw new Error(`Cannot reach image administration at ${base || '(no address set)'}: ${why}. Check the address, that the server is running, and that Chronicle can reach it (inside Docker, 127.0.0.1 is the container itself).`)
    }
  }

  // ---------- 1. scrape the application and request images ----------

  /** What a slot is, whatever version saved it: version 2.0 slots are page portraits and have no kind or key. */
  const slotKey = (s) => `${s.project ?? DEFAULT}|${s.kind ?? 'page'}|${s.ws}|${s.ref ?? s.page}|${s.key ?? (s.kind && s.kind !== 'page' ? '' : 'portrait')}`

  // A world is a project (named after it, with a number only if two worlds share a name). Inside it the folders follow
  // the adventure, with no ids in the names; a number is added only when two things would share a path:
  //   pages/<folders of the adventure>/<page>/<picture>   (text pictures and the detail map sit in the page's folder too)
  //   tabletop/tokens|handouts/<name>   tabletop/scenes/<scene folder>/<scene>
  function scrape() {
    const cfg = ctx.config.get()
    const types = new Set(String(cfg.pageTypes).split(',').map((t) => t.trim()).filter(Boolean))
    const mapTypes = new Set(String(cfg.mapPageTypes).split(',').map((t) => t.trim()).filter(Boolean))
    const format = FORMATS.includes(cfg.format) ? cfg.format : 'png'
    const dims = (w, h) => ({ width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) })
    const sprites = []
    const folders = {} // project -> { folder path -> title }: the real names of the adventure's folders
    const slots = Object.values(state.slots)
    const known = new Set(slots.map(slotKey))
    const usedIds = new Set(slots.map((s) => skey(s.project, s.id)))
    const usedDirs = new Set(slots.filter((s) => s.dir).map((s) => skey(s.project, s.dir)))
    const pageTypeOf = new Map(ctx.pages.list().map((p) => [p.id, p.type]))
    const names = (path) => String(path ?? '').split('/').filter((x) => x.trim())
    const named = (project, p, title) => { (folders[project] ??= {})[p] = title.trim() || 'Untitled' }

    // the project of a world, kept once chosen
    const projectOf = (ws) => {
      if (state.projects[ws]) return state.projects[ws]
      const base = slug(ctx.worldName(ws) ?? 'World', 'world')
      const taken = new Set([DEFAULT, ...Object.values(state.projects)])
      let id = base, n = 2
      while (taken.has(id)) id = `${base}-${n++}`
      return (state.projects[ws] = id)
    }
    // a page keeps its folder for all its pictures, even if it is renamed or moved later
    const pageDirs = new Map()
    for (const s of slots) if (s.dir && s.ref) pageDirs.set(`${s.project}|${s.ws}|${s.ref}`, s.dir)
    const dirOf = (ws, page, title, folder) => {
      const project = projectOf(ws)
      const k = `${project}|${ws}|${page}`
      const segs = names(folder).map((x) => slug(x, 'folder'))
      names(folder).forEach((nm, i) => named(project, ['pages', ...segs.slice(0, i + 1)].join('/'), nm))
      if (pageDirs.has(k)) { named(project, pageDirs.get(k), title); return pageDirs.get(k) }
      const base = ['pages', ...segs, slug(title, 'page')].join('/')
      let dir = base, n = 2
      while (usedDirs.has(skey(project, dir))) dir = `${base}-${n++}`
      usedDirs.add(skey(project, dir))
      pageDirs.set(k, dir)
      named(project, dir, title)
      return dir
    }

    // one request for one empty slot: `dir` is where it lives, `leaf` the picture's own name (none: the folder itself)
    const want = (kind, ws, ref, key, dir, leaf, label, size, what, remember) => {
      const project = projectOf(ws)
      const k = slotKey({ project, kind, ws, ref, key })
      if (known.has(k)) return // already requested; the same id again would only replace the request
      known.add(k)
      const base = leaf ? `${dir}/${leaf}` : dir
      let id = base, n = 2
      while (usedIds.has(skey(project, id))) id = `${base}-${n++}`
      usedIds.add(skey(project, id))
      sprites.push({
        _project: project, id,
        description: `${what} "${label.trim() || 'Untitled'}" in the world "${ctx.worldName(ws) ?? 'World'}", from Chronicle, a worldbuilding notebook for tabletop role-playing campaigns. No text in the picture.`,
        spec: { ...size, formats: [format] },
        target: `${cfg.targetFolder || 'chronicle'}/${id}.${format}`,
        _slot: { project, id, kind, ws, ref, key, name: slug(id.split('/').slice(-2).join('-'), 'image'), title: label.trim(), ...(remember ? { dir } : {}) },
      })
    }

    if (cfg.requestPages) {
      // every image block of a page's special page type: the thumbnail ("portrait") and any further picture of a custom type
      const side = Math.round(cfg.width), tall = Math.round(cfg.width * 4 / 3), wide = Math.round(cfg.wideWidth)
      for (const s of ctx.pages.imageSlots()) {
        if (s.value || (types.size && !types.has(s.type))) continue
        // a player character's token picture is square at the token size, like the pictures of tokens on the table
        const size = s.shape === 'token' ? dims(cfg.tokenSize, cfg.tokenSize) : s.shape === 'wide' ? dims(wide, wide * 7 / 16) : s.shape === 'tall' ? dims(side, tall) : dims(side, cfg.height)
        want('page', s.ws, s.page, s.key, dirOf(s.ws, s.page, s.title, s.folder), slug(s.key, 'picture'), s.title, size, `${s.label || s.key} picture (${s.shape}) for the ${s.type} page`, true)
      }
    }
    if (cfg.requestText) {
      // a paragraph that is only "[image: what it shows]" asks for a picture right there in the text
      for (const t of ctx.pages.textImages()) {
        want('text', t.ws, t.page, t.hash, dirOf(t.ws, t.page, t.title, t.folder), slug(t.description, 'picture'), t.description, dims(cfg.textWidth, cfg.textHeight), `Illustration in the text of the page "${t.title}", showing`, true)
      }
    }
    if (cfg.requestMaps) {
      // a pin on a map that points at a page, with no map behind it: a detail map of that place
      for (const pin of ctx.maps.pins()) {
        if (mapTypes.size && !mapTypes.has(pageTypeOf.get(pin.pageId) ?? '')) continue
        want('map', pin.ws, pin.pageId, '', dirOf(pin.ws, pin.pageId, pin.title, pin.folder), 'map', pin.title, dims(cfg.mapWidth, cfg.mapHeight), 'Top-down detail map of', true)
      }
    }
    if (cfg.requestTokens) {
      // tokens of one name share a picture, so a name is requested once
      for (const t of ctx.table.tokens()) {
        const name = t.name.trim()
        if (t.image || !name) continue
        want('token', t.ws, name.toLowerCase(), '', 'tabletop/tokens', slug(name, 'token'), name, dims(cfg.tokenSize, cfg.tokenSize), 'Top-down game token picture, centred on a transparent or plain background, for the token')
      }
    }
    if (cfg.requestHandouts) {
      for (const h of ctx.table.handouts()) {
        if (!h.image) want('handout', h.ws, h.id, '', 'tabletop/handouts', slug(h.title, 'handout'), h.title, dims(cfg.handoutWidth, cfg.handoutHeight), 'Picture for the handout')
      }
    }
    if (cfg.requestScenes) {
      // the frame is the scene's own size, so the background fits it exactly; the scene's folder is kept
      for (const s of ctx.table.scenes()) {
        if (s.bg) continue
        const segs = names(s.folder).map((x) => slug(x, 'folder'))
        names(s.folder).forEach((nm, i) => named(projectOf(s.ws), ['tabletop', 'scenes', ...segs.slice(0, i + 1)].join('/'), nm))
        want('scene', s.ws, s.id, '', ['tabletop', 'scenes', ...segs].join('/'), slug(s.name, 'scene'), s.name, dims(s.width, s.height), 'Battle map background for the scene')
      }
    }
    return { sprites, folders }
  }

  /** Requests an image for every empty slot that has not been asked for yet. Returns how many were sent. */
  function requestImages() {
    return serial(async () => {
      if (!ready()) throw new Error('Set the address and the admin token first.')
      const { sprites, folders } = scrape()
      const byProject = new Map()
      for (const s of sprites) (byProject.get(s._project) ?? byProject.set(s._project, []).get(s._project)).push(s)
      for (const [project, list] of byProject) {
        const ws = list[0]._slot.ws
        for (let i = 0; i < list.length; i += BATCH) {
          const chunk = list.slice(i, i + BATCH)
          const r = await admin('/api/requests', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              // naming the project creates it on first use; the folders carry the adventure's own names
              project: { id: project, name: ctx.worldName(ws) ?? project, description: `Pictures for the Chronicle world "${ctx.worldName(ws) ?? project}".` },
              folders: Object.fromEntries(Object.entries(folders[project] ?? {}).map(([p, title]) => [p, { title }])),
              sprites: chunk.map(({ _slot, _project, ...sprite }) => sprite),
            }),
          })
          const body = await r.json().catch(() => ({}))
          // 422 means the data is wrong and nothing changed: show the reasons to the owner
          if (!r.ok || body.ok === false) throw new Error(`Image administration refused the request for "${project}": ${messages(body.errors) || r.status}`)
          for (const s of chunk) state.slots[skey(project, s.id)] = { ...s._slot, sha: '', upload: '', seq: 0, error: '' }
          save()
        }
      }
      save()
      refreshStatus()
      return sprites.length
    })
  }

  // ---------- 2. receive images ----------

  /** Stores one image and makes it fill the slot it was requested for. Same bytes twice: nothing happens. */
  function apply(project, id, bytes, format, seq) {
    return serial(async () => {
      const slot = state.slots[skey(project, id)]
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
          if (ok === 'tokens') ctx.log.info(`${project}/${id}: no token without a picture is left, the picture is in the asset library`)
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
    const project = String(req.headers['x-sprite-project'] || DEFAULT)
    const id = String(req.headers['x-sprite-id'] ?? '')
    // a wrong hash is corruption on the way: answer 5xx so the admin sends it again (other 4xx are dropped)
    if (sha256(bytes) !== String(req.headers['x-sprite-sha256'] ?? '').toLowerCase()) return reply.code(502).send({ error: 'The hash does not match the image' })
    const seq = Number(req.headers['x-sprite-seq']) || 0
    let result
    try { result = await apply(project, id, bytes, String(req.headers['x-sprite-format'] ?? ''), seq) } catch (err) {
      // a picture Chronicle cannot keep (for example SVG) will not get better by retrying; a full disk or quota might
      return reply.code(/not a PNG|must be a PNG/.test(err.message) ? 415 : 500).send({ error: err.message })
    }
    if (result === 'unknown') return reply.code(404).send({ error: 'Chronicle did not request that image' })
    if (seq === (state.seq[project] ?? 0) + 1) { state.seq[project] = seq; save() }
    return reply.code(204).send()
  })

  // ---------- 3. catch up ----------

  /** Fetches every upload event since the last one handled, project by project. Stops at the first transport failure, so nothing is skipped. */
  function catchUp() {
    return (async () => {
      if (!ready()) throw new Error('Set the address and the admin token first.')
      const projects = new Set([...Object.values(state.projects), ...Object.values(state.slots).map((s) => s.project)])
      let applied = 0
      for (const project of projects) {
        const q = `project=${encodeURIComponent(project)}`
        const r = await admin(`/api/events?${q}&since=${state.seq[project] ?? 0}`)
        if (r.status === 404) continue // not created yet: nothing was requested there
        if (!r.ok) throw new Error(`Image administration answered ${r.status} for the events of "${project}"`)
        const { events = [] } = await r.json()
        for (const e of events) {
          if (state.slots[skey(project, e.id)]) {
            const f = await admin(`/api/file?${q}&id=${encodeURIComponent(e.id)}`)
            if (!f.ok) throw new Error(`Image administration answered ${f.status} for ${project}/${e.id}`)
            const bytes = Buffer.from(await f.arrayBuffer())
            if (sha256(bytes) !== (f.headers.get('x-sprite-sha256') ?? sha256(bytes)).toLowerCase()) throw new Error(`The hash of ${project}/${e.id} does not match`)
            try { if ((await apply(project, e.id, bytes, e.format, e.seq)) === 'applied') applied++ } catch { /* recorded on the slot; retrying cannot help */ }
          }
          state.seq[project] = Math.max(state.seq[project] ?? 0, e.seq)
          save()
        }
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
  ctx.route('POST', '/forget', async () => {
    const n = Object.keys(state.slots).length
    state.slots = {}
    save(); refreshStatus()
    return { message: `Forgot ${n} requests. Request images again to file them anew; a project keeps its old sprites in image administration, delete them there.` }
  })
  ctx.route('POST', '/catchup', async () => ({ message: `${await catchUp()} new images received.` }))

  refreshStatus()
  schedule()
  if (ready()) setTimeout(quiet, 0)
}
