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
- Server: auth, users/roles, workspaces, folders, pages, trash, page history with authors and full restore, zettels, image upload (raster only), daily DB backups, security headers.
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

### Starter todo (built)
- Every new page gets a todo with the world's default text (`Fill me` unless changed). In a blank page it is the only line; when a template or captured text supplied content, it is appended after it. An empty text in the settings turns it off.
- Stored per world in `workspaces.settings` (JSON, migration 11; `newPageTodo`), edited under Settings, Worlds. `PATCH /api/workspaces/:id` takes `name` and/or `settings`; `GET /api/workspaces` returns the settings. Added server-side in `POST /api/workspaces/:ws/pages`, so quick capture, wikilink stubs and templates all get it.
- Pages created by other routes (copy between worlds, session notes, import) do not get a starter todo.

### Deleting a world (built)
- Settings, Worlds, "Delete this world" (confirm dialog, then the app switches to another world or the first-world prompt). `DELETE /api/workspaces/:id` is a soft delete (`deleted_at`): the rows stay in the database but the world disappears from lists, its bootstrap answers 404 and its public share links stop working. There is no undelete in the UI.

## Templates (built)
- Custom templates per world: sidebar "Templates" (Ctrl+K "Open templates"), or a page's `…` menu "Save as template…". Type `/template-name` in any page to insert the template at the cursor, in place of the typed text. Template items come before built-in commands in the slash menu.
- Table `templates` (migration 8): `name`, `slug` (lower case, letters and digits joined by hyphens), `description`, `content` (TipTap JSON). The slug is unique per world (409 on a clash).
- Heading and todo ids are stripped and todos reset to open on every save. Insertion gets fresh ids.
- Templates ride in the bootstrap, so the slash menu needs no request. `world.json` includes them, and backup restore brings them back.
- Editors and owners create, edit and delete; viewers can read only.
- API: `POST /api/workspaces/:ws/templates`, `PATCH|DELETE /api/templates/:id`. Tests: `scripts/smoke-templates.mjs` (29 checks).

## Special pages (built)
- A special page is a normal page with a fixed layout next to its text and an automatic tag. Built-in types: Person, Monster, Location. Custom types are per world and can be created, duplicated and deleted. Deleting a type makes its pages plain pages (the text and field values are kept).
- Layout: four zones (top, side, main, bottom), columns side-left / side-right / single (with one column, side blocks merge into main), side width in px (160 to 520). `flow: wrap` lets the text run on underneath the side column once its blocks end (the side floats); `flow: columns` keeps the text in its own column, and `sticky: true` then keeps the side in view while a long text scrolls. Person, Monster and Location use `wrap`; layouts saved before the option exist keep `columns`. On phones the side stacks above the text either way. Blocks: image (key, shape square/circle/wide/tall), statblock (any stat block form), fields (labelled key/value pairs, optionally long text), body (the normal page text). An image with the key `portrait` doubles as the page thumbnail.
- Data: `page_types` (migration 9): `name`, `icon` (curated lucide set in `TypeIcon.tsx`), `tag` (cleaned server-side, added to every page of the type), `source` (the layout as JSON, YAML or Markdown front matter) and `definition` (the normalized layout). Pages carry `props.type` (type id, so renames never break it) and `props.data` (field and stat block values, keyed by the layout keys).
- The layout is interpreted by the client (`web/src/lib/pageTypes.ts`: `parseSource`, `normalizeLayout`, `layoutToSource`, `resolveTypes`, `typeOf`); the server only stores it within size limits.
- UI: the sidebar "New special page" menu creates a page of a chosen type; the sidebar "Special pages" lists the types with their page counts. The type editor has a **Designer** (column setup, add, move between zones, reorder and remove blocks in each zone, per-block and field settings) and a **Source** tab (JSON, YAML or Markdown front matter), both with a live preview you can type in. A key used twice or left empty blocks saving. Built-in types are read-only; Duplicate makes an editable copy.
- Stat block forms have a `look` next to their sections (`style` classic / card / plain, `accent` colour, `font`, `width`, `columns`), stored in `stat_templates.definition` beside `sections` and edited in the form designer or its source. Section kinds added: `abilities` (six scores with modifiers, `layout` row or table with optional save column; values under `str`..`cha` and `str_save`..) and `columns: 2` on `rows`. Text areas render `***Name.***`, `**bold**` and `*italic*` when previewed. The built-in monster and player forms use the classic look; "5e Monster (2024 layout)" is new. Forms saved before this have no look and keep the card style. Tests: `scripts/smoke-worlds.mjs`.
- Rides in the bootstrap (and the IndexedDB cache) and in `world.json` / backup restore. Copying between worlds does not carry custom page types: their pages become plain pages, while stat block forms are matched by name.
- API: `POST /api/workspaces/:ws/page-types`, `PATCH|DELETE /api/page-types/:id` (editors and owners; viewers read only). Tests: `scripts/smoke-pagetypes.mjs` (11 checks), `scripts/test-layout.ts` (parse/serialize round trip, key handling; 16 checks).

