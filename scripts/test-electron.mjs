// node scripts/test-electron.mjs http://localhost:3222
// Starts the desktop app against a running server and drives it over the DevTools protocol.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const server = process.argv[2] || 'http://localhost:3000'
const electronBin = createRequire(path.resolve('electron/package.json'))('electron')
const PORT = 9333
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  for (let i = 0; i < 40; i++) {
    try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const pages = t.filter((x) => x.type === 'page'); if (pages.length) return pages } catch {}
    await sleep(250)
  }
  return []
}
async function evalIn(wsUrl, expr) {
  const ws = new WebSocket(wsUrl)
  await new Promise((r) => (ws.onopen = r))
  const res = await new Promise((resolve) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d.result) }
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
  })
  ws.close()
  return res?.result?.value
}
function launch(env, userData) {
  return spawn(electronBin, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, path.resolve('electron')], { env: { ...process.env, ...env }, stdio: 'ignore' })
}
// Closes the app the way a user would (all windows closed), so shutdown hooks run; falls back to a hard kill.
const kill = async (p) => {
  try {
    const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
    const ws = new WebSocket(v.webSocketDebuggerUrl)
    await new Promise((r) => (ws.onopen = r))
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
  } catch {}
  for (let i = 0; i < 20 && p.exitCode === null; i++) await sleep(250)
  if (p.exitCode === null) p.kill()
  await sleep(500)
}

// 1) with a configured server the app loads Chronicle
// usage: node scripts/test-electron.mjs <server> [user] [password]   (user/password enable the login-persistence checks)
let ud = fs.mkdtempSync(path.join(os.tmpdir(), 'chron-e-'))
const withLogin = !!process.argv[4]
let app = launch({ CHRONICLE_URL: server }, ud)
let pages = await targets()
await sleep(2500)
pages = await targets()
check('window opens on the server', pages.length === 1 && pages[0].url.startsWith(server), pages[0]?.url)
check('app shell is rendered', (await evalIn(pages[0].webSocketDebuggerUrl, `!!document.getElementById('root')?.children.length`)) === true)
check('login screen shown', !!(await evalIn(pages[0].webSocketDebuggerUrl, `!!document.querySelector('.login form')`)))
const wsUrl = pages[0].webSocketDebuggerUrl
const loginStatus = await evalIn(wsUrl, `(async () => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: ${JSON.stringify(process.argv[3] || 'gm')}, password: ${JSON.stringify(process.argv[4] || '')} }) }); return r.status })()`)
if (withLogin) check('login inside the app works', loginStatus === 200, String(loginStatus))
const secondLaunch = launch({ CHRONICLE_URL: server }, ud)
await sleep(2500)
const two = await targets()
check('a second launch opens a second window in the same app', two.length === 2 && two.every((t) => t.url.startsWith(server)), String(two.length))
secondLaunch.kill()
check('desktop bridge is not exposed to the server page', (await evalIn(pages[0].webSocketDebuggerUrl, 'typeof window.chronicleDesktop')) === 'undefined')
await kill(app)
if (withLogin) {
  app = launch({ CHRONICLE_URL: server }, ud)
  await sleep(3500)
  pages = await targets()
  const me = await evalIn(pages[0].webSocketDebuggerUrl, `fetch('/api/auth/me').then(r => r.status)`)
  check('login survives closing and reopening the app', me === 200, String(me))
  await kill(app)
}

// 2) without a server the setup page shows, and validates
ud = fs.mkdtempSync(path.join(os.tmpdir(), 'chron-e-'))
app = launch({ CHRONICLE_URL: '' }, ud)
await sleep(1500)
pages = await targets()
check('setup page when no server is configured', pages.length === 1 && pages[0].url.includes('setup.html'), pages[0]?.url)
const ws = pages[0].webSocketDebuggerUrl
const tryConnect = (u) => evalIn(ws, `(async () => { const i = document.getElementById('url'); i.value = ${JSON.stringify(u)}; document.getElementById('f').requestSubmit(); await new Promise(r => setTimeout(r, 2500)); return document.getElementById('err').textContent })()`)
const e1 = await tryConnect('localhost:1')
check('unreachable address gives a clear error', /Cannot reach/.test(e1), e1)
const e2 = await tryConnect('https://example.com')
check('a website that is not Chronicle is refused', /not look like a Chronicle|Cannot reach/.test(e2), e2)
const e3 = await tryConnect('')
check('empty address is refused', /Enter the address/.test(e3), e3)
await tryConnect(server.replace(/^https?:\/\//, ''))
await sleep(1500)
pages = await targets()
check('valid address connects and loads the server', pages.length === 1 && pages[0].url.startsWith(server), pages[0]?.url)
const saved = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'))
check('address is remembered', saved.serverUrl === server, saved.serverUrl)
await kill(app)

// 3) the next start goes straight to the remembered server
app = launch({ CHRONICLE_URL: '' }, ud)
await sleep(2000)
pages = await targets()
check('remembered server is used on the next start', pages.length === 1 && pages[0].url.startsWith(server), pages[0]?.url)
await kill(app)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
