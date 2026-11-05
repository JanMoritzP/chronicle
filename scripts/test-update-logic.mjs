// node scripts/test-update-logic.mjs
// Checks the updater's pure logic (version compare, asset pick, download verification, swap script). No Electron needed.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const { isNewer, parseVersion, pickPortableAsset, assetSha256, trimNotes, downloadTo, replaceScript } = createRequire(import.meta.url)('../electron/update-logic.js')

let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

check('0.2.0 is newer than 0.1.0', isNewer('0.2.0', '0.1.0'))
check('v-prefix accepted', isNewer('v0.2.0', '0.1.9'))
check('same version is not newer', !isNewer('0.2.0', '0.2.0'))
check('older is not newer', !isNewer('0.1.9', '0.2.0'))
check('10 beats 9 (numeric, not text)', isNewer('0.10.0', '0.9.0'))
check('patch bump', isNewer('1.0.1', '1.0.0'))
check('release beats its pre-release', isNewer('1.0.0', '1.0.0-beta.1'))
check('pre-release does not beat release', !isNewer('1.0.0-beta.1', '1.0.0'))
check('garbage is never newer', !isNewer('latest', '0.1.0') && !isNewer('0.2.0', 'dev') && !isNewer(undefined, '0.1.0'))
check('parseVersion', JSON.stringify(parseVersion('v1.2.3-rc.1')) === JSON.stringify({ nums: [1, 2, 3], pre: 'rc.1' }))

const assets = [
  { name: 'Chronicle-Setup-0.2.0.exe', browser_download_url: 'https://x/setup' },
  { name: 'latest.yml', browser_download_url: 'https://x/latest.yml' },
  { name: 'Chronicle-0.2.0-portable.exe', browser_download_url: 'https://x/portable', size: 5 },
]
check('picks the portable exe', pickPortableAsset(assets)?.browser_download_url === 'https://x/portable')
check('no portable asset -> null', pickPortableAsset([assets[0]]) === null && pickPortableAsset(undefined) === null)
check('digest parsed', assetSha256({ digest: 'sha256:' + 'AB'.repeat(32) }) === 'ab'.repeat(32) && assetSha256({}) === null && assetSha256({ digest: 'md5:00' }) === null)
check('notes trimmed', trimNotes('## Hi\n\n\n\n**bold** `code`') === 'Hi\n\nbold code' && trimNotes('x'.repeat(2000), 10).length === 11)

const s = replaceScript('C:\\a b\\new.exe', 'C:\\a b\\100%.exe', true)
check('script quotes paths and escapes %', s.includes('move /Y "C:\\a b\\new.exe" "C:\\a b\\100%%.exe"'))
check('script relaunches when asked, not otherwise', s.includes('start "" "C:\\a b\\100%%.exe"') && !replaceScript('a', 'b', false).includes('start ""'))
check('script deletes itself and uses CRLF', s.includes('del "%~f0"') && s.includes('\r\n'))

// download verification against a local server
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'))
const good = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(4000)])
const notExe = Buffer.from('<html>nope</html>')
const http = await import('node:http')
const srv = http.createServer((req, res) => {
  if (req.url === '/good') return res.end(good)
  if (req.url === '/html') return res.end(notExe)
  res.statusCode = 404; res.end()
}).listen(0)
const base = `http://127.0.0.1:${srv.address().port}`
const sha = crypto.createHash('sha256').update(good).digest('hex')
const fails = async (fn) => { try { await fn(); return null } catch (e) { return e.message } }

let seen = 0
await downloadTo(`${base}/good`, path.join(tmp, 'ok.exe'), { size: good.length, sha256: sha, onProgress: (p) => { seen = p } })
check('good download is written and complete', fs.readFileSync(path.join(tmp, 'ok.exe')).equals(good) && seen === 1)
const e1 = await fails(() => downloadTo(`${base}/good`, path.join(tmp, 'a.exe'), { sha256: '0'.repeat(64) }))
check('wrong checksum rejected and file removed', /checksum/.test(e1 || '') && !fs.existsSync(path.join(tmp, 'a.exe')))
const e2 = await fails(() => downloadTo(`${base}/good`, path.join(tmp, 'b.exe'), { size: good.length + 1 }))
check('wrong size rejected and file removed', /incomplete/.test(e2 || '') && !fs.existsSync(path.join(tmp, 'b.exe')))
const e3 = await fails(() => downloadTo(`${base}/html`, path.join(tmp, 'c.exe'), {}))
check('non-exe rejected and file removed', /not a Windows program/.test(e3 || '') && !fs.existsSync(path.join(tmp, 'c.exe')))
const e4 = await fails(() => downloadTo(`${base}/missing`, path.join(tmp, 'd.exe'), {}))
check('HTTP error reported', /HTTP 404/.test(e4 || ''))

srv.close()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
