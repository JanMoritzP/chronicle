import { expect, grantAccess, test, unique } from '../fixtures'
import { answerPrompt, confirmDialog, dialog, openSettings, openView } from '../lib/ui'

const THEMES = ['Parchment', 'Linen', 'Sage', 'Tide', 'Rosewood', 'Tavern', 'Ink', 'Forest', 'Dusk', 'Slate']

test('every theme can be picked and is remembered', { tag: '@feature:settings.themes' }, async ({ app }) => {
  await openSettings(app, 'Appearance')
  for (const name of THEMES.slice(1)) {
    await app.getByRole('button', { name: `Switch to ${name} theme` }).click()
    await expect(app.getByRole('button', { name: `Selected: ${name}` })).toBeVisible()
  }
  await app.reload()
  await expect(app.getByRole('button', { name: 'Selected: Slate' })).toBeVisible()
})

test('text size slider changes the preview', { tag: '@feature:settings.font' }, async ({ app }) => {
  await openSettings(app, 'Appearance')
  const slider = app.getByRole('slider')
  await slider.focus()
  await app.keyboard.press('ArrowRight')
  await expect(app.getByText(/Text size: 1\d\d%/)).toBeVisible()
})

test('fonts: pick another interface font', { tag: '@feature:settings.font' }, async ({ app }) => {
  await openSettings(app, 'Appearance')
  await app.getByRole('combobox', { name: 'Interface' }).click()
  const option = app.getByRole('option').nth(1)
  await option.click()
  await expect(app.getByRole('combobox', { name: 'Interface' })).not.toHaveText('System sans')
})

test('create a new world and switch between worlds', { tag: '@feature:worlds' }, async ({ app, world }) => {
  await openSettings(app, 'Worlds')
  const name = unique('Second world')
  await app.getByRole('button', { name: '+ New world' }).click()
  await answerPrompt(app, name)
  await expect(app.getByRole('heading', { level: 1, name })).toBeVisible()
  await openSettings(app, 'Worlds')
  await app.locator('main').getByRole('button', { name: world.name }).click()
  await expect.poll(() => app.evaluate(() => localStorage.getItem('workspace'))).toBe(world.id)
})

test('delete a world after confirming', { tag: '@feature:worlds' }, async ({ app }) => {
  await openSettings(app, 'Worlds')
  await app.getByRole('button', { name: 'Delete this world' }).click()
  await expect(dialog(app)).toBeVisible()
  await confirmDialog(app)
  await expect(dialog(app)).toBeHidden()
})

test('the todo every new page starts with can be changed', { tag: '@feature:settings.starter-todo' }, async ({ app }) => {
  await openSettings(app, 'Worlds')
  const box = app.getByRole('textbox', { name: 'Todo every new page starts with' })
  await box.fill('Add a hook')
  await box.blur()
  await app.getByRole('button', { name: 'New page', exact: true }).click()
  await expect(app.locator('.ProseMirror').first()).toBeVisible()
  await expect(app.getByPlaceholder('What needs doing?').first()).toHaveValue('Add a hook')
})

test('shortcuts can be removed and added again', { tag: '@feature:settings.shortcuts' }, async ({ app }) => {
  await openSettings(app, 'Keyboard shortcuts')
  const row = app.getByRole('row', { name: /Open graph/ })
  await row.getByRole('button', { name: '×' }).first().click()
  await expect(row).toContainText('+ Add')
  await app.keyboard.press('Alt+g')
  await expect(app.locator('.tab.active')).toContainText('Settings')
  await row.getByRole('button', { name: '+ Add' }).click()
  await app.keyboard.press('Alt+h')
  await expect(row).toContainText('Alt + H')
  await app.keyboard.press('Alt+h')
  await expect(app.locator('.tab.active')).toContainText('Graph')
})

