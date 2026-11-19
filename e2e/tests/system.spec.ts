import { doc, expect, test } from '../fixtures'
import { ADMIN_PANEL, ADMIN_URL } from '../lib/env'
import { openPage } from '../lib/ui'

test('without a connection the cached world still opens', { tag: '@feature:offline' }, async ({ app, makePage }) => {
  await makePage('Cached page', { content: doc('Before.') })
  await app.reload()
  await openPage(app, 'Cached page')
  await expect(app.locator('.save-state')).toHaveText('Saved')
  await app.route('**/api/**', (route) => route.abort())
  await app.reload()
  await expect(app.getByRole('complementary').getByRole('button', { name: 'Cached page' })).toBeVisible({ timeout: 15_000 })
})

test('an old cached bootstrap without newer lists still loads', { tag: '@feature:offline.old-cache' }, async ({ app, world }) => {
  await app.evaluate(async (wsId) => {
    const open = indexedDB.open('keyval-store')
    await new Promise<void>((resolve) => {
      open.onupgradeneeded = () => open.result.createObjectStore('keyval')
      open.onsuccess = () => {
        const tx = open.result.transaction('keyval', 'readwrite')
        tx.objectStore('keyval').put({ pages: [], folders: [], links: [], zettels: [] }, `bootstrap:${wsId}`)
        tx.oncomplete = () => resolve()
      }
    })
  }, world.id)
  await app.reload()
  await expect(app.getByRole('button', { name: 'Toggle sidebar' })).toBeVisible()
  await expect(app.getByRole('heading', { level: 1 })).toBeVisible()
})

test('a server error shows a plain message', { tag: '@feature:errors' }, async ({ app }) => {
  await app.route('**/api/workspaces/*/folders', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Something broke' }) }))
  await app.getByRole('button', { name: 'New folder' }).click()
  await app.getByRole('dialog').getByRole('textbox').fill('Broken')
  await app.getByRole('dialog').locator('button[type=submit]').click()
  await expect(app.getByRole('dialog')).toContainText(/broke|could not|failed/i)
})

test('the admin dashboard lists people and worlds', { tag: '@feature:admin' }, async ({ page, world }) => {
  await page.goto(ADMIN_URL)
  await page.getByRole('textbox').first().fill(ADMIN_PANEL.username)
  await page.locator('input[type=password]').fill(ADMIN_PANEL.password)
  await page.getByRole('button', { name: /Sign in|Log in/ }).click()
  await expect(page.locator('body')).toContainText(world.name, { timeout: 15_000 })
  await expect(page.locator('body')).toContainText('e2e-editor')
})
