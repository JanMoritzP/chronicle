// Run by scripts/test-update-flow.mjs inside real Electron: drives electron/update.js with the dialogs answered by a script.
const { app, dialog } = require('electron')
const answers = (process.env.HARNESS_ANSWERS || '0').split(',').map(Number)
dialog.showMessageBox = async (_w, o) => {
  const response = answers.length ? answers.shift() : 0
  console.log(`DIALOG ${o.message} -> ${o.buttons?.[response] ?? response} [${(o.buttons || []).join(' | ')}]`)
  return { response }
}
app.whenReady().then(async () => {
  const { createUpdater } = require('../electron/update')
  const store = {}
  const u = createUpdater({ readSettings: () => store, writeSettings: (p) => Object.assign(store, p) })
  console.log('MODE ' + u.mode())
  await u.check(process.env.HARNESS_MANUAL !== '0')
  console.log('SETTINGS ' + JSON.stringify(store))
  app.quit()
})
