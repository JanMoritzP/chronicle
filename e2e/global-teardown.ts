import fs from 'node:fs'
import { STATE_FILE } from './lib/env'

export default async function globalTeardown() {
  let state: { pid?: number; fakePid?: number; dataDir?: string } = {}
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return }
  for (const pid of [state.pid, state.fakePid]) {
    if (pid) { try { process.kill(pid) } catch { /* already gone */ } }
  }
  // SQLite keeps files open for a moment on Windows
  await new Promise((r) => setTimeout(r, 500))
  if (state.dataDir) fs.rmSync(state.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
