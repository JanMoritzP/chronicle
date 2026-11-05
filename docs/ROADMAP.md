# Chronicle: roadmap and decisions

A World Anvil-style worldbuilding notebook. Self-hosted, React frontend, Node + SQLite backend.

## Decisions (agreed)

| Topic | Decision |
|---|---|
| Auth | Username + password, session cookie (HttpOnly, SameSite=Lax, Secure in prod). Roles: `owner`, `editor`, `viewer` (read-only). Rate-limited login. |
| Storage | SQLite (WAL) via better-sqlite3. Images on disk in `data/uploads`. |
| Editing | Block-based documents (TipTap/ProseMirror). Last-write-wins; no CRDT yet. |
| Client cache | Workspace metadata and opened pages are cached in IndexedDB, so the app starts and reads offline. Offline *writes* are only retried while the page stays open. |
| Links | `{{Name}}`, `{{Name\|shown text}}`, `{{Name#Section}}`. Stored as page ids, so renames never break links. Unresolved links create the page on demand. |
| Workspaces | A workspace is a **world**. Cross-workspace copy: unresolved "ghost" links (A) plus a prompt to also copy linked pages (B). |
| Stat blocks | Template-driven (data in `web/src/editor/templates.ts`), no computed fields. 5e templates first. |
| Calendar | Custom: year, up to two optional named sub-levels (e.g. season, month), days. User-defined lengths, no leap years. |
| Themes | Picker only, 10 themes. CSS variables in `styles.css` + list in `themes.ts`. |

## Status

### Done (phases 1-4 + cross-world copy + sessions + public sharing + export/restore + Electron)
- Server: auth, users/roles, workspaces, folders, pages, trash, version history (throttled snapshots, last 100), zettels, image upload (raster only), daily DB backups, security headers.
- Editor: headings with stable ids, lists, tasks, tables, quotes, code, images (upload / paste / drop), `{{` auto-close with page + section autocomplete, `/` commands (`/image`, `/embed`, stat blocks, etc.), page/section embeds.
- Hover previews: stat block, then portrait, then first paragraph. Section links preview only that section.
- Ctrl+K search (pages, aliases, sections, full text, zettels, `#tags`, `/commands`), fuzzy matching.
- Tabs, split view, per-tab back/forward (Ctrl+Alt+←/→, Alt+←/→, mouse buttons 4/5), zen mode, rebindable shortcuts.
- Graph, tag tree (nested tags), folders with drag and drop, backlinks, unlinked mentions.
- Zettelkasten: quick capture (Alt+C), PWA share target, "make page" links the zettel and marks it processed, processed ones hidden by default.
- Mobile layout, 10 themes.
- Maps and timeline (phase 3), see below.

### Not done yet
1. Import (Affine / Logseq / World Anvil), low priority.

## Map and timeline (phase 3, built)

**Tiling.** Upload (PNG/JPEG/WebP/AVIF, up to 600 MB) is stored as `data/maps/<id>/source.<ext>`. A single-job background queue cuts it with sharp (`layout: 'google'`, 256px webp, transparent-padded edge tiles) into `tiles/<z>/<y>/<x>.webp`. Maps still `processing` at boot are resumed. Tiles are auth-gated and cached immutably. The client uses Leaflet `CRS.Simple`; image px <-> latlng goes through `project/unproject` at `maxZoom`.

**Data.** `maps` (nested via `parent_map_id`, `scale_m_per_px`), `map_layers`, `map_items` (point/line/polygon; `time_mode` static|timed|journey; `keyframes`; `journey`), `calendars` (one JSON per workspace), `events` (page_id optional, `t_start`, `t_end`).

**Time.** `T` is an integer day count. `web/src/lib/calendar.ts` converts to and from year / level1 / level2 / day. No leap years. Changing the calendar later keeps all dates as day counts.

**Items over time.**
- Timed items have keyframes `{t, geometry?, hidden?}`. Before the first keyframe the item is absent. `style.glide` interpolates between keyframes (polygons only when the vertex counts match).
- Journey lines have `waypoints[{arrive, depart}]`. Stops without a time are spread by distance between known ones. The travelled part is solid, the rest dashed, and a dot marks the position at T.
- A line is timed or a journey, never both (the server rejects it). Only lines can be journeys.

