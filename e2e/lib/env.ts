import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const E2E_DIR = path.resolve(here, '..')
export const ROOT = path.resolve(E2E_DIR, '..')
export const RUN_DIR = path.join(E2E_DIR, '.run')
export const REPORT_DIR = path.join(E2E_DIR, 'report')
export const WEB_DIST = path.join(RUN_DIR, 'web-dist')
export const AUTH_DIR = path.join(RUN_DIR, 'auth')
export const STATE_FILE = path.join(RUN_DIR, 'state.json')

export const PORT = Number(process.env.E2E_PORT ?? 3232)
export const ADMIN_PORT = PORT + 1
export const FAKE_OPEN5E_PORT = PORT + 2
export const BASE_URL = `http://127.0.0.1:${PORT}`
export const ADMIN_URL = `http://127.0.0.1:${ADMIN_PORT}`

/** Throwaway accounts that exist only in the temporary data directory. */
export const OWNER = { username: 'gm', password: 'e2e-owner-pass' }
export const ADMIN_PANEL = { username: 'admin', password: 'e2e-admin-pass' }
export const EDITOR = { username: 'e2e-editor', password: 'e2e-editor-pass' }
export const VIEWER = { username: 'e2e-viewer', password: 'e2e-viewer-pass' }

export type Role = 'owner' | 'editor' | 'viewer'
export const ACCOUNTS = { owner: OWNER, editor: EDITOR, viewer: VIEWER } as const
export const authFile = (role: Role) => path.join(AUTH_DIR, `${role}.json`)

/** Coverage gate in percent. Lines and statements must reach it; functions and branches are reported only. */
export const COVERAGE_THRESHOLD = Number(process.env.E2E_COVERAGE_THRESHOLD ?? 70)
