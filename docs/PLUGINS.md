# Plugins

A plugin is a folder that adds behaviour to the server. It can react to what happens in Chronicle (hooks), answer requests of its own (routes), keep settings and files, and show a status in Settings.

A plugin runs inside the server process with the server's full rights. Install only plugins you trust. Nothing starts by itself: the owner turns a plugin on in Settings, Plugins.

## Where plugins live

- `plugins/` in the repository (the Docker image copies it to `/app/plugins`): plugins that ship with Chronicle. Override the place with `BUNDLED_PLUGINS`.
- `DATA_DIR/plugins/<folder>/`: your own plugins. Restart the server to find a new folder.

Which plugins are on, and their settings, are saved in `DATA_DIR/plugins-state.json`. Each plugin gets a private folder `DATA_DIR/plugin-data/<id>/` (`ctx.dataDir`). Neither is part of the database snapshots; the full download does not include them either.

## Files

`plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "description": "One or two sentences.",
  "main": "index.mjs",
  "config": [
    { "key": "url", "label": "Address", "type": "text", "default": "http://localhost:1234", "help": "Shown under the field." },
    { "key": "enabled", "label": "Do the thing", "type": "boolean", "default": true }
  ],
  "actions": [{ "label": "Run now", "route": "/run", "help": "Calls POST /api/plugins/my-plugin/run" }]
}
```

`id` is lowercase letters, digits and dashes. `config` field types are `text`, `number` and `boolean`; Settings draws the form. `actions` become buttons that POST to one of the plugin's own routes; the route may answer `{ "message": "..." }`.

The entry module (ESM) exports `activate(ctx)` and optionally `deactivate()`:

```js
export function activate(ctx) {
  ctx.on('upload:stored', async (u) => { /* ... */ })
  ctx.route('POST', '/run', async () => ({ message: 'Done.' }))
  ctx.setStatus('Ready.')
}
export function deactivate() {}
```

## The `ctx` object

| Member | What it does |
|---|---|
| `id`, `version`, `dir`, `dataDir` | Who it is, where its files are, and a folder only it writes to. |
| `log.info/warn/error(...)` | Writes to the server log, prefixed with the plugin id. |
| `config.get()` | The current settings (saved values over defaults). `config.onChange(fn)` runs after the owner saves. |
| `setStatus(text)` | Text under the plugin's name in Settings. |
| `on(hook, fn)` | Subscribe to a hook (below). Handlers may be async. |
| `emit('plugin:name', payload)` | Tell other plugins; they subscribe with `on('plugin:name', fn)`. |
| `reject(message)` | In an `upload:before` handler: refuses the upload with that message. |
| `route(method, path, [{access}], handler)` | Serves `/api/plugins/<id>/<path>`. `handler(req, reply)` is a Fastify handler; return a value to send it as JSON. `access` is `owner` (default), `editor`, `user` or `none` (no Chronicle login: the route must authenticate the caller itself, for example a webhook with a token). A route that takes a world id must check `ctx.worldRole(req.user, ws)` itself. Raw `image/*` and `application/octet-stream` bodies arrive as a Buffer. |
| `worldName(ws)`, `worldRole(user, ws)` | Look up a world. |
| `pages.list()`, `pages.setPortrait(pageId, url)` | Every page (`id, ws, title, type, portrait`), and set a page's portrait to an upload url. |
| `pages.imageSlots()`, `pages.setImage(pageId, key, url)` | Every image block of every page's special page type (built in or custom) with its value; fill one (`portrait` is the thumbnail, other keys live in the page data). |
| `pages.textImages()`, `pages.fillTextImage(pageId, hash, url, [oldUrl])` | Paragraphs that are only `[image: description]`, and replace one by the picture (or swap `oldUrl`). Open editors reload. |
| `maps.pins()`, `maps.create(ws, pageId, name, bytes)`, `maps.replace(mapId, bytes)`, `maps.exists(mapId)` | Pins that point at a page and open no map; make a tiled map from a picture and open it from those pins; re-tile a map from a new picture. |
| `table.scenes()`, `table.tokens()`, `table.handouts()`, `table.setSceneBackground`, `table.setTokenImages`, `table.setHandoutImage` | Tabletop picture slots and their setters; changes reach everyone at the table. |
| `uploads.add(ws, filename, bytes, [user])` | Store a picture like an upload from the app (quota, hooks); throws when it is not a picture or is refused. |
| `uploads.list()` | Every stored upload: `id, ws, filename, mime, size, file, url`. |
| `image.info(fileOrBuffer)` | `{ format, width, height }`, or null when it is not a picture. |

## Hooks

Every hook handler has 20 seconds. A handler that throws or times out never breaks the action: the error is logged, shown in Settings and, for uploads, returned to the browser as `warnings`. The one exception is `ctx.reject()` in `upload:before`.

| Hook | Payload | When |
|---|---|---|
| `upload:before` | `ws, user, filename, mime, size, file` | A file arrived and is not kept yet. |
| `upload:stored` | `ws, user, id, filename, mime, size, file, url` | A picture, sound or video was kept. |
| `upload:deleted` | `ws, id` | An upload was deleted from the asset library. |

All uploads of the app pass through the same code (page images, pasted or dropped images, page type pictures, tokens, handouts, map pictures, sounds), so a plugin sees all of them. Map files uploaded as a map itself (`POST /api/workspaces/:ws/maps`) are not uploads and do not trigger hooks.

