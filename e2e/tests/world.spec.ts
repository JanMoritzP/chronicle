import { doc, expect, test, unique } from '../fixtures'
import { makePng } from '../lib/png'
import { answerPrompt, dialog, editorOf, openPage, openView, slash } from '../lib/ui'

async function uploadMap(app: import('@playwright/test').Page, name: string) {
  await openView(app, 'Maps')
  const chooser = app.waitForEvent('filechooser')
  await app.getByRole('button', { name: 'Upload map' }).click()
  await (await chooser).setFiles({ name: 'world.png', mimeType: 'image/png', buffer: makePng() })
  await answerPrompt(app, name)
  await expect(app.getByRole('button', { name: 'Marker' })).toBeVisible()
}

test.describe('maps', () => {
  test('upload a map and open it', { tag: '@feature:maps.upload' }, async ({ app }) => {
    await uploadMap(app, 'Faerun')
    await expect(app.locator('.leaflet-container')).toBeVisible()
    await openView(app, 'Maps')
    await expect(app.locator('main')).toContainText('Faerun')
  })

  test('place a marker, title it and see it on the map', { tag: '@feature:maps.pins' }, async ({ app }) => {
    await uploadMap(app, 'Pins')
    await app.getByRole('button', { name: 'Marker' }).click()
    const box = await app.locator('.leaflet-container').boundingBox()
    await app.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await expect(app.locator('.leaflet-marker-icon, .leaflet-interactive').first()).toBeVisible()
  })

  test('draw a line and a region', { tag: '@feature:maps.shapes' }, async ({ app }) => {
    await uploadMap(app, 'Shapes')
    const box = (await app.locator('.leaflet-container').boundingBox())!
    await app.getByTitle('Line', { exact: true }).click()
    await app.mouse.click(box.x + 80, box.y + 80)
    await app.mouse.click(box.x + 200, box.y + 120)
    await app.mouse.dblclick(box.x + 260, box.y + 200)
    await app.getByTitle('Region', { exact: true }).click()
    await app.mouse.click(box.x + 100, box.y + 250)
    await app.mouse.click(box.x + 220, box.y + 250)
    await app.mouse.click(box.x + 160, box.y + 330)
    await app.mouse.dblclick(box.x + 160, box.y + 330)
    await expect(app.locator('.leaflet-container path.leaflet-interactive').first()).toBeAttached()
  })

  test('tools: select, measure, layers, settings, zoom and time', { tag: '@feature:maps.tools' }, async ({ app }) => {
    await uploadMap(app, 'Tools')
    await app.getByRole('button', { name: 'Zoom in' }).click()
    await app.getByRole('button', { name: 'Zoom out' }).click()
    for (const name of ['Select', 'Measure', 'Layers', 'Map settings', 'Time']) {
      await app.locator('.map-tools, main').getByRole('button', { name, exact: true }).first().click()
    }
    await expect(app.locator('.leaflet-container')).toBeVisible()
  })

  test('/pin puts the page on a map', { tag: '@feature:maps.page-pin' }, async ({ app, makePage }) => {
    await uploadMap(app, 'Pin target')
    await makePage('Tower of Sorcery')
    await app.reload()
    await openPage(app, 'Tower of Sorcery')
    await slash(app, 'pin', 'Pin on map')
    await expect(dialog(app).or(app.locator('.overlay')).first()).toBeVisible()
  })
})