## Library (Open5e, built)

A read-only reference library of everything Open5e publishes (api.open5e.com/v2): creatures, magic items, equipment (weapons and armor are part of it), spells, classes and subclasses, species, backgrounds, feats and conditions. It belongs to the server, not to a world, and is opened at any time from the sidebar ("Library") or the command list.

**Decisions.**
- Own SQLite file `DATA_DIR/library.db`. It is reference data that can be downloaded again, so backups, restore, export and world copies leave it out.
- The owner downloads it once with a button ("Download the library", about a minute, 20 MB) and can refresh it later. Nothing is downloaded automatically.
- Each entry exists once. When several books have the same name, the newest edition of the rules wins (2024, then 2014, then others), then the official SRD over third-party books, then the newest publication date. Older versions cannot be picked. Classes and species also compare their parent, so subclasses of different classes stay apart.
- Entry ids are `<category>:<open5e key>` because Open5e keys repeat across categories (`srd-2024_camel` is both a creature and a mount).
- Every refresh appends `CREATED`, `UPDATED` and `DELETED` lines (timestamp, category, id, name) to `DATA_DIR/library.log`. There is no screen for it.

**Quick add.** Alt+L (or "Add from the library" in the command list) opens a palette. Names are matched with the same fuzzy search as the page search, in the browser, over a compact index (about 6,300 rows) that is cached in IndexedDB per library version. Enter adds the entry to the current world and opens it, Shift+Enter opens it in the Library view. Creatures become a Monster page with the stat block filled in, everything else becomes a normal page with the text as the body and the source and license at the end.

**Mapping.** `web/src/lib/open5e.ts`. Creatures fill the built-in 5e monster form (classic or 2024 layout, by the source book's ruleset). Action text is taken from each action's `desc` and not from Open5e's structured attack data, which has mistakes (a goblin's scimitar listed as thunder damage). Speed uses the printed values, not the padded `speed_all`. Everything else goes through `entryText`: a subtitle, labelled facts and titled sections.

**API.** `GET /api/library/status`, `GET /api/library/index`, `GET /api/library/entries/:id` (any signed-in user), `POST /api/library/refresh` (owner, runs in the background, the client polls the status). Tests: `node scripts/smoke-library.mjs <url> gm <password>` (needs internet).

**Links to library entries (phase 2).**
- Typing `{{` shows library entries under "Library" after the pages (from two letters on, five at most, source and kind shown). Picking one inserts a wikilink with the attribute `libKey` (the entry id) and no page. It is drawn with a dotted underline and opens the entry in the Library view (Ctrl for a new tab, Shift for the split view). Entries already imported into the world are left out of the popup because their page shows up instead.
- `links.lib_key` (migration 12) holds these links; `target_id` stays empty and they are never matched by name, so a page called "Goblin" does not capture a link to the library Goblin, and they are not counted as missing pages or ghosts when copying.
- The Library view lists "Linked from": pages of the current world that link to the entry. Links are per world, the library is global.
- Importing sets `props.library` on the page, so an entry becomes a page only once per world (the button then reads "Open the page"). If pages link to the entry, a dialog asks whether to point those links at the new page. `POST /api/workspaces/:ws/library-links/repoint` rewrites the link nodes (keeping a differing shown text as the alias) and reindexes the pages like a normal save.
- Public pages: a library link on a shared page is a link to `/s/<token>?lib=<id>`, which shows the entry read-only. `GET /api/public/library/:id` answers only for entries that a shared page links to, so the library is not browsable. Markdown export writes a library link as plain text.

