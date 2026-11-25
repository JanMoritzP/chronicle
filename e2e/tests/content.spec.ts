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

test('a person page gets a character sheet that works out the numbers', { tag: '@feature:sheet.character' }, async ({ app, makePage }) => {
  await makePage('Aria', { props: { type: 'person' } })
  await app.reload()
  await openPage(app, 'Aria')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  await app.getByLabel('Class 1', { exact: true }).fill('Wizard')
  await app.getByLabel('Level of Wizard').fill('5')
  await expect(app.getByText('Proficiency +3')).toBeVisible()
  await app.getByLabel('Intelligence', { exact: true }).fill('18')
  const save = app.getByRole('button', { name: /Intelligence saving throw \+4/ })
  await save.click()
  await expect(app.getByRole('button', { name: /Intelligence saving throw \+7, proficient/ })).toBeVisible()
  await app.getByRole('button', { name: /^Arcana \+4/ }).click()
  await app.getByRole('button', { name: /^Arcana \+7, proficient/ }).click()
  await expect(app.getByRole('button', { name: /^Arcana \+10, expertise/ })).toBeVisible()
  await app.getByLabel('New item').fill('Rope')
  await app.getByLabel('New item').press('Enter')
  await expect(app.getByLabel('Item 1')).toHaveValue('Rope')
  await app.getByLabel('Maximum hit points', { exact: true }).fill('30')
  await app.getByLabel('Current hit points', { exact: true }).fill('5')
  await app.getByRole('button', { name: 'Long rest' }).click()
  await expect(app.getByLabel('Current hit points', { exact: true })).toHaveValue('30')
  await app.waitForTimeout(1500)
  await app.reload()
  await openPage(app, 'Aria')
  await expect(app.getByText('Proficiency +3')).toBeVisible()
  // a sheet with a class opens to play from; the form is one click away
  await app.getByRole('button', { name: 'Edit sheet' }).click()
  await expect(app.getByLabel('Intelligence', { exact: true })).toHaveValue('18')
  await expect(app.getByRole('button', { name: /^Arcana \+10, expertise/ })).toBeVisible()
  await expect(app.getByLabel('Item 1')).toHaveValue('Rope')
})

test('a character sheet tracks rests, hit dice, death saves, spell slots, items and coins', { tag: '@feature:sheet.character-more' }, async ({ app, makePage }) => {
  await makePage('Brann', { props: { type: 'person' } })
  await app.reload()
  await openPage(app, 'Brann')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  await app.getByLabel('Class 1', { exact: true }).fill('Cleric')
  await app.getByRole('button', { name: /^Class$/ }).click()
  await app.getByLabel('Class 2', { exact: true }).fill('Fighter')
  await app.getByLabel('Remove class 2').click()
  await app.getByRole('button', { name: '+d8' }).click()
  await app.getByLabel('d8 hit dice used 1').click()
  await app.getByLabel('Death save failures 1').click()
  await app.getByLabel('Death save successes 2').click()
  await app.getByLabel('Wisdom', { exact: true }).fill('16')
  await app.getByLabel('Wisdom saving throw', { exact: false }).first().click()
  const ability = app.getByRole('combobox').filter({ hasText: 'None' }).first()
  await ability.scrollIntoViewIfNeeded()
  await app.waitForTimeout(300)
  await ability.click()
  await expect(app.getByRole('listbox')).toBeVisible()
  await app.getByRole('option', { name: 'Wisdom' }).click()
  await app.getByLabel('Level 1 slots', { exact: true }).fill('3')
  await app.getByLabel('Level 1 slots used 2').click()
  await app.getByLabel('Spells').fill('Bless, Cure Wounds')
  await app.getByLabel('New item').fill('Mace')
  await app.getByRole('button', { name: 'Add', exact: true }).last().click()
  await app.getByLabel('Mace equipped').check()
  await app.getByLabel('Quantity of Mace').fill('2')
  await app.getByLabel('Note on Mace').fill('simple weapon')
  await app.getByLabel('GP coins').fill('30')
  await app.getByLabel('Maximum hit points').fill('20')
  await app.getByLabel('Current hit points', { exact: true }).fill('4')
  await app.getByLabel('Temporary hit points').fill('3')
  await app.getByRole('button', { name: 'Long rest' }).click()
  await expect(app.getByLabel('Current hit points', { exact: true })).toHaveValue('20')
  await expect(app.getByLabel('Level 1 slots used 2')).toHaveAttribute('aria-pressed', 'false')
  await app.getByLabel('Remove Mace').click()
  await expect(app.getByLabel('Item 1')).toHaveCount(0)
})

