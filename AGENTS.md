# AGENTS.md: Chronicle

Guide for any AI agent (or human) taking over this repo. Read it fully before changing anything. It says what the project is, how to work in it, and what the owner expects. Facts here were checked against the code; if the code disagrees, the code wins, then fix this file.

## 1. What this is

**Chronicle** is a self-hosted, World Anvil-style worldbuilding notebook for tabletop RPG campaigns (D&D). One owner (the GM, user `gm`) plus optional editor/viewer accounts for players.

| Part | Where | Stack |
|---|---|---|
| Server | `server/` | Node 22, Fastify 5, better-sqlite3 (SQLite WAL), zod 4, sharp. Bundled with esbuild to `server/dist/index.js` (ESM, `packages: 'external'`). |
| Web app | `web/` | React 19, Vite 7, TypeScript 5.9, zustand 5, TipTap 3 (ProseMirror), Leaflet. No UI framework; plain CSS in `web/src/styles.css`. |
| Desktop app | `electron/` | Electron 39 + electron-builder. A thin window onto a server. **Not** an npm workspace (so the Docker build never downloads Electron). Own `package.json` and lockfile. |
| Deploy | `Dockerfile`, `docker-compose.yml`, `umbrel/`, `docs/DEPLOY.md` | Docker image, Umbrel community store, plain Node. |
| CI / releases | `.github/workflows/`, `release-please-config.json` | release-please sets versions, writes the changelog and tags from commit messages; a tag builds and publishes the Windows app. |
| Scripts | `scripts/` | Smoke and unit tests (plain Node, no test framework), seeders. |
| Docs | `docs/ROADMAP.md`, `docs/DEPLOY.md`, `CHANGELOG.md` | ROADMAP is the design record: decisions plus what each feature does. |

Root npm workspaces: `server`, `web`. The owner's machine is **Windows + PowerShell**.

## 2. Commands

```
npm install                  # root; also needed once before building the Electron app (make-icon.mjs resolves sharp from server/)
npm run dev                  # server :3000 + web :5173 (proxied). First start needs ADMIN_PASSWORD
npm run typecheck            # server + web. Must be clean before you finish
npm run build                # web then server. server/dist and web/dist are gitignored
npm start                    # run the built server
```

PowerShell env: `$env:ADMIN_PASSWORD='x'; $env:DATA_DIR="$env:TEMP\test-data"; $env:PORT='3222'`.

Config env: `PORT`, `HOST`, `DATA_DIR`, `ADMIN_USER`, `ADMIN_PASSWORD` (first start only), `SESSION_DAYS`, `BACKUP_KEEP`, `WEB_DIST`.

### Running a throwaway server for testing
Never test against the owner's real data directory.
1. `npm run build`
2. Env: `DATA_DIR=<temp dir>`, `PORT=3222`, `ADMIN_PASSWORD=testpass123`
3. `Start-Process node -ArgumentList 'dist/index.js' -WorkingDirectory server -WindowStyle Hidden`
4. Log in as `gm` / `testpass123`.
5. Stop it afterwards (`Get-Process node | Stop-Process`) and delete the temp data dir.

### Tests (all plain Node scripts; each prints PASS/FAIL and exits non-zero on failure)
- API smoke tests against a running throwaway server: `node scripts/smoke-<area>.mjs http://localhost:3222 gm testpass123`. Areas: `auth`, `copy`, `export`, `maps`, `pagetypes`, `relations`, `sessions`, `share`, `stattemplates`, `templates`, `todos`, plus `smoke.mjs` (core).
- Pure logic: `scripts/test-family.ts`, `scripts/test-time.ts` (bundle with esbuild, run with node).
- Updater: `node scripts/test-update-logic.mjs` (no Electron), `node scripts/test-update-flow.mjs` (real Electron, fake GitHub; **unset `ELECTRON_RUN_AS_NODE` first**).
- Desktop app: `node scripts/test-electron.mjs <server-url>`.
- Add a smoke script for every new server route family, in the same style (copy a small one such as `smoke-templates.mjs`).

## 3. Architecture rules (the important ones)

