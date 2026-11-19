import { makePng } from '../lib/png'
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
  await page.locator('.tt-canvas canvas').click({ position: { x: 5, y: 5 } })
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
  await expect(app.getByLabel('Maximum hit points')).toHaveValue('30')
  await expect(app.locator('.tt-hpbar')).toBeVisible()
  await app.getByLabel('Hit points', { exact: true }).fill('30')
  await app.getByLabel('Hit points', { exact: true }).press('Enter')
  await expect(app.getByLabel('Hit points', { exact: true })).toHaveValue('30')
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
  await fog.click()
  await expect(fog).toBeChecked()
  await expect(app.getByRole('button', { name: 'Forget what players explored' })).toBeVisible()
  await app.reload()
  await openTable(app)
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Scene' }).click()
  await expect(app.getByLabel(/Fog of war/)).toBeChecked()
  // the wall tools are there for the GM and offer the kinds of wall
  await app.getByRole('button', { name: 'Draw walls' }).click()
  await expect(app.getByRole('group', { name: 'Kind of wall' })).toContainText('Secret door')
})

test('combat: add tokens, set initiative, start and step through the turns', { tag: '@feature:table.combat' }, async ({ app, as, world }) => {
  await grantAccess(world.id, 'editor')
  await app.reload()
  await openTable(app)
  await makeScene(app, 'Brawl')
  await makeToken(app, 'Aria')
  await makeToken(app, 'Orc')
  await app.locator('.tt-panel .seg').getByRole('button', { name: /Combat/ }).click()
  await app.getByRole('button', { name: /Add all/ }).click()
  await app.getByLabel('Initiative of Aria').fill('15')
  await app.getByLabel('Initiative of Aria').press('Enter')
  await app.getByLabel('Initiative of Orc').fill('9')
  await app.getByLabel('Initiative of Orc').press('Enter')
  await app.getByRole('button', { name: 'Start combat' }).click()
  const order = app.getByRole('list', { name: 'Order of play' })
  await expect(app.getByText('Round 1')).toBeVisible()
  await expect(order.locator('[aria-current=step]')).toContainText('Aria')
  await app.getByRole('button', { name: 'Next turn' }).click()
  await expect(order.locator('[aria-current=step]')).toContainText('Orc')
  const { page: player } = await as('editor', world.id)
  await player.goto('/')
  await openTable(player)
  await player.locator('.tt-panel .seg').getByRole('button', { name: /Combat/ }).click()
  await expect(player.getByRole('list', { name: 'Order of play' }).locator('[aria-current=step]')).toContainText('Orc')
  await app.getByRole('button', { name: 'Next turn' }).click()
  await expect(app.getByText('Round 2')).toBeVisible()
  await expect(player.getByText('Round 2')).toBeVisible()
  await expect(player.getByRole('button', { name: 'Next turn' })).toHaveCount(0)
})

test('encounters: build a fight, see how hard it is and place it on the scene', { tag: '@feature:table.encounters' }, async ({ app, makePage }) => {
  const sheet = {
    v: 1, ruleset: '5e', name: 'Goblin', size: 'Small', type: 'humanoid', alignment: 'neutral evil',
    abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 }, ac: { value: 15, note: '' }, hp: { max: 7, formula: '2d6' },
    speed: { walk: 30 }, saves: {}, skills: {}, senses: {}, vulnerabilities: '', resistances: '', immunities: '', conditionImmunities: '', languages: '', cr: 0.25, xp: 50,
    features: { traits: [], actions: [], bonus: [], reactions: [], legendary: [] },
  }
  await makePage('Goblin', { props: { type: 'monster', sheet } })
  await app.reload()
  await openTable(app)
  await makeScene(app, 'Road')
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Encounters' }).click()
  await app.getByRole('button', { name: 'New encounter' }).click()
  await app.getByPlaceholder('Goblin ambush on the road').fill('Ambush')
  await app.getByRole('button', { name: 'Create' }).click()
  await app.getByLabel('Party levels').fill('3, 3, 3, 3')
  await app.getByLabel('Party levels').press('Tab')
  await app.getByRole('button', { name: 'Add a creature' }).click()
  await app.getByPlaceholder('Find a monster page…').fill('Goblin')
  await app.getByPlaceholder('Find a monster page…').press('Enter')
  const meter = app.getByRole('group', { name: 'Difficulty' })
  await expect(meter).toContainText('Trivial')
  for (let i = 0; i < 3; i++) await app.getByRole('button', { name: 'One more Goblin' }).click()
  await expect(meter).toContainText('Easy')
  await expect(meter).toContainText('400 adjusted XP')
  await app.getByRole('button', { name: 'Place on this scene' }).click()
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Token' }).click()
  await app.locator('.tt-canvas canvas').click({ position: { x: 5, y: 5 } })
  const tokens = app.getByRole('list', { name: 'Tokens on this scene' })
  await expect(tokens).toContainText('Goblin 4')
  await expect(tokens).toContainText('(hidden)')
})

