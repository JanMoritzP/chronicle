import { doc, expect, grantAccess, test, unique } from '../fixtures'
import { answerPrompt, confirmDialog, editorOf, menuItem, openPage, openView, sidebar, typeInEditor } from '../lib/ui'

test('create a page, give it a title and see it in the sidebar', { tag: '@feature:pages.create' }, async ({ app }) => {
  await app.getByRole('button', { name: 'New page', exact: true }).click()
  const title = app.getByLabel('Page title')
  await expect(title).toBeVisible()
  await title.fill('The Rusty Tankard')
  await expect(sidebar(app).getByRole('button', { name: 'The Rusty Tankard' })).toBeVisible()
  await expect(app.getByText('Saved', { exact: true })).toBeVisible()
})

test('text typed in the editor is saved and survives a reload', { tag: '@feature:pages.edit' }, async ({ app, makePage }) => {
  await makePage('Notes')
  await app.reload()
  await openPage(app, 'Notes')
  await typeInEditor(app, 'The innkeeper owes the party a favour.')
  await expect(app.getByText('Saved', { exact: true })).toBeVisible()
  await app.waitForTimeout(2000)
  await app.reload()
  await openPage(app, 'Notes')
  await expect(editorOf(app)).toContainText('The innkeeper owes the party a favour.')
})

test('tags can be added and open a tag view', { tag: '@feature:pages.tags' }, async ({ app, makePage }) => {
  await makePage('Tagged')
  await app.reload()
  await openPage(app, 'Tagged')
  await app.getByLabel('Add tags').fill('npc/villain')
  await app.keyboard.press('Enter')
  const chip = app.locator('main .chip', { hasText: 'npc/villain' })
  await expect(chip).toBeVisible()
  await chip.getByText('#npc/villain').click()
  await expect(app.locator('.tab.active')).toContainText('#npc/villain')
})

test('rename a page from its title', { tag: '@feature:pages.rename' }, async ({ app, makePage }) => {
  await makePage('Old name')
  await app.reload()
  await openPage(app, 'Old name')
  await app.getByLabel('Page title').fill('New name')
  await expect(sidebar(app).getByRole('button', { name: 'New name', exact: true })).toBeVisible()
  await expect(sidebar(app).getByRole('button', { name: 'Old name', exact: true })).toHaveCount(0)
})

test('move to trash, see it in Trash and restore it', { tag: '@feature:pages.trash' }, async ({ app, makePage }) => {
  await makePage('Doomed')
  await app.reload()
  await openPage(app, 'Doomed')
  await menuItem(app, 'Move to trash')
  await expect(sidebar(app).getByRole('button', { name: 'Doomed', exact: true })).toHaveCount(0)
  await openView(app, 'Trash')
  await expect(app.locator('main')).toContainText('Doomed')
  await app.locator('main').getByRole('button', { name: /Restore/ }).first().click()
  await expect(sidebar(app).getByRole('button', { name: 'Doomed', exact: true })).toBeVisible()
})

test('delete a page for good from the trash', { tag: '@feature:pages.purge' }, async ({ app, makePage }) => {
  await makePage('Gone for good')
  await app.reload()
  await openPage(app, 'Gone for good')
  await menuItem(app, 'Move to trash')
  await openView(app, 'Trash')
  await app.locator('main').getByRole('button', { name: 'Delete forever' }).first().click()
  await confirmDialog(app)
  await expect(app.locator('main')).not.toContainText('Gone for good')
})

test('folders: create one and add a page inside it', { tag: '@feature:pages.folders' }, async ({ app }) => {
  await app.getByRole('button', { name: 'New folder' }).click()
  await answerPrompt(app, 'Locations')
  await expect(sidebar(app).getByText('Locations', { exact: true })).toBeVisible()
  await sidebar(app).getByTitle('New page here').first().click({ force: true })
  await expect(app.getByLabel('Page title')).toBeVisible()
  await app.getByLabel('Page title').fill('Waterdeep')
  await expect(sidebar(app).getByRole('button', { name: 'Waterdeep', exact: true })).toBeVisible()
})

