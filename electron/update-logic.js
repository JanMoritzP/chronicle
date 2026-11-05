// Pure helpers for the updater. No Electron imports, so scripts/test-update-logic.mjs can run them with plain node.

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v ?? '').trim())
  return m ? { nums: [+m[1], +m[2], +m[3]], pre: m[4] || '' } : null
}

/** True when `remote` is a higher version than `local`. A release beats its own pre-releases. Unparseable input is never newer. */
function isNewer(remote, local) {
  const a = parseVersion(remote), b = parseVersion(local)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i] > b.nums[i]
  if (a.pre === b.pre) return false
  if (!a.pre) return true
  if (!b.pre) return false
  return a.pre > b.pre
}

/** The portable build is attached to every release as `Chronicle-<version>-portable.exe`. */
function pickPortableAsset(assets) {
  return (assets || []).find((a) => /portable\.exe$/i.test(a?.name || '') && a.browser_download_url) || null
}

/** GitHub reports `digest: "sha256:<hex>"` on release assets; returns the hex part or null. */
function assetSha256(asset) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(asset?.digest || '')
  return m ? m[1].toLowerCase() : null
}

/** Release notes are markdown from GitHub; the dialog only needs a short plain excerpt. */
function trimNotes(body, max = 700) {
  const s = String(body || '').replace(/\r/g, '').replace(/[`*_#>]/g, '').replace(/\n{3,}/g, '\n\n').trim()
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s
}

/** Streams `url` to `dest`, checking size, checksum (when known) and the Windows "MZ" header. Deletes a bad download. */
async function downloadTo(url, dest, { size = 0, sha256 = null, onProgress, fetchImpl = fetch } = {}) {
  const fs = require('node:fs')
  const crypto = require('node:crypto')
  const { Readable, Transform } = require('node:stream')
  const { pipeline } = require('node:stream/promises')
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Chronicle-updater' }, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`)
  const total = Number(res.headers.get('content-length')) || size || 0
  const hash = crypto.createHash('sha256')
  let got = 0
  let head = Buffer.alloc(0)
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      if (head.length < 2) head = Buffer.concat([head, chunk]).subarray(0, 2)
      hash.update(chunk)
      got += chunk.length
      if (onProgress) onProgress(total ? got / total : 0)
      cb(null, chunk)
    },
  })
  const bad = (msg) => { fs.rmSync(dest, { force: true }); throw new Error(msg) }
  try {
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(dest))
  } catch (e) { bad(`Download failed: ${e.message}`) }
  if (size && got !== size) bad('The download is incomplete.')
  if (sha256 && hash.digest('hex') !== sha256) bad('The download does not match its checksum.')
  if (head.toString('latin1') !== 'MZ') bad('The download is not a Windows program.')
}

// cmd treats % specially even inside quotes; doubling it is the escape in a batch file.
const q = (p) => '"' + String(p).replace(/%/g, '%%').replace(/"/g, '') + '"'

/**
 * Batch file that runs after the app has quit: it keeps trying to move the downloaded exe over the old one
 * (Windows refuses while the old exe is still running), optionally starts the new one, then deletes itself.
 */
function replaceScript(from, to, relaunch) {
  return [
    '@echo off',
    'set n=0',
    ':retry',
    'set /a n+=1',
    'if %n% gtr 90 goto done',
    'ping -n 2 127.0.0.1 >nul',
    `move /Y ${q(from)} ${q(to)} >nul 2>&1`,
    'if errorlevel 1 goto retry',
    ...(relaunch ? [`start "" ${q(to)}`] : []),
    ':done',
    '(goto) 2>nul & del "%~f0"',
    '',
  ].join('\r\n')
}

module.exports = { parseVersion, isNewer, pickPortableAsset, assetSha256, trimNotes, downloadTo, replaceScript }
