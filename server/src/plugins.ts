import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import sharp from 'sharp'
import { z } from 'zod'
import { worldRole } from './access.js'
import { requireOwner, userFromRequest, type AuthUser } from './auth.js'
import { config } from './config.js'
import { db } from './db.js'
import { publishWorld } from './live.js'
import { mapSlots } from './routes/maps.js'
import { addPicture } from './routes/uploads.js'
import { replaceContent, type PageRow } from './pages.js'
import type { DocNode } from './doc.js'
import { tableSlots } from './table.js'

/**
 * Plugins are folders with a plugin.json and an entry module. Chronicle looks in the bundled `plugins/` folder and in
 * `DATA_DIR/plugins/`. A plugin is code that runs inside the server with its full rights, so one only starts when the
 * owner turns it on in Settings. docs/PLUGINS.md describes the contract.
 */

/** What the core tells plugins. A hook handler may be async; a failing one never breaks the action that caused it. */
export interface HookMap {
  /** A file has been received but is not kept yet. Call ctx.reject(message) to refuse it. */
  'upload:before': { ws: string; user: string; filename: string; mime: string; size: number; file: string }
  /** A picture, sound or video was stored in a world. */
  'upload:stored': { ws: string; user: string; id: string; filename: string; mime: string; size: number; file: string; url: string }
  'upload:deleted': { ws: string; id: string }
}
export type HookName = keyof HookMap

const HOOK_NAMES = new Set<string>(['upload:before', 'upload:stored', 'upload:deleted'])
const HOOK_TIMEOUT_MS = 20_000

// ---------- picture slots in pages ----------

interface ImageBlock { key: string; label: string; shape: string }
const SHAPES = new Set(['square', 'circle', 'wide', 'tall'])
/** The image blocks of the built-in page types (the layouts themselves live in the web app). */
const BUILTIN_IMAGES: Record<string, ImageBlock[]> = {
  person: [{ key: 'portrait', label: 'Portrait', shape: 'square' }],
  monster: [{ key: 'portrait', label: 'Portrait', shape: 'wide' }],
  item: [{ key: 'portrait', label: 'Portrait', shape: 'square' }],
  location: [{ key: 'portrait', label: 'Banner', shape: 'wide' }],
}
function imageBlocksOf(definition: any): ImageBlock[] {
  const out: ImageBlock[] = []
  for (const zone of ['top', 'side', 'main', 'bottom']) {
    for (const b of Array.isArray(definition?.[zone]) ? definition[zone] : []) {
      if (b?.type === 'image' && typeof b.key === 'string' && b.key) out.push({ key: b.key, label: typeof b.label === 'string' ? b.label : b.key, shape: SHAPES.has(b.shape) ? b.shape : 'square' })
    }
  }
  return out
}

const PLACEHOLDER = /^\[image:\s*(.+?)\s*\]$/i
const placeholderHash = (description: string) => crypto.createHash('sha1').update(description.toLowerCase()).digest('hex').slice(0, 6)
const plainText = (n: DocNode): string => (n.type === 'text' ? n.text ?? '' : (n.content ?? []).map(plainText).join(''))
/** Calls fn for every paragraph that is only `[image: description]`; fn may replace it and returns whether it did. */
function walkPlaceholders(node: DocNode, fn: (description: string, replace: (n: DocNode) => void) => boolean) {
  const kids = node.content
  if (!kids) return
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]
    const m = k.type === 'paragraph' ? PLACEHOLDER.exec(plainText(k).trim()) : null
    if (m) fn(m[1], (n) => { kids[i] = n })
    else walkPlaceholders(k, fn)
  }
}

/** Thrown through ctx.reject(): the action is refused with this message (only honoured by "before" hooks). */
export class PluginRejection extends Error {}

const fieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
  label: z.string().min(1).max(80),
  type: z.enum(['text', 'number', 'boolean']).default('text'),
  default: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
  help: z.string().max(400).optional(),
  placeholder: z.string().max(120).optional(),
})
const manifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
  name: z.string().min(1).max(80),
  version: z.string().min(1).max(20),
  description: z.string().max(500).default(''),
  main: z.string().min(1).max(200).default('index.mjs'),
  config: z.array(fieldSchema).max(30).default([]),
  /** Buttons in Settings that call one of the plugin's own routes (POST). */
  actions: z.array(z.object({ label: z.string().min(1).max(60), route: z.string().regex(/^\/[a-zA-Z0-9/_-]{1,80}$/), help: z.string().max(200).optional() })).max(8).default([]),
})
type Manifest = z.infer<typeof manifestSchema>
type Field = Manifest['config'][number]
type Value = string | number | boolean

/** `none`: no Chronicle login at all. The route must authenticate the caller itself (for example a webhook with a token). */
type Access = 'owner' | 'editor' | 'user' | 'none'
type RouteHandler = (req: FastifyRequest, reply: FastifyReply) => unknown
type Handler = (payload: any) => unknown

interface Loaded {
  manifest: Manifest
  dir: string
  bundled: boolean
  active: boolean
  error: string
  status: string
  handlers: Map<string, Handler[]>
  routes: Map<string, { access: Access; handler: RouteHandler }>
  listeners: ((cfg: Record<string, Value>) => void)[]
  deactivate?: () => unknown
}

const registry = new Map<string, Loaded>()
let logger: FastifyInstance['log'] | null = null

// ---------- saved state: which plugins run, and their settings ----------

interface State { enabled: string[]; config: Record<string, Record<string, Value>> }
const stateFile = () => path.join(config.dataDir, 'plugins-state.json')
function readState(): State {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    return { enabled: Array.isArray(s.enabled) ? s.enabled.filter((x: unknown) => typeof x === 'string') : [], config: s.config && typeof s.config === 'object' ? s.config : {} }
  } catch { return { enabled: [], config: {} } }
}
function writeState(s: State) {
  const tmp = stateFile() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2))
  fs.renameSync(tmp, stateFile())
}

function settingsOf(p: Loaded): Record<string, Value> {
  const saved = readState().config[p.manifest.id] ?? {}
  const out: Record<string, Value> = {}
  for (const f of p.manifest.config) {
    const v = saved[f.key]
    out[f.key] = coerce(f, v) ?? f.default ?? (f.type === 'boolean' ? false : f.type === 'number' ? 0 : '')
  }
  return out
}
function coerce(f: Field, v: unknown): Value | undefined {
  if (f.type === 'boolean') return typeof v === 'boolean' ? v : undefined
  if (f.type === 'number') return typeof v === 'number' && Number.isFinite(v) ? v : undefined
  return typeof v === 'string' ? v.slice(0, 500) : undefined
}

// ---------- discovery and activation ----------