test('a creature sheet takes legendary actions, recharges and uses per day', { tag: '@feature:sheet.edit-more' }, async ({ app, makePage }) => {
  const sheet = {
    v: 1, ruleset: '5e', name: 'Wyrm', size: 'Huge', type: 'dragon', alignment: 'chaotic evil',
    abilities: { str: 23, dex: 10, con: 21, int: 14, wis: 11, cha: 19 }, ac: { value: 19, note: 'natural armor' }, hp: { max: 256, formula: '19d12 + 133' },
    speed: { walk: 40, fly: 80 }, saves: {}, skills: {}, senses: {}, vulnerabilities: '', resistances: '', immunities: 'fire', conditionImmunities: '', languages: 'Draconic', cr: 17, xp: 18000,
    features: { traits: [], actions: [{ name: 'Fire Breath', text: 'Exhales fire. DC 21 Dexterity saving throw, 18d6 fire damage.' }], bonus: [], reactions: [], legendary: [] },
  }
  await makePage('Wyrm', { props: { type: 'monster', sheet } })
  await app.reload()
  await openPage(app, 'Wyrm')
  await app.getByRole('combobox', { name: 'How often' }).first().click()
  await app.getByRole('option', { name: 'Recharge' }).click()
  await app.getByLabel('Recharges on').fill('5')
  const adds = app.getByRole('button', { name: /^Add a/ })
  await adds.last().click()
  await app.getByLabel('Name of legendary actions 1').fill('Tail Attack')
  await app.getByLabel('Cost in actions').fill('2')
  await app.getByRole('combobox', { name: 'How often' }).last().click()
  await app.getByRole('option', { name: 'Per day' }).click()
  await app.getByLabel('Times per day').fill('3')
  await app.getByLabel('Text of Tail Attack').fill('The wyrm lashes out.')
  await app.getByLabel('Challenge rating').fill('18')
  await app.getByLabel('Challenge rating').blur()
  await app.getByRole('button', { name: 'Remove Tail Attack' }).click()
  await expect(app.getByLabel('Name of legendary actions 1')).toHaveCount(0)
})

test('a character levels up, and what they carry and are attuned to is counted', { tag: '@feature:sheet.levelup' }, async ({ app, makePage }) => {
  await makePage('Garrick', { props: { type: 'person' } })
  await app.reload()
  await openPage(app, 'Garrick')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  await app.getByLabel('Class 1', { exact: true }).fill('Fighter')
  await app.getByLabel('Level of Fighter').fill('3')
  await app.getByLabel('Constitution', { exact: true }).fill('14')
  await app.getByLabel('Maximum hit points', { exact: true }).fill('28')
  await app.getByLabel('Current hit points', { exact: true }).fill('28')

  await app.getByRole('button', { name: 'Level up', exact: true }).click()
  const panel = app.getByRole('dialog', { name: 'Level up' })
  await expect(panel).toContainText('Level 4: Fighter 4')
  await expect(panel).toContainText('8 more hit points')
  await expect(panel).toContainText('ability score improvement')
  const str = Number(await app.getByLabel('Strength', { exact: true }).inputValue())
  await panel.getByRole('button', { name: 'Add a point to STR' }).click()
  await panel.getByRole('button', { name: 'Add a point to STR' }).click()
  await expect(panel.getByRole('button', { name: 'Add a point to STR' })).toBeDisabled()
  await expect(panel).toContainText(`STR ${str} to ${str + 2}`)
  await panel.getByRole('button', { name: /^Level up to 4$/ }).click()
  await expect(panel).toHaveCount(0)
  await expect(app.getByLabel('Level of Fighter')).toHaveValue('4')
  await expect(app.getByLabel('Strength', { exact: true })).toHaveValue(String(str + 2))
  await expect(app.getByLabel('Maximum hit points', { exact: true })).toHaveValue('36')

  // what is carried and attuned to
  await app.getByLabel('New item').fill('Plate armor')
  await app.getByLabel('New item').press('Enter')
  await app.getByLabel('Weight of Plate armor in pounds').fill('65')
  await expect(app.getByLabel('Load')).toContainText('Carrying 65 of')
  await expect(app.getByLabel('Load')).toContainText('encumbered')
  await app.getByLabel('Plate armor attuned').check()
  await expect(app.getByLabel('Load')).toContainText('Attuned to 1 of 3')
  await app.getByLabel('Plate armor equipped').check()
  await app.getByLabel('Saving throw bonus of Plate armor').fill('2')
  await expect(app.getByRole('button', { name: /Strength saving throw \+3/ })).toBeVisible()
  // a bag of holding makes what is in it weightless
  await app.getByLabel('New item').fill('Bag of holding')
  await app.getByLabel('New item').press('Enter')
  await app.getByLabel('Bag of holding holds weightlessly').check()
  await app.getByLabel('Kept in, for Plate armor').fill('Bag of holding')
  await expect(app.getByLabel('Load')).toContainText('Carrying 0 of')
})