test('accounts: add, set a password and remove', { tag: '@feature:settings.accounts' }, async ({ app }) => {
  await openSettings(app, 'Accounts')
  const name = 'guest' + Date.now().toString(36).slice(-6)
  await app.getByRole('textbox', { name: 'Username' }).fill(name)
  await app.getByRole('textbox', { name: 'Password', exact: true }).fill('guest-password-1')
  await app.getByRole('button', { name: 'Add account' }).click()
  const row = app.getByRole('row', { name: new RegExp(name) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Set password' }).click()
  await answerPrompt(app, 'another-password-2')
  await expect(dialog(app)).toContainText(/password/i)
  await confirmDialog(app)
  await expect(dialog(app)).toBeHidden()
  await row.getByRole('button', { name: 'Remove' }).click()
  await confirmDialog(app)
  await expect(row).toHaveCount(0)
})

test('change my password needs matching fields', { tag: '@feature:settings.password' }, async ({ app }) => {
  await openSettings(app, 'My account')
  const change = app.getByRole('button', { name: 'Change', exact: true })
  await expect(change).toBeDisabled()
  await app.getByRole('textbox', { name: 'Current password' }).fill('wrong-current-pass')
  await app.getByRole('textbox', { name: 'New password', exact: true }).fill('a-new-password-1')
  await app.getByRole('textbox', { name: 'New password confirmation' }).fill('a-new-password-1')
  await change.click()
  await expect(dialog(app).or(app.locator('.error')).first()).toBeVisible()
})

test('backups: back up now lists a snapshot', { tag: '@feature:backups' }, async ({ app }) => {
  await openSettings(app, 'Backups')
  await app.getByRole('button', { name: 'Back up now' }).click()
  await expect(app.locator('main').getByText(/\.sqlite|\.db|backup/i).first()).toBeVisible()
})

test('export links download the world and everything', { tag: '@feature:export' }, async ({ app }) => {
  await openSettings(app, 'Worlds')
  const [download] = await Promise.all([
    app.waitForEvent('download'),
    app.getByRole('link', { name: /Export this world/ }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.zip$/)
})

// Logging out ends the server session, so this test signs in as a throwaway account instead of sharing the saved owner session.
test('log out returns to the sign in screen', { tag: '@feature:auth.logout' }, async ({ as, api }) => {
  const name = 'leaver' + Date.now().toString(36).slice(-6)
  await api.json('post', '/api/users', { username: name, password: 'leaver-password-1', role: 'editor' })
  const { page } = await as('anonymous')
  await page.goto('/')
  await page.getByLabel('Username').fill(name)
  await page.getByLabel('Password').fill('leaver-password-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText(/unprocessed zettels/)).toBeVisible()
  await openSettings(page, 'My account')
  await page.getByRole('button', { name: /^Log out/ }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('settings are split into sections, and viewers do not see the owner ones', { tag: '@feature:settings.sections' }, async ({ app, as, world }) => {
  await openView(app, 'Settings')
  const menu = app.getByRole('navigation', { name: 'Settings sections' })
  for (const name of ['Appearance', 'Keyboard shortcuts', 'Worlds', 'Sharing', 'Accounts', 'Backups', 'My account']) {
    await menu.getByRole('button', { name, exact: true }).click()
    await expect(app.getByRole('region', { name })).toBeVisible()
  }
  await grantAccess(world.id, 'viewer')
  const { page: viewer } = await as('viewer', world.id)
  await viewer.goto('/')
  await openView(viewer, 'Settings')
  const viewerMenu = viewer.getByRole('navigation', { name: 'Settings sections' })
  await expect(viewerMenu.getByRole('button', { name: 'Worlds', exact: true })).toBeVisible()
  await expect(viewerMenu.getByRole('button', { name: 'Accounts', exact: true })).toHaveCount(0)
  await expect(viewerMenu.getByRole('button', { name: 'Backups', exact: true })).toHaveCount(0)
})

test('the owner makes an invite link and a new person joins the world with it', { tag: '@feature:invites' }, async ({ app, world, browser }) => {
  await openSettings(app, 'Worlds')
  await app.getByLabel(/Let people join/).click()
  await expect(app.getByLabel(/Let people join/)).toBeChecked()
  await app.getByLabel('Name (only you see it)').fill('Tuesday group')
  await app.getByRole('button', { name: 'Create link' }).click()
  const link = await app.getByLabel('Invite link', { exact: true }).inputValue()
  expect(link).toMatch(/\/join\/[\w-]{30,}$/)
  await expect(app.getByRole('list', { name: 'Invite links' })).toContainText('Player link')
  await expect(app.getByRole('list', { name: 'Invite links' })).toContainText('Tuesday group')
  await expect(app.getByRole('list', { name: 'Invite links' })).toContainText('open')

  // a stranger opens it: no sign in, one form
  const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await guest.newPage()
  await page.goto(link)
  await expect(page.getByText(/You are invited to/)).toContainText(world.name)
  await expect(page.getByText(/as a player/)).toBeVisible()
  const join = page.getByRole('button', { name: 'Create account and join' })
  await expect(join).toBeDisabled()
  await page.getByLabel('Choose a name').fill('Guest Aria')
  await page.getByLabel('Password', { exact: true }).fill('a-long-password')
  await page.getByLabel('Password again').fill('a-different-one')
  await join.click()
  await expect(page.getByRole('alert')).toContainText('not the same')
  await page.getByLabel('Password again').fill('a-long-password')
  await join.click()
  // they land in the app, in that world, and can open the tabletop
  await expect(page.getByText(world.name).first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Tabletop' }).click()
  await expect(page.locator('.tt-canvas canvas')).toBeVisible()
  await guest.close()

  // the link was for one person at a time only if it said so; this one lets in five, and it can be closed
  await app.getByRole('button', { name: 'Close', exact: true }).first().click()
  await app.getByRole('button', { name: 'Close link' }).click()
  await expect(app.getByRole('list', { name: 'Invite links' })).toContainText('revoked')
  const late = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const lp = await late.newPage()
  await lp.goto(link)
  await expect(lp.getByRole('alert')).toContainText('not valid any more')
  await late.close()
})
