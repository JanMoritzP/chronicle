import { expect, test, unique } from '../fixtures'
import { answerPrompt, confirmDialog, dialog, openView } from '../lib/ui'

const THEMES = ['Parchment', 'Linen', 'Sage', 'Tide', 'Rosewood', 'Tavern', 'Ink', 'Forest', 'Dusk', 'Slate']

test('every theme can be picked and is remembered', { tag: '@feature:settings.themes' }, async ({ app }) => {
  await openView(app, 'Settings')
  for (const name of THEMES.slice(1)) {
    await app.getByRole('button', { name: `Switch to ${name} theme` }).click()
    await expect(app.getByRole('button', { name: `Selected: ${name}` })).toBeVisible()
  }
  await app.reload()
  await expect(app.getByRole('button', { name: 'Selected: Slate' })).toBeVisible()
})

test('text size slider changes the preview', { tag: '@feature:settings.font' }, async ({ app }) => {
  await openView(app, 'Settings')
  const slider = app.getByRole('slider')
  await slider.focus()
  await app.keyboard.press('ArrowRight')
  await expect(app.getByText(/Text size: 1\d\d%/)).toBeVisible()
})

test('fonts: pick another interface font', { tag: '@feature:settings.font' }, async ({ app }) => {
  await openView(app, 'Settings')
  await app.getByRole('combobox', { name: 'Interface' }).click()
  const option = app.getByRole('option').nth(1)
  await option.click()
  await expect(app.getByRole('combobox', { name: 'Interface' })).not.toHaveText('System sans')
})

test('create a new world and switch between worlds', { tag: '@feature:worlds' }, async ({ app, world }) => {
  await openView(app, 'Settings')
  const name = unique('Second world')
  await app.getByRole('button', { name: '+ New world' }).click()
  await answerPrompt(app, name)
  await expect(app.getByRole('heading', { level: 1, name })).toBeVisible()
  await openView(app, 'Settings')
  await app.locator('main').getByRole('button', { name: world.name }).click()
  await expect.poll(() => app.evaluate(() => localStorage.getItem('workspace'))).toBe(world.id)
})

test('delete a world after confirming', { tag: '@feature:worlds' }, async ({ app }) => {
  await openView(app, 'Settings')
  await app.getByRole('button', { name: 'Delete this world' }).click()
  await expect(dialog(app)).toBeVisible()
  await confirmDialog(app)
  await expect(dialog(app)).toBeHidden()
})

test('the todo every new page starts with can be changed', { tag: '@feature:settings.starter-todo' }, async ({ app }) => {
  await openView(app, 'Settings')
  const box = app.getByRole('textbox', { name: 'Todo every new page starts with' })
  await box.fill('Add a hook')
  await box.blur()
  await app.getByRole('button', { name: 'New page', exact: true }).click()
  await expect(app.locator('.ProseMirror').first()).toBeVisible()
  await expect(app.getByPlaceholder('What needs doing?').first()).toHaveValue('Add a hook')
})

test('shortcuts can be removed and added again', { tag: '@feature:settings.shortcuts' }, async ({ app }) => {
  await openView(app, 'Settings')
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
  await openView(app, 'Settings')
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
  await openView(app, 'Settings')
  const change = app.getByRole('button', { name: 'Change', exact: true })
  await expect(change).toBeDisabled()
  await app.getByRole('textbox', { name: 'Current password' }).fill('wrong-current-pass')
  await app.getByRole('textbox', { name: 'New password', exact: true }).fill('a-new-password-1')
  await app.getByRole('textbox', { name: 'New password confirmation' }).fill('a-new-password-1')
  await change.click()
  await expect(dialog(app).or(app.locator('.error')).first()).toBeVisible()
})

test('backups: back up now lists a snapshot', { tag: '@feature:backups' }, async ({ app }) => {
  await openView(app, 'Settings')
  await app.getByRole('button', { name: 'Back up now' }).click()
  await expect(app.locator('main').getByText(/\.sqlite|\.db|backup/i).first()).toBeVisible()
})

test('export links download the world and everything', { tag: '@feature:export' }, async ({ app }) => {
  await openView(app, 'Settings')
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
  await openView(page, 'Settings')
  await page.getByRole('button', { name: /^Log out/ }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})
