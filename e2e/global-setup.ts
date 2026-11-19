import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { request } from '@playwright/test'
import { ACCOUNTS, ADMIN_PANEL, ADMIN_PORT, E2E_DIR, FAKE_OPEN5E_PORT, AUTH_DIR, BASE_URL, EDITOR, OWNER, PORT, REPORT_DIR, ROOT, RUN_DIR, STATE_FILE, VIEWER, WEB_DIST, authFile } from './lib/env'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`)
}

async function waitForHealth() {
  const until = Date.now() + 30_000
  while (Date.now() < until) {
    try {
      const r = await fetch(`${BASE_URL}/api/health`)
      if (r.ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('The test server did not start. Check that the ports are free (E2E_PORT).')
}

export default async function globalSetup() {
  // E2E_SKIP_BUILD keeps the last web build, for quick reruns while writing tests
  const keepBuild = !!process.env.E2E_SKIP_BUILD && fs.existsSync(WEB_DIST)
  for (const name of fs.existsSync(RUN_DIR) ? fs.readdirSync(RUN_DIR) : []) {
    if (keepBuild && name === path.basename(WEB_DIST)) continue
    fs.rmSync(path.join(RUN_DIR, name), { recursive: true, force: true })
  }
  fs.rmSync(REPORT_DIR, { recursive: true, force: true })
  fs.mkdirSync(AUTH_DIR, { recursive: true })

  if (!process.env.E2E_SKIP_BUILD || !keepBuild) {
    run(npm, ['run', 'build', '-w', 'server'], ROOT)
    // Unminified build with source maps, so coverage maps back to web/src. The production build is untouched.
    run(npx, ['vite', 'build', '--outDir', WEB_DIST, '--emptyOutDir', '--sourcemap', '--minify', 'false'], path.join(ROOT, 'web'))
  }

  // Never touch the owner's real data: a fresh directory per run
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-e2e-'))
  const log = fs.openSync(path.join(RUN_DIR, 'server.log'), 'a')
  const fake = spawn(process.execPath, [path.join(E2E_DIR, 'fake-open5e.mjs'), String(FAKE_OPEN5E_PORT)], { stdio: 'ignore' })
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'dist', 'index.js')], {
    cwd: path.join(ROOT, 'server'),
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      WEB_DIST,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      ADMIN_PORT: String(ADMIN_PORT),
      ADMIN_HOST: '127.0.0.1',
      ADMIN_USER: OWNER.username,
      ADMIN_PASSWORD: OWNER.password,
      ADMIN_PANEL_USER: ADMIN_PANEL.username,
      ADMIN_PANEL_PASSWORD: ADMIN_PANEL.password,
      NODE_ENV: 'test',
      OPEN5E_API: `http://127.0.0.1:${FAKE_OPEN5E_PORT}/v2`,
    },
    stdio: ['ignore', log, log],
    detached: false,
  })
  fs.writeFileSync(STATE_FILE, JSON.stringify({ pid: child.pid, fakePid: fake.pid, dataDir }))
  await waitForHealth()

  // One login per role; every test reuses the saved session cookie
  const owner = await request.newContext({ baseURL: BASE_URL })
  const login = await owner.post('/api/auth/login', { data: OWNER })
  if (!login.ok()) throw new Error('Owner login failed')
  await owner.storageState({ path: authFile('owner') })
  for (const [role, acct] of [['editor', EDITOR], ['viewer', VIEWER]] as const) {
    const made = await owner.post('/api/users', { data: { ...acct, role } })
    if (!made.ok()) throw new Error(`Could not create the ${role} account`)
    const ctx = await request.newContext({ baseURL: BASE_URL })
    const r = await ctx.post('/api/auth/login', { data: ACCOUNTS[role] })
    if (!r.ok()) throw new Error(`${role} login failed`)
    await ctx.storageState({ path: authFile(role) })
    await ctx.dispose()
  }
  await owner.dispose()
}