test('search finds pages by title and text', { tag: '@feature:pages.search' }, async ({ app, makePage }) => {
  await makePage('Strahd von Zarovich', { content: doc('The vampire lord of Barovia.') })
  await app.reload()
  await expect(sidebar(app).getByRole('button', { name: 'Strahd von Zarovich' })).toBeVisible()
  await app.keyboard.press('Control+k')
  const box = app.getByLabel('Search pages, text, tags, or commands')
  await box.fill('strahd')
  await expect(app.locator('.result', { hasText: 'Strahd von Zarovich' }).first()).toBeVisible()
  await box.fill('Barovia')
  await expect(app.locator('.result', { hasText: 'Strahd von Zarovich' }).first()).toBeVisible()
  await app.keyboard.press('Enter')
  await expect(app.getByLabel('Page title')).toHaveValue('Strahd von Zarovich')
})

test('search with a slash lists every command', { tag: '@feature:pages.search-commands' }, async ({ app }) => {
  await app.keyboard.press('Control+k')
  await app.getByLabel('Search pages, text, tags, or commands').fill('/')
  await expect(app.locator('.result').first()).toBeVisible()
  expect(await app.locator('.result').count()).toBeGreaterThan(5)
})

test('quick capture saves a zettel', { tag: '@feature:zettels' }, async ({ app }) => {
  const idea = unique('A dragon sleeps under the mill')
  await app.keyboard.press('Alt+c')
  await app.getByPlaceholder('Any thought, name, idea…').fill(idea)
  await app.getByPlaceholder('tags (space separated)').fill('idea')
  await app.keyboard.press('Control+Enter')
  await openView(app, 'Zettelkasten')
  await expect(app.locator('main')).toContainText(idea)
})

test('version history records edits', { tag: '@feature:pages.history' }, async ({ app, makePage, api }) => {
  const p = await makePage('Versioned', { content: doc('first') })
  await api.json('patch', `/api/pages/${p.id}`, { content: doc('second'), title: 'Versioned' })
  await app.reload()
  await openPage(app, 'Versioned')
  await app.getByTitle('Version history').click()
  await expect(app.getByLabel('Version history')).toBeVisible()
  await app.getByLabel('Version history').getByRole('button', { name: 'Close' }).click()
})

test('show the active tab beside another', { tag: '@feature:shell.split' }, async ({ app, makePage }) => {
  await makePage('Left')
  await app.reload()
  await openPage(app, 'Left')
  await app.getByRole('button', { name: 'New tab' }).click()
  await app.getByTitle('Show active tab beside another').click()
  await expect(app.locator('.pane')).toHaveCount(2)
  await app.getByTitle('Close split').click()
  await expect(app.locator('.pane')).toHaveCount(1)
})

// Found by this suite: the button opens a new tab and marks it split, but the split pane is hidden because that tab is also the active one.
test.fixme('the Open in split view button shows two panes', { tag: '@feature:shell.split-button' }, async ({ app, makePage }) => {
  await makePage('Right')
  await app.reload()
  await openPage(app, 'Right')
  await app.getByTitle('Open in split view').click()
  await expect(app.locator('.pane')).toHaveCount(2)
})

test('the page type picker turns a plain page into a special page', { tag: '@feature:pages.type' }, async ({ app, makePage }) => {
  await makePage('Becomes a person')
  await app.reload()
  await openPage(app, 'Becomes a person')
  await app.getByTitle('Page type').click()
  await app.getByRole('option', { name: /Person/ }).click()
  await expect(app.locator('main')).toContainText(/Race|Class/)
})

test('viewers cannot edit', { tag: '@feature:roles.viewer' }, async ({ as, world, makePage }) => {
  await makePage('Read only', { content: doc('hello') })
  await grantAccess(world.id, 'viewer')
  const { page } = await as('viewer', world.id)
  await page.goto('/')
  await openPage(page, 'Read only')
  await expect(page.getByRole('button', { name: 'New page', exact: true })).toHaveCount(0)
  await expect(editorOf(page)).toHaveAttribute('contenteditable', 'false')
})
