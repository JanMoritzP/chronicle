import { doc, expect, test } from '../fixtures'
import { editorOf, openPage, openView, sidebar, slash } from '../lib/ui'

// The library is shared by every world, so these tests run in order in one worker.
test.describe.configure({ mode: 'serial' })

test('download the library from the empty state', { tag: '@feature:library.download' }, async ({ app, api }) => {
  await openView(app, 'Library')
  const status = await api.json<{ count: number }>('get', '/api/library/status')
  if (status.count === 0) {
    await app.getByRole('button', { name: 'Download the library' }).click()
  }
  await expect.poll(async () => (await api.json<{ count: number }>('get', '/api/library/status')).count, { timeout: 30_000 }).toBeGreaterThan(5)
  await app.reload()
  await openView(app, 'Library')
  await expect(app.locator('main')).toContainText('Fireball')
})

test('search the library and open an entry', { tag: '@feature:library.browse' }, async ({ app }) => {
  await openView(app, 'Library')
  const search = app.getByRole('textbox').first()
  await search.fill('goblin')
  await app.locator('main').getByText('Goblin', { exact: true }).first().click()
  await expect(app.locator('main')).toContainText(/Scimitar|Nimble Escape/)
  await search.fill('fireball')
  await app.locator('main').getByText('Fireball', { exact: true }).first().click()
  await expect(app.locator('main')).toContainText(/8d6|Evocation/)
})

test('add a library entry to the world as a page', { tag: '@feature:library.import' }, async ({ app }) => {
  await openView(app, 'Library')
  await app.getByRole('textbox').first().fill('goblin')
  await app.locator('main').getByText('Goblin', { exact: true }).first().click()
  await app.getByRole('button', { name: /Add to this world/ }).click()
  await expect(app.getByLabel('Page title')).toHaveValue(/Goblin/)
  await expect(sidebar(app).getByRole('button', { name: /Goblin/ }).first()).toBeVisible()
})

test('library terms in a page can be linked', { tag: '@feature:library.link-terms' }, async ({ app, makePage }) => {
  await makePage('Combat notes', { content: doc('The wizard casts Fireball while the goblin is Prone.') })
  await app.reload()
  await openPage(app, 'Combat notes')
  await app.getByTitle('More actions').click()
  await app.getByRole('button', { name: 'Link library terms' }).click()
  await expect(editorOf(app).locator('.wikilink.lib').first()).toBeVisible({ timeout: 10_000 })
})

test('typing {{ suggests library entries too', { tag: '@feature:library.wikilink' }, async ({ app, makePage }) => {
  await makePage('Spell notes')
  await app.reload()
  await openPage(app, 'Spell notes')
  await slash(app, 'todo')
  await app.keyboard.press('Escape')
  await editorOf(app).click()
  await app.keyboard.press('Control+End')
  await app.keyboard.press('Enter')
  await app.keyboard.type('{{Fireb')
  await expect(app.locator('.suggest .result').first()).toContainText('Fireball')
})

test('open one of every kind of entry', { tag: '@feature:library.entries' }, async ({ app }) => {
  await app.reload()
  await openView(app, 'Library')
  const search = app.getByRole('textbox').first()
  for (const [query, shown] of [['wolf', 'Armor Class'], ['light', 'Cantrip'], ['bag', 'Wondrous'], ['prone', 'Prone'], ['fire', 'Damage type'], ['evocation', 'Spell school']] as const) {
    await search.fill(query)
    await app.locator('main').getByText(new RegExp('^' + query, 'i')).first().click()
    await expect(app.locator('main')).toContainText(shown)
  }
})

test('an imported spell gets its own page with the spell layout', { tag: '@feature:library.import' }, async ({ app }) => {
  await openView(app, 'Library')
  await app.getByRole('textbox').first().fill('fireball')
  await app.locator('main').getByText('Fireball', { exact: true }).first().click()
  await app.getByRole('button', { name: /Add to this world/ }).click()
  await expect(app.getByLabel('Page title')).toHaveValue(/Fireball/)
  await expect(app.locator('main')).toContainText(/8d6|Evocation|Level 3/)
})