function discover() {
  const roots: { dir: string; bundled: boolean }[] = [{ dir: config.bundledPluginsDir, bundled: true }, { dir: path.join(config.dataDir, 'plugins'), bundled: false }]
  for (const root of roots) {
    if (!fs.existsSync(root.dir)) continue
    for (const e of fs.readdirSync(root.dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const dir = path.join(root.dir, e.name)
      const file = path.join(dir, 'plugin.json')
      if (!fs.existsSync(file)) continue
      try {
        const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
        if (registry.has(manifest.id)) { logger?.warn(`plugin ${manifest.id} in ${dir} ignored: the id is already taken`); continue }
        registry.set(manifest.id, { manifest, dir, bundled: root.bundled, active: false, error: '', status: '', handlers: new Map(), routes: new Map(), listeners: [] })
      } catch (err) { logger?.warn(`plugin in ${dir} ignored: ${(err as Error).message.slice(0, 200)}`) }
    }
  }
}

function contextFor(p: Loaded) {
  const id = p.manifest.id
  const dataDir = path.join(config.dataDir, 'plugin-data', id)
  fs.mkdirSync(dataDir, { recursive: true })
  const log = (level: 'info' | 'warn' | 'error') => (...args: unknown[]) => logger?.[level](`[plugin ${id}] ${args.map(String).join(' ')}`)
  return {
    id,
    version: p.manifest.version,
    dir: p.dir,
    /** A folder only this plugin writes to; it survives updates. */
    dataDir,
    log: { info: log('info'), warn: log('warn'), error: log('error') },
    config: {
      get: () => settingsOf(p),
      onChange: (fn: (cfg: Record<string, Value>) => void) => { p.listeners.push(fn) },
    },
    /** Shown under the plugin's name in Settings. */
    setStatus: (text: string) => { p.status = String(text).slice(0, 300) },
    on: (name: string, fn: Handler) => {
      if (!HOOK_NAMES.has(name) && !name.startsWith('plugin:')) throw new Error(`Unknown hook "${name}"`)
      p.handlers.set(name, [...(p.handlers.get(name) ?? []), fn])
    },
    /** Tell other plugins something. The name must start with "plugin:". */
    emit: (name: string, payload: unknown) => {
      if (!name.startsWith('plugin:')) throw new Error('Custom events start with "plugin:"')
      return runHook(name, payload)
    },
    reject: (message: string): never => { throw new PluginRejection(message) },
    /** An address under /api/plugins/<id>/. Owner only unless said otherwise; a plugin that takes a world id must check worldRole itself. */
    route: (method: string, route: string, optionsOrHandler: { access?: Access } | RouteHandler, maybeHandler?: RouteHandler) => {
      const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler
      if (!handler) throw new Error('route needs a handler')
      const access = typeof optionsOrHandler === 'function' ? 'owner' : optionsOrHandler.access ?? 'owner'
      p.routes.set(`${method.toUpperCase()} /${route.replace(/^\/+/, '')}`, { access, handler })
    },
    worldName: (ws: string) => (db.prepare('SELECT name FROM workspaces WHERE id = ?').get(ws) as { name: string } | undefined)?.name ?? null,
    worldRole: (user: AuthUser, ws: string) => worldRole(user, ws),
    pages: {
      /** Every page that is not deleted, with its special page type id and whether a portrait is set. */
      list: () => (db.prepare('SELECT p.id, p.workspace_id AS ws, p.title, p.props FROM pages p JOIN workspaces w ON w.id = p.workspace_id WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL ORDER BY p.created_at').all() as { id: string; ws: string; title: string; props: string }[])
        .map((r) => {
          let props: { type?: unknown; portrait?: unknown } = {}
          try { props = JSON.parse(r.props) } catch { /* damaged props count as empty */ }
          return { id: r.id, ws: r.ws, title: r.title, type: typeof props.type === 'string' ? props.type : '', portrait: typeof props.portrait === 'string' ? props.portrait : '' }
        }),
      /** Sets the portrait of a page to an upload url. Returns false when the page is gone. Open clients refresh. */
      setPortrait: (pageId: string, url: string) => {
        const row = db.prepare('SELECT workspace_id AS ws, props FROM pages WHERE id = ? AND deleted_at IS NULL').get(pageId) as { ws: string; props: string } | undefined
        if (!row) return false
        const props = JSON.parse(row.props || '{}')
        props.portrait = url
        db.prepare('UPDATE pages SET props = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(props), Date.now(), pageId)
        publishWorld(row.ws, { k: 'refresh', area: 'pages', pageId })
        return true
      },
      /**
       * Every picture slot of a page's special page type (image blocks of the layout), built in or custom, with its
       * current value. `key` portrait is the page thumbnail, any other key lives in the page's data.
       */
      imageSlots: () => {
        const custom = new Map<string, ImageBlock[]>()
        for (const t of db.prepare('SELECT id, definition FROM page_types').all() as { id: string; definition: string }[]) {
          try { custom.set(t.id, imageBlocksOf(JSON.parse(t.definition))) } catch { /* a damaged type has no slots */ }
        }
        const out: { page: string; ws: string; title: string; type: string; key: string; label: string; shape: string; value: string }[] = []
        for (const r of db.prepare('SELECT p.id, p.workspace_id AS ws, p.title, p.props FROM pages p JOIN workspaces w ON w.id = p.workspace_id WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL ORDER BY p.created_at').all() as { id: string; ws: string; title: string; props: string }[]) {
          let props: { type?: unknown; portrait?: unknown; data?: Record<string, unknown> } = {}
          try { props = JSON.parse(r.props) } catch { continue }
          const type = typeof props.type === 'string' ? props.type : ''
          for (const b of custom.get(type) ?? BUILTIN_IMAGES[type] ?? []) {
            const v = b.key === 'portrait' ? props.portrait : props.data?.[b.key]
            out.push({ page: r.id, ws: r.ws, title: r.title, type, key: b.key, label: b.label, shape: b.shape, value: typeof v === 'string' ? v : '' })
          }
        }
        return out
      },
      /** Puts a picture into one image block of a page. Returns false when the page is gone. */
      setImage: (pageId: string, key: string, url: string) => {
        const row = db.prepare('SELECT workspace_id AS ws, props FROM pages WHERE id = ? AND deleted_at IS NULL').get(pageId) as { ws: string; props: string } | undefined
        if (!row) return false
        const props = JSON.parse(row.props || '{}')
        if (key === 'portrait') props.portrait = url
        else props.data = { ...(props.data ?? {}), [key]: url }
        db.prepare('UPDATE pages SET props = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(props), Date.now(), pageId)
        publishWorld(row.ws, { k: 'refresh', area: 'pages', pageId })
        return true
      },
      /** Paragraphs in page text that consist of just `[image: what it shows]`: a picture the writer wants here. */
      textImages: () => {
        const out: { page: string; ws: string; title: string; description: string; hash: string }[] = []
        for (const r of db.prepare("SELECT p.id, p.workspace_id AS ws, p.title, p.content FROM pages p JOIN workspaces w ON w.id = p.workspace_id WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL AND p.text LIKE '%[image:%'").all() as { id: string; ws: string; title: string; content: string }[]) {
          try { walkPlaceholders(JSON.parse(r.content), (d) => { out.push({ page: r.id, ws: r.ws, title: r.title, description: d, hash: placeholderHash(d) }); return false }) } catch { /* damaged content */ }
        }
        return out
      },
      /** Replaces the `[image: ...]` paragraph with that hash by the picture. Open editors reload. Returns false when it is gone. */
      fillTextImage: (pageId: string, hash: string, url: string, oldUrl = '') => {
        const page = db.prepare('SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL').get(pageId) as PageRow | undefined
        if (!page) return false
        const doc = JSON.parse(page.content) as DocNode
        let done = false
        walkPlaceholders(doc, (d, replace) => {
          if (done || placeholderHash(d) !== hash) return false
          replace({ type: 'image', attrs: { src: url, alt: d } })
          done = true
          return true
        })
        // no placeholder left: this is a replacement, so swap the picture that stands there
        const swap = (n: DocNode) => {
          if (n.type === 'image' && oldUrl && n.attrs?.src === oldUrl) { n.attrs = { ...n.attrs, src: url }; done = true }
          for (const k of n.content ?? []) swap(k)
        }
        if (!done) swap(doc)
        if (!done) return false
        replaceContent(page, doc, null)
        publishWorld(page.workspace_id, { k: 'refresh', area: 'pages', pageId })
        return true
      },
    },
    /** Detail maps: pins that point at a page but have no map behind them, and making or replacing that map from a picture. */
    maps: {
      pins: () => mapSlots.pins(),
      exists: (mapId: string) => mapSlots.exists(mapId),
      create: (ws: string, pageId: string, name: string, bytes: Buffer) => mapSlots.create(ws, pageId, name, bytes),
      replace: (mapId: string, bytes: Buffer) => mapSlots.replace(mapId, bytes),
    },
    /** Pictures of the tabletop. Lists show what is set; the setters announce the change to everyone at the table. */
    table: {
      scenes: () => tableSlots.scenes(),
      tokens: () => tableSlots.tokens(),
      handouts: () => tableSlots.handouts(),
      setSceneBackground: (id: string, url: string) => tableSlots.setSceneBackground(id, url),
      /** Every token of that name in the world without a picture gets it; returns how many. */
      setTokenImages: (ws: string, name: string, url: string) => tableSlots.setTokenImages(ws, name, url),
      setHandoutImage: (id: string, url: string) => tableSlots.setHandoutImage(id, url),
    },
    uploads: {
      /** Stores a picture like an upload from the app (quota, hooks). Throws when it is not a picture or is refused. */
      add: (ws: string, filename: string, bytes: Buffer, user = 'plugin') => addPicture(ws, user, filename, bytes),
      list: () => (db.prepare('SELECT id, workspace_id AS ws, filename, mime, size FROM uploads ORDER BY created_at').all() as { id: string; ws: string; filename: string; mime: string; size: number }[])
        .map((r) => ({ ...r, file: uploadFile(r.id, r.mime), url: `/api/uploads/${r.id}` })),
    },
    image: {
      /** Format and pixel size of a file or buffer, or null when it is not a picture. */
      info: async (src: string | Buffer) => {
        try { const m = await sharp(src).metadata(); return m.format && m.width && m.height ? { format: m.format, width: m.width, height: m.height } : null } catch { return null }
      },
    },
  }
}

function uploadFile(id: string, mime: string) {
  const ext = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' } as Record<string, string>)[mime] ?? ''
  return path.join(config.dataDir, 'uploads', id + ext)
}

async function activate(p: Loaded) {
  const main = path.resolve(p.dir, p.manifest.main)
  if (!main.startsWith(path.resolve(p.dir) + path.sep) || !fs.existsSync(main)) throw new Error(`The entry file ${p.manifest.main} was not found inside the plugin folder`)
  p.handlers = new Map(); p.routes = new Map(); p.listeners = []; p.status = ''
  const mod = await import(pathToFileURL(main).href + `?v=${Date.now()}`)
  if (typeof mod.activate !== 'function') throw new Error('The entry file must export an activate(ctx) function')
  p.active = true
  try {
    await mod.activate(contextFor(p))
  } catch (err) {
    p.active = false; p.handlers = new Map(); p.routes = new Map()
    throw err
  }
  p.deactivate = typeof mod.deactivate === 'function' ? mod.deactivate : undefined
  p.error = ''
}

async function deactivate(p: Loaded) {
  p.active = false
  try { await p.deactivate?.() } catch (err) { logger?.warn(`plugin ${p.manifest.id} failed to stop: ${(err as Error).message}`) }
  p.deactivate = undefined; p.handlers = new Map(); p.routes = new Map(); p.listeners = []; p.status = ''
}

/** Finds the plugins and starts the ones the owner turned on. A plugin that fails to start stays off and says why in Settings. */
export async function startPlugins(app: FastifyInstance) {
  logger = app.log
  discover()
  for (const id of readState().enabled) {
    const p = registry.get(id)
    if (!p) continue
    try { await activate(p) } catch (err) { p.error = (err as Error).message; app.log.error(`plugin ${id} failed to start: ${p.error}`) }
  }
}

export async function stopPlugins() {
  for (const p of registry.values()) if (p.active) await deactivate(p)
}

// ---------- hooks ----------

/**
 * Calls every handler of a hook, one plugin after the other, each with a time limit. A handler error is remembered for
 * Settings and returned, except a ctx.reject(): that is rethrown so a "before" hook can stop the action.
 */
export async function runHook<K extends HookName>(name: K, payload: HookMap[K]): Promise<{ plugin: string; error: string }[]>
export async function runHook(name: string, payload: unknown): Promise<{ plugin: string; error: string }[]>
export async function runHook(name: string, payload: unknown) {
  const failures: { plugin: string; error: string }[] = []
  for (const p of registry.values()) {
    if (!p.active) continue
    for (const fn of p.handlers.get(name) ?? []) {
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([
          Promise.resolve(fn(payload)),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('took longer than 20 seconds')), HOOK_TIMEOUT_MS) }),
        ])
      } catch (err) {
        if (err instanceof PluginRejection) throw err
        const msg = (err as Error).message ?? String(err)
        p.error = msg
        logger?.warn(`plugin ${p.manifest.id}, ${name}: ${msg}`)
        failures.push({ plugin: p.manifest.id, error: msg })
      } finally { clearTimeout(timer) }
    }
  }
  return failures
}

