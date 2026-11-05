# Chronicle desktop

A desktop window for a Chronicle server. It holds no data: pages, accounts and backups stay on the server, so the desktop app and the browser always show the same thing.

## Run it

```
cd electron
npm install
node node_modules/electron/install.js   # only if npm blocked Electron's install script
npm start
```

On the first start it asks for the server address (`dnd.pocherhome.de`, `localhost:3000`, ...). Addresses without `http(s)://` get `https://`, except local ones (localhost, `192.168.x.x`, `*.local`), which get `http://`. The server is checked before the address is saved. To run against a server without the prompt, set `CHRONICLE_URL`.

## Build an installer

```
npm run dist:win     # NSIS installer and a portable .exe, in electron/dist
npm run dist:linux   # AppImage
npm run dist:mac     # needs a Mac
```

`npm run icon` (done by the `dist` scripts) renders `web/public/icon.svg` to `build/icon.png`. Builds are unsigned, so Windows SmartScreen warns on first run.

## Behaviour

- **Login:** the session cookie is kept on disk, so you stay logged in across restarts.
- **Windows:** `Ctrl+Shift+N` opens another window, and starting the app a second time does the same. All windows share one login, so one person can have a page open in two windows.
- **Links:** anything that is not your server opens in the normal browser, never inside the app.
- **Window size:** position and size are remembered.
- **Server address:** `Ctrl+Shift+S` goes back to the address screen. If the server cannot be reached, the address screen is shown with the error.
- **Shortcuts:** the web app's own shortcuts (`Ctrl+K`, `Alt+…`, all rebindable in Settings) work unchanged, and there is no menu bar that could steal them. The app only adds shortcuts the web app does not use:

  | Key | Action |
  | --- | --- |
  | `Ctrl+Shift+N` | New window |
  | `F5` / `Ctrl+R` | Reload |
  | `Ctrl+Shift+R` | Reload without cache |
  | `Ctrl +` / `Ctrl -` / `Ctrl 0` | Zoom |
  | `F11` | Full screen |
  | `F12` | Developer tools |
  | `Ctrl+Shift+S` | Change server |

## Security

The window is sandboxed with context isolation and no Node access. The only bridge to the system (`connect`) exists on the local address screen, and is refused if called from a page served by the server.

## Not done

- No offline mode. Without the server the app shows the address screen with the error.
- No auto-update; install a new build over the old one.
- Builds are unsigned.
- Only Windows was built and run here. The Linux and Mac targets are configured but untested.
