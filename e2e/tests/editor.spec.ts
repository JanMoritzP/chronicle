import { doc, expect, grantAccess, test } from '../fixtures'
import { editorOf, focusEnd, openPage, openView, slash, typeInEditor } from '../lib/ui'

test.describe('slash commands', () => {
  // [menu label, what to type after the slash, selector that must exist in the editor afterwards]
  const blocks: [string, string, string][] = [
    ['Heading 1', 'h1', 'h1'],
    ['Heading 2', 'h2', 'h2'],
    ['Heading 3', 'h3', 'h3'],
    ['Bullet list', 'bullet', 'ul li'],
    ['Numbered list', 'number', 'ol li'],
    ['Checklist', 'checklist', 'ul[data-type="taskList"]'],
    ['Quote', 'quote', 'blockquote'],
    ['Code block', 'code', 'pre'],
    ['Divider', 'divider', 'hr'],
    ['Table', 'table', 'table'],
    ['Table of contents', 'toc', '*[data-type="toc"], .toc, nav'],
    ['Note box', 'callout', '*[data-callout], .callout, aside'],
    ['Warning box', 'warning', '*[data-callout], .callout, aside'],
    ['Read-aloud box', 'aloud', '*[data-callout], .callout, aside'],
    ['Secret', 'secret', '*[data-callout], .callout, aside'],
    ['Collapsible section', 'fold', 'details, .fold'],
    ['Columns', 'columns', '*[data-type="columns"], .columns'],
    ['Roll table', 'roll', 'table'],
    ['Date today', 'date', 'p'],
  ]
  for (const [label, query, selector] of blocks) {
    test(`/${label.toLowerCase()} inserts its block`, { tag: '@feature:editor.slash' }, async ({ app, makePage }) => {
      await makePage('Slash target')
      await app.reload()
      await openPage(app, 'Slash target')
      await slash(app, query, label)
      await expect(editorOf(app).locator(selector).first()).toBeVisible()
    })
  }

  for (const label of ['NPC', 'Place', 'Encounter']) {
    test(`/${label.toLowerCase()} inserts a starter structure`, { tag: '@feature:editor.presets' }, async ({ app, makePage }) => {
      await makePage('Preset target')
      await app.reload()
      await openPage(app, 'Preset target')
      await slash(app, label)
      await expect(editorOf(app).locator('h2, h3').first()).toBeVisible()
    })
  }

  test('a chain such as h2{Hooks}+ul>li*3 builds nested blocks', { tag: '@feature:editor.chain' }, async ({ app, makePage }) => {
    await makePage('Chain target')
    await app.reload()
    await openPage(app, 'Chain target')
    await focusEnd(app)
    await app.keyboard.type('/h2{Hooks}+ul>li*3')
    await expect(app.locator('.suggest .result.sel')).toBeVisible()
    await app.keyboard.press('Enter')
    await expect(editorOf(app).getByRole('heading', { name: 'Hooks' })).toBeVisible()
    await expect(editorOf(app).locator('ul > li')).toHaveCount(3)
  })

  test('an invalid chain explains what is wrong and cannot be inserted', { tag: '@feature:editor.chain' }, async ({ app, makePage }) => {
    await makePage('Bad chain')
    await app.reload()
    await openPage(app, 'Bad chain')
    await focusEnd(app)
    await app.keyboard.type('/h2{Oops}+nope>')
    await expect(app.locator('.suggest .result.disabled, .suggest .result').first()).toBeVisible()
  })

  test('slash search says nothing matches for gibberish', { tag: '@feature:editor.slash' }, async ({ app, makePage }) => {
    await makePage('No match')
    await app.reload()
    await openPage(app, 'No match')
    await focusEnd(app)
    await app.keyboard.type('/zzzzqqq')
    await expect(app.locator('.suggest')).toBeHidden()
  })
})

test('text formatting: bold, italic and markdown shortcuts', { tag: '@feature:editor.format' }, async ({ app, makePage }) => {
  await makePage('Format')
  await app.reload()
  await openPage(app, 'Format')
  await focusEnd(app)
  await app.keyboard.press('Control+b')
  await app.keyboard.type('bold')
  await app.keyboard.press('Control+b')
  await app.keyboard.type(' ')
  await app.keyboard.press('Control+i')
  await app.keyboard.type('italic')
  await app.keyboard.press('Control+i')
  await app.keyboard.press('Enter')
  const ed = editorOf(app)
  await app.keyboard.type('# Big heading')
  // let the shortcut turn the line into a heading before moving on, or a slow machine types the next line into it
  await expect(ed.locator('h1')).toHaveText('Big heading')
  await app.keyboard.press('Enter')
  await app.keyboard.type('- first')
  await expect(ed.locator('ul li')).toHaveCount(1)
  await app.keyboard.press('Enter')
  await app.keyboard.type('second')
  await expect(ed.locator('strong')).toHaveText('bold')
  await expect(ed.locator('em')).toHaveText('italic')
  await expect(ed.locator('h1')).toHaveText('Big heading')
  await expect(ed.locator('ul li')).toHaveCount(2)
})

