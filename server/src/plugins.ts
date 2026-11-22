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

type Access = 'owner' | 'editor' | 'user'
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
    uploads: {
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
      const user = userFromRequest(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      req.user = user
      if (route.access === 'owner' && user.role !== 'owner') return reply.code(403).send({ error: 'owner only' })
      if (route.access === 'editor' && user.role === 'viewer') return reply.code(403).send({ error: 'read-only account' })
      try { return await route.handler(req, reply) } catch (err) {
        logger?.warn(`plugin ${id}, ${req.method} /${rest}: ${(err as Error).message}`)
        p!.error = (err as Error).message
        return reply.code(500).send({ error: (err as Error).message })
      }
    },
  })
}
