import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'
import { requireOwner } from './auth.js'
import { config } from './config.js'
import { db, migrate, SCHEMA_VERSION, schemaVersionOf } from './db.js'
import { zipStream, type ZipEntry } from './zip.js'

const dir = () => path.join(config.dataDir, 'backups')
const NAME = /^[\w.-]+\.db$/
// Accounts and logins belong to the installation, not to the content, so a restore leaves them alone.
const KEEP_TABLES = new Set(['users', 'sessions', 'meta'])
const KEEP_PRE_RESTORE = 5

export async function runBackup(prefix = 'dnd'): Promise<string> {
  fs.mkdirSync(dir(), { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(dir(), `${prefix}-${stamp}.db`)
  await db.backup(file)
  const keep = prefix === 'dnd' ? config.backupKeep : KEEP_PRE_RESTORE
  const all = fs.readdirSync(dir()).filter((f) => f.startsWith(prefix + '-') && f.endsWith('.db')).sort()
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.unlinkSync(path.join(dir(), old))
  return path.basename(file)
}

export function scheduleBackups() {
  const DAY = 24 * 3600_000
  const tick = () => runBackup().then((n) => console.log('Backup written:', n)).catch((e) => console.error('Backup failed:', e))
  setTimeout(tick, 30_000)
  setInterval(tick, DAY)
}

export interface BackupInfo { name: string; size: number; createdAt: number; kind: 'daily' | 'pre-restore' | 'other' }

function listBackups(): BackupInfo[] {
  if (!fs.existsSync(dir())) return []
  return fs.readdirSync(dir()).filter((f) => NAME.test(f)).map((name) => {
    const st = fs.statSync(path.join(dir(), name))
    return { name, size: st.size, createdAt: st.mtimeMs, kind: (name.startsWith('dnd-') ? 'daily' : name.startsWith('pre-restore-') ? 'pre-restore' : 'other') as BackupInfo['kind'] }
  }).sort((a, b) => b.createdAt - a.createdAt)
}

/** Replaces all content (worlds, pages, maps, ...) with the content of a backup file, in one transaction. Users and logins stay. */
export function restoreFrom(file: string) {
  const tmp = path.join(config.dataDir, 'restore-tmp.db')
  fs.copyFileSync(file, tmp)
  try {
    const copy = new Database(tmp)
    try {
      if (!copy.prepare("SELECT 1 FROM sqlite_master WHERE name='pages'").get()) throw new Error('This file is not a Chronicle backup')
      if (schemaVersionOf(copy) > SCHEMA_VERSION) throw new Error('This backup was made by a newer version of Chronicle')
      migrate(copy)
      copy.pragma('journal_mode = DELETE')
    } finally { copy.close() }

    db.pragma('foreign_keys = OFF')
    db.prepare('ATTACH DATABASE ? AS bk').run(tmp)
    try {
      const tables = (schema: string) => (db.prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((r) => r.name)
      const have = new Set(tables('bk'))
      const restored: Record<string, number> = {}
      db.transaction(() => {
        for (const t of tables('main')) {
          if (KEEP_TABLES.has(t)) continue
          db.exec(`DELETE FROM main."${t}"`)
          if (!have.has(t)) continue
          const cols = (schema: string) => (db.prepare(`PRAGMA ${schema}.table_info("${t}")`).all() as { name: string }[]).map((c) => c.name)
          const shared = cols('main').filter((c) => cols('bk').includes(c)).map((c) => `"${c}"`).join(',')
          restored[t] = db.prepare(`INSERT INTO main."${t}"(${shared}) SELECT ${shared} FROM bk."${t}"`).run().changes
        }
        const bad = db.pragma('foreign_key_check') as unknown[]
        if (bad.length) throw new Error('The backup is inconsistent and was not restored')
      })()
      return restored
    } finally {
      db.exec('DETACH DATABASE bk')
      db.pragma('foreign_keys = ON')
    }
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

function* fullArchive(snapshot: string): Generator<ZipEntry> {
  yield { name: 'dnd.db', data: { file: snapshot } }
  const up = path.join(config.dataDir, 'uploads')
  if (fs.existsSync(up)) for (const f of fs.readdirSync(up)) yield { name: `uploads/${f}`, data: { file: path.join(up, f) }, store: true }
  const maps = path.join(config.dataDir, 'maps')
  if (fs.existsSync(maps)) {
    for (const id of fs.readdirSync(maps)) {
      const d = path.join(maps, id)
      for (const f of fs.readdirSync(d)) if (f.startsWith('source.')) yield { name: `maps/${id}/${f}`, data: { file: path.join(d, f) }, store: true }
    }
  }
  yield { name: 'README.txt', data: Buffer.from('Chronicle full backup.\nTo restore on a fresh install: stop the server, put dnd.db, uploads/ and maps/ into the data directory, start it again.\nMap tiles are rebuilt from the source images on start.\n') }
}

export async function backupRoutes(app: FastifyInstance) {
  app.get('/api/backups', { preHandler: requireOwner }, async () => listBackups().map((b) => b.name))
  app.get('/api/backups/info', { preHandler: requireOwner }, async () => listBackups())
  app.post('/api/backups', { preHandler: requireOwner }, async () => ({ name: await runBackup() }))

  app.get('/api/backups/:name/download', { preHandler: requireOwner }, async (req, reply) => {
    const { name } = req.params as { name: string }
    const file = path.join(dir(), name)
    if (!NAME.test(name) || !fs.existsSync(file)) return reply.code(404).send({ error: 'not found' })
    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .send(fs.createReadStream(file))
  })

  app.delete('/api/backups/:name', { preHandler: requireOwner }, async (req, reply) => {
    const { name } = req.params as { name: string }
    const file = path.join(dir(), name)
    if (!NAME.test(name) || !fs.existsSync(file)) return reply.code(404).send({ error: 'not found' })
    fs.unlinkSync(file)
    return { ok: true }
  })

  app.post('/api/backups/:name/restore', { preHandler: requireOwner }, async (req, reply) => {
    const { name } = req.params as { name: string }
    const file = path.join(dir(), name)
    if (!NAME.test(name) || !fs.existsSync(file)) return reply.code(404).send({ error: 'not found' })
    const safety = await runBackup('pre-restore')
    try {
      const restored = restoreFrom(file)
      return { ok: true, safety, restored }
    } catch (e: any) {
      return reply.code(400).send({ error: e.message ?? 'Restore failed', safety })
    }
  })

  /** Everything needed to move to another machine: database snapshot, uploads and map sources. */
  app.get('/api/export/full', { preHandler: requireOwner }, async (req, reply) => {
    fs.mkdirSync(dir(), { recursive: true })
    const snapshot = path.join(config.dataDir, `export-${Date.now()}.db`)
    await db.backup(snapshot)
    const stream = zipStream(fullArchive(snapshot))
    const cleanup = () => fs.rm(snapshot, { force: true }, () => {})
    stream.on('close', cleanup)
    stream.on('error', cleanup)
    const stamp = new Date().toISOString().slice(0, 10)
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="chronicle-full-${stamp}.zip"`)
      .send(stream)
  })
}