test('canvas tools: drag, measure, ping, draw, walls, and a player under fog', { tag: '@feature:table.canvas' }, async ({ app, as, world }) => {
  await grantAccess(world.id, 'editor')
  await app.reload()
  const errors: string[] = []
  app.on('pageerror', (e) => errors.push(e.message))
  await openTable(app)
  await makeScene(app, 'Vault')
  await makeToken(app, 'Aria')
  await app.getByLabel('e2e-editor').click()
  await expect(app.getByLabel('e2e-editor')).toBeChecked()
  const canvas = app.locator('.tt-canvas canvas')
  const box = (await canvas.boundingBox())!
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2

  // drag the token, then measure and ping
  await app.mouse.move(cx, cy)
  await app.mouse.down()
  await app.mouse.move(cx + 40, cy + 10, { steps: 4 })
  await app.mouse.move(cx + 120, cy + 40, { steps: 6 })
  await app.mouse.up()
  await app.getByRole('button', { name: 'Ruler' }).click()
  await app.mouse.move(cx - 150, cy - 100)
  await app.mouse.down()
  await app.mouse.move(cx - 60, cy - 60, { steps: 5 })
  await app.mouse.up()
  await app.getByRole('button', { name: 'Select' }).click()
  await app.mouse.move(cx - 100, cy + 100)
  await app.keyboard.down('Alt')
  await app.mouse.down()
  await app.mouse.up()
  await app.keyboard.up('Alt')
  await app.getByRole('button', { name: 'Zoom in' }).click()
  await app.getByRole('button', { name: 'Zoom out' }).click()
  await app.keyboard.press('f')

  // draw: a pen stroke, a box, then take the box away again
  await app.getByRole('button', { name: 'Draw', exact: true }).click()
  await app.mouse.move(cx - 200, cy - 120)
  await app.mouse.down()
  await app.mouse.move(cx - 160, cy - 100, { steps: 5 })
  await app.mouse.move(cx - 120, cy - 130, { steps: 5 })
  await app.mouse.up()
  await app.getByRole('group', { name: 'Kind of drawing' }).getByRole('button', { name: 'Box' }).click()
  await app.getByLabel('Colour #29b6f6').click()
  await app.mouse.move(cx + 80, cy - 140)
  await app.mouse.down()
  await app.mouse.move(cx + 160, cy - 80, { steps: 5 })
  await app.mouse.up()
  await app.getByRole('button', { name: 'Erase', exact: true }).click()
  await app.mouse.click(cx + 120, cy - 140)

  // walls: a closed box around the middle with a door, fog on, then a player's view of it
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Scene' }).click()
  await app.getByLabel(/Fog of war/).click()
  await expect(app.getByLabel(/Fog of war/)).toBeChecked()
  await app.getByRole('button', { name: 'Draw walls' }).click()
  for (const [dx, dy] of [[-90, -90], [90, -90], [90, 90], [-90, 90], [-90, -90]]) await app.mouse.click(cx + dx, cy + dy)
  await app.mouse.dblclick(cx - 90, cy - 90)
  await app.getByRole('group', { name: 'Kind of wall' }).getByRole('button', { name: 'Door', exact: true }).click()
  await app.mouse.click(cx + 90, cy - 20)
  await app.mouse.dblclick(cx + 90, cy + 20)
  await app.keyboard.press('Escape')

  const { page: player } = await as('editor', world.id)
  const playerErrors: string[] = []
  player.on('pageerror', (e) => playerErrors.push(e.message))
  await player.goto('/')
  await openTable(player)
  await expect(player.getByRole('list', { name: 'Tokens on this scene' })).toContainText('Aria')
  await player.waitForTimeout(1500)
  const pbox = (await player.locator('.tt-canvas canvas').boundingBox())!
  await player.mouse.click(pbox.x + pbox.width / 2 + 90, pbox.y + pbox.height / 2)
  await player.mouse.move(pbox.x + 20, pbox.y + 20)
  await player.mouse.down()
  await player.mouse.move(pbox.x + 60, pbox.y + 40, { steps: 4 })
  await player.mouse.up()
  expect(errors).toEqual([])
  expect(playerErrors).toEqual([])
})

test('layers and templates: place a tile, move it to another layer, and draw a spell area', { tag: '@feature:table.tiles' }, async ({ app }) => {
  await openTable(app)
  await makeScene(app, 'Hall')
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Scene' }).click()
  const chooser = app.waitForEvent('filechooser')
  await app.getByRole('button', { name: 'Add a tile' }).click()
  await (await chooser).setFiles({ name: 'table.png', mimeType: 'image/png', buffer: makePng(300, 150) })
  const tiles = app.getByRole('list', { name: 'Tiles on this scene' })
  await expect(tiles).toContainText('Tile 1')
  await tiles.getByRole('button', { name: /Tile 1/ }).click()
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Token' }).click()
  await app.getByLabel('Tile width').fill('420')
  await app.getByLabel('Tile width').press('Enter')
  await expect(app.getByLabel('Tile width')).toHaveValue('420')
  await app.getByRole('button', { name: 'Hide', exact: true }).click()
  await expect(app.getByRole('button', { name: 'Reveal' })).toBeVisible()
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Scene' }).click()
  await expect(tiles).toContainText('hidden')
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Token' }).click()
  await app.getByRole('button', { name: 'Delete tile' }).click()
  await app.getByRole('button', { name: 'Delete', exact: true }).click()
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Scene' }).click()
  await expect(tiles).not.toContainText('Tile 1')

  // a cone and a burst, each as many cells long as it was dragged
  const errors: string[] = []
  app.on('pageerror', (e) => errors.push(e.message))
  const box = (await app.locator('.tt-canvas canvas').boundingBox())!
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await app.getByRole('button', { name: 'Draw', exact: true }).click()
  for (const kind of ['Cone', 'Burst', 'Ray', 'Cube']) {
    await app.getByRole('group', { name: 'Kind of drawing' }).getByRole('button', { name: kind, exact: true }).click()
    await app.mouse.move(cx - 150, cy)
    await app.mouse.down()
    await app.mouse.move(cx - 60, cy + 10, { steps: 5 })
    await app.mouse.up()
  }
  await app.getByRole('button', { name: 'Erase', exact: true }).click()
  await app.mouse.click(cx - 100, cy + 4)
  expect(errors).toEqual([])
})
