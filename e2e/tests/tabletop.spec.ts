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

const makeScene = async (page: import('@playwright/test').Page, name: string) => {
  await page.locator('.tt-bar').getByRole('button', { name: 'Scene', exact: true }).click()
  await page.getByPlaceholder('The crypt under the chapel').fill(name)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.locator('.tt-bar')).toContainText(name)
}
const makeToken = async (page: import('@playwright/test').Page, name: string) => {
  await page.locator('.tt-bar').getByRole('button', { name: 'Token' }).click()
  await page.getByPlaceholder('Goblin 1').fill(name)
  await page.getByRole('button', { name: 'Add' }).click()
  await page.getByRole('list', { name: 'Tokens on this scene' }).getByRole('button', { name: name }).click()
}

test('chat and dice: a roll is shown to everyone, a whisper only to its target', { tag: '@feature:table.chat' }, async ({ app, as, world }) => {
  await grantAccess(world.id, 'editor')
  await app.reload()
  await openTable(app)
  const { page: player } = await as('editor', world.id)
  await player.goto('/')
  await openTable(player)
  for (const p of [app, player]) await p.locator('.tt-panel .seg').getByRole('button', { name: /Chat/ }).click()

  await app.getByLabel('Chat message').fill('/roll 1d20+5 stealth')
  await app.getByLabel('Chat message').press('Enter')
  for (const p of [app, player]) {
    await expect(p.getByRole('list', { name: 'Chat' })).toContainText('stealth')
    await expect(p.getByRole('list', { name: 'Chat' }).locator('.tt-total')).toBeVisible()
  }
  await player.getByRole('group', { name: 'Quick dice' }).getByRole('button', { name: 'd20' }).click()
  await expect(app.getByRole('list', { name: 'Chat' }).locator('.tt-rollout')).toHaveCount(2)

  await player.getByLabel('Chat message').fill('/w gm the door is trapped')
  await player.getByLabel('Chat message').press('Enter')
  await expect(app.getByRole('list', { name: 'Chat' })).toContainText('the door is trapped')
  await player.getByLabel('Chat message').fill('/roll banana')
  await player.getByLabel('Chat message').press('Enter')
  await expect(player.getByRole('alert')).toContainText('not a roll')
})

test("hit points, damage, healing and conditions on a token", { tag: '@feature:table.stats' }, async ({ app }) => {
  await openTable(app)
  await makeScene(app, 'Arena')
  await makeToken(app, 'Ogre')
  await app.getByLabel('Maximum hit points').fill('30')
  await app.getByLabel('Maximum hit points').press('Enter')
  await app.getByLabel('Hit points', { exact: true }).fill('30')
  await app.getByLabel('Hit points', { exact: true }).press('Enter')
  await app.getByLabel('Amount of damage or healing').fill('8')
  await app.getByRole('button', { name: 'Damage' }).click()
  await expect(app.getByLabel('Hit points', { exact: true })).toHaveValue('22')
  await app.getByLabel('Amount of damage or healing').fill('50')
  await app.getByRole('button', { name: 'Heal' }).click()
  await expect(app.getByLabel('Hit points', { exact: true })).toHaveValue('30')
  const prone = app.getByRole('group', { name: 'Conditions' }).getByRole('button', { name: 'Prone' })
  await prone.click()
  await expect(prone).toHaveAttribute('aria-pressed', 'true')
  await prone.click()
  await expect(prone).toHaveAttribute('aria-pressed', 'false')
})

test('the GM turns on fog and darkness for a scene and the choice is kept', { tag: '@feature:table.fog' }, async ({ app }) => {
  await openTable(app)
  await makeScene(app, 'Catacombs')
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Scene' }).click()
  const fog = app.getByLabel(/Fog of war/)
  await expect(fog).not.toBeChecked()
  await fog.check()
  await expect(app.getByRole('button', { name: 'Forget what players explored' })).toBeVisible()
  await app.reload()
  await openTable(app)
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Scene' }).click()
  await expect(app.getByLabel(/Fog of war/)).toBeChecked()
  // the wall tools are there for the GM and offer the kinds of wall
  await app.getByRole('button', { name: 'Draw walls' }).click()
  await expect(app.getByRole('group', { name: 'Kind of wall' })).toContainText('Secret door')
})