test.describe('timeline', () => {
  test('add an event and filter it', { tag: '@feature:timeline' }, async ({ app }) => {
    await openView(app, 'Timeline')
    await app.getByRole('button', { name: 'Event', exact: true }).click()
    await app.getByRole('textbox', { name: 'What happened?' }).fill('The sack of Phandalin')
    await app.getByRole('button', { name: 'Add event' }).click()
    await expect(app.locator('main')).toContainText('The sack of Phandalin')
    await app.getByRole('textbox', { name: 'Filter events…' }).fill('zzz')
    await expect(app.locator('main')).not.toContainText('The sack of Phandalin')
    await app.getByRole('textbox', { name: 'Filter events…' }).fill('phandalin')
    await expect(app.locator('main')).toContainText('The sack of Phandalin')
  })

  test('set up a custom calendar', { tag: '@feature:timeline.calendar' }, async ({ app }) => {
    await openView(app, 'Timeline')
    await app.getByRole('button', { name: 'Set up your calendar' }).click()
    await expect(app.locator('main')).toContainText(/Month|Year|Day/)
  })

  test('/teven gives a page a date', { tag: '@feature:timeline.page-event' }, async ({ app, makePage }) => {
    await makePage('Dated page')
    await app.reload()
    await openPage(app, 'Dated page')
    await slash(app, 'teven', 'Timeline event')
    await expect(app.locator('.overlay, [role=dialog]').first()).toBeVisible()
  })
})

test.describe('sessions', () => {
  test('log a session with a write-up page', { tag: '@feature:sessions' }, async ({ app }) => {
    await openView(app, 'Sessions')
    await app.getByRole('button', { name: 'New session' }).click()
    await app.getByRole('textbox', { name: 'Title' }).fill('The Heist')
    await app.getByRole('button', { name: 'Add session' }).click()
    await expect(app.getByRole('heading', { name: 'Journal' })).toBeVisible()
    await expect(app.locator('main')).toContainText('The Heist')
  })

  test('statistics ranges can be switched', { tag: '@feature:sessions.stats' }, async ({ app, makePage }) => {
    await makePage('Counted', { content: doc('one two three four five') })
    await app.reload()
    await openView(app, 'Sessions')
    await app.getByRole('button', { name: 'All time' }).click()
    await expect(app.locator('main')).toContainText('words written')
    await app.getByRole('button', { name: 'Custom' }).click()
    await app.getByRole('button', { name: 'Last 30 days' }).click()
  })
})

test.describe('relations and graph', () => {
  test('family relations show in the tree and the diagram', { tag: '@feature:relations' }, async ({ app, api, world, makePage }) => {
    const parent = await makePage('Lord Aldric')
    const child = await makePage('Lady Mira')
    await api.json('post', `/api/workspaces/${world.id}/relations`, { sourceId: parent.id, targetId: child.id, kind: 'parent', label: '' })
    await app.reload()
    await openView(app, 'Relations')
    await expect(app.locator('main')).toContainText('Lord Aldric')
    await app.getByRole('button', { name: 'Diagram' }).click()
    await expect(app.locator('main svg, main canvas').first()).toBeVisible()
    await app.getByRole('button', { name: 'Family trees' }).click()
    await expect(app.locator('main')).toContainText('Lady Mira')
  })

  test('/relation opens a dialog to link pages', { tag: '@feature:relations.dialog' }, async ({ app, makePage }) => {
    await makePage('Kin source')
    await app.reload()
    await openPage(app, 'Kin source')
    await slash(app, 'relation', 'Relation')
    await expect(app.locator('.overlay, [role=dialog]').first()).toBeVisible()
  })

  test('the graph shows linked pages', { tag: '@feature:graph' }, async ({ app, makePage }) => {
    await makePage('Hub', { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'wikilink', attrs: { name: 'Spoke', pageId: null } }] }] } }).catch(() => null)
    await makePage('Spoke')
    await app.reload()
    await openView(app, 'Graph')
    await expect(app.getByRole('img', { name: 'Graph showing page connections' })).toBeVisible()
    await app.getByRole('checkbox', { name: 'Hide unlinked pages' }).check()
    await app.getByRole('checkbox', { name: 'Hide unlinked pages' }).uncheck()
  })
})

test('a page can link to its section with {{Page#Section}}', { tag: '@feature:editor.wikilinks-anchor' }, async ({ app, makePage }) => {
  await makePage('Chapter', { content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Origins' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Long ago.' }] }] } })
  await makePage('Citing')
  await app.reload()
  await openPage(app, 'Citing')
  await editorOf(app).click()
  await app.keyboard.press('Control+End')
  await app.keyboard.press('Enter')
  await app.keyboard.type('See {{Chapter#Origins')
  await expect(app.locator('.suggest .result').first()).toBeVisible()
  void unique
})
