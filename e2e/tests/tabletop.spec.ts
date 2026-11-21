import { openPage } from '../lib/ui'
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
  // a failed message shows up as a banner; creating a scene must never leave one
  await expect(page.getByRole('alert')).toHaveCount(0)
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
  // reactions: spent by hand, back when their turn begins
  const react = app.getByRole('button', { name: /^Reaction of Aria/ })
  await expect(react).toHaveAttribute('aria-label', 'Reaction of Aria, ready')
  await react.click()
  await expect(react).toHaveAttribute('aria-label', 'Reaction of Aria, spent')
  await app.getByRole('button', { name: 'Next turn' }).click()
  await expect(order.locator('[aria-current=step]')).toContainText('Orc')
  await expect(react).toHaveAttribute('aria-label', 'Reaction of Aria, spent')
  await app.getByRole('button', { name: 'Next turn' }).click()
  await expect(order.locator('[aria-current=step]')).toContainText('Aria')
  await expect(react).toHaveAttribute('aria-label', 'Reaction of Aria, ready')
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

test('a world that plays by the 2024 rules rates a fight against a budget', { tag: '@feature:table.rules-2024' }, async ({ app, api, world, makePage }) => {
  const sheet = {
    v: 1, ruleset: '5e-2024', name: 'Ogre', size: 'Large', type: 'giant', alignment: 'chaotic evil',
    abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 }, ac: { value: 11, note: '' }, hp: { max: 59, formula: '7d10 + 21' },
    speed: { walk: 40 }, saves: {}, skills: {}, senses: {}, vulnerabilities: '', resistances: '', immunities: '', conditionImmunities: '', languages: '', cr: 2, xp: 450,
    features: { traits: [], actions: [], bonus: [], reactions: [], legendary: [] },
  }
  await makePage('Ogre', { props: { type: 'monster', sheet } })
  await api.json('patch', `/api/workspaces/${world.id}`, { settings: { system: '5e-2024' } })
  await app.reload()
  await openTable(app)
  await makeScene(app, 'Ford')
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Encounters' }).click()
  await app.getByRole('button', { name: 'New encounter' }).click()
  await app.getByPlaceholder('Goblin ambush on the road').fill('Ogres')
  await app.getByRole('button', { name: 'Create' }).click()
  await app.getByLabel('Party levels').fill('3, 3, 3, 3')
  await app.getByLabel('Party levels').press('Tab')
  await app.getByRole('button', { name: 'Add a creature' }).click()
  await app.getByPlaceholder('Find a monster page…').fill('Ogre')
  await app.getByPlaceholder('Find a monster page…').press('Enter')
  const meter = app.getByRole('group', { name: 'Difficulty' })
  await expect(meter).toContainText('2024 rules')
  await expect(meter).toContainText('Budget: Low 600 · Moderate 900 · High 1600')
  await expect(meter).toContainText('Low')
  for (let i = 0; i < 2; i++) await app.getByRole('button', { name: 'One more Ogre' }).click()
  // three ogres are 1,350 XP: above the moderate budget of 900, within the high budget of 1,600
  await expect(meter).toContainText('1350 XP of creatures')
  await expect(meter).toContainText('High')
})

