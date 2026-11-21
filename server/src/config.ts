import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  /** How much one world may keep in uploads, in megabytes. */
  uploadQuotaMb: Math.max(10, Number(process.env.UPLOAD_QUOTA_MB ?? 1024) || 1024),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(here, '..', '..', 'data')),
  webDist: path.resolve(process.env.WEB_DIST ?? path.join(here, '..', '..', 'web', 'dist')),
  adminUser: process.env.ADMIN_USER ?? 'gm',
  adminPassword: process.env.ADMIN_PASSWORD,
  /** Port of the admin dashboard (people and world access). 0 turns it off. */
  adminPort: Number(process.env.ADMIN_PORT ?? 3001),
  adminHost: process.env.ADMIN_HOST ?? '127.0.0.1',
  /** Creates the dashboard's admin account on first start, like ADMIN_PASSWORD does for the owner. */
  adminPanelUser: process.env.ADMIN_PANEL_USER ?? 'admin',
  adminPanelPassword: process.env.ADMIN_PANEL_PASSWORD,
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  backupKeep: Number(process.env.BACKUP_KEEP ?? 14),
  isProd: process.env.NODE_ENV === 'production',
}
