import { doc, expect, test } from '../fixtures'
import { menuItem, openPage, openView } from '../lib/ui'

test('share a page with a public link and open it signed out', { tag: '@feature:share' }, async ({ app, as, makePage }) => {
  await makePage('Handout', { content: doc('Beware the old well.') })
  await app.reload()
  await openPage(app, 'Handout')
  await menuItem(app, 'Share publicly…')
  await app.getByRole('button', { name: 'Create public link' }).click()
  const link = app.locator('input[readonly]').first()
  await expect(link).toBeVisible()
  const url = await link.inputValue()
  expect(url).toContain('/s/')
  const { page } = await as('anonymous')
  await page.goto(new URL(url).pathname)
  await expect(page.getByText('Beware the old well.')).toBeVisible()
  await expect(page.getByRole('complementary')).toHaveCount(0)
})

test('stop sharing makes the link stop working', { tag: '@feature:share' }, async ({ app, as, api, makePage }) => {
  const p = await makePage('Temporary handout', { content: doc('Short lived secret.') })
  const { token } = await api.json<{ token: string }>('post', `/api/pages/${p.id}/share`)
  await app.reload()
  await openPage(app, 'Temporary handout')
  await menuItem(app, 'Share publicly…')
  await app.getByRole('button', { name: /Stop sharing|Remove/ }).click()
  const { page } = await as('anonymous')
  await page.goto(`/s/${token}`)
  await expect(page.getByText('Short lived secret.')).toHaveCount(0)
})

test('a public page hides secrets', { tag: '@feature:share.privacy' }, async ({ api, as, makePage }) => {
  const content = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Open text.' }] },
      { type: 'callout', attrs: { kind: 'secret' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'GM only note.' }] }] },
    ],
  }
  const p = await makePage('Mixed', { content })
  const { token } = await api.json<{ token: string }>('post', `/api/pages/${p.id}/share`)
  const { page } = await as('anonymous')
  await page.goto(`/s/${token}`)
  await expect(page.getByText('Open text.')).toBeVisible()
  await expect(page.getByText('GM only note.')).toHaveCount(0)
})

test('settings lists publicly shared pages', { tag: '@feature:share.list' }, async ({ app, api, makePage }) => {
  const p = await makePage('Listed share')
  await api.json('post', `/api/pages/${p.id}/share`)
  await app.reload()
  await openView(app, 'Settings')
  await expect(app.locator('main')).toContainText('Listed share')
})

test('copy a page to another world from its menu', { tag: '@feature:copy' }, async ({ app, api, makePage, world }) => {
  const targetName = 'Copy target ' + world.id.slice(0, 5)
  const other = await api.json<{ id: string }>('post', '/api/workspaces', { name: targetName })
  await makePage('Portable', { content: doc('Travels well.') })
  await app.reload()
  await openPage(app, 'Portable')
  await menuItem(app, 'Copy to another world…')
  const overlay = app.locator('.overlay')
  await overlay.getByRole('combobox').click()
  await app.getByRole('option', { name: targetName }).click()
  await overlay.getByRole('button', { name: /^Copy 1 page/ }).click()
  await expect.poll(async () => JSON.stringify(await api.json('get', `/api/workspaces/${other.id}/bootstrap`))).toContain('Portable')
})

test('the world export is a zip', { tag: '@feature:export' }, async ({ api, world, makePage }) => {
  await makePage('Exported', { content: doc('In the archive.') })
  const r = await api.get(`/api/workspaces/${world.id}/export`)
  expect(r.ok()).toBeTruthy()
  expect((await r.body()).subarray(0, 2).toString()).toBe('PK')
})

test('an editor cannot read a world they were not given', { tag: '@feature:roles.access' }, async ({ as, world }) => {
  const { page } = await as('editor', world.id)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Toggle sidebar' })).toBeVisible()
  const r = await page.request.get(`/api/workspaces/${world.id}/bootstrap`)
  expect([403, 404]).toContain(r.status())
})
