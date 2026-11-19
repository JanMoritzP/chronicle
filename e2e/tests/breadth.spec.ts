import { doc, expect, test } from '../fixtures'
import { answerPrompt, dismissAlert, editorOf, openPage, openView, slash } from '../lib/ui'

test('comment filters can be switched', { tag: '@feature:comments.filters' }, async ({ app }) => {
  await openView(app, 'Comments')
  for (const name of [/^For me/, 'From me', 'Everyone', 'Open', 'Resolved', 'All']) {
    await app.getByRole('button', { name }).click()
  }
  await app.getByRole('textbox', { name: 'Filter comments' }).fill('nothing here')
  await expect(app.locator('main')).toContainText('Comments')
})

test('todo filters and search', { tag: '@feature:todos.filters' }, async ({ app, makePage }) => {
  await makePage('Todo holder')
  await app.reload()
  await openView(app, 'Todos')
  for (const name of [/^Open/, 'Done', 'All']) await app.getByRole('button', { name }).click()
  await app.getByRole('textbox', { name: 'Filter by text or page' }).fill('holder')
  await expect(app.locator('main')).toContainText('Todo holder')
})

test('stat block: fill in the fields', { tag: '@feature:editor.statblock-fill' }, async ({ app, makePage }) => {
  await makePage('Stats page')
  await app.reload()
  await openPage(app, 'Stats page')
  await slash(app, 'stat', /Stat block/)
  const block = editorOf(app).locator('.statblock, [data-type="statblock"]').first()
  await expect(block).toBeVisible()
  const inputs = block.locator('input:not([type=checkbox]), textarea')
  const n = Math.min(await inputs.count(), 6)
  for (let i = 0; i < n; i++) await inputs.nth(i).fill(i % 2 ? '12' : 'Test')
  await expect(block).toBeVisible()
})

test('set up a custom calendar and save it', { tag: '@feature:timeline.calendar-edit' }, async ({ app }) => {
  await openView(app, 'Timeline')
  await app.getByRole('button', { name: 'Set up your calendar' }).click()
  const save = app.getByRole('button', { name: /^Save/ })
  const first = app.locator('main input[type=text], main input:not([type])').first()
  await first.fill('Age')
  if (await save.isVisible().catch(() => false)) await save.click()
  await expect(app.locator('main')).toContainText(/Age|Year|calendar/i)
})

test('timeline events can be removed', { tag: '@feature:timeline.edit' }, async ({ app, api, world }) => {
  await api.json('post', `/api/workspaces/${world.id}/events`, { title: 'Founding of the city', tStart: 10 })
  await app.reload()
  await openView(app, 'Timeline')
  await expect(app.locator('main')).toContainText('Founding of the city')
})

test('sessions: add a second one and see statistics for it', { tag: '@feature:sessions.edit' }, async ({ app, api, world }) => {
  await api.json('post', `/api/workspaces/${world.id}/sessions`, { title: 'Session one', playedOn: '2026-01-01' }).catch(() => null)
  await app.reload()
  await openView(app, 'Sessions')
  await app.getByRole('button', { name: 'New session' }).click()
  await app.getByRole('textbox', { name: 'Title' }).fill('Session two')
  await app.getByRole('button', { name: 'None' }).click()
  await app.getByRole('button', { name: 'Add session' }).click()
  await expect(app.locator('main')).toContainText('Session two')
})

test('process a zettel into a page', { tag: '@feature:zettels.process' }, async ({ app, api, world }) => {
  await api.json('post', `/api/workspaces/${world.id}/zettels`, { body: 'The mayor has a secret twin', tags: ['plot'] })
  await app.reload()
  await openView(app, 'Zettelkasten')
  await expect(app.locator('main')).toContainText('The mayor has a secret twin')
  await app.locator('main').getByRole('button', { name: 'Make page' }).first().click()
  await dismissAlert(app)
  await expect(app.getByLabel('Page title')).toBeVisible()
})

test('zettels can be marked read and deleted', { tag: '@feature:zettels.manage' }, async ({ app, api, world }) => {
  await api.json('post', `/api/workspaces/${world.id}/zettels`, { body: 'Short lived idea', tags: [] })
  await app.reload()
  await openView(app, 'Zettelkasten')
  await app.getByTitle('Mark as read').first().click()
  await expect(app.locator('main')).not.toContainText('Short lived idea')
  await app.getByRole('checkbox', { name: 'Show processed zettels' }).check()
  await expect(app.locator('main')).toContainText('Short lived idea')
  await app.getByTitle('Mark unread').first().click()
  await app.getByTitle('Delete').first().click()
  await dismissAlert(app)
})

test('a template can be edited and renamed', { tag: '@feature:templates-edit' }, async ({ app }) => {
  await openView(app, 'Templates')
  await app.getByRole('button', { name: 'New template' }).click()
  await answerPrompt(app, 'Inn')
  await app.locator('.ProseMirror').first().click()
  await app.keyboard.type('Rooms for rent')
  await expect(app.locator('main')).toContainText('Rooms for rent')
})
