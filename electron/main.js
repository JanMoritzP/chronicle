const { app, BrowserWindow, Menu, ipcMain, net, shell, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

// The desktop app is only a window onto a Chronicle server. All data, accounts and logic stay on the server.
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) } catch { return {} } }
const writeSettings = (patch) => {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }, null, 2))
}

const serverUrl = () => (process.env.CHRONICLE_URL || readSettings().serverUrl || '').replace(/\/+$/, '')

function normalise(input) {
  let s = String(input || '').trim()
  if (!s) throw new Error('Enter the address of your Chronicle server.')
  if (!/^https?:\/\//i.test(s)) {
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|.*\.local)(:|\/|$)/i.test(s)
    s = (local ? 'http://' : 'https://') + s
  }
  const u = new URL(s)
  return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, ''))
}

async function checkServer(url) {
  let res
  try { res = await net.fetch(url + '/api/auth/me', { signal: AbortSignal.timeout(8000) }) } catch (e) { throw new Error(`Cannot reach ${url}. Is the server running and the address right?`) }
  const type = res.headers.get('content-type') || ''
  if ((res.status !== 200 && res.status !== 401) || !type.includes('json')) throw new Error(`${url} answers, but it does not look like a Chronicle server.`)
}

const windows = new Set()

function bounds() {
  const saved = readSettings().bounds
  const ok = saved && screen.getAllDisplays().some((d) => {
    const b = d.workArea
    return saved.x < b.x + b.width - 80 && saved.x + saved.width > b.x + 80 && saved.y < b.y + b.height - 80 && saved.y + 60 > b.y
  })
  return ok ? saved : { width: 1360, height: 880 }
}

function setupPage(win, error) {
  win.loadFile(path.join(__dirname, 'setup.html'), { query: { url: serverUrl(), error: error || '' } })
}

function openWindow(offset = 0) {
  const b = bounds()
  const win = new BrowserWindow({
    ...b, x: b.x === undefined ? undefined : b.x + offset, y: b.y === undefined ? undefined : b.y + offset,
    minWidth: 380, minHeight: 480, backgroundColor: '#e9dfd0', title: 'Chronicle', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  })
  windows.add(win)
  if (readSettings().maximized) win.maximize()
  win.on('close', () => {
    if (windows.size === 1 || BrowserWindow.getFocusedWindow() === win) {
      if (!win.isMaximized() && !win.isMinimized()) writeSettings({ bounds: win.getBounds() })
      writeSettings({ maximized: win.isMaximized() })
    }
  })
  win.on('closed', () => windows.delete(win))

  const url = serverUrl()
  if (!url) setupPage(win)
  else win.loadURL(url)

  const origin = () => { try { return new URL(serverUrl()).origin } catch { return '' } }
  // Anything that is not the Chronicle server opens in the real browser, never inside this window.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith(origin() + '/')) { openWindow(30); return { action: 'deny' } }
    if (/^https?:/i.test(target)) shell.openExternal(target)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, target) => {
    if (target.startsWith('file:') || target.startsWith(origin())) return
    e.preventDefault()
    if (/^https?:/i.test(target)) shell.openExternal(target)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, failed, isMain) => {
    if (!isMain || code === -3 || failed.startsWith('file:')) return
    setupPage(win, `Could not load ${serverUrl()} (${desc}).`)
  })

  // The app binds Alt+key and Ctrl+K itself, so there is no menu bar. These few desktop shortcuts are handled here and only use combinations the app does not.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const ctrl = input.control || input.meta
    const k = input.key.toLowerCase()
    const wc = win.webContents
    if (ctrl && input.shift && k === 'n') { event.preventDefault(); openWindow(30) }
    else if (input.key === 'F5' || (ctrl && !input.alt && !input.shift && k === 'r')) { event.preventDefault(); wc.reload() }
    else if (ctrl && input.shift && k === 'r') { event.preventDefault(); wc.reloadIgnoringCache() }
    else if (input.key === 'F12' || (ctrl && input.shift && k === 'i')) { event.preventDefault(); wc.toggleDevTools() }
    else if (input.key === 'F11') { event.preventDefault(); win.setFullScreen(!win.isFullScreen()) }
    else if (ctrl && !input.alt && (k === '=' || k === '+')) { event.preventDefault(); wc.setZoomLevel(wc.getZoomLevel() + 0.5) }
    else if (ctrl && !input.alt && k === '-') { event.preventDefault(); wc.setZoomLevel(wc.getZoomLevel() - 0.5) }
    else if (ctrl && !input.alt && k === '0') { event.preventDefault(); wc.setZoomLevel(0) }
    else if (ctrl && input.shift && k === 's') { event.preventDefault(); setupPage(win) }
  })
  return win
}

ipcMain.handle('connect', async (_e, raw) => {
  if (!String(_e.senderFrame?.url || '').startsWith('file:')) throw new Error('Not allowed')
  const url = normalise(raw)
  await checkServer(url)
  writeSettings({ serverUrl: url })
  const win = BrowserWindow.fromWebContents(_e.sender)
  if (win) win.loadURL(url)
  return url
})

const lock = app.requestSingleInstanceLock()
if (!lock) app.quit()
else {
  // A second launch opens a second window in the running app, which is how multi-window works.
  app.on('second-instance', () => openWindow(30))
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    openWindow()
    app.on('activate', () => { if (!windows.size) openWindow() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  // Electron writes cookies to disk lazily; flush so the login survives quitting right after signing in.
  let flushed = false
  app.on('before-quit', (e) => {
    if (flushed) return
    e.preventDefault()
    flushed = true
    const done = () => app.quit()
    require('electron').session.defaultSession.cookies.flushStore().then(done, done)
  })
}