**Linked fields (phase 3).**
- A field of a special page can be a link to library entries of one kind: species, class, background, feat, spell, magic item, equipment, creature or condition. In the designer the field's type reads "Link: class" and so on, with "Several" for lists such as spells. In the YAML source: `{ key: class, label: Class, library: class }` and `{ key: spells, label: Spells, library: spell, multi: true }`.
- The value is a list of entries `{ name, libKey?, pageId? }` in `props.data`. Typing offers the pages of the world that were imported from that kind first, then library entries (imported ones are left out), and "Use “…” as text" for homebrew. Entries open the library entry or the page; ctrl and shift work as for links in text. Older plain-text values show as one unlinked entry and are replaced when the field is edited.
- Field entries go into the same link index as links in the text (`links.lib_key` for library entries, `target_id` for pages), so "Linked from", the graph and backlinks include them. The index is rebuilt on every save, also when only the fields changed. The repoint after an import rewrites field entries too. Copying a page to another world keeps library entries and turns entries that point at a page left behind into plain text.
- The built-in Person page uses it for Race (species) and Class / Role (class).
**Every kind has its own page (phase 4).**
- Importing an entry makes a page of the matching built-in special page type, with the data in its fields or stat block and the text in the body: creatures become Monster (5e Monster or 2024 form), spells Spell (5e Spell form), equipment and magic items Item (5e Item form), classes Class, species Species, backgrounds Background, feats Feat, conditions Condition. Each type adds its own tag. The library view shows spells and items in the same forms.
- Classes carry hit die, saving throws, primary ability and the parent class of a subclass (a link) in the side fields. The body holds the core traits table, proficiencies and equipment, a level progression table (proficiency bonus, class columns such as rages or cantrips, spell slots, features gained) and every feature with its levels. Species link their parent species. Feats show kind and prerequisite. A condition keeps only the wording of its own book.
- Text from the data set keeps its structure: bullet lists, tables, bold and italic become real editor content.
- Stat block forms can hold links. A field of type `link` (designer: "Link: class" and so on, "Allow several entries"; source: `{ key: classes, label: Class, type: link, library: class, multi: true }`) works like a linked page field. The stat block data stays plain strings: the shown text lives under the field's key, the links as JSON under `<key>:refs`. The server reads these (`server/src/refs.ts`) for the link index, the repoint after an import and copying between worlds; shared pages keep the text and drop the links; Markdown export leaves the `:refs` lines out.
- The 5e Spell form links its classes. The 5e Player Character form got Species, Class, Background, Feats and Spells as links.
- Not done: a class page does not list its spells (Open5e stores the classes on each spell, not the spells on each class).

**Terms and properties (phase 5).**
- Open5e publishes what other entries refer to as entries of their own, and the library holds them: weapon properties (`weaponproperties`, with the full explanation), damage types, skills, abilities, spell schools, languages, creature types, alignments, sizes and the rules text (`rules`, about 280 entries). They are searched, opened and linked like everything else, and importing one makes a Rule page (kind, section and a few details as fields, the text as the body).
- Links: an item's damage type and weapon properties, a spell's school, and a creature's size, type and alignment are links. Weapon properties keep their detail next to the link ("Versatile (1d10)"): an entry has a `note` besides its name, so the detail survives when the link is moved to an imported page. A Monster page has a "Classification" block for size, type and alignment.
- Rules that share a name (Ability Checks appears in several sections) are separate entries; the section shows next to the name. Alignments have no name in Open5e and get one from their key.
- Not linked: a creature's skills, languages, resistances and condition immunities stay text, because they carry numbers or qualifiers ("Stealth +6", "nonmagical attacks") that a linked entry cannot hold when typed by hand. Item categories, rarities and environments have no explanation text in Open5e and stay text.
- Existing libraries have to be refreshed once (Library, Refresh) to download the new kinds.