// ---------- routes ----------

function describe(p: Loaded) {
  const values = settingsOf(p)
  return {
    id: p.manifest.id, name: p.manifest.name, version: p.manifest.version, description: p.manifest.description, bundled: p.bundled,
    enabled: readState().enabled.includes(p.manifest.id), active: p.active, error: p.error, status: p.status,
    config: p.manifest.config.map((f) => ({ ...f, value: values[f.key] })),
    actions: p.manifest.actions,
  }
}

export async function pluginRoutes(app: FastifyInstance) {
  // a plugin route may receive raw bytes (a webhook that pushes a picture); they arrive as a Buffer
  app.addContentTypeParser(/^(image\/[a-z0-9.+-]+|application\/octet-stream)$/, { parseAs: 'buffer', bodyLimit: 50 * 1024 * 1024 }, (_req, body, done) => done(null, body))
  app.get('/api/plugins', { preHandler: requireOwner }, async () => [...registry.values()].map(describe))

  app.patch('/api/plugins/:id', { preHandler: requireOwner }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const p = registry.get(id)
    if (!p) return reply.code(404).send({ error: 'not found' })
    const b = z.object({ enabled: z.boolean().optional(), config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'bad request' })
    const state = readState()
    if (b.data.config) {
      const next: Record<string, Value> = {}
      for (const [k, v] of Object.entries(b.data.config)) {
        const f = p.manifest.config.find((x) => x.key === k)
        const ok = f ? coerce(f, v) : undefined
        if (!f || ok === undefined) return reply.code(400).send({ error: `The setting "${k}" is not valid for this plugin` })
        next[k] = ok
      }
      state.config[id] = { ...state.config[id], ...next }
      writeState(state)
      if (p.active) for (const fn of p.listeners) { try { fn(settingsOf(p)) } catch (err) { p.error = (err as Error).message } }
    }
    if (b.data.enabled !== undefined) {
      const on = state.enabled.includes(id)
      if (b.data.enabled && !p.active) {
        try { await activate(p) } catch (err) {
          p.error = (err as Error).message
          return reply.code(422).send({ error: `${p.manifest.name} could not start: ${p.error}` })
        }
      }
      if (!b.data.enabled && p.active) await deactivate(p)
      if (b.data.enabled !== on) {
        const fresh = readState()
        fresh.enabled = b.data.enabled ? [...new Set([...fresh.enabled, id])] : fresh.enabled.filter((x) => x !== id)
        writeState(fresh)
      }
    }
    return describe(p)
  })

  // everything a plugin registered with ctx.route lives under here
  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/api/plugins/:id/*',
    bodyLimit: 50 * 1024 * 1024,
    handler: async (req, reply) => {
      const { id, '*': rest } = req.params as { id: string; '*': string }
      const p = registry.get(id)
      const route = p?.active ? p.routes.get(`${req.method} /${rest}`) : undefined
      if (!route) return reply.code(404).send({ error: 'not found' })
      if (route.access !== 'none') {
        const user = userFromRequest(req)
        if (!user) return reply.code(401).send({ error: 'unauthorized' })
        req.user = user
        if (route.access === 'owner' && user.role !== 'owner') return reply.code(403).send({ error: 'owner only' })
        if (route.access === 'editor' && user.role === 'viewer') return reply.code(403).send({ error: 'read-only account' })
      }
      try { return await route.handler(req, reply) } catch (err) {
        logger?.warn(`plugin ${id}, ${req.method} /${rest}: ${(err as Error).message}`)
        p!.error = (err as Error).message
        return reply.code(500).send({ error: (err as Error).message })
      }
    },
  })
}