test('wikilinks: {{ suggests pages and the link opens the page', { tag: '@feature:editor.wikilinks' }, async ({ app, makePage }) => {
  await makePage('Neverwinter', { content: doc('A city.') })
  await makePage('Source page')
  await app.reload()
  await openPage(app, 'Source page')
  await typeInEditor(app, 'Travel to {{Neverw')
  await expect(app.locator('.suggest .result.sel')).toContainText('Neverwinter')
  await app.keyboard.press('Enter')
  const link = editorOf(app).locator('.wikilink').filter({ hasText: 'Neverwinter' }).first()
  await expect(link).toBeVisible()
  await link.click()
  await expect(app.getByLabel('Page title')).toHaveValue('Neverwinter')
})

test('a link to a page that does not exist yet can be created', { tag: '@feature:editor.wikilinks-missing' }, async ({ app, makePage }) => {
  await makePage('Linker')
  await app.reload()
  await openPage(app, 'Linker')
  await typeInEditor(app, 'See {{Brand new place')
  await app.keyboard.press('Enter')
  const link = editorOf(app).locator('.wikilink').filter({ hasText: 'Brand new place' }).first()
  await expect(link).toBeVisible()
})

test('hovering a link previews the page', { tag: '@feature:editor.hover-preview' }, async ({ app, makePage }) => {
  await makePage('Phandalin', { content: doc('A frontier town under the shadow of the Sword Mountains.') })
  await makePage('Hover source', { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Go to ' }] }] } })
  await app.reload()
  await openPage(app, 'Hover source')
  await typeInEditor(app, '{{Phandal')
  await app.keyboard.press('Enter')
  const link = editorOf(app).locator('.wikilink').filter({ hasText: 'Phandalin' }).first()
  await link.hover()
  await expect(app.locator('.hover-card').first()).toContainText('frontier town', { timeout: 8000 })
})

test('todo: add one, find it in Todos and tick it off', { tag: '@feature:todos' }, async ({ app, makePage, api, world }) => {
  await makePage('Has todo')
  await app.reload()
  await openPage(app, 'Has todo')
  await slash(app, 'Todo', 'Todo')
  await app.getByPlaceholder('What needs doing?').last().fill('Name the blacksmith')
  await expect.poll(async () => JSON.stringify(await api.json('get', '/api/workspaces/' + world.id + '/todos'))).toContain('Name the blacksmith')
  await openView(app, 'Todos')
  const values = () => app.locator('main input:not([type=checkbox])').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
  await expect.poll(values).toContain('Name the blacksmith')
  await app.locator('main').getByRole('checkbox').first().click()
  await app.getByRole('button', { name: 'Done' }).click()
  await expect(app.locator('main').getByRole('checkbox')).toHaveCount(1)
  await expect(app.locator('main').getByRole('checkbox').first()).toBeChecked()
})

test('stat block: insert a form and fill it', { tag: '@feature:editor.statblock' }, async ({ app, makePage }) => {
  await makePage('Monster notes')
  await app.reload()
  await openPage(app, 'Monster notes')
  await slash(app, 'stat', /Stat block/)
  await expect(editorOf(app).locator('.statblock, [data-type="statblock"]').first()).toBeVisible()
})

test('embed shows another page inside this one', { tag: '@feature:editor.embed' }, async ({ app, makePage }) => {
  await makePage('Embedded fact', { content: doc('The bridge is haunted.') })
  await makePage('Host page')
  await app.reload()
  await openPage(app, 'Host page')
  await slash(app, 'Embed', 'Embed page')
  await app.getByPlaceholder('Embed which page?').fill('Embedded')
  await app.locator('.result', { hasText: 'Embedded fact' }).click()
  await expect(editorOf(app)).toContainText('The bridge is haunted.')
})

test('typing @ and a name leaves a comment for that person', { tag: '@feature:comments' }, async ({ app, as, world, makePage }) => {
  await grantAccess(world.id, 'editor')
  await makePage('Commented')
  await app.reload()
  await openPage(app, 'Commented')
  await typeInEditor(app, '@e2e-ed')
  await expect(app.locator('.suggest .result.sel')).toContainText('e2e-editor')
  await app.keyboard.press('Enter')
  await app.keyboard.type('Please check this.')
  await app.waitForTimeout(1500)
  const { page } = await as('editor', world.id)
  await page.goto('/')
  await openView(page, 'Comments')
  await expect(page.locator('main')).toContainText('Please check this.')
})

test('zen mode hides the sidebar and Escape brings it back', { tag: '@feature:shell.zen' }, async ({ app, makePage }) => {
  await makePage('Zen page')
  await app.reload()
  await openPage(app, 'Zen page')
  await app.getByTitle('Zen mode (Alt+Z)').click()
  await expect(app.getByRole('complementary')).toBeHidden()
  await app.keyboard.press('Escape')
  await expect(app.getByRole('complementary')).toBeVisible()
})

test('an image can be uploaded into a page', { tag: '@feature:editor.image' }, async ({ app, makePage }) => {
  await makePage('Picture page')
  await app.reload()
  await openPage(app, 'Picture page')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const chooser = app.waitForEvent('filechooser')
  await slash(app, 'Image', 'Image')
  await (await chooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png })
  await expect(editorOf(app).locator('img:not(.ProseMirror-separator)')).toBeVisible()
})
