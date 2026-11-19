# Deploying Chronicle

Three ways to run it, from simplest to most involved. All of them serve the same thing: one Node process that serves the web app and the API on port 3000, plus the admin dashboard on its own port (3001).

## 1. Docker Compose (recommended, also on a Windows machine)

Needs Docker (Docker Desktop on Windows).

```
git clone <your repo> chronicle && cd chronicle
# edit docker-compose.yml: set ADMIN_PASSWORD (min 8 chars)
docker compose up -d --build
```

Open `http://localhost:3000` and log in as `gm` with that password. Then change the password under Settings and remove `ADMIN_PASSWORD` from the compose file (it is only read when no user exists yet).

The admin dashboard is on `http://localhost:3001`. Set `ADMIN_PANEL_PASSWORD` for the first start to create its account (user `admin`). The compose file publishes the port to your network (use `127.0.0.1:3001:3001` to allow only the machine itself); do not forward it to the internet. See "People and world access" below.

- Data lives in the named volume `chronicle-data` (`dnd.db`, `uploads/`, `maps/`, `backups/`). Use a named volume, not `./data`: SQLite is unreliable on bind mounts from the Windows file system.
- The container has a health check (`docker ps` shows `healthy`) and stops cleanly (`docker stop` checkpoints the database first).
- Update: `git pull && docker compose up -d --build`. The rebuild replaces the container, not the volume, so the database, uploads and backups stay. Migrations run on start. Back up first (see below).
- `docker compose down` (without `-v`) is safe: it stops the container but keeps the volume, and it is not needed for an update. Never use `docker compose down -v` or delete the volume without a backup: that deletes the world.
- If the app suddenly shows no data, the database is probably not gone: run `docker volume ls`. The volume name includes the folder you run compose from, so a differently named folder starts a fresh, empty volume while the old one keeps the data.

### Auto-deploy with a GitHub runner

Every release (a `feat:` or `fix:` commit pushed to `main`) can rebuild the server on the machine that hosts it. `.github/workflows/deploy-server.yml` runs on a self-hosted runner there and does `docker compose up -d --build --wait`. A failed health check fails the run.

One-time setup on the server (needs Docker and Git):

1. GitHub repo → Settings → Actions → Runners → New self-hosted runner. Follow the commands for your system and, when asked for labels, add `chronicle-server`.
2. Install it as a service (`./svc.sh install && ./svc.sh start` on Linux, `config.cmd` offers it on Windows) so it survives reboots. The runner's user must be allowed to run `docker`.
3. Check the volume name with `docker volume ls`. If it is not `chronicle_chronicle-data`, set a repo variable `COMPOSE_PROJECT_NAME` (Settings → Secrets and variables → Actions → Variables) to the part before `_chronicle-data`. Otherwise the deploy starts a fresh, empty volume.
4. Stop and remove the container you started by hand (`docker compose down`, without `-v`), or it keeps port 3000.

The runner deploys the `docker-compose.yml` from the repo, so the admin passwords and ports in it apply. Passwords are only read on the very first start.

The repo is public: never use this runner in a workflow triggered by `pull_request`, and keep "Require approval for all outside collaborators" on under Settings → Actions → General. Run it by hand from the Actions tab (Deploy server → Run workflow) to redeploy a tag.

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
| `DATA_DIR` | `/data` in Docker | database, uploads, maps, backups, the Open5e library (`library.db`, `library.log`) |
| `ADMIN_USER` | gm | first start only |
| `ADMIN_PASSWORD` | | first start only, min 8 chars |
| `ADMIN_PORT` | 3001 | port of the admin dashboard; `0` turns it off |
| `ADMIN_HOST` | 127.0.0.1 | address the dashboard listens on (the Docker image uses 0.0.0.0, the compose file publishes it to your network) |
| `ADMIN_PANEL_USER` | admin | first start only |
| `ADMIN_PANEL_PASSWORD` | | first start only, min 8 chars. Without it, and with no admin account yet, the dashboard stays off |
| `SESSION_DAYS` | 30 | |
| `BACKUP_KEEP` | 14 | daily snapshots kept |

## People and world access

Several people can use one Chronicle at the same time. Who may open which world is decided in the admin dashboard, which runs on its own port with its own account, separate from the accounts people use in the notebook.

- Keep the dashboard port off the internet: expose only port 3000 (for example through cloudflared) and reach port 3001 from your own machine or network.
- Owner accounts open every world and manage backups. Editors and viewers open only the worlds they were added to. A viewer account is read-only everywhere.
- Accounts made in the dashboard start with no world. Accounts made by the owner under Settings can open every world, as before.
- Changes apply at once: a person who loses a world is moved out of it while they are working.
- Editing is live: people on the same page see each other's cursors and changes as they type. This uses a WebSocket on the normal port, so a reverse proxy must pass WebSocket upgrades (cloudflared does) and must not buffer `/api/live` (server-sent events).
- If you forget the admin password, empty the `admins` table in `dnd.db`, set `ADMIN_PANEL_PASSWORD` and restart.

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
