const { app, BrowserWindow, dialog, shell, net } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { isNewer, pickPortableAsset, assetSha256, trimNotes, downloadTo, replaceScript } = require('./update-logic')

const REPO = 'JanMoritzP/chronicle'
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`
const API = process.env.CHRONICLE_UPDATE_API || `https://api.github.com/repos/${REPO}/releases/latest`
const FIRST_CHECK_MS = 8_000
const EVERY_MS = 6 * 60 * 60 * 1000

// Two kinds of Windows build, two update paths:
//  - installed (NSIS): electron-updater downloads the installer from the GitHub release and runs it on restart
//  - portable: electron-updater cannot replace a single exe, so we fetch the portable exe from the release ourselves
//    and swap it in with a small batch file once the app has quit
const mode = () => (process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : app.isPackaged ? 'installed' : 'dev')

const clean = (v) => String(v || '').replace(/^v/i, '')
const parent = () => BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || undefined
const box = (opts) => dialog.showMessageBox(parent(), { type: 'info', noLink: true, title: 'Chronicle', ...opts })
const progress = (p) => BrowserWindow.getAllWindows().forEach((w) => w.setProgressBar(p))

function createUpdater({ readSettings, writeSettings }) {
  let busy = false

  async function latestRelease() {
    const res = await net.fetch(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Chronicle-updater' }, signal: AbortSignal.timeout(10_000) })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}.`)
    return res.json()
  }

  // Asks about a found version. Returns 'now', 'later' or 'skip'.
  async function offer(version, notes, canInstall) {
    const detail = trimNotes(notes)
    const buttons = canInstall ? ['Update now', 'Later', 'Skip this version'] : ['Open download page', 'Later']
    const { response } = await box({
      message: `Chronicle ${version} is available`,
      detail: `You have ${app.getVersion()}.${detail ? '\n\n' + detail : ''}`,
      buttons, defaultId: 0, cancelId: 1,
    })
    return response === 0 ? 'now' : response === 2 ? 'skip' : 'later'
  }

  async function checkInstalled(manual) {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.removeAllListeners('download-progress')
    autoUpdater.on('download-progress', (p) => progress(p.percent / 100))
    const result = await autoUpdater.checkForUpdates()
    const info = result?.updateInfo
    if (!result?.isUpdateAvailable || !info) {
      if (manual) await box({ message: 'Chronicle is up to date', detail: `Version ${app.getVersion()} is the newest.` })
      return
    }
    if (!manual && readSettings().skippedVersion === info.version) return
    const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes.replace(/<[^>]+>/g, ' ') : ''
    const choice = await offer(info.version, notes, true)
    if (choice === 'skip') return writeSettings({ skippedVersion: info.version })
    if (choice !== 'now') return
    try { await autoUpdater.downloadUpdate() } finally { progress(-1) }
    const { response } = await box({ message: 'Update ready', detail: `Chronicle ${info.version} is downloaded. Restart to install it. If you choose Later, it installs the next time you quit.`, buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1 })
    if (response === 0) autoUpdater.quitAndInstall(true, true)
  }

  async function checkPortable(manual) {
    const rel = await latestRelease()
    const version = clean(rel?.tag_name)
    if (!rel || !isNewer(version, app.getVersion())) {
      if (manual) await box({ message: 'Chronicle is up to date', detail: `Version ${app.getVersion()} is the newest.` })
      return
    }
    if (!manual && readSettings().skippedVersion === version) return
    const asset = pickPortableAsset(rel.assets)
    const target = process.env.PORTABLE_EXECUTABLE_FILE
    const choice = await offer(version, rel.body, !!asset)
    if (choice === 'skip') return writeSettings({ skippedVersion: version })
    if (choice !== 'now') return
    if (!asset) return shell.openExternal(rel.html_url || RELEASES_PAGE)

    // Download next to the exe so the final move is a rename and a read-only folder is noticed before 90 MB are fetched.
    const staged = path.join(path.dirname(target), `.chronicle-update-${version}.exe`)
    try {
      try { fs.writeFileSync(staged, '') } catch { throw new Error(`Cannot write to ${path.dirname(target)}. Move Chronicle to a folder you can write to, or download the new version by hand.`) }
      await downloadTo(asset.browser_download_url, staged, { size: asset.size, sha256: assetSha256(asset), onProgress: progress, fetchImpl: net.fetch })
    } catch (e) {
      fs.rmSync(staged, { force: true })
      progress(-1)
      const { response } = await box({ type: 'error', message: 'The update could not be downloaded', detail: e.message, buttons: ['Open download page', 'Close'], defaultId: 1, cancelId: 1 })
      if (response === 0) shell.openExternal(rel.html_url || RELEASES_PAGE)
      return
    }
    progress(-1)
    const { response } = await box({ message: 'Update ready', detail: `Chronicle ${version} is downloaded. Restart to switch to it.`, buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1 })
    const swap = (relaunch) => {
      const bat = path.join(os.tmpdir(), `chronicle-update-${process.pid}.bat`)
      fs.writeFileSync(bat, replaceScript(staged, target, relaunch))
      spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    }
    // The script only waits 90 s for the old exe to be free, so with "Later" it is started when the app quits.
    if (response === 0) { swap(true); app.quit() }
    else app.once('quit', () => swap(false))
  }

  async function check(manual = false) {
    if (busy) return
    const m = mode()
    if (m === 'dev' && !process.env.CHRONICLE_UPDATE_API) {
      if (manual) await box({ message: 'Updates only work in the built app', detail: 'This copy is running from source.' })
      return
    }
    busy = true
    try { await (m === 'portable' ? checkPortable(manual) : checkInstalled(manual)) }
    catch (e) {
      console.warn('update check failed:', e.message)
      if (manual) await box({ type: 'error', message: 'Could not check for updates', detail: String(e.message || e), buttons: ['Close', 'Open download page'], defaultId: 0, cancelId: 0 }).then((r) => { if (r.response === 1) shell.openExternal(RELEASES_PAGE) })
    } finally { busy = false; progress(-1) }
  }

  function start() {
    setTimeout(() => check(false), FIRST_CHECK_MS)
    setInterval(() => check(false), EVERY_MS).unref()
  }

  return { check, start, mode }
}

module.exports = { createUpdater }
