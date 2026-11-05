const { contextBridge, ipcRenderer } = require('electron')

// Only the local setup page gets a bridge; a page served by the server never does.
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('chronicleDesktop', {
    connect: (url) => ipcRenderer.invoke('connect', url),
  })
}