**Names in text link to their entries (phase 6).**
- The names of library entries inside running text are links: "Charisma" in a class, a prone creature, *Fireball* in a feature, fire damage in a trait. `web/src/lib/autolink.ts` finds them (tested by `scripts/test-autolink.ts`).
- Where: the Library view (sections, tables, facts and the text fields of spell, item and creature stat blocks), the text fields of stat blocks on pages when read (shown as links, nothing stored, and to the imported page where the entry was imported), and the body of a page when it is imported (stored as links, so backlinks and the repoint after an import work). The page menu has "Link library terms" for pages that already exist. Shared pages show plain text.
- Rules, so that ordinary words stay plain: abilities, skills, classes, species, languages, items, feats and rules are linked only with the entry's capitals (Charisma, not charisma); conditions in any case (invisible needs a capital); spells only in italics, which is how the data writes them; damage types only before "damage" (fire damage); spell schools only before "spell" or "school"; weapon properties, creatures, creature types, alignments and sizes are not linked in text. Very short or common names (Common, Light, Shield, Range), items under five letters, single word feats under seven and single word rules under eight are skipped, and a one word rule at the end of a capitalised phrase (Weapon Proficiencies) is not cut out of it.
- Each entry is linked once per section (once per field in a stat block); headings, code and existing links are left alone; an entry never links to itself.
- Hover cards: resting the mouse on a link to a library entry (a name in text, a chip in a linked field, a library link in a page) shows a card like the one for page links: the stat block for creatures, spells and items, else the facts and the start of the text. Clicking the card opens the entry. Links inside a card do not open further cards. The card is placed from the link's position when it opens; if the list was redrawn in the meantime (a page opened, links refreshed) the link is gone and no card opens, and a card whose link disappears closes by itself (before, it could land in the top left corner and stay there, covering "New page").
- A class page's saving throws and primary ability are linked fields (ability). Pages imported before this change keep their text; "Link library terms" adds the links.

## Several people at once (built)

What it does: more than one person works in the same Chronicle at the same time, edits the same page together, and an admin decides who may open which world.

