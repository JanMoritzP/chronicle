import { doc, expect, test } from '../fixtures'
import { editorOf, openPage } from '../lib/ui'

test('on a phone the sidebar opens and a page can be read', { tag: '@feature:mobile' }, async ({ app, makePage }) => {
  await makePage('Phone page', { content: doc('Readable on a phone.') })
  await app.reload()
  await app.getByRole('button', { name: 'Toggle sidebar' }).click()
  await expect(app.getByRole('complementary')).toBeVisible()
  await openPage(app, 'Phone page')
  await expect(editorOf(app)).toContainText('Readable on a phone.')
  const overflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('on a phone the main views fit the screen', { tag: '@feature:mobile' }, async ({ app }) => {
  for (const name of ['Maps', 'Timeline', 'Sessions', 'Todos', 'Library']) {
    await app.reload()
    await app.getByRole('button', { name: 'Toggle sidebar' }).click()
    await app.getByRole('complementary').getByRole('button', { name, exact: true }).click()
    const overflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `${name} overflows`).toBeLessThanOrEqual(1)
  }
})

test('on a phone the settings sections scroll as a strip and fit the screen', { tag: '@feature:mobile' }, async ({ app }) => {
  await app.getByRole('button', { name: 'Toggle sidebar' }).click()
  await app.getByRole('complementary').getByRole('button', { name: 'Settings', exact: true }).click()
  await app.locator('.scrim').click({ position: { x: 360, y: 300 } })
  const menu = app.getByRole('navigation', { name: 'Settings sections' })
  for (const name of ['Appearance', 'Keyboard shortcuts', 'Worlds', 'Backups']) {
    await menu.getByRole('button', { name, exact: true }).click()
    await expect(app.getByRole('region', { name })).toBeVisible()
    const overflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `${name} overflows`).toBeLessThanOrEqual(1)
    if (process.env.SHOT && name === 'Worlds') await app.screenshot({ path: `${process.env.SHOT}/settings-mobile.png` })
  }
})

test('on a phone the tabletop has a bottom bar, a sheet for chat and dice, and your hit points at hand', { tag: '@feature:mobile.table' }, async ({ app }) => {
  await app.getByRole('button', { name: 'Toggle sidebar' }).click()
  await app.getByRole('complementary').getByRole('button', { name: 'Tabletop', exact: true }).click()
  const nav = app.getByRole('navigation', { name: 'Table sections' })
  await expect(nav).toBeVisible()
  await expect(app.getByRole('complementary', { name: 'Table panel' })).toHaveCount(0)

  await app.locator('.tt-bar').getByRole('button', { name: 'New scene' }).click()
  await app.getByPlaceholder('The crypt under the chapel').fill('Camp')
  await app.getByRole('button', { name: 'Create' }).click()
  await expect(app.locator('.tt-bar')).toContainText('Camp')
  await app.locator('.tt-rail').getByRole('button', { name: 'New token' }).click()
  await app.getByPlaceholder('Goblin 1').fill('Aria')
  await app.getByRole('button', { name: 'Add' }).click()

  // the chat sheet opens over the map and closes again
  await nav.getByRole('button', { name: 'Chat and dice' }).click()
  const sheet = app.getByRole('complementary', { name: 'Table panel' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('group', { name: 'Quick dice' }).getByRole('button', { name: 'd20' }).click()
  await expect(sheet.getByRole('list', { name: 'Chat' }).locator('.tt-total')).toBeVisible()
  await nav.getByRole('button', { name: 'Map' }).click()
  await expect(sheet).toHaveCount(0)

  // give the token hit points and an owner, then hurt it from the strip under the map
  await nav.getByRole('button', { name: 'Me' }).click()
  await sheet.getByRole('list', { name: 'Tokens on this scene' }).getByRole('button', { name: 'Aria' }).click()
  await sheet.getByLabel('Maximum hit points').fill('20')
  await sheet.getByLabel('Maximum hit points').press('Enter')
  await sheet.getByLabel('Hit points', { exact: true }).fill('20')
  await sheet.getByLabel('Hit points', { exact: true }).press('Enter')
  await expect(sheet.getByLabel('Hit points', { exact: true })).toHaveValue('20')
  await sheet.getByLabel('gm', { exact: true }).click()
  await expect(sheet.getByLabel('gm', { exact: true })).toBeChecked()
  await nav.getByRole('button', { name: 'Map' }).click()
  const strip = app.getByLabel('Aria hit points')
  await expect(strip).toContainText('20/20')
  await strip.getByRole('button', { name: 'Damage' }).click()
  await app.getByPlaceholder('7').fill('7')
  await app.getByRole('button', { name: 'Take damage' }).click()
  await expect(strip).toContainText('13/20')

  const overflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  if (process.env.SHOT) await app.screenshot({ path: `${process.env.SHOT}/table-mobile.png` })
})