More hooks are added by calling `runHook(name, payload)` from `server/src/plugins.ts` where the thing happens, and listing the name in `HOOK_NAMES` and `HookMap`.

## Core endpoints

- `GET /api/plugins` (owner): found plugins with state, settings and status.
- `PATCH /api/plugins/:id` (owner): `{ enabled?, config? }`. A plugin that fails to start stays off and the answer says why.
- `/api/plugins/:id/*`: the plugin's own routes. Answers 404 while the plugin is off.
- `POST /api/workspaces/:ws/images?name=<file name>` (editors): the raw bytes of one picture as the body (content type `image/*` or `application/octet-stream`; PNG, JPEG, WebP, GIF or AVIF, checked by content, up to 25 MB). Goes through quota and plugins like any upload and answers `{ id, url, mime, size, warnings? }`. It lets a script or another program add a picture without building a form.

## Image administration (bundled)

Works with the image administration program over HTTP only (see its `PLUGIN_INTEGRATION.md` and `CONTRACT.md`). The plugin never touches that program's files. The flow:

1. **Request.** The plugin scrapes Chronicle for empty picture slots; each becomes one sprite in `POST <address>/api/requests`. Each kind can be switched off in Settings:
   - **Page type pictures** (square 512 x 512, tall 3:4, wide 1024 x 448): every empty image block of a page's special page type, built in (person, monster, item, location: the portrait or banner) or custom (all its image blocks). Can be limited to some page types.
   - **Pictures in text**: a paragraph that is only `[image: what it shows]` (800 x 450). When the picture arrives the line is replaced by it; a later replacement swaps that picture.
   - **Detail maps** (4096 x 3072): a map pin that points at a page (default type `location`) but opens no map. The pushed picture becomes a tiled map, a child of the map holding the pin, and the pin opens it. A replacement re-tiles that map. The map keeps its own copy, so it is not in the asset library.
   - **Tokens** (square, 256): tokens without a picture, one request per token name; the picture goes to every token of that name in the world that has none.
   - **Handouts** (1024 x 768): handouts without a picture.
   - **Scene backgrounds**: scenes without a background, at the scene's own size.

   **Projects and folders in image administration.** Every world (adventure) is its own **project**, named after the world (`harbour-tale`; a number is added only if two worlds share a name) and created by the first request for it. Inside a project the folders follow the adventure, with no ids in the names: `pages/<folders of the adventure>/<page>/<picture>`. A page's pictures, its `[image: ...]` pictures and its detail map (`map`) share the page's folder. Tabletop things go to `tabletop/tokens|handouts/<name>` and `tabletop/scenes/<scene folder>/<scene>`. The real names of the folders ("NPCs", the page title) are sent as folder titles, so the admin shows them instead of the slugs. A number (`-2`) is added only when two things would share a path. A page keeps its folder if it is renamed or moved later. The target path is the id under the delivery folder (the admin serves it at `/files/<project>/<path>`).

   Every request has a description telling the person what to upload, an exact `spec` (width, height, format from the settings, default 512 x 512 png) so the admin's fit editor can scale and crop any upload to it, and a `target` whose extension is the format. Braces in titles are doubled so they are not read as placeholders. A page is requested once; a `422` answer changes nothing and its reasons are shown to the owner.
2. **Push.** The admin `POST`s every valid upload to `/api/plugins/image-administration/webhook` (raw bytes, headers `X-Sprite-Id`, `-Seq`, `-Format`, `-Sha256`, and `Authorization: Bearer <webhook token>`). The plugin checks the token (this route has no Chronicle login: `access: 'none'`) and the hash, stores the bytes like any upload and makes them the page's portrait. The same image again changes nothing; a different one replaces the portrait (the old file stays in the asset library). A wrong hash answers 502 so the admin retries; an image nobody requested answers 404 and a format Chronicle cannot keep (SVG) 415, which the admin drops.
3. **Catch up.** On start-up, after saving settings, every N minutes (default 5, 0 = off) and with the "Fetch new images" button the plugin calls `GET /api/events?since=<last seq>` and `GET /api/file?id=`, applies what a failed push missed and stores the highest `seq` of each project in `DATA_DIR/plugin-data/image-administration/state.json` along with what was requested. The timer also requests images for pages created since.

Set it up in Settings, Plugins: the admin address, the admin token (sent as `Authorization: Bearer` on every call), and a webhook token of your choosing. Start the admin (version with projects) with `--webhook <Chronicle address>/api/plugins/image-administration/webhook --webhook-token <the same token>`. Without a webhook token pushes are refused with 503 and pictures arrive by catch-up only. Never expose the admin server or its token to the public internet; the admin UI has no login. The webhook must be reachable from the admin server, so inside Docker use the host's address.

Buttons: "Request images now" (look at every page again) and "Fetch new images" (catch up now); "Forget all requests" starts over (the next request files every empty slot again under fresh names; delete the old sprites in image administration).

Notes: a page that gets a portrait some other way is simply not requested later; a request already sent is not withdrawn. Pushed pictures are applied live to everyone at the table. Requests made by earlier versions stay in the admin's `default` project and keep working; the slots they filled are not requested again, and slots they only requested are requested again in the world's own project. Not covered: the map viewer's own pictures other than detail maps, and pictures that are not in an empty slot.

Tests: `node scripts/smoke-plugins.mjs <url> gm <pass>` (starts its own fake image administration).
