# Chronicle

Self-hosted worldbuilding notes. See [docs/ROADMAP.md](docs/ROADMAP.md) for decisions and what is still to do.

## Develop

```
npm install
set ADMIN_PASSWORD=choose-something   # first start only; creates the owner account (user "gm")
npm run dev                           # server :3000, web :5173 (proxied)
```

PowerShell: `$env:ADMIN_PASSWORD='choose-something'; npm run dev`

Check the API: start the server, then `node scripts/smoke.mjs http://localhost:3000 gm <password>` (uses a throwaway workspace; run it against a test data dir, not your real one).

## Deploy (Docker / Umbrel / plain Node)

Full guide: [docs/DEPLOY.md](docs/DEPLOY.md) (Docker Compose, Umbrel community store in `umbrel/`, running without Docker, cloudflared, backups, building the Electron app).

```
docker compose up -d --build
```
Data lives in the named volume `chronicle-data` (`dnd.db`, `uploads/`, `backups/`). Point cloudflared at port 3000 and keep HTTPS on at Cloudflare. The server trusts the proxy headers, so session cookies are `Secure` in production. A desktop app is in `electron/` (see its README). Back up the whole `data` folder, or use Settings → Backups: daily snapshots with one-click restore (a safety snapshot is taken first, accounts are kept) and "Download everything (.zip)". Each world can also be exported as Markdown + `world.json` from Settings.

## Config (env)
`PORT`, `HOST`, `DATA_DIR`, `ADMIN_USER`, `ADMIN_PASSWORD` (first start), `SESSION_DAYS` (30), `BACKUP_KEEP` (14).

## Adding things
- **Theme:** add a `[data-theme="x"]` block in `web/src/styles.css` and an entry in `web/src/themes.ts`.
- **Stat template:** add an entry in `web/src/editor/templates.ts`.
- **Shortcut:** `web/src/lib/keys.ts` (rebindable in Settings).
- **Template:** create it in the sidebar's Templates view (or a page's menu, Save as template). Type `/template-name` in any page to insert it at the cursor.
