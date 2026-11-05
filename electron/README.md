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
  | `Ctrl+Shift+U` | Check for updates |

## Updates

The app looks for a newer version on GitHub (`JanMoritzP/chronicle`, latest release) a few seconds after start and every six hours. Nothing is shown unless there is one. The address screen also shows the version and a "Check for updates" link.

- **Installed build** (`Chronicle-Setup-<version>.exe`): downloads the installer from the release and installs it when you restart, or the next time you quit.
- **Portable build** (`Chronicle-<version>-portable.exe`): downloads the new portable exe next to the old one, checks its size and SHA-256, and swaps it in after the app quits. The folder must be writable.
- "Skip this version" silences the automatic prompt for that version only. A manual check always shows it.

### Publishing a release

Automatic: commit with a `feat:` or `fix:` prefix and push to `main`. release-please (`.github/workflows/release-please.yml`) bumps the version, updates `CHANGELOG.md` and pushes the `vX.Y.Z` tag; `.github/workflows/release-desktop.yml` then builds on Windows and publishes the release. The commit subjects become the release notes, so write them for the user. The notes shown in the update dialog are that version's section of `CHANGELOG.md`. Details in AGENTS.md, section 4.

The first release (0.2.0) was tagged by hand; release-please needs one existing tag to measure from.

Without CI: `$env:GH_TOKEN='<token with repo scope>'; npm run release:win`. `npm run dist:win` only builds locally and publishes nothing. Tests: `node scripts/test-update-logic.mjs` and `node scripts/test-update-flow.mjs`.

## Security

The window is sandboxed with context isolation and no Node access. The only bridge to the system (`connect`) exists on the local address screen, and is refused if called from a page served by the server.

## Not done

- No offline mode. Without the server the app shows the address screen with the error.
- Builds are unsigned.
- Only Windows was built and run here. The Linux and Mac targets are configured but untested.
