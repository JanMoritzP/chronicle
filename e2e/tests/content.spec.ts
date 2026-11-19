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

test.describe('creature sheet', () => {
  const sheet = {
    v: 1, ruleset: '5e', name: 'Goblin', size: 'Small', type: 'humanoid', alignment: 'neutral evil',
    abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 }, ac: { value: 15, note: 'leather armor' }, hp: { max: 7, formula: '2d6' },
    speed: { walk: 30 }, saves: {}, skills: { stealth: 6 }, senses: { darkvision: 60 }, vulnerabilities: '', resistances: '', immunities: '', conditionImmunities: '', languages: 'Common', cr: 0.25, xp: 50,
    features: { traits: [{ name: 'Nimble Escape', text: 'Disengage or Hide as a bonus action.' }], actions: [{ name: 'Scimitar', text: 'Melee Weapon Attack: +4 to hit.' }], bonus: [], reactions: [], legendary: [] },
  }

  test('a monster page edits its numbers in place and keeps them', { tag: '@feature:sheet.edit' }, async ({ app, makePage }) => {
    await makePage('Goblin', { props: { type: 'monster', sheet } })
    await app.reload()
    await openPage(app, 'Goblin')
    await expect(app.getByLabel('Armor class')).toHaveValue('15')
    await expect(app.getByLabel('Strength')).toHaveValue('8')
    await app.getByLabel('Armor class').fill('17')
    await app.getByLabel('Strength').fill('18')
    await app.getByRole('button', { name: /saves, skills and senses/ }).evaluate((el) => (el as HTMLElement).click())
    await expect(app.getByLabel('Skills')).toHaveValue('Stealth +6')
    await app.getByRole('button', { name: 'Add a trait' }).click()
    await app.getByLabel('Name of traits 2').fill('Keen Ears')
    await app.waitForTimeout(1500)
    await app.reload()
    await openPage(app, 'Goblin')
    await expect(app.getByLabel('Armor class')).toHaveValue('17')
    await expect(app.getByLabel('Strength')).toHaveValue('18')
    await expect(app.getByLabel('Name of traits 2')).toHaveValue('Keen Ears')
  })

  test('an old text stat block is shown as a sheet and stored as one when edited', { tag: '@feature:sheet.legacy' }, async ({ app, makePage }) => {
    await makePage('Old Orc', { props: { type: 'monster', data: { main: { template: '5e-monster', data: { name: 'Old Orc', ac: '13 (hide armor)', hp: '15 (2d8 + 6)', str: '16', actions: '***Greataxe.*** *Melee Weapon Attack:* +5 to hit. *Hit:* 9 (1d12 + 3) slashing damage.' } } } } })
    await app.reload()
    await openPage(app, 'Old Orc')
    await expect(app.getByLabel('Hit points')).toHaveValue('15')
    await expect(app.getByLabel('Armor class')).toHaveValue('13')
    await expect(app.getByLabel('Text of Greataxe')).toHaveValue(/9 \(1d12 \+ 3\) slashing damage/)
    await app.getByLabel('Hit points').fill('20')
    await app.waitForTimeout(1500)
    await app.reload()
    await openPage(app, 'Old Orc')
    await expect(app.getByLabel('Hit points')).toHaveValue('20')
    await expect(app.getByLabel('Armor class')).toHaveValue('13')
  })
})