- **World access.** Table `workspace_members(workspace_id, user_id, role editor|viewer)` (migration #13; existing accounts were added to every world). `server/src/access.ts` checks every `/api/` request that reaches into a world once, in a global `onRequest` hook: the world comes from the path (`/api/workspaces/:ws/...`, or the row behind `/api/pages/:id`, `/api/maps/:id` and the other id routes). A non-member gets 404, a viewer gets 403 on writes. Owners reach every world. A global viewer account is read-only in every world. `GET /api/workspaces` lists only the worlds the account may open and adds `role`; the client makes `user.role` `viewer` while a viewer world is open (`account` keeps the real role). Deleting a world is owner only. Copy checks read access to the source worlds and write access to the target. Folder, page and zettel ids sent by a client must belong to the same world.
- **Admin dashboard.** `server/src/admin.ts` and `admin-ui.ts`: a second Fastify server on `ADMIN_PORT` (default 3001, bound to `ADMIN_HOST`, default 127.0.0.1) with its own account (`admins`, `admin_sessions`, cookie `dnd_admin`, `SameSite=Strict`), a strict CSP and no outside resources. It lists worlds with their members, adds and removes people with editor or viewer access, creates, renames and deletes worlds, creates accounts, changes account type, sets passwords, signs people out, and shows who is online and what they are editing. The first account is created from `ADMIN_PANEL_USER` and `ADMIN_PANEL_PASSWORD`; with neither it stays off. At least one owner account must remain.
- **Live editing.** Each open page has a room on the server (`server/src/collab.ts`) holding a Yjs document, reached by WebSocket at `/api/collab/:pageId` (same origin, session cookie, member of the world). The editor uses TipTap's Collaboration and CollaborationCaret extensions; cursors carry the person's name and colour. The shared document is stored in `page_docs` and written to `pages` (text, outline, links, todos, history, statistics) at most every 1.5 seconds while people type and when the last person leaves, through the same `applyContent` an editor save used. `server/src/ydoc.ts` converts between the stored TipTap JSON and the Yjs structure without a ProseMirror schema; the first open of a page seeds it from the stored JSON. Viewers see changes live but their edits are ignored. Content written by anything else (REST `PATCH` with `content`, restoring a version, relinking library terms, restoring a backup) drops the room and tells open editors to reload; todo changes from the Todos tab are applied to the live document instead.
- **Live stream.** `GET /api/live?ws=` (server-sent events, `server/src/live.ts`) tells each tab about changes by others: `refresh` after any write in the world (the client reloads its lists and the views that keep their own copy), `page-saved` with the derived page data, `presence` with who is online, `worlds` when an admin changed access. Requests carry `X-Client-Id` so a tab is not told about its own change.
- **Fields on special pages.** `PATCH /api/pages/:id` takes `propsPatch` (`data`, `portrait`, `type`) merged on the server, so two people editing different fields do not overwrite each other. Title and tags are still last write wins.
- **Restore.** Backup restore keeps accounts, memberships (pruned to worlds that exist) and admin accounts, and resets all rooms.
- **Tests.** `node scripts/smoke-multiuser.mjs <url> <user> <pass> <admin-url> <admin-user> <admin-pass>` (access, dashboard, live editing, live stream), `scripts/test-ydoc.ts` (conversion and merging).
- **Not covered.** Maps, the timeline and relations refresh their lists live but an open map view does not follow another person's edits to its items. Offline edits to a page are kept and merged while the tab stays open; a page opened while offline is read-only.

## Page history (built)

What it does: every edit to a page is recorded with who made it and when, and any earlier version can be restored in full. The clock button on a page opens the history.

- **What an entry holds.** The state of the page after an edit: title, text, special-page fields and portrait (`props`), icon, aliases and tags. Table `page_versions` gained `author_id`, `author_name`, `props`, `meta`, `reason`, `restored_from` (migration #14). The author is stored as a name too, so an entry survives a deleted account. Entries from before this change hold text only and show as "Earlier version"; restoring one keeps the page's current fields.
- **When an entry is made.** `recordRevision` in `server/src/pages.ts` runs after every change to a page: `PATCH /api/pages/:id`, a live editing save (`collab.ts` credits the last person who changed the document), a todo change, relinking library terms. Edits by the same person within 5 minutes of the entry's start fold into that entry, so a restore point exists for every edit without storing every keystroke. An edit by someone else always starts a new entry. A change that leaves the page identical adds nothing. The first change to a page with no history also keeps its starting state (no author).
- **Kept forever.** No entry is ever thinned or deleted, except with its page.
- **Restore.** `POST /api/versions/:vid/restore` (editors) puts back title, text, fields, portrait, icon, aliases and tags. The folder is left where it is. What was on the page just before is recorded first, and the restore itself becomes an entry by the person who did it, marked with the date it restored. Nothing is lost, so a restore can be undone by restoring an entry before it. People editing the page live are told to reload.
- **Not covered.** History is not copied to another world or exported, as before. Two people typing in the same few seconds produce one entry credited to whoever changed the page last.
- **Tests.** `node scripts/smoke-history.mjs <url> <user> <pass>`.

## Operations
- Password change: `POST /api/auth/password` (own), owner can set another user's.
- Docker: health check on `/api/health`, graceful shutdown on SIGTERM (WAL checkpoint), `/data` owned by uid 1000, compose uses a named volume. Session cookie `Secure` follows `req.protocol` (behind cloudflared it is https).
- Umbrel: community store files in `umbrel/` (amd64 only), image published by `.github/workflows/image.yml`. Not tested on a real Umbrel.

## Known limitations / things to watch
- Offline edits are not queued across reloads.
- The service worker is a stub (installability only).
- Deleting a folder moves its contents up a level rather than trashing them.
- Copying between worlds does not carry map pins, events or history (todos not checked). Templates and custom page types are not copied either (their pages become plain pages; stat block forms are matched by name).
- Viewers cannot share. `/todo` is unavailable in read-only mode.
- Title and tags of a page are last write wins when two people change them at the same moment.
- Only amd64 images; Linux and Mac Electron builds untested.