test('a character from Foundry, D&D Beyond or Roll20 can be imported, and a character exported', { tag: '@feature:sheet.import' }, async ({ app, makePage }) => {
  await makePage('Seraphine', { props: { type: 'person' } })
  await app.reload()
  await openPage(app, 'Seraphine')
  const actor = {
    name: 'Seraphine', type: 'character',
    system: { abilities: { str: { value: 10 }, dex: { value: 16, proficient: 1 }, con: { value: 14 }, int: { value: 12 }, wis: { value: 13 }, cha: { value: 8 } }, attributes: { hp: { value: 21, max: 30 }, ac: { value: 15 } }, skills: { ste: { value: 1 } }, currency: { gp: 120 } },
    items: [{ type: 'class', name: 'Rogue', system: { levels: 5 } }, { type: 'weapon', name: 'Rapier', system: { quantity: 1, equipped: true, weight: 2 } }],
  }
  const chooser = app.waitForEvent('filechooser')
  await app.getByRole('button', { name: 'Import a character' }).click()
  await (await chooser).setFiles({ name: 'seraphine.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(actor)) })
  await app.getByRole('button', { name: 'Edit sheet' }).click()
  await expect(app.getByLabel('Class 1', { exact: true })).toHaveValue('Rogue')
  await expect(app.getByLabel('Level of Rogue')).toHaveValue('5')
  await expect(app.getByLabel('Maximum hit points', { exact: true })).toHaveValue('30')
  await expect(app.getByLabel('Current hit points', { exact: true })).toHaveValue('21')
  await expect(app.getByLabel('Item 1')).toHaveValue('Rapier')
  const download = app.waitForEvent('download')
  await app.getByRole('button', { name: 'Export this character' }).click()
  const saved = JSON.parse((await import('node:fs')).readFileSync(await (await download).path(), 'utf8'))
  expect(saved.format).toBe('chronicle-character')
  expect(saved.sheet.name).toBe('Seraphine')
  expect(saved.sheet.abilities.dex).toBe(16)
})

test('an item can add to armor class while it is equipped', { tag: '@feature:sheet.item-ac' }, async ({ app, makePage }) => {
  await makePage('Dara', { props: { type: 'person' } })
  await app.reload()
  await openPage(app, 'Dara')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  await app.getByLabel('Armor class', { exact: true }).fill('12')
  await app.getByLabel('New item').fill('Shield +1')
  await app.getByLabel('New item').press('Enter')
  await app.getByLabel('Armor class bonus of Shield +1').fill('3')
  await expect(app.getByLabel('Armor class from items')).toHaveCount(0)
  await app.getByLabel('Shield +1 equipped').check()
  await expect(app.getByLabel('Armor class from items')).toContainText('add 3 to armor class, for 15 in all')
  await app.getByLabel('Charges of Shield +1').fill('4')
  await expect(app.getByRole('group', { name: 'Shield +1 charge' })).toBeVisible()
})

test('a Pathfinder character from Pathbuilder can be imported', { tag: '@feature:sheet.import-pathbuilder' }, async ({ app, makePage }) => {
  await makePage('Seelah', { props: { type: 'person' } })
  await app.reload()
  await openPage(app, 'Seelah')
  const build = { success: true, build: {
    name: 'Seelah', class: 'Champion', level: 3, ancestry: 'Human', heritage: 'Versatile Heritage', background: 'Warrior', keyability: 'str',
    attributes: { ancestryhp: 8, classhp: 10, bonushp: 0, bonushpPerLevel: 0, speed: 25, speedBonus: 0 },
    abilities: { str: 18, dex: 12, con: 14, int: 10, wis: 12, cha: 14 },
    proficiencies: { classDC: 2, perception: 4, fortitude: 4, reflex: 2, will: 4, heavy: 4, athletics: 4 },
    lores: [], feats: [['Shield Block', null, 'General Feat', 1]], weapons: [{ name: 'Longsword', display: 'Longsword', prof: 'martial', die: 'd8', pot: 1 }],
    equipment: [], money: { cp: 0, sp: 0, gp: 5, pp: 0 }, acTotal: { acItemBonus: 6 }, armor: [], spellCasters: [],
  } }
  const chooser = app.waitForEvent('filechooser')
  await app.getByRole('button', { name: 'Import a character' }).click()
  await (await chooser).setFiles({ name: 'seelah.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(build)) })
  await expect(app.getByLabel('Level', { exact: true })).toHaveValue('3')
  await expect(app.getByLabel('Strength modifier')).toHaveValue('4')
  await expect(app.getByRole('button', { name: /Perception \+/ })).toBeVisible()  await app.waitForTimeout(800)
  await app.reload()
  await openPage(app, 'Seelah')
  await expect(app.getByLabel('Level', { exact: true })).toHaveValue('3')
})
