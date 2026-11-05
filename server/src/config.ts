import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(here, '..', '..', 'data')),
  webDist: path.resolve(process.env.WEB_DIST ?? path.join(here, '..', '..', 'web', 'dist')),
  adminUser: process.env.ADMIN_USER ?? 'gm',
  adminPassword: process.env.ADMIN_PASSWORD,
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  backupKeep: Number(process.env.BACKUP_KEEP ?? 14),
  isProd: process.env.NODE_ENV === 'production',
}
