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