test('an imported creature shows a stat block', { tag: '@feature:library.import' }, async ({ app }) => {
  await openView(app, 'Library')
  await app.getByRole('textbox').first().fill('wolf')
  await app.locator('main').getByText('Wolf', { exact: true }).first().click()
  await app.getByRole('button', { name: /Add to this world/ }).click()
  await expect(app.getByLabel('Page title')).toHaveValue(/Wolf/)
  await expect(app.locator('main')).toContainText(/Armor|AC|13/)
})

test('open the classes, species, backgrounds, feats, items and terms', { tag: '@feature:library.kinds' }, async ({ app }) => {
  await app.reload()
  await openView(app, 'Library')
  const search = app.getByRole('textbox').first()
  const cases: [string, string, RegExp][] = [
    ['wizard', 'Level progression', /Hit die|D6/],
    ['evoker', 'Subclass of Wizard', /Sculpt Spells/],
    ['elf', 'Darkvision', /Fey Ancestry/],
    ['sage', 'Researcher', /Skill Proficiencies/],
    ['alert', 'Prerequisite', /initiative/],
    ['longsword', 'Versatile', /1d8/],
    ['chain mail', 'Armor', /16/],
    ['finesse', 'Weapon property', /Strength or Dexterity/],
    ['stealth', 'Skill', /DEX/],
    ['dexterity', 'Skills', /agility/i],
    ['elvish', 'Language', /Elf|elves/],
    ['beast', 'Creature type', /nonhumanoid/],
    ['cover', 'Rule', /trees/],
  ]
  for (const [query, shown, more] of cases) {
    await search.fill(query)
    await app.locator('main').getByText(new RegExp('^' + query, 'i')).first().click()
    await expect(app.locator('main'), query).toContainText(shown)
    await expect(app.locator('main'), query).toContainText(more)
  }
})

test('every kind of entry can be added to the world as its own page', { tag: '@feature:library.import-kinds' }, async ({ app }) => {
  await openView(app, 'Library')
  const search = app.getByRole('textbox').first()
  for (const query of ['wizard', 'elf', 'sage', 'alert', 'longsword', 'chain mail', 'finesse', 'cover']) {
    await openView(app, 'Library')
    await search.fill(query)
    await app.locator('main').getByText(new RegExp('^' + query, 'i')).first().click()
    await app.getByRole('button', { name: /Add to this world/ }).click()
    // the longsword page already links to Finesse in the library, so adding it offers to point that link at the new page
    if (query === 'finesse') await app.getByRole('button', { name: 'Point links to the page' }).click()
    await expect(app.getByLabel('Page title')).toHaveValue(new RegExp(query, 'i'))
  }
})

test('a spell and an item from the library are added to a character sheet', { tag: '@feature:library.sheet' }, async ({ app, makePage }) => {
  await makePage('Lysa', { props: { type: 'person' } })
  await app.reload()
  await openPage(app, 'Lysa')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  await app.getByLabel('Add a spell from the library').fill('fireball')
  await app.getByRole('list', { name: 'Results for Add a spell from the library' }).getByRole('button', { name: 'Fireball', exact: true }).first().click()
  await expect(app.getByLabel('Spells', { exact: true })).toHaveValue(/Level 3: Fireball/)
  await app.getByLabel('Add an item from the library').fill('longsword')
  await app.getByRole('list', { name: 'Results for Add an item from the library' }).getByRole('button', { name: 'Longsword', exact: true }).first().click()
  await expect(app.getByLabel('Item 1')).toHaveValue('Longsword')
})

test('a species and a background from the library are put on a character sheet', { tag: '@feature:library.origin' }, async ({ app, makePage }) => {
  await makePage('Orla', { props: { type: 'person' } })
  await app.reload()
  await openPage(app, 'Orla')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  await app.getByLabel('Choose a species from the library').fill('elf')
  await app.getByRole('list', { name: 'Results for Choose a species from the library' }).getByRole('button').first().click()
  await expect(app.getByLabel('Species', { exact: true })).toHaveValue(/Elf/)
  await app.getByLabel('Choose a background from the library').fill('sage')
  await app.getByRole('list', { name: 'Results for Choose a background from the library' }).getByRole('button').first().click()
  await expect(app.getByLabel('Background', { exact: true })).toHaveValue('Sage')
})
