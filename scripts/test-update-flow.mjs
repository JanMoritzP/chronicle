// node scripts/test-update-flow.mjs
// Runs electron/update.js in real Electron against a fake GitHub API, in "portable" mode, and checks the exe really gets replaced.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const electronBin = createRequire(path.resolve('electron/package.json'))('electron')
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); if (!ok) failed++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const fresh = Buffer.concat([Buffer.from('MZ'), Buffer.from('NEW-VERSION-'), crypto.randomBytes(3000)])
const freshSha = crypto.createHash('sha256').update(fresh).digest('hex')
let release
let port
const srv = http.createServer((req, res) => {
  if (req.url === '/api') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(release)) }
  if (req.url === '/exe') { res.setHeader('content-length', fresh.length); return res.end(fresh) }
  res.statusCode = 404; res.end()
}).listen(0)
port = srv.address().port
const base = `http://127.0.0.1:${port}`
const mkRelease = (tag, extra = {}) => ({
  tag_name: tag, body: '## Notes\n\n- something new', html_url: base + '/page',
  assets: [{ name: `Chronicle-${tag.replace(/^v/, '')}-portable.exe`, browser_download_url: base + '/exe', size: fresh.length, digest: 'sha256:' + freshSha, ...extra }],
})

function run(answers, { manual = true, target, api = base + '/api' } = {}) {
  return new Promise((resolve) => {
    const out = []
    const env = { ...process.env, PORTABLE_EXECUTABLE_FILE: target, CHRONICLE_UPDATE_API: api, HARNESS_ANSWERS: answers, HARNESS_MANUAL: manual ? '1' : '0' }
    delete env.ELECTRON_RUN_AS_NODE
    const p = spawn(electronBin, [path.resolve('scripts/update-harness.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    p.stdout.on('data', (d) => out.push(String(d)))
    p.stderr.on('data', (d) => out.push(String(d)))
    const t = setTimeout(() => p.kill(), 60_000)
    p.on('exit', () => { clearTimeout(t); resolve(out.join('')) })
  })
}
const waitFor = async (fn, ms = 20_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(300) } return false }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-flow-'))
const target = path.join(dir, 'Chronicle-portable.exe')
const old = Buffer.concat([Buffer.from('MZ'), Buffer.from('OLD-VERSION-')])
const reset = () => { fs.writeFileSync(target, old); for (const f of fs.readdirSync(dir)) if (f.startsWith('.chronicle-update')) fs.rmSync(path.join(dir, f)) }
const isOld = () => fs.readFileSync(target).equals(old)

// 1. newer release, user says "Update now" then "Later": file swaps once the app has quit
release = mkRelease('v999.0.0'); reset()
let out = await run('0,1', { target })
check('portable mode detected', /MODE portable/.test(out), out)
check('offer shown with the new version', /Chronicle 999\.0\.0 is available -> Update now/.test(out), out)
check('"update ready" dialog shown', /Update ready -> Later/.test(out), out)
check('exe replaced after quit', await waitFor(() => fresh.equals(fs.readFileSync(target))), 'target still old')
check('staging file cleaned up', await waitFor(() => !fs.readdirSync(dir).some((f) => f.startsWith('.chronicle-update'))))

// 2. up to date: manual check says so, nothing changes
release = mkRelease('v0.0.1'); reset()
out = await run('0', { target })
check('up-to-date message on manual check', /Chronicle is up to date/.test(out), out)
check('exe untouched when up to date', isOld())

// 3. up to date + automatic check: silent
out = await run('', { target, manual: false })
check('automatic check is silent when up to date', !/DIALOG/.test(out), out)

// 4. skip this version, then automatic check stays quiet but manual check still offers it
release = mkRelease('v999.0.0'); reset()
out = await run('2', { target })
check('skip stores the version', /"skippedVersion":"999\.0\.0"/.test(out), out)
check('exe untouched after skip', isOld())

// 5. wrong checksum: error dialog, exe untouched, no leftovers
release = mkRelease('v999.0.0', { digest: 'sha256:' + '0'.repeat(64) }); reset()
out = await run('0,1', { target })
check('bad checksum reported', /could not be downloaded/.test(out), out)
await sleep(1500)
check('exe untouched after bad download', isOld())
check('no staging file left after bad download', !fs.readdirSync(dir).some((f) => f.startsWith('.chronicle-update')))

// 6. no portable asset: falls back to the download page (button 0 = open page, would launch a browser, so answer Later)
release = { ...mkRelease('v999.0.0'), assets: [] }; reset()
out = await run('1', { target })
check('no asset offers the download page instead of an install', /Open download page/.test(out), out)

// 7. API down: manual check reports it
reset()
out = await run('1', { target, api: 'http://127.0.0.1:1/nope' })
check('network failure is reported on manual check', /Could not check for updates/.test(out), out)

srv.close()
fs.rmSync(dir, { recursive: true, force: true })
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
