import { expect, test } from '../fixtures'

test.describe('sign in', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('wrong password shows an error, right one opens the app', { tag: '@feature:auth.login' }, async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Chronicle' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    await page.getByLabel('Username').fill('gm')
    await page.getByLabel('Password').fill('not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.locator('.error')).toBeVisible()
    await page.getByLabel('Password').fill('e2e-owner-pass')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  })
})

test('home shows the world and its recent pages', { tag: '@feature:shell.home' }, async ({ app, world, makePage }) => {
  await makePage('Recent one')
  await app.reload()
  await expect(app.getByRole('heading', { level: 1, name: world.name })).toBeVisible()
  await expect(app.getByRole('heading', { name: 'Recently edited' })).toBeVisible()
  await expect(app.locator('main').getByRole('button', { name: /Recent one/ })).toBeVisible()
})

test('every sidebar view opens', { tag: '@feature:shell.navigation' }, async ({ app }) => {
  const views: [string, RegExp | string][] = [
    ['Zettelkasten', 'Zettelkasten'], ['Graph', 'Graph'], ['Maps', 'Maps'], ['Timeline', 'Timeline'], ['Relations', 'Relations'],
    ['Sessions', 'Sessions'], ['Todos', 'Todos'], ['Comments', 'Comments'], ['Library', 'Library'], ['Templates', 'Templates'],
    ['Special pages', 'Special pages'], ['Stat block forms', 'Stat block forms'], ['Trash', 'Trash'], ['Manual', 'Manual'], ['Settings', 'Settings'],
  ]
  for (const [button, tab] of views) {
    await app.locator('aside, [role=complementary]').getByRole('button', { name: button, exact: true }).click()
    await expect(app.locator('.tab.active, .tabs .active').first()).toContainText(tab)
  }
})

test('tabs: open, close, back and forward', { tag: '@feature:shell.tabs' }, async ({ app }) => {
  await app.getByRole('button', { name: 'Graph', exact: true }).click()
  await app.getByRole('button', { name: 'Maps', exact: true }).click()
  await app.getByRole('button', { name: /^Back/ }).click()
  await expect(app.locator('.tab.active, .tabs .active').first()).toContainText('Graph')
  await app.getByRole('button', { name: /^Forward/ }).click()
  await expect(app.locator('.tab.active, .tabs .active').first()).toContainText('Maps')
  await app.getByRole('button', { name: 'New tab' }).click()
  await expect(app.getByRole('button', { name: 'Close tab' })).toHaveCount(2)
  await app.getByRole('button', { name: 'Close tab' }).last().click()
  await expect(app.getByRole('button', { name: 'Close tab' })).toHaveCount(1)
})

test('the sidebar can be toggled', { tag: '@feature:shell.sidebar' }, async ({ app }) => {
  const side = app.getByRole('complementary')
  await expect(side).toBeVisible()
  await app.getByRole('button', { name: 'Toggle sidebar' }).click()
  await expect(side).toBeHidden()
  await app.keyboard.press('Alt+b')
  await expect(side).toBeVisible()
})

test('keyboard shortcuts: new page, search, graph, todos, zen', { tag: '@feature:shell.shortcuts' }, async ({ app }) => {
  await app.keyboard.press('Alt+g')
  await expect(app.locator('.tab.active, .tabs .active').first()).toContainText('Graph')
  await app.keyboard.press('Alt+t')
  await expect(app.locator('.tab.active, .tabs .active').first()).toContainText('Todos')
  await app.keyboard.press('Alt+n')
  await expect(app.getByLabel('Page title')).toBeVisible()
  await app.keyboard.press('Control+k')
  await expect(app.getByLabel('Search pages, text, tags, or commands')).toBeVisible()
  await app.keyboard.press('Escape')
  await expect(app.getByLabel('Search pages, text, tags, or commands')).toBeHidden()
  await app.getByLabel('Page title').click()
  await app.keyboard.press('Alt+z')
  await expect(app.getByRole('complementary')).toBeHidden()
  await app.keyboard.press('Escape')
  await expect(app.getByRole('complementary')).toBeVisible()
})

test('manual lists the commands', { tag: '@feature:shell.manual' }, async ({ app }) => {
  await app.getByRole('button', { name: 'Manual', exact: true }).first().click()
  await expect(app.getByRole('heading', { level: 1, name: /Manual/ })).toBeVisible()
  await expect(app.locator('main')).toContainText('Heading 1')
})

test('home offers shortcuts to write, capture and find', { tag: '@feature:shell.home-actions' }, async ({ app }) => {
  await app.getByRole('button', { name: /^Capture a thought/ }).click()
  await expect(app.getByPlaceholder('Any thought, name, idea…')).toBeVisible()
  await app.keyboard.press('Escape')
  await app.getByRole('button', { name: /^Find anything/ }).click()
  await expect(app.getByLabel('Search pages, text, tags, or commands')).toBeVisible()
  await app.keyboard.press('Escape')
  await app.getByRole('button', { name: /^Write a page/ }).click()
  await expect(app.getByLabel('Page title')).toBeVisible()
})

test('the sidebar names the world and switches between worlds', { tag: '@feature:shell.world-switcher' }, async ({ app, api, world }) => {
  const other = await api.json<{ id: string; name: string }>('post', '/api/workspaces', { name: `Other ${world.name}` })
  await app.reload()
  const head = app.getByRole('button', { name: /^World: / })
  await expect(head).toContainText(world.name)
  await head.click()
  await expect(app.getByRole('menuitemradio', { name: world.name, exact: true })).toHaveAttribute('aria-checked', 'true')
  await app.getByRole('menuitemradio', { name: other.name, exact: true }).click()
  await expect(head).toContainText(other.name)
  await head.click()
  await app.getByRole('menuitem', { name: 'Home' }).click()
  await expect(app.getByRole('heading', { level: 1, name: other.name })).toBeVisible()
})