### Data model
- **A workspace is a "world".** Everything (pages, folders, maps, templates, page types, stat templates…) belongs to a workspace. The UI may have **no workspace at all** (fresh install). Never use `wsId!`; call `useStore.getState().ensureWorkspace()` (returns the id, or `null` if the user cancelled the "Create your first world" prompt) and handle `null`. This was a real bug ("not found" + uncaught TypeError when creating a page with no world).
- **Pages** store a TipTap JSON document. Page links are stored as page **ids**, so renames never break links. `pages.props` is a JSON bag: `props.type` = page type id, `props.data` = special-page field data, `props.portrait`.
- **Special pages (page types).** Built-in: Person, Monster, Location. Custom ones live in the per-workspace `page_types` table (migration #9); the layout is a JSON/YAML-like definition edited in `PageTypes.tsx`; resolution is `web/src/lib/pageTypes.ts` (`resolveTypes`, `typeOf`). A type may add a tag to its pages.
- **Stat block templates.** Built-in plus custom (`stat_templates`, migration #10). Resolution: `web/src/editor/templates.ts` (`resolveTemplates`, `findTemplate`) and `web/src/editor/useTemplates.ts`. Known caveat: a Monster page's stat block is separate data from the editor's `/statblock` node.
- **Bootstrap.** `GET /api/workspaces/:ws/bootstrap` returns everything the client needs for one world (pages meta, folders, links, zettels, templates, pageTypes, statTemplates…). New per-world lists should ride in it and be cached in IndexedDB (`bootstrap:<wsId>`). An old cached bootstrap may lack new fields: **code defensively** (`data.pageTypes ?? []`).
- **IDs/time:** string ids (`uid()`), timestamps in ms. Map/timeline time `T` is an integer day count (see ROADMAP).

### Server
- **Migrations are append-only.** `server/src/db.ts` has `const migrations: string[]`; `SCHEMA_VERSION = migrations.length`. Never edit or reorder a shipped migration; add a new one at the end. A backup from a newer schema is refused on restore; keep backup/restore, export (`export.ts`, `markdown.ts`), and copy (`copy.ts`) in step when you add tables that hold user content (update restore's table list, `world.json`, copy logic or document that it is not copied in ROADMAP).
- **Routes** live in `server/src/routes/*.ts`, one Fastify plugin per area, registered in `server/src/index.ts`. Validate every body with **zod** (`safeParse`, reply 400 `{error: 'bad request'}`). Mutations use `preHandler: requireEditor`; viewers are read-only. Check workspace/page ownership on every id from the client (`wsExists`, same-workspace checks) so one world can never touch another's rows.
- Error shape is `{ error: string }`. The client `api.ts` turns non-2xx into `ApiError(status, message)`.
- Writes touching several tables go in `db.transaction(...)`.
- Public (unauthenticated) surface is only `/api/public/*` and the `/s/:token` page. Anything leaving through it must pass `publicDoc` so nothing private leaks. `smoke-share.mjs` tests this; do not widen it casually.
- Security: sessions are HttpOnly cookies, `Secure` follows `req.protocol`; login is rate limited. Do not weaken auth, CSP/security headers, or the upload type allow-list (raster images only).
- Server runtime deps are `packages: 'external'`; adding one means it must be in `server/package.json` (Docker uses `npm ci`).

### Web
- **State:** one zustand store, `web/src/store.ts` (`useStore`). Actions that create things return the created object, or `null` when cancelled. Components call `useStore.getState().x()` in handlers; use hooks for reading.
- **API layer:** every request goes through `web/src/api.ts` (`req`). Add a typed method there and its types in `web/src/types.ts`.
- **Never use `window.alert/confirm/prompt`.** Electron has no `prompt()`. Use `askText`, `confirmDialog`, `alertDialog` from `web/src/lib/dialog.ts` (hosted by `DialogHost.tsx`).
- **Never use a native `<select>`.** Use `web/src/components/Select.tsx` (styled portal listbox).
- **Handle rejected promises** from API calls in event handlers: `.catch((e) => alertDialog(e.message))`. An unhandled rejection is a bug report waiting to happen.
- **Icons:** `lucide-react`; page type icons are a curated map in `TypeIcon.tsx` (`TYPE_ICONS`). Add icons there by name, keep the bundle small.
- **Styling:** CSS variables per theme in `styles.css` (`[data-theme="x"]`, listed in `themes.ts`). Use the variables (`var(--muted)`, …); never hard-code colours in components. Ten themes exist; check a dark one when adding UI. Layout must work at phone width (< 900 px has a mobile layout).
- **Shortcuts** are rebindable (`web/src/lib/keys.ts`). The Electron app deliberately adds only keys the web app does not use (see `electron/README.md`).
- **Offline:** metadata and opened pages are cached in IndexedDB; offline writes are only retried while the page stays open. The service worker is a stub.
- **Viewers:** hide or disable every editing control when `user.role === 'viewer'`.
- Editor extensions live in `web/src/editor/`; slash commands in `slash.ts`; wikilinks `{{Name}}`, `{{Name|text}}`, `{{Name#Section}}` in `wikilink.tsx`. Public/shared pages render the same nodes read-only, so a new node type needs a read-only rendering and a decision for `publicDoc` and Markdown export.

### Desktop app and updates
- `electron/main.js` is the only app code in Electron; the UI always comes from the server, so **server/web changes never need a new desktop build**. Only changes in `electron/` do.
- The page served by the server gets **no** bridge to the system. The `file:` setup page has `connect`, `version`, `checkUpdates` (`preload.js`); main-process handlers also refuse any sender not on `file:`. Keep it that way: sandbox on, context isolation on, no Node in pages.
- **Updater** (`electron/update.js`, pure helpers in `electron/update-logic.js`):
  - Source: GitHub Releases of `JanMoritzP/chronicle` (public repo; no token in the app).
  - **Installed (NSIS) build:** `electron-updater` reads `latest.yml` from the release, downloads the installer on "Update now", installs on restart or next quit.
  - **Portable build** (`PORTABLE_EXECUTABLE_FILE` set): electron-updater cannot swap a single exe, so `update.js` finds the `*-portable.exe` asset, downloads it next to the running exe (`.chronicle-update-<ver>.exe`), verifies size + SHA-256 (GitHub's `digest`) + `MZ` header, then a temporary `.bat` moves it over the old exe after the app quits and relaunches.
  - Checks 8 s after start and every 6 h, silently unless an update exists. Manual: `Ctrl+Shift+U` or the link on the address screen. "Skip this version" is stored in `settings.json`.
  - Asset names are part of the contract: `Chronicle-Setup-<ver>.exe`, `Chronicle-<ver>-portable.exe`, `latest.yml` (set by `artifactName` in `electron/package.json`). Do not rename them without changing `pickPortableAsset`.
  - Builds are **unsigned**; Windows SmartScreen warns on first install. Do not add signing without the owner.

## 4. Releasing

The app version is `electron/package.json` → `version`. Root, `server` and `web` keep the same number, and the root lockfile mentions them; `release-please-config.json` (multi-manifest form, with `.release-please-manifest.json` next to it) keeps all of it in step.

**Releases are automatic.** Commit with a conventional prefix and push to `main`:

- `feat:` bumps the minor, `fix:` the patch, a breaking change (`feat!:` or a `BREAKING CHANGE:` body) the major.
- The workflow `.github/workflows/release-please.yml` then sets that version in all four `package.json` files and both lockfiles, prepends a section to `CHANGELOG.md` written from the commit subjects, commits that, and pushes the tag `vX.Y.Z`.
- The tag triggers `.github/workflows/release-desktop.yml`, which runs the updater tests, builds on Windows and publishes the GitHub release (`Chronicle-Setup-<ver>.exe`, `Chronicle-<ver>-portable.exe`, `latest.yml`). The release notes are that version's `CHANGELOG.md` section (`scripts/extract-release-notes.mjs` writes it to `electron/release-notes.md`, which electron-builder picks up); they are what the in-app update dialog shows. The release must be **published, not a draft** (`releaseType: release`), or clients will not see it.

Consequences:

- The commit subject becomes a changelog entry and the in-app release note (first ~700 chars), so write it for the user, important bit first (section 6).
- A push without `feat:`/`fix:` commits releases nothing. Several pushes release together, as one version.
- `release-as: X.Y.Z` in a commit message forces an exact version (e.g. `1.0.0`).
- The `chore(main): release X.Y.Z` commit that appears on `main` after a push is release-please's; do not edit versions by hand afterwards. If the build fails, fix and re-run the workflow from the GitHub UI, or delete and re-push the tag.

Before pushing a release: `npm run typecheck`, `npm run build`, the relevant smoke scripts, `node scripts/test-update-logic.mjs`.

The first release (0.2.0) was tagged by hand and `.release-please-manifest.json` starts at 0.2.0; release-please needs a starting point, so that is a one-time thing. release-please updates the manifest file itself with every release.

Without CI: `$env:GH_TOKEN='<token with repo scope>'; cd electron; npm run release:win` (builds and publishes the current version). `npm run dist:win` only builds locally; output in `electron/dist`.

Server side: users on Docker/Umbrel update by redeploying the image; that is independent of the desktop version.

Version numbers: semver. Anything the updater compares must stay `MAJOR.MINOR.PATCH[-pre]`.

## 5. Coding guidelines

- **TypeScript strict.** No `any` unless parsing JSON from the editor/DB (existing code does this for TipTap docs and `props`). No `@ts-ignore`. `npm run typecheck` must pass with zero errors.
- **Match the surrounding style.** Two-space indent, single quotes, no semicolons, trailing commas in multiline literals, `async/await`. Small files per component/area; prefer extending an existing module over a new abstraction.
- **No new dependency** unless clearly needed; say why in your summary. Check bundle size for web. Server deps must also work in the Docker build (native modules build with python3/make/g++ there).
- **Comments:** sparse. Explain *why* for non-obvious behaviour (a Windows quirk, a security reason, a past bug). Do not narrate the code. Match the density of the file you are in.
- **No dead code, no TODO litter, no debug logging left behind.**
- **Errors:** validate at boundaries (zod on the server, `ApiError` on the client); never swallow errors silently (the codebase's few `catch {}` are for best-effort cache writes). User-facing failures go through `alertDialog`.
- **Defensive about old data:** old IndexedDB caches, old backups, pages without `props`, workspaces without calendars. Migrations must keep old databases working.
- **Accessibility/UX basics:** buttons have a `title` or label, dialogs close on Escape, focus lands in the first input.
- **Windows-aware:** paths use `path.join`; the owner is on Windows. Shell snippets in docs should be PowerShell-friendly.
- Do not reformat files you are not changing (the repo has mixed line endings; git warns about LF→CRLF, ignore it).

## 6. Content and writing guidelines

This covers UI text, docs, changelog, release notes and defaults.

- **Voice:** plain, calm, direct. Short sentences. Say what happened and what to do next. The product is a notebook for storytellers, not enterprise software: no jargon, no exclamation marks, no emoji.
- **English UI.** The owner writes German; do not mix languages in the UI. Use "world" (never "workspace") in anything the user sees. "Page", "special page", "folder", "tag", "session".
- **Capitalisation:** sentence case for buttons, titles, menu items ("New special page", "Create world"). Proper nouns only for the product (Chronicle) and D&D terms.
- **Buttons are verbs** ("Create", "Save", "Delete"), destructive ones named for the action, not "OK". Confirm dialogs for destructive actions say exactly what will be lost and use the `danger` style.
- **Errors:** what failed + how to fix it, no stack traces or status codes ("Cannot reach http://x. Is the server running and the address right?").
- **Placeholders** show a realistic example, not "Enter value".
- **Default content** (built-in page types, stat templates, template headings) uses 5e-friendly, system-neutral wording and sensible empty states. Special-page field labels are short nouns ("Race", "Class / Role", "Home").
- **Docs:** update in the same change as the code. A user-visible feature gets a section in `docs/ROADMAP.md` in the existing style (what it does, data, API, tests). Deployment-relevant changes go in `docs/DEPLOY.md`; desktop behaviour in `electron/README.md`; every release in `CHANGELOG.md`. Use sentence-case headings, no marketing language, no en/em dashes in prose (use commas, colons, or a new sentence).
- **Release notes / changelog:** lead with what the user can now do, then fixes. 3 to 6 bullets. They appear verbatim in the in-app update dialog (first ~700 chars), so keep the important bit first.
- **Commit messages:** conventional prefix, then an imperative subject: `feat: …`, `fix: …` (`chore:`, `docs:`, `refactor:` are fine too). The prefix sets the version bump and the subject is written into `CHANGELOG.md` and the release notes verbatim, so write it for the user in plain words (section 4). Example: `fix: ask for a first world when creating a page with none`. Propose it after a change and commit and push only after the owner approves it (section 7).

## 7. Working with the owner

- **The agent does the work, the owner approves.** The agent makes the changes (code, tests, docs), proposes a commit message, and commits and pushes once the owner approves it. Message rules in section 6. When the change is a release, say so and include any extra steps (e.g. a one-time tag, section 4) in the same approval.
- The owner reports bugs informally ("it just says not found, uncaught TypeError"). **Reproduce first** (throwaway server + the in-app browser or a script), find the root cause, fix it, verify the fix the same way. Do not guess.
- Do the whole task: code, tests, docs, typecheck, build. Then summarise briefly: what changed, what you verified, what you could not verify, and anything the owner must do (e.g. push a tag).
- Be honest about what was not tested. Never claim a feature works because it compiles.
- Ask before: adding paid services, changing auth, deleting user data paths, changing the release/asset contract, code signing, or large redesigns. Otherwise decide and move on.
- Do not touch `dnd_note_taking.zip` or other untracked files you did not create. Leave `electron/dist` and `server/dist` out of commits (gitignored).
- Keep the working tree clean of temp files: use `$env:TEMP\opencode` for scratch data and delete it after.

## 8. Gotchas (learned the hard way)

- `server/dist` and `web/dist` are gitignored and get wiped; `npm run build` before running the server.
- `npm install` blocks some install scripts (`better-sqlite3`, `esbuild`, `electron`); they load fine. For Electron run `node node_modules/electron/install.js` if the binary is missing.
- electron-builder prints "no node modules found" lines; harmless.
- Running Electron from a script with `ELECTRON_RUN_AS_NODE` set (even empty) makes it behave as plain Node and `require('electron')` fails. Delete the variable.
- A bare Electron script reports Electron's own version from `app.getVersion()`, not the app's. Test update logic with a very high fake version (e.g. 999.0.0).
- The portable exe is a self-extracting wrapper: the real path of the running file is `process.env.PORTABLE_EXECUTABLE_FILE`, not `process.execPath`.
- Windows will not overwrite a running exe, hence the batch swap after quit. `%` in paths must be doubled in batch files (`replaceScript` does it).
- In-app browser tool (when testing the UI): `evaluate` takes `script`; `wait` needs `condition: "text"` plus `text`; element refs go stale after the page changes; the `.menu` popup is not in snapshots, so drive it with DOM `click()` via `evaluate`.
- PowerShell here rejects Python heredocs and complex `node -e` one-liners; write a temp `.mjs` file instead.
- The Sidebar and Settings views contain several creation entry points (`New page`, special page menu, `New folder`, Quick capture, links to missing pages). A fix to one flow usually applies to all; grep for siblings.
- Known open items: see `docs/ROADMAP.md` ("Not done yet", "Known limitations"). Views such as Relations, Sessions, Todos and Maps still read `wsId` with `!`; they are only reachable inside a world, but prefer null-safe code in new work.
- Pushing a tag in the same push that introduces the workflow file misses the tag event (GitHub had not indexed the workflow when the tag event arrived; the branch push seconds later worked, the tag event was dropped). If a tag-triggered workflow never ran after such a push, delete the tag and push it again: `git push origin :refs/tags/v0.2.0` then `git push origin v0.2.0`. Happened with v0.2.0.
- The release-please action ignores a single-manifest `release-please-config.json` (no `packages` key) and fails with "Missing required manifest versions". It only works in multi-manifest form: `packages` key in the config plus the `.release-please-manifest.json` file. Passing `release-type` as an action input instead does not work either: the action then builds its config from the inputs only and silently drops the config file (no `include-v-in-tag`, no `extra-files`).

## 9. Definition of done

- [ ] Root cause understood (bugs) or behaviour specified (features).
- [ ] `npm run typecheck` clean; `npm run build` succeeds.
- [ ] Relevant smoke/unit scripts pass; new route family has a smoke script.
- [ ] UI checked in a browser (light and a dark theme, phone width for layout changes, viewer role if editing is involved).
- [ ] Docs updated (ROADMAP / DEPLOY / electron README / CHANGELOG as applicable).
- [ ] Old data still loads (migration or defensive default).
- [ ] Temp servers stopped, temp data deleted; commit and push happened only after the owner approved the message.
- [ ] Final message states what changed, what was verified, what was not.
