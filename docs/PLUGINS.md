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
| `route(method, path, [{access}], handler)` | Serves `/api/plugins/<id>/<path>`. `handler(req, reply)` is a Fastify handler; return a value to send it as JSON. `access` is `owner` (default), `editor` or `user`. A route that takes a world id must check `ctx.worldRole(req.user, ws)` itself. |
| `worldName(ws)`, `worldRole(user, ws)` | Look up a world. |
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

Works with the image administration program (sprite-admin, "Sprite Contract" 1.0). With the plugin on, every picture stored anywhere in Chronicle:

1. becomes one sprite in `<contract folder>/<include folder>/chronicle-<world id>.json`, with the id `chronicle/<world>-<short id>/<name>-<short id>`, a description, `spec` (format and the picture's exact size, so a replacement fits) and a target under the delivery folder. The world's folder gets a title. Braces in names are escaped so they are not read as placeholders.
2. is sent to `POST <address>/api/upload?id=<sprite id>` (header `X-Sprite-Admin: 1`), so sprite-admin validates it and delivers it to the target path.

Set it up: start `sprite-admin serve` on the project, make sure the root contract includes the folder (for example `include: [contracts/*.json]`), then in Settings, Plugins set the contract folder and turn it on. Settings has two buttons: add the pictures uploaded before the plugin was on, and send waiting pictures again (after image administration was down or refused one).

Notes: Chronicle keeps its own copy of each picture, so pages, shares, exports and backups work without image administration. AVIF, sound and video are not entered (the contract has no such format). Deleting a picture in Chronicle removes its sprite from the contract and leaves delivered files alone. If image administration refuses a picture the upload still succeeds, the sprite stays in the contract as missing, and the reason shows in Settings.

Tests: `node scripts/smoke-plugins.mjs <url> gm <pass>` (starts its own fake image administration).
