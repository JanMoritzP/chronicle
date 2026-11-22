// Complement to the image administration program (sprite-admin, "Sprite Contract" format 1.0).
// Each picture stored in Chronicle becomes one sprite in a contract file of its world, and its bytes are sent to
// sprite-admin, which validates them and delivers them to the sprite's target path. Chronicle keeps its own copy
// so pages, shares and backups keep working.
import fs from 'node:fs'
import path from 'node:path'

const FORMAT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

const slug = (text, fallback) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback
/** Text fields of a contract expand {placeholders}, so braces from a file name must be doubled. */
const literal = (text) => text.replace(/[{}]/g, (c) => c + c)

export function activate(ctx) {
  const ledgerFile = path.join(ctx.dataDir, 'sprites.json')
  // upload id -> { ws, spriteId, file, sent, error }; remembers what was entered where
  let ledger = {}
  try { ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) } catch { /* first start */ }
  const save = () => { fs.writeFileSync(ledgerFile + '.tmp', JSON.stringify(ledger)); fs.renameSync(ledgerFile + '.tmp', ledgerFile) }

  // contract files are rewritten one at a time
  let queue = Promise.resolve()
  const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => undefined); return run }

  const refreshStatus = () => {
    const cfg = ctx.config.get()
    if (!cfg.contractDir) return ctx.setStatus('Set the contract folder to start.')
    const all = Object.values(ledger)
    const waiting = all.filter((e) => !e.sent && cfg.sendImage).length
    ctx.setStatus(`${all.length} in the contract${waiting ? `, ${waiting} not yet accepted by image administration` : ''}.`)
  }
  ctx.config.onChange(refreshStatus)

  const contractPath = (cfg, ws) => path.join(cfg.contractDir, cfg.includeFolder || 'contracts', `chronicle-${ws}.json`)

  function writeContract(cfg, ws, change) {
    return serial(() => {
      const file = contractPath(cfg, ws)
      let doc = { contract: '1.0', sprites: [] }
      if (fs.existsSync(file)) doc = JSON.parse(fs.readFileSync(file, 'utf8'))
      doc.sprites = (doc.sprites ?? []).filter((s) => !change.remove?.includes(s.id))
      if (change.sprite) doc.sprites.push(change.sprite)
      if (change.folder) doc.folders = { [change.folder.id]: change.folder.value }
      if (!doc.sprites.length) { fs.rmSync(file, { force: true }); return }
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file + '.tmp', JSON.stringify(doc, null, 2))
      fs.renameSync(file + '.tmp', file)
    })
  }

  async function deliver(cfg, entry, mime) {
    const bytes = fs.readFileSync(entry.file)
    const r = await fetch(`${cfg.url.replace(/\/+$/, '')}/api/upload?id=${encodeURIComponent(entry.spriteId)}`, {
      method: 'POST', headers: { 'X-Sprite-Admin': '1', 'content-type': mime }, body: bytes, signal: AbortSignal.timeout(15000),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok || !body.ok) throw new Error((body.errors ?? [`image administration answered ${r.status}`]).map((e) => (typeof e === 'string' ? e : e.message ?? JSON.stringify(e))).join('; '))
  }

  async function enter(upload, user) {
    const cfg = ctx.config.get()
    if (!cfg.contractDir) return
    const format = FORMAT[upload.mime]
    if (!format) return // sound, video and AVIF are not sprites
    const info = await ctx.image.info(upload.file)
    if (!info) return
    const world = ctx.worldName(upload.ws) ?? 'World'
    const folderName = `${slug(world, 'world')}-${upload.ws.slice(0, 8)}`
    const base = slug(upload.filename.replace(/\.[^.]+$/, ''), 'image')
    const spriteId = `chronicle/${folderName}/${base}-${upload.id.slice(0, 8)}`
    const target = `${cfg.targetFolder || 'chronicle'}/${folderName}/${base}-${upload.id.slice(0, 8)}.${format}`
    const entry = { ws: upload.ws, spriteId, file: upload.file, sent: false, error: '' }
    ledger[upload.id] = entry
    save()
    await writeContract(cfg, upload.ws, {
      folder: { id: `chronicle/${folderName}`, value: { title: `Chronicle: ${literal(world)}`, description: literal(`Pictures of the world "${world}" in Chronicle.`) } },
      sprite: {
        id: spriteId,
        title: literal(upload.filename.replace(/\.[^.]+$/, '').slice(0, 80) || 'Image'),
        description: literal(`The picture "${upload.filename}" from the world "${world}" in Chronicle, a worldbuilding notebook for tabletop role-playing campaigns. It appears on pages, maps or the table. A replacement shows the same subject.`),
        spec: { formats: [format], width: info.width, height: info.height },
        target,
        tags: ['chronicle'],
        notes: literal(`Added to Chronicle by ${user || 'someone'}.`),
      },
    })
    if (!cfg.sendImage) { entry.sent = true; save(); refreshStatus(); return }
    try {
      await deliver(cfg, entry, upload.mime)
      entry.sent = true
    } catch (err) {
      entry.error = err.message
      throw new Error(`The picture is in the contract but was not accepted: ${err.message}`)
    } finally { save(); refreshStatus() }
  }

  ctx.on('upload:stored', (u) => enter(u, u.user))

  ctx.on('upload:deleted', async (u) => {
    const entry = ledger[u.id]
    const cfg = ctx.config.get()
    if (!entry) return
    delete ledger[u.id]
    save()
    if (cfg.contractDir) await writeContract(cfg, entry.ws, { remove: [entry.spriteId] })
    refreshStatus()
  })

  ctx.route('POST', '/backfill', async () => {
    const cfg = ctx.config.get()
    if (!cfg.contractDir) return { message: 'Set the contract folder first.' }
    let added = 0, failed = 0
    for (const u of ctx.uploads.list()) {
      if (ledger[u.id] || !FORMAT[u.mime] || !fs.existsSync(u.file)) continue
      try { await enter(u, ''); added++ } catch { failed++ }
    }
    return { message: `${added} added${failed ? `, ${failed} not accepted by image administration` : ''}.` }
  })

  ctx.route('POST', '/retry', async () => {
    const cfg = ctx.config.get()
    let sent = 0, failed = 0
    const mimes = new Map(ctx.uploads.list().map((u) => [u.id, u.mime]))
    for (const [id, entry] of Object.entries(ledger)) {
      if (entry.sent) continue
      try {
        await deliver(cfg, entry, mimes.get(id) ?? 'image/png')
        entry.sent = true; entry.error = ''; sent++
      } catch (err) { entry.error = err.message; failed++ }
    }
    save(); refreshStatus()
    return { message: `${sent} sent${failed ? `, ${failed} still not accepted` : ''}.` }
  })

  refreshStatus()
}
