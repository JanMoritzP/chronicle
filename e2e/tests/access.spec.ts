import { doc, expect, grantAccess, test } from '../fixtures'
import { openPage, openSettings } from '../lib/ui'

const withSecret = (open: string, secret: string) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: open }] },
    { type: 'callout', attrs: { kind: 'secret' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: secret }] }] },
  ],
})

test('a player reads a page without its secrets', { tag: '@feature:access.secrets' }, async ({ app, as, world, makePage }) => {
  await makePage('The duke', { content: withSecret('A kind ruler.', 'He leads the cult.') })
  await grantAccess(world.id, 'editor')
  await app.reload()
  await openPage(app, 'The duke')
  await expect(app.getByText('He leads the cult.')).toBeVisible()
  const { page } = await as('editor', world.id)
  await page.goto('/')
  await openPage(page, 'The duke')
  await expect(page.getByText('A kind ruler.')).toBeVisible()
  await expect(page.getByText('Parts of this page are for the GM')).toBeVisible()
  await expect(page.getByText('He leads the cult.')).toHaveCount(0)
})

test('a GM hides a page from everyone else', { tag: '@feature:access.page' }, async ({ app, as, world, makePage }) => {
  await makePage('Next session', { content: doc('Ambush at the bridge.') })
  await grantAccess(world.id, 'editor')
  await app.reload()
  await openPage(app, 'Next session')
  await app.getByRole('button', { name: 'Who can see this page' }).click()
  const dialog = app.getByRole('dialog', { name: /Who can see/ })
  await dialog.getByRole('combobox', { name: 'Everyone in the world' }).click()
  await app.getByRole('option', { name: /Hidden/ }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)
  const { page } = await as('editor', world.id)
  await page.goto('/')
  await expect(page.getByText(/unprocessed zettels/)).toBeVisible()
  await expect(page.locator('.side-item', { hasText: 'Next session' })).toHaveCount(0)
})

test('a GM changes what a member is in the world', { tag: '@feature:access.roles' }, async ({ app, world }) => {
  await grantAccess(world.id, 'editor')
  await app.reload()
  await openSettings(app, 'People')
  const row = app.locator('tr', { hasText: 'e2e-editor' })
  await expect(row).toContainText('Player who writes')
  await row.getByText('Player who writes').click()
  await app.getByRole('option', { name: 'GM' }).click()
  await expect(row).toContainText('GM')
})

test('import Markdown files with links between them', { tag: '@feature:import' }, async ({ app }) => {
  await app.getByRole('button', { name: /Switch world/ }).click()
  await app.getByRole('menuitem', { name: 'Import pages…' }).click()
  const dialog = app.getByRole('dialog', { name: 'Import pages' })
  await expect(dialog).toBeVisible()
  await app.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['---\naliases: [Tom]\n---\nThe ferryman of [[Riverside]]. #npc'], 'Old Tom.md', { type: 'text/markdown' }))
    dt.items.add(new File(['A quiet town.\n\n- [ ] visit'], 'Riverside.md', { type: 'text/markdown' }))
    document.querySelector('.import-drop')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  await expect(dialog).toContainText('Markdown files: 2 pages')
  await dialog.getByRole('button', { name: 'Import' }).click()
  await expect(dialog).toContainText('Made 2 pages')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await app.locator('.side-item', { hasText: 'Imported from Markdown' }).click()
  await openPage(app, 'Old Tom')
  await expect(app.locator('.ProseMirror')).toContainText('The ferryman of Riverside')
  await expect(app.locator('.ProseMirror [data-wikilink], .ProseMirror .wikilink').first()).toBeVisible()
})