**UI.** Tools: select, marker, line, region, measure (with "use as scale"). Vertex handles (drag, click midpoint to add, double-click to remove). Layers panel, nested-map links and breadcrumbs, scale bar. Per-map time bar with play, step, jump-to-change, ticks and a calendar popup. Timeline view with a calendar editor. `/pin` and `/teven` on pages; the "Where & when" section lists a page's pins and events. Hovering an item with a linked page shows the normal preview card.

**Tests.** `scripts/smoke-maps.mjs` (API), `scripts/test-time.ts` (calendar and time math; bundle with esbuild, run with node). Seeders: `scripts/seed-map.mjs`, `scripts/seed-items.mjs`.

**Verified in the browser:** two-level calendar editor, measure + set scale, polygons, keyframes, layers, nested maps with breadcrumbs, phone-width layout, event editing.

## Relations (phase 4, built)
- Table `relations(source, target, kind parent|spouse|sibling|other, label)`. `parent` = source is the parent of target; spouse and sibling are symmetric and stored once; `other` is directed with a free label ("rival of"). The server rejects self links, duplicates, parent loops and pages from other worlds. Trashed pages hide their relations.
- `/relation` on a page opens a dialog (parent of / child of / married to / sibling of / custom). The page shows a "Relations" section with remove buttons (editors only).
- Sidebar "Relations" (also Ctrl+K `/relations`): family trees (layered layout in `web/src/lib/family.ts`, couples drawn as one block with a shared child line, pan/zoom, hover previews) and a free force-directed diagram for custom relations, optionally including family links.
- Tests: `scripts/smoke-relations.mjs`, `scripts/test-family.ts`; `scripts/seed-family.mjs` creates a demo family.
## Copy between worlds (built)
- Page menu, folder context menu (whole folder incl. subfolders) and Ctrl+K `/copy this page` open one dialog: pick the target world, see which pages are linked from the selection, optionally tick them to copy too (B). Linked pages are not followed recursively.
- Server (`server/src/routes/copy.ts`): `POST /api/copy/preview` and `POST /api/copy`, one transaction. New ids for every page; wikilink/embed ids inside the copied set are remapped, everything else becomes a **ghost link** that keeps its name (A) and connects automatically when a page with that name is created or copied later. Embeds of missing pages show a hint instead of a spinner.
- Also copied: tags, folder path (recreated by name), images and portraits (files duplicated, urls rewritten), relations between two copied pages. Not copied: map pins, timeline events, history.
- Title collisions are never merged: the copy becomes `Title (copy)`, `Title (copy 2)`.
- Tests: `scripts/smoke-copy.mjs` (22 checks).

## Sessions and statistics (built)
- Tables `game_sessions(number, title, played_on, t_start, t_end, page_id)` and `page_activity(page_id, day, written, net, created)`. Activity is recorded on page create, on every save (word delta) and on copy. Migration 4 backfills one row per existing page, dated on its creation day, so older worlds start with all their pages on one day.
- `written` counts growth only (typing), so deleting or tidying never lowers it. `net` keeps the signed change.
- A session owns the days from its own `played_on` until the next session's date: the game, the write-up and the prep for next time. Its stats (pages created, words written, pages touched) are summed over that range, so every page is counted in exactly one session. Moving a session's date moves the stats.
- `t_start` / `t_end` are optional in-world dates (calendar day counts, shown with `formatRange`).
- "New session" can create a write-up page: "Session N: title" in an auto-created "Sessions" folder, tag `session`, sections Recap, Decisions and consequences, Loose ends, Next session. Or attach an existing page, or none. Deleting a session keeps its page.
- Sidebar "Sessions" (Ctrl+K `/sessions`): statistics panel (last 30 days, all time or custom range; totals, per-day chart, most written pages) and the journal list. Viewers see everything but cannot add, edit or delete.
- API: `GET/POST /api/workspaces/:ws/sessions`, `PATCH/DELETE /api/sessions/:id`, `GET /api/workspaces/:ws/stats?from&to` (inclusive dates).
- Tests: `scripts/smoke-sessions.mjs` (30 checks).
- Verified in the browser: create with write-up page, edit, link to the page, live word count while typing, viewer read-only, phone width.

