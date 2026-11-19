import { test as base, expect, request, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { addCoverageReport } from 'monocart-reporter'
import { ACCOUNTS, ADMIN_PANEL, ADMIN_URL, BASE_URL, authFile, type Role } from '../lib/env'

export type Api = APIRequestContext & {
  json: <T = any>(method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, data?: unknown) => Promise<T>
}

async function makeApi(storageState: string, baseURL = BASE_URL): Promise<Api> {
  const ctx = (await request.newContext({ baseURL, storageState })) as Api
  ctx.json = async (method, url, data) => {
    const r = await ctx[method](url, data === undefined ? {} : { data })
    if (!r.ok()) throw new Error(`${method.toUpperCase()} ${url} failed with ${r.status()}: ${await r.text()}`)
    const text = await r.text()
    return (text ? JSON.parse(text) : null) as never
  }
  return ctx
}

let counter = 0
export const unique = (label: string) => `${label} ${process.pid}-${Date.now().toString(36)}-${counter++}`

export const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })),
})

type Fixtures = {
  /** Collects V8 coverage from every page of the test and hands it to the report. */
  coverage: void
  /** Owner API client with a saved session. */
  api: Api
  /** A world made through the API; the owner's page opens it. */
  world: { id: string; name: string }
  /** Page, API client and world for one role. */
  as: (role: Role | 'anonymous', worldId?: string) => Promise<{ page: Page; context: BrowserContext; api: Api }>
  /** Pages already loaded as the owner inside `world`. */
  app: Page
  /** Make a page through the API. */
  makePage: (title: string, opts?: { content?: unknown; props?: unknown; tags?: string[]; folderId?: string | null }) => Promise<{ id: string; title: string }>
}

function track(context: BrowserContext, pages: Set<Page>) {
  const add = async (p: Page) => {
    pages.add(p)
    try { await p.coverage.startJSCoverage({ resetOnNavigation: false }) } catch { /* page closed already */ }
  }
  for (const p of context.pages()) void add(p)
  context.on('page', (p) => void add(p))
}

export const test = base.extend<Fixtures>({
  coverage: [async ({ context, browserName }, use, testInfo) => {
    const pages = new Set<Page>()
    if (browserName === 'chromium') track(context, pages)
    await use()
    if (browserName !== 'chromium') return
    const list = []
    for (const p of pages) {
      try { list.push(...(await p.coverage.stopJSCoverage())) } catch { /* page was closed by the test */ }
    }
    if (list.length) await addCoverageReport(list, testInfo)
  }, { scope: 'test', auto: true }],

  api: async ({}, use) => {
    const api = await makeApi(authFile('owner'))
    await use(api)
    await api.dispose()
  },

  world: async ({ api }, use) => {
    const name = unique('World')
    const w = await api.json<{ id: string }>('post', '/api/workspaces', { name })
    await use({ id: w.id, name })
  },

  makePage: async ({ api, world }, use) => {
    await use((title, opts = {}) => api.json('post', `/api/workspaces/${world.id}/pages`, { title, ...opts }))
  },

  app: async ({ page, world }, use) => {
    await page.addInitScript((id) => { try { localStorage.setItem('workspace', id) } catch { /* ignore */ } }, world.id)
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Toggle sidebar' })).toBeVisible()
    // the world is loaded once Home shows its counts; a click before that is undone by the load
    await expect(page.getByText(/unprocessed zettels/)).toBeVisible()
    await use(page)
  },

  as: async ({ browser }, use, testInfo) => {
    const made: { context: BrowserContext; api: Api }[] = []
    const allPages: Set<Page>[] = []
    await use(async (role, worldId) => {
      const context = await browser.newContext({ baseURL: BASE_URL, storageState: role === 'anonymous' ? { cookies: [], origins: [] } : authFile(role) })
      const pages = new Set<Page>()
      if (browser.browserType().name() === 'chromium') track(context, pages)
      const page = await context.newPage()
      if (worldId) await context.addInitScript((id) => { try { localStorage.setItem('workspace', id) } catch { /* ignore */ } }, worldId)
      const api = await makeApi(authFile(role === 'anonymous' ? 'owner' : role))
      made.push({ context, api })
      allPages.push(pages)
      return { page, context, api }
    })
    for (const pages of allPages) {
      const list = []
      for (const p of pages) { try { list.push(...(await p.coverage.stopJSCoverage())) } catch { /* closed */ } }
      if (list.length) await addCoverageReport(list, testInfo)
    }
    for (const { context, api } of made) {
      await api.dispose()
      await context.close()
    }
  },
})

/** Give an account access to a world (new accounts get every world that exists when they are made, later worlds need this). */
export async function grantAccess(worldId: string, role: Exclude<Role, 'owner'>) {
  const owner = await makeApi(authFile('owner'))
  const { username } = ACCOUNTS[role]
  const users = await owner.json<{ id: string; username: string }[]>('get', '/api/users')
  const user = users.find((u) => u.username === username)
  if (!user) throw new Error(`No ${role} account`)
  const panel = await request.newContext({ baseURL: ADMIN_URL })
  const login = await panel.post('/api/login', { data: ADMIN_PANEL })
  if (!login.ok()) throw new Error('Admin dashboard login failed')
  const r = await panel.put(`/api/worlds/${worldId}/members/${user.id}`, { data: { role } })
  if (!r.ok()) throw new Error(`Granting access failed: ${await r.text()}`)
  await panel.dispose()
  await owner.dispose()
}

export { expect }
