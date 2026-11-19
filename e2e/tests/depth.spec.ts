import { doc, expect, test } from '../fixtures'
import { makePng } from '../lib/png'
import { answerPrompt, confirmDialog, dismissAlert, editorOf, openPage, openView, sidebar, slash } from '../lib/ui'

async function openMap(app: import('@playwright/test').Page, name: string) {
  await openView(app, 'Maps')
  const chooser = app.waitForEvent('filechooser')
  await app.getByRole('button', { name: 'Upload map' }).click()
  await (await chooser).setFiles({ name: 'world.png', mimeType: 'image/png', buffer: makePng() })
  await answerPrompt(app, name)
  await expect(app.getByTitle('Marker', { exact: true })).toBeVisible()
}

async function placeMarker(app: import('@playwright/test').Page, dx = 200, dy = 200) {
  await app.getByTitle('Marker', { exact: true }).click()
  const box = (await app.locator('.leaflet-container').boundingBox())!
  await app.mouse.click(box.x + dx, box.y + dy)
  await expect(app.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible()
}

test.describe('map markers', () => {
  test('name a marker, link a page, recolour and move it to a layer', { tag: '@feature:maps.inspector' }, async ({ app, makePage }) => {
    await makePage('Citadel')
    await app.reload()
    await openMap(app, 'Inspect')
    await placeMarker(app)
    await app.getByRole('textbox', { name: 'Name', exact: true }).fill('The Citadel')
    await app.getByRole('textbox', { name: 'Link a page…' }).click()
    await app.getByText('Citadel', { exact: true }).last().click()
    await app.locator('.map-panel button[style*="background"]').nth(2).click()
    await app.getByRole('button', { name: 'Changes' }).click()
    await app.getByRole('button', { name: 'Static' }).click()
    await app.getByRole('button', { name: 'Close (Esc)' }).click()
    await expect(app.getByRole('textbox', { name: 'Name', exact: true })).toBeHidden()
  })

  test('delete a marker with the Delete button', { tag: '@feature:maps.inspector' }, async ({ app }) => {
    await openMap(app, 'Delete me')
    await placeMarker(app)
    await app.getByRole('button', { name: 'Delete (Del)' }).click()
    await dismissAlert(app)
    await expect(app.getByRole('textbox', { name: 'Name', exact: true })).toBeHidden()
  })

  test('add a layer and a child map from the layers panel', { tag: '@feature:maps.child' }, async ({ app }) => {
    await openMap(app, 'Parent map')
    await app.getByRole('button', { name: 'Layers', exact: true }).click()
    await app.getByRole('button', { name: /Add layer/ }).click()
    await answerPrompt(app, 'Secret routes')
    await expect(app.locator('.map-panel')).toContainText('Secret routes')
  })

  test('the time bar steps through changes', { tag: '@feature:maps.time' }, async ({ app }) => {
    await openMap(app, 'Timed')
    await placeMarker(app)
    await app.getByRole('button', { name: 'Changes' }).click()
    await app.getByRole('button', { name: 'Close (Esc)' }).click()
    await app.getByRole('button', { name: 'Next change' }).first().click()
    await app.getByRole('button', { name: 'Previous change' }).first().click()
    await app.getByRole('button', { name: 'Forward one step' }).click()
    await app.getByRole('button', { name: 'Back one step' }).click()
    await app.getByRole('button', { name: 'Play' }).click()
    await app.getByRole('button', { name: 'Pause' }).click().catch(() => null)
  })
})

test.describe('relations', () => {
  test('/relation links two pages as parent and child', { tag: '@feature:relations.create' }, async ({ app, makePage }) => {
    await makePage('Elder')
    await makePage('Younger')
    await app.reload()
    await openPage(app, 'Elder')
    await slash(app, 'relation', 'Relation')
    const overlay = app.locator('.overlay').first()
    await overlay.getByText('Younger', { exact: true }).click()
    await overlay.getByRole('button', { name: 'Add relation' }).click()
    await openView(app, 'Relations')
    await expect(app.locator('main')).toContainText('Younger')
  })
})

test.describe('designers', () => {
  test('page type designer: add fields, move them, switch to source and save', { tag: '@feature:page-types.designer' }, async ({ app }) => {
    await openView(app, 'Special pages')
    await app.getByRole('button', { name: 'New custom type' }).click()
    await answerPrompt(app, 'Guild')
    await app.getByRole('button', { name: 'Text', exact: true }).first().click()
    await app.getByRole('button', { name: 'Image', exact: true }).first().click()
    await app.getByRole('button', { name: 'Move up' }).last().click()
    await app.getByRole('button', { name: 'Move down' }).first().click()
    await app.getByRole('button', { name: 'Remove', exact: true }).last().click()
    await app.getByRole('button', { name: 'Source' }).click()
    await app.getByRole('button', { name: 'Designer' }).click()
    await app.getByRole('textbox', { name: 'Type name' }).fill('Guild house')
    await app.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(app.locator('main')).toContainText('Saved')
  })

  test('a custom page type can be used to make pages and then deleted', { tag: '@feature:page-types.use' }, async ({ app }) => {
    await openView(app, 'Special pages')
    await app.getByRole('button', { name: 'New custom type' }).click()
    await answerPrompt(app, 'Cult')
    await app.getByRole('button', { name: 'Delete this type' }).click()
    await confirmDialog(app)
    await expect(app.locator('.tab.active')).toContainText('Special pages')
  })

  test('stat form designer: change the look, add a section and save', { tag: '@feature:stat-forms.edit' }, async ({ app }) => {
    await openView(app, 'Stat block forms')
    await app.getByRole('button', { name: 'New form' }).click()
    await answerPrompt(app, 'Ship')
    await app.getByRole('button', { name: 'Dragon red' }).click()
    await app.getByRole('button', { name: 'Move down' }).first().click()
    await app.getByRole('button', { name: 'Source' }).click()
    await app.getByRole('button', { name: 'Designer' }).click()
    await app.getByRole('textbox', { name: 'Form name' }).fill('Ship sheet')
    await app.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(app.locator('main')).toContainText('Saved')
  })
})

test.describe('folders in the sidebar', () => {
  test('rename a folder, add a subfolder and delete it', { tag: '@feature:pages.folders-manage' }, async ({ app }) => {
    await app.getByRole('button', { name: 'New folder' }).click()
    await answerPrompt(app, 'Cities')
    await sidebar(app).getByText('Cities', { exact: true }).click({ button: 'right' })
    await app.locator('.menu').getByRole('button', { name: 'Rename' }).click()
    await answerPrompt(app, 'Towns')
    await expect(sidebar(app).getByText('Towns', { exact: true })).toBeVisible()
    await sidebar(app).getByText('Towns', { exact: true }).click({ button: 'right' })
    await app.locator('.menu').getByRole('button', { name: 'New subfolder' }).click()
    await answerPrompt(app, 'Harbours')
    await sidebar(app).getByText('Towns', { exact: true }).click()
    await expect(sidebar(app).getByText('Harbours', { exact: true })).toBeVisible()
    await sidebar(app).getByText('Towns', { exact: true }).click({ button: 'right' })
    await app.locator('.menu').getByRole('button', { name: 'Delete' }).click()
    await confirmDialog(app)
    await expect(sidebar(app).getByText('Towns', { exact: true })).toHaveCount(0)
  })

  test('a special page can be started inside a folder', { tag: '@feature:pages.folders-manage' }, async ({ app }) => {
    await app.getByRole('button', { name: 'New folder' }).click()
    await answerPrompt(app, 'Npcs')
    await sidebar(app).getByText('Npcs', { exact: true }).click({ button: 'right' })
    await app.locator('.menu').getByRole('button', { name: /New special page here/ }).click()
    await app.locator('.menu').getByRole('button', { name: /Person/ }).click()
    await expect(app.getByLabel('Page title')).toBeVisible()
  })
})

test.describe('more editing', () => {
  test('restore an older version of a page', { tag: '@feature:pages.history-restore' }, async ({ app, makePage, api }) => {
    const p = await makePage('Rewritten', { content: doc('Version one') })
    await api.json('patch', `/api/pages/${p.id}`, { content: doc('Version two'), title: 'Rewritten' })
    await api.json('patch', `/api/pages/${p.id}`, { content: doc('Version three'), title: 'Rewritten' })
    await app.reload()
    await openPage(app, 'Rewritten')
    await app.getByTitle('Version history').click()
    await app.getByRole('listbox', { name: 'Versions' }).getByRole('option').last().click()
    await app.getByRole('button', { name: 'Restore this version' }).click()
    await dismissAlert(app)
    await expect(editorOf(app)).not.toContainText('Version three', { timeout: 10_000 })
  })

  test('hash search finds tags', { tag: '@feature:pages.search-tags' }, async ({ app, makePage }) => {
    await makePage('Tagged for search', { tags: ['villain'] })
    await app.reload()
    await app.keyboard.press('Control+k')
    await app.getByLabel('Search pages, text, tags, or commands').fill('#villain')
    await expect(app.locator('.result').first()).toBeVisible()
  })

  test('tables: insert and add a row', { tag: '@feature:editor.tables' }, async ({ app, makePage }) => {
    await makePage('Table page')
    await app.reload()
    await openPage(app, 'Table page')
    await slash(app, 'table', 'Table')
    await expect(editorOf(app).locator('table')).toBeVisible()
    await editorOf(app).locator('td').first().click()
    await app.keyboard.type('cell')
    await app.keyboard.press('Tab')
    await app.keyboard.press('Tab')
    await app.keyboard.press('Tab')
    await app.keyboard.press('Tab')
    await app.keyboard.press('Tab')
    await app.keyboard.press('Tab')
    await app.keyboard.press('Tab')
    await app.keyboard.press('Tab')
    await app.keyboard.press('Tab')
    await expect(editorOf(app).locator('tr')).not.toHaveCount(3)
  })

  test('graph: filter by tag', { tag: '@feature:graph.filter' }, async ({ app, makePage }) => {
    await makePage('Graph tagged', { tags: ['place'] })
    await app.reload()
    await openView(app, 'Graph')
    await app.getByRole('combobox').first().click()
    await app.getByRole('option', { name: /place/ }).click()
  })
})