test('a Pathfinder 2e character works out its numbers from level and ranks', { tag: '@feature:pf2e.character' }, async ({ app, api, world, makePage }) => {
  await api.json('patch', `/api/workspaces/${world.id}`, { settings: { system: 'pf2e' } })
  await makePage('Valeros', { props: { type: 'person' } })
  await app.reload()
  await openPage(app, 'Valeros')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  await app.getByLabel('Level', { exact: true }).fill('5')
  await app.getByLabel('Strength modifier').fill('4')
  await app.getByLabel('Wisdom modifier').fill('3')
  await app.getByLabel('Dexterity modifier').fill('2')
  await expect(app.getByLabel('Armor class', { exact: true })).toHaveText('12')
  // trained Perception at level 5 is 5 + 2, plus Wisdom 3
  await expect(app.getByRole('button', { name: 'Perception +10' })).toBeVisible()
  await app.getByLabel('Armor bonus').fill('4')
  await app.getByLabel('Dexterity cap').fill('1')
  await app.getByLabel('Armor proficiency: Untrained').click()
  await expect(app.getByLabel('Armor class', { exact: true })).toHaveText('22')
  await app.getByLabel('Athletics proficiency: Untrained').click()
  await app.getByLabel('Athletics proficiency: Trained').click()
  await app.getByLabel('Athletics proficiency: Expert').click()
  await expect(app.getByRole('button', { name: /^Athletics \+15/ })).toBeVisible()
  await app.getByRole('button', { name: 'Strike', exact: true }).click()
  await app.getByLabel('Strike 1').fill('Longsword')
  await expect(app.getByRole('group', { name: 'Longsword attacks' })).toContainText('+11')
  await app.waitForTimeout(1500)
  await app.reload()
  await openPage(app, 'Valeros')
  await expect(app.getByLabel('Armor class', { exact: true })).toHaveText('22')
  await expect(app.getByLabel('Level', { exact: true })).toHaveValue('5')
  await expect(app.getByRole('group', { name: 'Longsword attacks' })).toContainText('+11')
})

test('a Pathfinder 2e world: a creature sheet, and a threat rating by level', { tag: '@feature:pf2e' }, async ({ app, api, world, makePage }) => {
  await api.json('patch', `/api/workspaces/${world.id}`, { settings: { system: 'pf2e' } })
  await makePage('Orc warrior', { props: { type: 'monster' } })
  await app.reload()
  await openPage(app, 'Orc warrior')
  await app.getByRole('button', { name: 'Use a Pathfinder 2e sheet' }).click()
  await app.getByLabel('Level', { exact: true }).fill('3')
  await app.getByLabel('Perception', { exact: true }).fill('9')
  await app.getByRole('button', { name: 'Add', exact: true }).nth(1).click()
  await app.getByLabel('Name of actions entry 1').fill('Greataxe')
  await app.getByLabel('Attack bonus of Greataxe').fill('12')
  await app.waitForTimeout(1500)
  await app.reload()
  await openPage(app, 'Orc warrior')
  await expect(app.getByLabel('Level', { exact: true })).toHaveValue('3')
  await expect(app.getByLabel('Perception', { exact: true })).toHaveValue('9')
  await expect(app.getByLabel('Attack bonus of Greataxe')).toHaveValue('12')

  await openTable(app)
  await makeScene(app, 'Orc camp')
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Encounters' }).click()
  await app.getByRole('button', { name: 'New encounter' }).click()
  await app.getByPlaceholder('Goblin ambush on the road').fill('Patrol')
  await app.getByRole('button', { name: 'Create' }).click()
  await app.getByLabel('Party levels').fill('3, 3, 3, 3')
  await app.getByLabel('Party levels').press('Tab')
  await app.getByRole('button', { name: 'Add a creature' }).click()
  await app.getByPlaceholder('Find a monster page…').fill('Orc')
  await app.getByPlaceholder('Find a monster page…').press('Enter')
  const meter = app.getByRole('group', { name: 'Difficulty' })
  await expect(meter).toContainText('Pathfinder 2e')
  await expect(meter).toContainText('Trivial 40 · Low 60 · Moderate 80 · Severe 120 · Extreme 160')
  await app.getByRole('button', { name: 'One more Orc warrior' }).click()
  await expect(meter).toContainText('80 XP of creatures against party level 3')
  await expect(meter).toContainText('Moderate')
})

