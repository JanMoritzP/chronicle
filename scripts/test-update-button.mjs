// node scripts/test-update-button.mjs
// Real Electron against a fake Chronicle page and a fake GitHub API: the "Check for updates" address that the Settings button opens
// starts a check, nothing else does, and the page gets no bridge. Unset ELECTRON_RUN_AS_NODE first.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const electronBin = createRequire(path.resolve('electron/package.json'))('electron')
const PORT = 9334
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); if (!ok) failed++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let apiHits = 0
const fake = http.createServer((req, res) => {
  if (req.url === '/api/release') { apiHits++; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ tag_name: 'v0.0.1', body: '', html_url: '', assets: [] })) }
  if (req.url === '/api/auth/me') { res.statusCode = 401; res.setHeader('content-type', 'application/json'); return res.end('{"error":"unauthorized"}') }
  res.setHeader('content-type', 'text/html')
  res.end('<!doctype html><title>fake</title><body>fake chronicle</body>')
}).listen(0)
const base = `http://127.0.0.1:${fake.address().port}`

async function targets() {
  for (let i = 0; i < 40; i++) {
    try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const pages = t.filter((x) => x.type === 'page'); if (pages.length) return pages } catch { /* not up yet */ }
    await sleep(250)
  }
  return []
}
async function evalIn(wsUrl, expr) {
  const ws = new WebSocket(wsUrl)
  await new Promise((r) => (ws.onopen = r))
  const res = await new Promise((resolve) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d.result) }
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true } }))
  })
  ws.close()
  return res?.result?.value
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-btn-'))
const env = { ...process.env, CHRONICLE_URL: base, CHRONICLE_UPDATE_API: base + '/api/release', PORTABLE_EXECUTABLE_FILE: path.join(dir, 'Chronicle-portable.exe') }
delete env.ELECTRON_RUN_AS_NODE
const app = spawn(electronBin, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(dir, 'data')}`, path.resolve('electron')], { env, stdio: 'ignore' })

let pages = await targets()
await sleep(1500)
pages = await targets()
const ws = pages[0]?.webSocketDebuggerUrl
check('app loads the page', pages.length === 1 && pages[0].url.startsWith(base), pages[0]?.url)
check('user agent tells the page it is the desktop app', /ChronicleDesktop\/1/.test(await evalIn(ws, 'navigator.userAgent')))
check('page has no bridge', (await evalIn(ws, 'typeof window.chronicleDesktop')) === 'undefined')

// the first automatic check is 8 s after start, so anything before that was caused by the click
check('no check has happened yet', apiHits === 0, String(apiHits))
await evalIn(ws, `window.open('chronicle-desktop://other'); window.open('chronicle-desktop://check-updates/x')`)
await sleep(1500)
check('other addresses start no check', apiHits === 0, String(apiHits))
await evalIn(ws, `window.open('chronicle-desktop://check-updates')`)
let waited = 0
while (!apiHits && waited < 4000) { await sleep(250); waited += 250 }
check('the button address starts a check', apiHits === 1, String(apiHits))
await sleep(500)
const after = await targets()
check('no window opened and the page stayed', after.length === 1 && after[0].url.startsWith(base), String(after.length))

app.kill()
fake.close()
await sleep(500)
fs.rmSync(dir, { recursive: true, force: true })
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
