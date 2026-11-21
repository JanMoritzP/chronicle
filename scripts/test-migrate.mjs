// node scripts/test-migrate.mjs   (needs `npm run build` first)
// An install made by an earlier release must keep working after an update: the database is rolled back to what each
// release had, the server is started on it, and the tabletop is used.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { WebSocket } from 'ws'

let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const root = path.resolve(import.meta.dirname, '..')
const PORT = 3299

async function start(dir) {
  const proc = spawn(process.execPath, ['dist/index.js'], {
    cwd: path.join(root, 'server'), stdio: 'ignore',
    env: { ...process.env, DATA_DIR: dir, PORT: String(PORT), ADMIN_PASSWORD: 'testpass123', ADMIN_PORT: String(PORT + 1) },
  })
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) return proc } catch { /* not up yet */ }
    await sleep(250)
  }
  proc.kill()
  throw new Error('the server did not start')
}
const stop = async (proc) => { proc.kill(); await new Promise((r) => proc.once('exit', r)); await sleep(300) }

/** What each earlier release had: the later tables and columns are taken away again. */
const SCENARIOS = {
  'a 0.24 install (walls and fog, nothing after)': (d) => { d.exec('DROP TABLE IF EXISTS encounters; DROP TABLE IF EXISTS drawings; DROP TABLE IF EXISTS scene_tiles; ALTER TABLE table_state DROP COLUMN combat') },
  'a 0.25 install (with combat)': (d) => { d.exec('DROP TABLE IF EXISTS encounters; DROP TABLE IF EXISTS drawings; DROP TABLE IF EXISTS scene_tiles') },
  'a 0.28 install (with drawings and encounters)': (d) => { d.exec('DROP TABLE IF EXISTS scene_tiles') },
}

for (const [name, rollBack] of Object.entries(SCENARIOS)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-migrate-'))
  try {
    let proc = await start(dir)
    await stop(proc)
    const d = new Database(path.join(dir, 'dnd.db'))
    const version = Number(d.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value)
    // the steps after the one that adds the tabletop tiles (invite links, macros and handouts, roll tables and decks) are taken away too: an older install has not run them
    d.exec('DROP TABLE IF EXISTS invites; DROP TABLE IF EXISTS macros; DROP TABLE IF EXISTS handouts; DROP TABLE IF EXISTS roll_tables; DROP TABLE IF EXISTS decks; DROP TABLE IF EXISTS tracks; DROP TABLE IF EXISTS triggers; DROP TABLE IF EXISTS system_packs; DROP TABLE IF EXISTS map_docs')
    d.exec('DROP TABLE IF EXISTS scene_reveals; DROP TABLE IF EXISTS scene_pins; ALTER TABLE uploads DROP COLUMN tags; ALTER TABLE scene_walls DROP COLUMN locked')
    d.exec('ALTER TABLE scenes DROP COLUMN weather')
    for (const col of ['folder', 'notes', 'grid_color', 'grid_opacity', 'ambient']) d.exec(`ALTER TABLE scenes DROP COLUMN ${col}`)
    rollBack(d)
    d.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(version - 15))
    d.close()

    proc = await start(dir)
    const base = `http://localhost:${PORT}`
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'gm', password: 'testpass123' }) })
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const ws = (await (await fetch(`${base}/api/workspaces`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Upgrade test' }) })).json()).id
    const enc = await fetch(`${base}/api/workspaces/${ws}/encounters`, { headers: { cookie } })
    check(`${name}: encounters can be read`, enc.status === 200)

    const sock = new WebSocket(`ws://localhost:${PORT}/api/table/${ws}`, { headers: { cookie, origin: base } })
    const msgs = []
    sock.on('message', (m) => msgs.push(JSON.parse(m.toString())))
    await new Promise((r) => sock.on('open', r))
    await sleep(300)
    sock.send(JSON.stringify({ t: 'scene.create', name: 'After the update', op: 'a' }))
    await sleep(500)
    const snap = msgs.find((m) => m.t === 'snapshot')
    check(`${name}: the table opens with walls, drawings, tiles and combat`, snap && Array.isArray(snap.tiles) && Array.isArray(snap.drawings) && snap.combat)
    check(`${name}: a scene can be created`, msgs.some((m) => m.t === 'scene' && m.scene.name === 'After the update') && !msgs.some((m) => m.t === 'nack'))
    const sceneId = msgs.find((m) => m.t === 'scene')?.scene.id
    sock.send(JSON.stringify({ t: 'draw.add', sceneId, kind: 'line', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#fff', width: 3, op: 'b' }))
    sock.send(JSON.stringify({ t: 'combat.control', action: 'clear', op: 'c' }))
    await sleep(400)
    check(`${name}: drawing and combat work`, msgs.some((m) => m.t === 'draw') && msgs.some((m) => m.t === 'combat') && !msgs.some((m) => m.t === 'nack'))
    sock.close()
    await stop(proc)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
