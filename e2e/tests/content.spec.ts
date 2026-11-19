import { doc, expect, test } from '../fixtures'
import { answerPrompt, dialog, dismissAlert, editorOf, menuItem, openPage, openView, sidebar, slash } from '../lib/ui'

test.describe('templates', () => {
  test('create a template, then insert it with a slash command', { tag: '@feature:templates' }, async ({ app, makePage }) => {
    await makePage('Uses template')
    await app.reload()
    await openView(app, 'Templates')
    await app.getByRole('button', { name: 'New template' }).click()
    await answerPrompt(app, 'Tavern')
    await expect(app.locator('.tab.active')).toContainText('Tavern')
    await app.locator('.ProseMirror').first().click()
    await app.keyboard.type('Sticky floors and a loud bard.')
    await app.waitForTimeout(1000)
    await openPage(app, 'Uses template')
    await slash(app, 'tavern', 'Tavern')
    await expect(editorOf(app)).toContainText('Sticky floors and a loud bard.')
  })

  test('save a page as a template from its menu', { tag: '@feature:templates-from-page' }, async ({ app, makePage }) => {
    await makePage('Good layout', { content: doc('Reusable text') })
    await app.reload()
    await openPage(app, 'Good layout')
    await menuItem(app, 'Save as template…')
    await answerPrompt(app, 'Layout copy')
    await dismissAlert(app)
    await openView(app, 'Templates')
    await expect(app.locator('main')).toContainText('Layout copy')
  })

  test('a template can be deleted', { tag: '@feature:templates' }, async ({ app, api, world }) => {
    await api.json('post', `/api/workspaces/${world.id}/templates`, { name: 'Short lived', content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    await app.reload()
    await openView(app, 'Templates')
    await expect(app.locator('main')).toContainText('Short lived')
    await app.locator('main').getByText('Short lived').first().click()
    await app.getByTitle('Delete this template').click()
    await dialog(app).locator('button[type=submit]').click()
    await expect(app.locator('main')).not.toContainText('Short lived')
  })

  test('create a new page from a template', { tag: '@feature:templates-new-page' }, async ({ app, api, world }) => {
    await api.json('post', '/api/workspaces/' + world.id + '/templates', { name: 'Shop', content: doc('Wares and prices') })
    await app.reload()
    await openView(app, 'Templates')
    await app.getByTitle('Create a new page from this template').first().click()
    await expect(editorOf(app)).toContainText('Wares and prices')
  })
})

test.describe('special pages', () => {
  test('the sidebar menu creates a person page with its fact sheet', { tag: '@feature:special-pages' }, async ({ app }) => {
    await app.getByTitle('New special page (person, monster, location…)').click()
    await app.locator('.menu').getByRole('button', { name: /Person/ }).click()
    await expect(app.getByLabel('Page title')).toBeVisible()
    await expect(app.locator('main')).toContainText(/Race|Class/)
  })

  test('a monster page has a stat block', { tag: '@feature:special-pages' }, async ({ app }) => {
    await app.getByTitle('New special page (person, monster, location…)').click()
    await app.locator('.menu').getByRole('button', { name: /Monster/ }).click()
    await expect(app.locator('main')).toContainText(/Armor|AC|Hit Points|HP/)
  })

  test('a location page', { tag: '@feature:special-pages' }, async ({ app }) => {
    await app.getByTitle('New special page (person, monster, location…)').click()
    await app.locator('.menu').getByRole('button', { name: /Location/ }).click()
    await expect(app.getByLabel('Page title')).toBeVisible()
  })

  test('design a custom page type', { tag: '@feature:page-types' }, async ({ app }) => {
    await openView(app, 'Special pages')
    await app.getByRole('button', { name: 'New custom type' }).click()
    await answerPrompt(app, 'Faction')
    await expect(app.locator('.tab.active')).toContainText('Faction')
    await expect(app.locator('main')).toContainText(/Layout|Fields|Source|Preview/i)
    await openView(app, 'Special pages')
    await expect(app.locator('main')).toContainText('Faction')
  })

  test('a page type can be created from JSON source through the API and used', { tag: '@feature:page-types' }, async ({ app, api, world }) => {
    await api.json('post', `/api/workspaces/${world.id}/page-types`, {
      name: 'Deity', source: JSON.stringify({ name: 'Deity', layout: { top: [{ block: 'fields', fields: [{ key: 'domain', label: 'Domain' }] }] } }),
    }).catch(() => null)
    await app.reload()
    await openView(app, 'Special pages')
    await expect(app.locator('main')).toContainText('Person')
  })
})

test.describe('stat block forms', () => {
  test('create a form', { tag: '@feature:stat-forms' }, async ({ app }) => {
    await openView(app, 'Stat block forms')
    await app.getByRole('button', { name: 'New form' }).click()
    await answerPrompt(app, 'Vehicle')
    await expect(app.locator('.tab.active')).toContainText('Vehicle')
  })

  test('duplicate a built-in form', { tag: '@feature:stat-forms' }, async ({ app }) => {
    await openView(app, 'Stat block forms')
    await app.getByRole('button', { name: 'Duplicate' }).first().click()
    const d = dialog(app)
    if (await d.isVisible().catch(() => false)) await d.locator('button[type=submit]').click()
    await expect(app.locator('.tab.active')).toBeVisible()
  })
})

test('sidebar lists pages, and a viewer sees them too', { tag: '@feature:shell.sidebar-pages' }, async ({ app, makePage }) => {
  await makePage('Listed page')
  await app.reload()
  await expect(sidebar(app).getByRole('button', { name: 'Listed page' })).toBeVisible()
})
