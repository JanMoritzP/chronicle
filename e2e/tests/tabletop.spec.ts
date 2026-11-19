import { expect, grantAccess, test } from '../fixtures'

const openTable = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Tabletop' }).click()
  await expect(page.locator('.tt-canvas canvas')).toBeVisible()
}

test('the GM adds a scene and tokens and a player sees them live, hidden ones excepted', { tag: '@feature:table.live' }, async ({ app, as, world }) => {
  await grantAccess(world.id, 'editor')
  await app.reload()
  await openTable(app)

  await app.locator('.tt-bar').getByRole('button', { name: 'Scene', exact: true }).click()
  await app.getByPlaceholder('The crypt under the chapel').fill('The crypt')
  await app.getByRole('button', { name: 'Create' }).click()
  await expect(app.locator('.tt-bar')).toContainText('The crypt')

  const { page: player } = await as('editor', world.id)
  await player.goto('/')
  await openTable(player)
  await expect(player.locator('.tt-bar')).toContainText('The crypt')

  for (const name of ['Aria', 'Orc']) {
    await app.locator('.tt-bar').getByRole('button', { name: 'Token' }).click()
    await app.getByPlaceholder('Goblin 1').fill(name)
    await app.getByRole('button', { name: 'Add' }).click()
    await expect(app.getByRole('list', { name: 'Tokens on this scene' })).toContainText(name)
  }
  await expect(player.getByRole('list', { name: 'Tokens on this scene' })).toContainText('Aria')
  await expect(player.getByRole('list', { name: 'Tokens on this scene' })).toContainText('Orc')

  // hiding the orc takes it off the player's table
  await app.getByRole('list', { name: 'Tokens on this scene' }).getByRole('button', { name: 'Orc' }).click()
  await app.getByRole('button', { name: 'Hide', exact: true }).click()
  await expect(player.getByRole('list', { name: 'Tokens on this scene' })).not.toContainText('Orc')
  await expect(player.getByRole('list', { name: 'Tokens on this scene' })).toContainText('Aria')
})

test('the GM edits a token from the panel', { tag: '@feature:table.panel' }, async ({ app }) => {
  await openTable(app)
  await app.locator('.tt-bar').getByRole('button', { name: 'Scene', exact: true }).click()
  await app.getByPlaceholder('The crypt under the chapel').fill('Tavern')
  await app.getByRole('button', { name: 'Create' }).click()
  await expect(app.locator('.tt-bar')).toContainText('Tavern')
  await app.locator('.tt-bar').getByRole('button', { name: 'Token' }).click()
  await app.getByPlaceholder('Goblin 1').fill('Barkeep')
  await app.getByRole('button', { name: 'Add' }).click()
  await app.getByRole('list', { name: 'Tokens on this scene' }).getByRole('button', { name: 'Barkeep' }).click()
  const name = app.getByLabel('Name')
  await name.fill('Barkeep Bram')
  await name.press('Enter')
  await expect(app.getByRole('button', { name: 'Hide', exact: true })).toBeVisible()
  await app.locator('.tt-canvas canvas').click({ position: { x: 5, y: 5 } })
  await expect(app.getByRole('list', { name: 'Tokens on this scene' })).toContainText('Barkeep Bram')
})
