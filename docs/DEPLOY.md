# Deploying Chronicle

Three ways to run it, from simplest to most involved. All of them serve the same thing: one Node process that serves the web app and the API on port 3000.

## 1. Docker Compose (recommended, also on a Windows machine)

Needs Docker (Docker Desktop on Windows).

```
git clone <your repo> chronicle && cd chronicle
# edit docker-compose.yml: set ADMIN_PASSWORD (min 8 chars)
docker compose up -d --build
```

Open `http://localhost:3000` and log in as `gm` with that password. Then change the password under Settings and remove `ADMIN_PASSWORD` from the compose file (it is only read when no user exists yet).

- Data lives in the named volume `chronicle-data` (`dnd.db`, `uploads/`, `maps/`, `backups/`). Use a named volume, not `./data`: SQLite is unreliable on bind mounts from the Windows file system.
- The container has a health check (`docker ps` shows `healthy`) and stops cleanly (`docker stop` checkpoints the database first).
- Update: `git pull && docker compose up -d --build`. The rebuild replaces the container, not the volume, so the database, uploads and backups stay. Migrations run on start. Back up first (see below).
- `docker compose down` (without `-v`) is safe: it stops the container but keeps the volume, and it is not needed for an update. Never use `docker compose down -v` or delete the volume without a backup: that deletes the world.
- If the app suddenly shows no data, the database is probably not gone: run `docker volume ls`. The volume name includes the folder you run compose from, so a differently named folder starts a fresh, empty volume while the old one keeps the data.

## 2. Umbrel (community app store)

This repo contains a ready store in `umbrel/`. Umbrel pulls a prebuilt image, so the image has to exist first.

1. Push this repo to GitHub.
2. Publish the image: push a tag (`git tag v1.0.0 && git push --tags`). `.github/workflows/image.yml` builds `ghcr.io/<you>/chronicle:1.0.0` for amd64. Make the package public (GitHub → Packages → Package settings).
3. In `umbrel/chronicle-chronicle/docker-compose.yml` set `image:` to that name. Umbrel wants images pinned by digest: after the first publish, append `@sha256:<digest>` (shown on the package page). In `umbrel-app.yml` fill in `repo`, `support`, `submitter`, `submission`.
4. Put the contents of `umbrel/` in the root of a GitHub repo of its own (or keep this repo and use a branch): the store file `umbrel-app-store.yml` must be in the root, next to the `chronicle-chronicle/` folder.
5. In Umbrel: App Store → ⋯ → Community App Stores → add the repo URL → install Chronicle.

Umbrel generates the first password for `gm` (shown in the app's page in Umbrel). The app's own login stays on (`PROXY_AUTH_ADD: "false"`), which also keeps public share links (`/s/...`) reachable.

**Not tested here:** the Umbrel install itself. The image runs as `1000:1000`, is healthy and passes all smoke tests in that setup, but I could not run Umbrel. Expect to adjust the manifest if Umbrel's validation complains.

## 3. Without Docker

Needs Node 22 and build tools for `better-sqlite3` (on Windows: Visual Studio Build Tools, or it downloads a prebuilt binary).

```
npm ci
npm run build
set ADMIN_PASSWORD=choose-something        (PowerShell: $env:ADMIN_PASSWORD='...')
set DATA_DIR=C:\chronicle-data
npm start
```

`WEB_DIST` defaults to `web/dist`.

## Public access with cloudflared

Point the tunnel at `http://localhost:3000` (or the container name, if cloudflared runs in the same compose network):

```
cloudflared tunnel route dns <tunnel> dnd.pocherhome.de
# config.yml
ingress:
  - hostname: dnd.pocherhome.de
    service: http://localhost:3000
  - service: http_status:404
```

Keep HTTPS on in Cloudflare. The server trusts the proxy headers, so the session cookie is `Secure` whenever the request came in over https. Plain `http://localhost:3000` still works for local use.

## Settings (environment)

| Variable | Default | |
|---|---|---|
| `PORT` | 3000 | |
| `HOST` | 0.0.0.0 | |
| `DATA_DIR` | `/data` in Docker | database, uploads, maps, backups |
| `ADMIN_USER` | gm | first start only |
| `ADMIN_PASSWORD` | | first start only, min 8 chars |
| `SESSION_DAYS` | 30 | |
| `BACKUP_KEEP` | 14 | daily snapshots kept |

## Backups

- The server snapshots the database daily (`backups/`). Settings → Backups lists them, restores one (a safety snapshot is taken first, accounts are kept) and can "Download everything (.zip)": database, images and map sources. Do that regularly and keep the file off the machine.
- Snapshots hold the database only. Images and map sources are not in them.
- Moving to a new machine: unzip the full download into the new data directory before the first start, or copy the volume.
- Raw copy of a Docker volume: `docker run --rm -v chronicle-data:/data -v ${PWD}:/out busybox tar czf /out/chronicle-data.tgz -C /data .`

## Desktop app (Electron)

A window onto the server. It holds no data.

```
cd electron
npm install
node node_modules/electron/install.js    # only if npm skipped Electron's install script
npm start                                # run it
npm run dist:win                         # installer + portable exe in electron/dist
npm run dist:linux                       # AppImage
npm run dist:mac                         # on a Mac
```

On first start it asks for the server address (`dnd.pocherhome.de`). Builds are unsigned, so Windows SmartScreen warns once ("More info" → "Run anyway").

From 0.2.0 the app updates itself from the latest GitHub release. Releases are published automatically: a `feat:` or `fix:` commit on `main` is versioned, changelogged and tagged, and the tag triggers the build (see AGENTS.md, section 4, and `electron/README.md`).

## Before going public

- Use a long password for `gm`. Login is rate limited (8 per minute), but that is the only barrier.
- Public share links are unguessable tokens; stopping a share deletes the token.
- Create editor/viewer accounts for players under Settings rather than sharing the owner login.
