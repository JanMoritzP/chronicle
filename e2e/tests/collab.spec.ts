import { doc, expect, grantAccess, test } from '../fixtures'
import { editorOf, openPage, typeInEditor } from '../lib/ui'

test('two people editing one page see each other live', { tag: '@feature:collab.live' }, async ({ app, as, world, makePage }) => {
  await makePage('Shared notes', { content: doc('Start.') })
  await grantAccess(world.id, 'editor')
  await app.reload()
  await openPage(app, 'Shared notes')
  const { page: other } = await as('editor', world.id)
  await other.goto('/')
  await openPage(other, 'Shared notes')
  await typeInEditor(app, 'From the owner.')
  await expect(editorOf(other)).toContainText('From the owner.', { timeout: 15_000 })
  await typeInEditor(other, 'From the editor.')
  await expect(editorOf(app)).toContainText('From the editor.', { timeout: 15_000 })
})

test('an editor sees the caret of the owner', { tag: '@feature:collab.presence' }, async ({ app, as, world, makePage }) => {
  await makePage('Presence page', { content: doc('Hello.') })
  await grantAccess(world.id, 'editor')
  await app.reload()
  await openPage(app, 'Presence page')
  await editorOf(app).click()
  const { page: other } = await as('editor', world.id)
  await other.goto('/')
  await openPage(other, 'Presence page')
  await expect(other.locator('.collaboration-carets__label, .collaboration-caret__label, .collaboration-cursor__label').first()).toBeVisible({ timeout: 15_000 })
})

test('a viewer sees edits but cannot make any', { tag: '@feature:collab.viewer' }, async ({ app, as, world, makePage }) => {
  await makePage('Watched', { content: doc('Watch me.') })
  await grantAccess(world.id, 'viewer')
  await app.reload()
  await openPage(app, 'Watched')
  const { page: viewer } = await as('viewer', world.id)
  await viewer.goto('/')
  await openPage(viewer, 'Watched')
  await typeInEditor(app, 'Fresh words.')
  await expect(editorOf(viewer)).toContainText('Fresh words.', { timeout: 15_000 })
  await expect(editorOf(viewer)).toHaveAttribute('contenteditable', 'false')
})

test('a page made by someone else appears in the sidebar without a reload', { tag: '@feature:collab.sidebar' }, async ({ app, api, world }) => {
  await api.json('post', `/api/workspaces/${world.id}/pages`, { title: 'Arrived live' })
  await expect(app.getByRole('complementary').getByRole('button', { name: 'Arrived live' })).toBeVisible({ timeout: 15_000 })
})