## Public sharing (built)
- Page `…` menu → "Share publicly…" creates an unguessable link `/s/<token>` (18 random bytes). One token per page; stopping deletes it for good, sharing again makes a new one. Editors and owners only; viewers cannot share. Settings lists all shared pages with copy/stop.
- Server (`server/src/routes/shares.ts`, table `shares`): `GET /api/public/:token` and `GET /api/public/img/:id` are the only unauthenticated routes (rate limited, 120/min). The page document is rewritten before it leaves the server (`publicDoc`):
  - links to shared pages become ordinary links to `/s/<their token>`; links to anything else become plain text, so private titles and ids never leak (the alias or name typed in the link is kept)
  - embeds of shared pages are inlined (section embeds only that section, one level deep); embeds of unshared pages are dropped
  - images are rewritten to `/api/public/img/<id>`, which only serves an upload while a currently shared page uses it
  - map pins, relations, backlinks, tags, search and the rest of the world are not exposed at all
- Client: `/s/:token` is routed in `main.tsx` before `App`, so no login, store or sidebar loads. Read-only render of the same editor nodes (stat blocks included). Unknown or revoked tokens show a neutral "not shared" page.
- Tests: `scripts/smoke-share.mjs` (33 checks, mostly about what must not leak).

## Export and restore (built)
- **Export this world** (Settings, any logged-in user): `GET /api/workspaces/:ws/export` streams a zip.
  - `pages/<folders>/<Title>.md`: front-matter (title, icon, aliases, tags, created, updated, id), then the page as Markdown. Links are `[[Page]]`, `[[Page#Section|shown]]`, embeds `![[Page]]` (using the page's current title), stat blocks a fenced ```` ```statblock <template> ```` block of `key: value` lines, images relative links into `images/`. Names are sanitised; duplicate titles get ` (2)`. Trashed pages are left out.
  - `world.json`: the lossless version (editor documents, folders, tags, relations, events, sessions, zettels, calendar, maps with layers and pins, upload list).
  - `images/` and `maps/<id>/source.*` (original map images; tiles are not exported, they are rebuilt from the source).
- **Backups** (owner, Settings): daily snapshots (newest 14, `BACKUP_KEEP`), list with size and kind, download, delete, "Back up now".
- **Restore**: `POST /api/backups/:name/restore`. It first writes a `pre-restore-*` snapshot (newest 5 kept), then copies every content table from the chosen snapshot into the live database in one transaction. The snapshot is migrated to the current schema first; a newer-schema backup is refused; a failed foreign-key check rolls everything back. **Accounts and logins are never touched**, so nobody is logged out and an account created after the backup survives. Undo a restore by restoring the `pre-restore` snapshot.
- **Download everything** (owner): `GET /api/export/full`, a zip with a consistent `dnd.db` snapshot, `uploads/` and map sources. Moving to a new machine = unzip into the data directory.
- Snapshots contain only the database; uploads and map sources are not in them. Restoring an old snapshot keeps the current files, so images referenced by the backup still exist (files are never deleted by a restore).
- The zip writer is `server/src/zip.ts` (no dependency, streams entry by entry, no zip64, 4 GB limit). Markdown conversion is `server/src/markdown.ts`.
- Tests: `scripts/smoke-export.mjs` (35 checks; reads the zip with an independent reader and verifies CRCs).

## Electron (built)
- `electron/` is a separate package (not in the root workspaces, so the Docker build never downloads Electron). It is a thin window onto the server, not a copy of the web app: one codebase, and desktop and browser always agree.
- First start asks for the server address and checks it is a Chronicle server (`/api/auth/me` answers JSON 200/401) before saving it in `userData/settings.json`. `CHRONICLE_URL` overrides it.
- Multi-window: `Ctrl+Shift+N` or launching again opens another window on the same server. Windows share the cookie jar, so one login. Cookies are flushed on quit so the login survives.
- Links to anything but the server open in the system browser. Sandbox on, context isolation on, no Node in the page. The `connect` bridge only exists on the local `file:` page and is also refused by sender URL in the main process.
- No menu bar, so nothing steals the app's `Alt+…` or `Ctrl+K` shortcuts (AltGr on a German keyboard stays safe). The few desktop keys are in `electron/README.md`.
- Packaging with electron-builder (`npm run dist:win` etc.); the icon comes from `web/public/icon.svg`. `dist:win` was run: the NSIS installer (97 MB) and the portable exe (89 MB) build, and the portable exe starts and opens its window (the installer itself was not run).
- Tests: `scripts/test-electron.mjs <server> [user] [password]` launches the real app and drives it over the DevTools protocol (14 checks: loading, setup validation, remembered address, second window, login persistence, bridge not exposed to the server page).
- **Auto-update (0.2.0):** `electron/update.js` checks the latest GitHub release (public repo, no token) 8 s after start and every 6 h; `Ctrl+Shift+U` or the address screen link checks on demand. Installed (NSIS) builds use `electron-updater` with `latest.yml`. Portable builds cannot be replaced by it, so the app downloads the `*-portable.exe` asset beside itself, verifies size, SHA-256 (GitHub's asset `digest`) and the `MZ` header, and a temporary batch file swaps it in after quit. "Skip this version" is kept in `settings.json`. Pure helpers are in `electron/update-logic.js`.
- **Releases:** the Release workflow (`.github/workflows/release.yml`) runs `scripts/release.mjs`; if there are `feat:`/`fix:` commits since the last `vX.Y.Z` tag it sets the version in all four `package.json` files and both lockfiles, prepends a `CHANGELOG.md` section from the commit subjects, commits it, tags `vX.Y.Z` and pushes both in one push. The tag runs `.github/workflows/release-desktop.yml`, which publishes `Chronicle-Setup-X.Y.Z.exe`, `Chronicle-X.Y.Z-portable.exe`, `latest.yml` and the blockmap. Those names are a contract with the updater. The release notes are that version's `CHANGELOG.md` section; `scripts/extract-release-notes.mjs` (CRLF-safe, Windows checkouts) writes it to `electron/release-notes.md` (the GitHub release body, read by the portable app's dialog) and `electron/build/release-notes.md` (the `releaseNotes` field of `latest.yml`, read by the installed app's dialog), and `scripts/publish-release.mjs` creates the release with the notes before the build so electron-builder only uploads assets.
- Tests: `scripts/test-update-logic.mjs` (22 checks) and `scripts/test-update-flow.mjs` (15 checks; real Electron against a fake GitHub API, including the real exe swap).
- Not done: offline mode, code signing; the Linux and Mac targets are untested. The 0.1.0 builds have no updater, so they must be replaced by hand once. The updater was tested against a fake API, not yet against a real published release.

## Todos (built)
- `/todo` inserts an inline marker (TipTap atom node `todo` with `message`, `done`, `id`) and focuses its message field. Enter or Escape confirms, an empty message removes the marker. The old checkbox list is now `/checklist`.
- Table `todos` (migration 7) is an index rebuilt from the page document inside `reindexLinks`, so every save path (editor, restore, copy, version restore) keeps it in step. Todo text is not part of page text or word count.
- A todo that is ticked disappears from the page (the node stays in the document with `done: true`). It comes back when unticked in the Todos tab, and "Go to" on a done todo shows it briefly.
- Sidebar "Todos" (badge = open count, `Alt+T`, Ctrl+K "Open todos"): filter open/done/all and by text, grouped by page, with the paragraph around the marker as context. Tick, edit, delete, and "Go to" opens the page scrolled to the marker with a highlight.
- Changes from the tab go through `applyContent` on the server and over `todoBus` into an open editor (split view), so the editor's next autosave cannot undo them.
- Public shares drop todos. Markdown export writes `**TODO:** text` / `**DONE:** ~~text~~`; `world.json` keeps the node.
- API: `GET /api/workspaces/:ws/todos`, `PATCH|DELETE /api/pages/:id/todos/:todoId` (editors). Tests: `scripts/smoke-todos.mjs` (38 checks).

## Templates (built)
- Custom templates per world: sidebar "Templates" (Ctrl+K "Open templates"), or a page's `…` menu "Save as template…". Type `/template-name` in any page to insert the template at the cursor, in place of the typed text. Template items come before built-in commands in the slash menu.
- Table `templates` (migration 8): `name`, `slug` (lower case, letters and digits joined by hyphens), `description`, `content` (TipTap JSON). The slug is unique per world (409 on a clash).
- Heading and todo ids are stripped and todos reset to open on every save. Insertion gets fresh ids.
- Templates ride in the bootstrap, so the slash menu needs no request. `world.json` includes them, and backup restore brings them back.
- Editors and owners create, edit and delete; viewers can read only.
- API: `POST /api/workspaces/:ws/templates`, `PATCH|DELETE /api/templates/:id`. Tests: `scripts/smoke-templates.mjs` (29 checks).

## Special pages (built)
- A special page is a normal page with a fixed layout next to its text and an automatic tag. Built-in types: Person, Monster, Location. Custom types are per world and can be created, duplicated and deleted. Deleting a type makes its pages plain pages (the text and field values are kept).
- Layout: four zones (top, side, main, bottom), columns side-left / side-right / single (with one column, side blocks merge into main), side width in px (160 to 520). Blocks: image (key, shape square/circle/wide/tall), statblock (any stat block form), fields (labelled key/value pairs, optionally long text), body (the normal page text). An image with the key `portrait` doubles as the page thumbnail.
- Data: `page_types` (migration 9): `name`, `icon` (curated lucide set in `TypeIcon.tsx`), `tag` (cleaned server-side, added to every page of the type), `source` (the layout as JSON, YAML or Markdown front matter) and `definition` (the normalized layout). Pages carry `props.type` (type id, so renames never break it) and `props.data` (field and stat block values, keyed by the layout keys).
- The layout is interpreted by the client (`web/src/lib/pageTypes.ts`: `parseSource`, `normalizeLayout`, `layoutToSource`, `resolveTypes`, `typeOf`); the server only stores it within size limits.
- UI: the sidebar "New special page" menu creates a page of a chosen type; the sidebar "Special pages" lists the types with their page counts. The type editor has a **Designer** (column setup, add, move between zones, reorder and remove blocks in each zone, per-block and field settings) and a **Source** tab (JSON, YAML or Markdown front matter), both with a live preview you can type in. A key used twice or left empty blocks saving. Built-in types are read-only; Duplicate makes an editable copy.
- Rides in the bootstrap (and the IndexedDB cache) and in `world.json` / backup restore. Copying between worlds does not carry custom page types: their pages become plain pages, while stat block forms are matched by name.
- API: `POST /api/workspaces/:ws/page-types`, `PATCH|DELETE /api/page-types/:id` (editors and owners; viewers read only). Tests: `scripts/smoke-pagetypes.mjs` (11 checks), `scripts/test-layout.ts` (parse/serialize round trip, key handling; 16 checks).

## Operations
- Password change: `POST /api/auth/password` (own), owner can set another user's.
- Docker: health check on `/api/health`, graceful shutdown on SIGTERM (WAL checkpoint), `/data` owned by uid 1000, compose uses a named volume. Session cookie `Secure` follows `req.protocol` (behind cloudflared it is https).
- Umbrel: community store files in `umbrel/` (amd64 only), image published by `.github/workflows/image.yml`. Not tested on a real Umbrel.

## Known limitations / things to watch
- Offline edits are not queued across reloads.
- The service worker is a stub (installability only).
- Deleting a folder moves its contents up a level rather than trashing them.
- Copying between worlds does not carry map pins, events or history (todos not checked). Templates and custom page types are not copied either (their pages become plain pages; stat block forms are matched by name).
- Single owner account; viewers cannot share. `/todo` is unavailable in read-only mode.
- Only amd64 images; Linux and Mac Electron builds untested.