test('canvas: hex grids, tiles that can be dragged, doors that open and walls that can be erased', { tag: '@feature:table.canvas-more' }, async ({ app }) => {
  const errors: string[] = []
  app.on('pageerror', (e) => errors.push(e.message))
  await openTable(app)
  await makeScene(app, 'Hexmap')
  await makeToken(app, 'Scout')
  const canvas = app.locator('.tt-canvas canvas')
  const box = (await canvas.boundingBox())!
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2

  // every kind of grid and every rule for counting diagonals
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Scene' }).click()
  for (const [from, option] of [['Square', 'Hexes, pointy top'], ['Hexes, pointy top', 'Hexes, flat top'], ['Hexes, flat top', 'No grid'], ['No grid', 'Square']] as const) {
    await app.getByRole('combobox').filter({ hasText: from }).first().click()
    await app.getByRole('option', { name: option }).click()
    await expect(app.getByRole('combobox').filter({ hasText: option }).first()).toBeVisible()
  }
  for (const rule of ['Straight line length', 'Across then down', 'Every diagonal counts one cell']) {
    await app.getByRole('combobox').filter({ hasText: /Every second diagonal|Straight line|Across then down|Every diagonal/ }).first().click()
    await app.getByRole('option', { name: new RegExp(rule) }).click()
  }
  await app.getByRole('combobox').filter({ hasText: 'Square' }).first().click()
  await app.getByRole('option', { name: 'Hexes, pointy top' }).click()
  // on a hex grid a token still moves and the ruler still measures
  await app.mouse.move(cx, cy)
  await app.mouse.down()
  await app.mouse.move(cx + 60, cy + 30, { steps: 5 })
  await app.mouse.up()
  await app.getByRole('button', { name: 'Ruler' }).click()
  await app.mouse.move(cx - 120, cy - 60)
  await app.mouse.down()
  await app.mouse.move(cx + 20, cy - 10, { steps: 5 })
  await app.mouse.up()
  await app.getByRole('button', { name: 'Select' }).click()

  // a tile can be picked up and moved, then locked
  const chooser = app.waitForEvent('filechooser')
  await app.getByRole('button', { name: 'Add a tile' }).click()
  await (await chooser).setFiles({ name: 'crate.png', mimeType: 'image/png', buffer: makePng(120, 120) })
  await expect(app.getByRole('list', { name: 'Tiles on this scene' })).toContainText('Tile 1')
  await app.waitForTimeout(600)
  await app.mouse.move(cx - 150, cy + 100)
  await app.mouse.down()
  await app.mouse.up()
  await app.getByRole('list', { name: 'Tiles on this scene' }).getByRole('button', { name: /Tile 1/ }).click()
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Token' }).click()
  await app.getByRole('button', { name: 'Lock', exact: true }).click()
  await expect(app.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible()
  await app.getByRole('button', { name: 'Forward', exact: true }).click()
  await app.getByRole('button', { name: 'Back', exact: true }).click()
  await app.getByRole('button', { name: 'Bigger' }).click()
  await app.getByRole('button', { name: 'Smaller' }).click()
  await app.getByRole('button', { name: 'Unlock', exact: true }).click()
  await app.keyboard.press('Delete')

  // a door opens when clicked and a wall goes when erased
  await app.getByRole('button', { name: 'Draw walls' }).click()
  await app.getByRole('group', { name: 'Kind of wall' }).getByRole('button', { name: 'Door', exact: true }).click()
  await app.mouse.click(cx - 100, cy - 100)
  await app.mouse.dblclick(cx + 100, cy - 100)
  await app.getByRole('group', { name: 'Kind of wall' }).getByRole('button', { name: 'Window' }).click()
  await app.mouse.click(cx - 100, cy + 100)
  await app.mouse.dblclick(cx + 100, cy + 100)
  await app.getByRole('group', { name: 'Kind of wall' }).getByRole('button', { name: 'Secret door' }).click()
  await app.mouse.click(cx - 100, cy - 20)
  await app.mouse.dblclick(cx - 100, cy + 40)
  await app.getByRole('button', { name: 'Draw walls' }).click()
  await app.mouse.click(cx, cy - 100)
  await app.mouse.click(cx, cy - 100)
  await app.getByRole('button', { name: 'Erase', exact: true }).click()
  await app.mouse.click(cx - 100, cy + 100)
  await app.getByRole('button', { name: 'Select' }).click()
  await app.keyboard.press('f')
  await app.keyboard.press('Control+a')
  await app.keyboard.press('r')
  await app.keyboard.press('h')
  await app.keyboard.press('l')
  await app.keyboard.press('ArrowRight')
  await app.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('a token linked to a creature page gets its sheet card with a roll on every number', { tag: '@feature:table.card' }, async ({ app, makePage }) => {
  const sheet = {
    v: 1, ruleset: '5e', name: 'Bandit', size: 'Medium', type: 'humanoid', alignment: 'any non-lawful',
    abilities: { str: 11, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, ac: { value: 12, note: 'leather armor' }, hp: { max: 11, formula: '2d8 + 2' },
    speed: { walk: 30 }, saves: { dex: 3 }, skills: { stealth: 3 }, senses: {}, vulnerabilities: '', resistances: 'cold', immunities: '', conditionImmunities: '', languages: 'Common', cr: 0.125, xp: 25,
    features: { traits: [], actions: [{ name: 'Scimitar', text: 'Melee Weapon Attack: +3 to hit, reach 5 ft. Hit: 4 (1d6 + 1) slashing damage.', usage: { type: 'recharge', min: 5 } }, { name: 'Light Crossbow', text: 'Ranged Weapon Attack: +3 to hit, range 80/320 ft. DC 12 Dexterity saving throw.', usage: { type: 'perDay', times: 3 } }], bonus: [], reactions: [], legendary: [] },
  }
  await makePage('Bandit', { props: { type: 'monster', sheet } })
  await app.reload()
  await openTable(app)
  await makeScene(app, 'Road')
  await makeToken(app, 'Bandit 1')
  await app.getByRole('button', { name: 'Link a page' }).click()
  await app.getByPlaceholder('Find a monster or character…').fill('Bandit')
  await app.getByPlaceholder('Find a monster or character…').press('Enter')
  const card = app.locator('.tt-sheet')
  await expect(card).toContainText('Medium humanoid')
  await expect(app.getByLabel('Hit points', { exact: true })).toHaveValue('11')
  await card.getByRole('button', { name: /^Initiative/ }).click()
  await card.getByRole('group', { name: 'Ability checks' }).getByRole('button').first().click({ modifiers: ['Shift'] })
  await card.getByRole('button', { name: /^DEX save/ }).click({ modifiers: ['Control'] })
  await card.getByRole('button', { name: /^Stealth/ }).click()
  await card.getByText('Scimitar').click()
  await card.getByRole('button', { name: /^To hit/ }).first().click()
  await card.getByRole('button', { name: /1d6\+1/ }).click()
  await app.locator('.tt-panel .seg').getByRole('button', { name: /Chat/ }).click()
  const chat = app.getByRole('list', { name: 'Chat' })
  await expect(chat).toContainText('Bandit 1: Initiative')
  await expect(chat).toContainText('Scimitar, attack')
  await expect(chat).toContainText('Scimitar, slashing damage')
  await expect(chat.locator('.tt-rollout')).toHaveCount(6)
  // conditions toggle on and off
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Token' }).click()
  const prone = app.getByRole('group', { name: 'Conditions' }).getByRole('button', { name: 'Prone' })
  await prone.click()
  await expect(prone).toHaveAttribute('aria-pressed', 'true')
  await prone.click()
  await expect(prone).toHaveAttribute('aria-pressed', 'false')
})

test('the GM switches on damage types: resistance halves a hit and it is said in chat; rests and death saves work', { tag: '@feature:table.automation' }, async ({ app, makePage }) => {
  const sheet = {
    v: 1, kind: 'character', ruleset: '5e', name: 'Sister Vey', size: '', type: '', alignment: '',
    abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 14, cha: 10 }, ac: { value: 15, note: '' }, hp: { max: 20, formula: '', current: 20, temp: 0 },
    speed: { walk: 30 }, saves: {}, skills: {}, senses: {}, vulnerabilities: '', resistances: 'fire', immunities: '', conditionImmunities: '', languages: '',
    hitDice: [{ sides: 8, total: 3, used: 2 }], deathSaves: { ok: 0, fail: 0 }, spellcasting: { ability: 'wis', slots: [{ total: 3, used: 2 }] },
    features: { traits: [], actions: [], bonus: [], reactions: [], legendary: [] },
  }
  await makePage('Sister Vey', { props: { type: 'person', sheet } })
  await app.reload()
  await openTable(app)
  await makeScene(app, 'Chapel')
  await makeToken(app, 'Vey')
  await app.getByRole('button', { name: 'Link a page' }).click()
  await app.getByPlaceholder('Find a monster or character…').fill('Sister Vey')
  await app.getByPlaceholder('Find a monster or character…').press('Enter')
  await expect(app.getByLabel('Hit points', { exact: true })).toHaveValue('20')

  // off by default: no damage type to choose
  await expect(app.getByRole('button', { name: 'Select Damage type' })).toHaveCount(0)
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Table', exact: true }).click()
  await app.getByLabel('Damage types: resistance, vulnerability and immunity').click()
  await expect(app.getByLabel('Damage types: resistance, vulnerability and immunity')).toBeChecked()
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Token', exact: true }).click()
  await app.getByLabel('Amount of damage or healing').fill('10')
  await app.getByTitle('Damage type').click()
  await app.getByRole('option', { name: 'Fire' }).click()
  await app.getByRole('button', { name: 'Damage', exact: true }).click()
  await expect(app.getByLabel('Hit points', { exact: true })).toHaveValue('15')
  await app.locator('.tt-panel .seg').getByRole('button', { name: /Chat/ }).click()
  await expect(app.getByRole('list', { name: 'Chat' })).toContainText('takes 5 fire damage (resistant)')

  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Token', exact: true }).click()
  const ready = app.getByRole('group', { name: 'Spell slots' }).getByRole('button', { name: /ready/ })
  await expect(ready).toHaveCount(1)
  // a long rest brings the hit points back
  await app.getByRole('button', { name: 'Long rest' }).click()
  await expect(app.getByLabel('Hit points', { exact: true })).toHaveValue('20')
  await expect(ready).toHaveCount(3)

  // at 0 hit points a death save is offered
  await app.getByLabel('Amount of damage or healing').fill('99')
  await app.getByRole('button', { name: 'Damage', exact: true }).click()
  await expect(app.getByLabel('Hit points', { exact: true })).toHaveValue('0')
  await app.getByRole('button', { name: 'Death save' }).click()
  await app.locator('.tt-panel .seg').getByRole('button', { name: /Chat/ }).click()
  await expect(app.getByRole('list', { name: 'Chat' })).toContainText('Death saving throw')
})

test('with attacks switched on, a feature can be rolled against a target and the damage is applied', { tag: '@feature:table.attacks' }, async ({ app, makePage }) => {
  const sheet = {
    v: 1, ruleset: '5e', name: 'Archer', size: 'Medium', type: 'humanoid', alignment: '',
    abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }, ac: { value: 13, note: '' }, hp: { max: 11, formula: '' },
    speed: { walk: 30 }, saves: {}, skills: {}, senses: {}, vulnerabilities: '', resistances: '', immunities: '', conditionImmunities: '', languages: '',
    features: { traits: [], actions: [{ name: 'Longbow', text: 'Ranged Weapon Attack: +60 to hit, range 150/600 ft. Hit: 9 (1d4 + 6) piercing damage.' }], bonus: [], reactions: [], legendary: [] },
  }
  await makePage('Archer', { props: { type: 'monster', sheet } })
  await app.reload()
  await openTable(app)
  await makeScene(app, 'Range')
  await makeToken(app, 'Dummy')
  await app.getByLabel('Maximum hit points').fill('50')
  await app.getByLabel('Maximum hit points').press('Enter')
  await app.getByLabel('Hit points', { exact: true }).fill('50')
  await app.getByLabel('Hit points', { exact: true }).press('Enter')
  await app.getByLabel('Armor class').fill('10')
  await app.getByLabel('Armor class').press('Enter')
  await makeToken(app, 'Archer 1')
  await app.getByRole('button', { name: 'Link a page' }).click()
  await app.getByPlaceholder('Find a monster or character…').fill('Archer')
  await app.getByPlaceholder('Find a monster or character…').press('Enter')
  await expect(app.locator('.tt-sheet')).toContainText('Medium humanoid')
  // off by default: there is no target to choose
  await expect(app.getByTitle('Target of attacks')).toHaveCount(0)
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Table', exact: true }).click()
  await app.getByLabel('Attacks and saves rolled against targets, with the damage applied').click()
  await expect(app.getByLabel('Attacks and saves rolled against targets, with the damage applied')).toBeChecked()
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Token', exact: true }).click()
  await expect(async () => {
    await app.getByTitle('Target of attacks').click()
    await expect(app.getByRole('option', { name: 'Dummy' })).toBeVisible({ timeout: 1500 })
  }).toPass()
  await app.getByRole('option', { name: 'Dummy' }).click()
  await app.locator('.tt-sheet').getByText('Longbow').click()
  await app.getByRole('button', { name: 'Use Longbow on the target' }).click()
  await app.locator('.tt-panel .seg').getByRole('button', { name: /Chat/ }).click()
  const chat = app.getByRole('list', { name: 'Chat' })
  await expect(chat).toContainText('Longbow, attack on Dummy')
  await expect(chat).toContainText(/(critically hits|hits) Dummy for \d+ piercing|misses Dummy/)

  // a spell area drawn on the map can be the target: everyone inside it is rolled against
  const box = (await app.locator('.tt-canvas canvas').boundingBox())!
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await app.getByRole('button', { name: 'Draw', exact: true }).click()
  await app.getByRole('group', { name: 'Kind of drawing' }).getByRole('button', { name: 'Burst', exact: true }).click()
  await app.mouse.move(cx, cy)
  await app.mouse.down()
  await app.mouse.move(cx + 150, cy, { steps: 5 })
  await app.mouse.up()
  await app.locator('.tt-panel .seg').getByRole('button', { name: 'Token', exact: true }).click()
  await expect(async () => {
    await app.getByTitle('Target of attacks').click()
    await expect(app.getByRole('option', { name: /Everyone in the burst 1/ })).toBeVisible({ timeout: 1500 })
  }).toPass()
  await app.getByRole('option', { name: /Everyone in the burst 1/ }).click()
  await app.locator('.tt-sheet').getByText('Longbow').click()
  await app.getByRole('button', { name: 'Use Longbow on the target' }).click()
  await app.locator('.tt-panel .seg').getByRole('button', { name: /Chat/ }).click()
  await expect(chat.getByText('Longbow, attack on Archer 1')).toBeVisible()
})

test('spell effects with a duration go on a token and can be ended', { tag: '@feature:table.effects' }, async ({ app }) => {
  await openTable(app)
  await makeScene(app, 'Hall')
  await makeToken(app, 'Cleric')
  await expect(async () => {
    await app.getByTitle('Add a spell effect').click()
    await expect(app.getByRole('option', { name: 'Bless' })).toBeVisible({ timeout: 1500 })
  }).toPass()
  await app.getByRole('option', { name: 'Bless' }).click()
  const effects = app.getByRole('group', { name: 'Effects' })
  await expect(effects).toContainText('Bless (10)')
  await expect(effects).toContainText('+1d4 attacks')
  await app.getByLabel('Spell effect', { exact: true }).fill('Blessing of the hearth')
  await app.getByLabel('Duration in rounds').fill('3')
  await app.getByLabel('Bonus to armor of the effect').fill('2')
  await app.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(effects).toContainText('Blessing of the hearth (3) +2 AC')
  await app.getByRole('button', { name: 'End Bless', exact: true }).click()
  await expect(effects).not.toContainText('Bless (10)')
  await expect(effects).toContainText('Blessing of the hearth')
  await app.locator('.tt-panel .seg').getByRole('button', { name: /Chat/ }).click()
  await expect(app.getByRole('list', { name: 'Chat' })).toContainText('is under Bless for 10 rounds')
})
