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
  await makePage('Lysa', { props: { type: 'pc' } })
  await app.reload()
  await openPage(app, 'Lysa')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  await app.getByRole('combobox', { name: 'Add a spell' }).fill('fireball')
  await app.getByRole('listbox').getByRole('option', { name: /^Fireball/ }).dispatchEvent('mousedown')
  await expect(app.getByLabel('Spells', { exact: true })).toHaveValue(/Level 3: Fireball/)
  await expect(app.getByRole('combobox', { name: 'Add a spell' })).toHaveValue('')
  await app.getByRole('combobox', { name: 'New item' }).fill('longsword')
  await app.getByRole('listbox').getByRole('option', { name: /^Longsword/ }).dispatchEvent('mousedown')
  await expect(app.getByLabel('Item 1')).toHaveValue('Longsword')
  // what matches nothing is added as typed
  await app.getByRole('combobox', { name: 'New item' }).fill('Lucky coin')
  await app.getByRole('combobox', { name: 'New item' }).press('Enter')
  await expect(app.getByLabel('Item 2')).toHaveValue('Lucky coin')
})

test('a species and a background from the library are put on a character sheet', { tag: '@feature:library.origin' }, async ({ app, makePage }) => {
  await makePage('Orla', { props: { type: 'pc' } })
  await app.reload()
  await openPage(app, 'Orla')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  const species = app.getByRole('combobox', { name: 'Species', exact: true })
  await species.fill('elf')
  await app.getByRole('listbox').getByRole('option', { name: /^Elf/ }).dispatchEvent('mousedown')
  await expect(species).toHaveValue('Elf')
  // the species brings its traits
  await expect(app.getByLabel('Name of traits 1')).toHaveValue('Darkvision')
  const background = app.getByRole('combobox', { name: 'Background', exact: true })
  await background.fill('sa')
  await app.getByRole('listbox').getByRole('option', { name: /^Sage/ }).dispatchEvent('mousedown')
  await expect(background).toHaveValue('Sage')
})

test('the player box of a character sheet suggests the people of the world', { tag: '@feature:sheet.player-suggest' }, async ({ app, makePage }) => {
  await makePage('Tamsin', { props: { type: 'pc' } })
  await app.reload()
  await openPage(app, 'Tamsin')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  const player = app.getByRole('combobox', { name: 'Player', exact: true })
  await player.fill('g')
  await app.getByRole('listbox').getByRole('option', { name: /^gm/ }).dispatchEvent('mousedown')
  await expect(player).toHaveValue('gm')
  // someone without an account can still be written in
  await player.fill('Alex from the club')
  await player.press('Enter')
  await expect(player).toHaveValue('Alex from the club')
})

test('the class, subclass, alignment and features of a character sheet suggest library entries', { tag: '@feature:library.sheet-suggest' }, async ({ app, makePage }) => {
  await makePage('Corwin', { props: { type: 'pc' } })
  await app.reload()
  await openPage(app, 'Corwin')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  const cls = app.getByRole('combobox', { name: 'Class 1', exact: true })
  await cls.fill('wiz')
  const classes = app.getByRole('listbox')
  await expect(classes.getByRole('option', { name: /^Evoker/ })).toHaveCount(0)
  await classes.getByRole('option', { name: /^Wizard/ }).dispatchEvent('mousedown')
  await expect(cls).toHaveValue('Wizard')
  // the subclass box offers the subclasses of that class, and the box shows that the name is linked
  await app.getByRole('combobox', { name: 'Subclass 1' }).focus()
  await app.getByRole('listbox').getByRole('option', { name: /^Evoker/ }).dispatchEvent('mousedown')
  await expect(app.getByRole('combobox', { name: 'Subclass 1' })).toHaveValue('Evoker')
  await expect(app.locator('.cs-class').getByLabel('Linked to an entry')).toHaveCount(2)
  await app.getByRole('combobox', { name: 'Alignment' }).fill('neutral')
  await app.getByRole('listbox').getByRole('option', { name: /^Neutral Evil/ }).dispatchEvent('mousedown')
  // a name of one's own stays as typed
  await app.getByRole('combobox', { name: 'Species', exact: true }).fill('Starborn')
  await app.getByRole('combobox', { name: 'Species', exact: true }).press('Enter')
  await expect(app.getByRole('combobox', { name: 'Species', exact: true })).toHaveValue('Starborn')
  await app.getByRole('button', { name: 'Add an action' }).click()
  await app.getByRole('combobox', { name: 'Name of actions 1' }).fill('fire')
  await app.getByRole('listbox').getByRole('option', { name: /^Fireball/ }).dispatchEvent('mousedown')
  await app.getByRole('button', { name: 'Done editing' }).click()
  const sheet = app.getByLabel('Character sheet')
  await expect(sheet.locator('.sheet-link', { hasText: 'Evoker' })).toHaveAttribute('data-lib-key', /^class:/)
  await expect(sheet.locator('.sheet-link', { hasText: 'Neutral Evil' })).toHaveAttribute('data-lib-key', /^alignment:/)
  await expect(sheet.locator('.sheet-link', { hasText: 'Fireball' })).toHaveAttribute('data-lib-key', /^spell:/)
  await expect(sheet.getByText('Starborn')).toBeVisible()
})

test('the names on a character sheet link to their library entries', { tag: '@feature:library.sheet-links' }, async ({ app, makePage }) => {
  await makePage('Ilyra', { props: { type: 'pc' } })
  await app.reload()
  await openPage(app, 'Ilyra')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  await app.getByLabel('Species', { exact: true }).fill('High Elf')
  await app.getByLabel('Class 1', { exact: true }).fill('Wizard')
  await app.getByLabel('Spells', { exact: true }).fill('Cantrips: Light\nLevel 3: Fireball, Unknown Spell')
  await app.getByLabel('New item').fill('Bag of Holding')
  await app.getByLabel('New item').press('Enter')
  await app.getByRole('button', { name: 'Done editing' }).click()
  const sheet = app.getByLabel('Character sheet')
  await expect(sheet.locator('.sheet-link', { hasText: 'Elf' })).toHaveAttribute('data-lib-key', /^species:/)
  await expect(sheet.locator('.sheet-link', { hasText: 'Fireball' })).toHaveAttribute('data-lib-key', /^spell:/)
  await expect(sheet.locator('.sheet-link', { hasText: 'Bag of Holding' })).toHaveAttribute('data-lib-key', /^magicitem:/)
  await expect(sheet.getByText('Unknown Spell')).toBeVisible()
  await expect(sheet.locator('.sheet-link', { hasText: 'Unknown Spell' })).toHaveCount(0)
  await sheet.locator('.sheet-link', { hasText: 'Wizard' }).click()
  const peek = app.getByRole('dialog', { name: 'Wizard' })
  await expect(peek).toContainText(/Hit die|Arcane Recovery/)
  await app.keyboard.press('Escape')
  await expect(peek).toHaveCount(0)
  await expect(app.getByLabel('Page title')).toHaveValue('Ilyra')

  // a skill's name leads to the skill, the rest of its row still belongs to the skill's button
  await sheet.locator('.cs-skill .sheet-link', { hasText: 'Stealth' }).click()
  await expect(app.getByRole('dialog', { name: 'Stealth' })).toBeVisible()
  await app.keyboard.press('Escape')
  await sheet.getByRole('button', { name: 'Edit sheet' }).click()
  await sheet.getByRole('button', { name: /^Stealth [+-]/ }).click()
  await expect(sheet.getByRole('button', { name: /^Stealth .*, proficient$/ })).toBeVisible()

  // features of the class and traits of the species open the entry that gives them
  for (const [i, name] of ['Arcane Recovery', 'Darkvision'].entries()) {
    await sheet.getByRole('button', { name: 'Add a trait' }).click()
    await sheet.getByLabel(`Name of traits ${i + 1}`).fill(name)
  }
  await sheet.getByRole('button', { name: 'Done editing' }).click()
  await sheet.getByLabel('Features and attacks').getByTitle('From Wizard').click()
  await expect(app.getByRole('dialog', { name: 'Wizard' }).getByRole('heading', { name: /^Arcane Recovery/ })).toBeInViewport()
  await app.keyboard.press('Escape')
  await sheet.getByTitle('From Elf').click()
  await expect(app.getByRole('dialog', { name: 'Elf' }).getByRole('heading', { name: 'Darkvision' })).toBeInViewport()
  await app.keyboard.press('Escape')
})

test('a fighter and a wizard level from 1 to 20 by the 2014 rules, with subclasses and features from the library', { tag: '@feature:sheet.levelup-career' }, async ({ app, api, world, makePage }) => {
  test.setTimeout(240_000)
  await api.json('patch', `/api/workspaces/${world.id}`, { settings: { system: '5e' } })
  type Panel = ReturnType<typeof app.getByRole>
  const career = async (title: string, cls: string, con: number, choices: Record<number, (panel: Panel) => Promise<void>>) => {
    await makePage(title, { props: { type: 'pc' } })
    await app.reload()
    await openPage(app, title)
    await app.getByRole('button', { name: 'Add a character sheet' }).click()
    await app.getByLabel('Constitution', { exact: true }).fill(String(con))
    await app.getByLabel('Constitution', { exact: true }).blur()
    const panel = app.getByRole('dialog', { name: 'Level up' })
    for (let level = 1; level <= 20; level++) {
      await app.getByRole('button', { name: 'Level up', exact: true }).click()
      if (level === 1) {
        await expect(panel).toContainText('First level')
        await panel.getByLabel('Name of the new class').fill(cls)
      }
      await expect(panel.getByLabel('What changes')).toContainText(`Level ${level}: ${cls} ${level}`)
      await choices[level]?.(panel)
      await panel.getByRole('button', { name: `Level up to ${level}`, exact: true }).click()
      await expect(panel).toHaveCount(0)
      await expect(app.getByLabel(`Level of ${cls}`)).toHaveValue(String(level))
    }
    // level 20 is the end
    await app.getByRole('button', { name: 'Level up', exact: true }).click()
    await expect(panel).toContainText('cannot go past level 20')
    await panel.getByRole('button', { name: 'Cancel' }).click()
  }
  const point = (a: string) => async (panel: Panel) => {
    for (let i = 0; i < 2; i++) await panel.getByRole('button', { name: `Add a point to ${a}` }).click()
  }

  // a fighter: the 2014 class and Champion from the library, not the 2024 ones of the same names
  await career('Brannoc', 'Fighter', 14, {
    1: async (panel) => {
      await expect(panel.getByLabel('What changes')).toContainText('12 hit points (the whole d10, +2 Constitution)')
      await expect(panel.getByLabel('Class features gained')).toContainText('Second Wind')
      await expect(panel.getByLabel('Class features gained')).not.toContainText('Weapon Mastery')
    },
    2: async (panel) => {
      await expect(panel.getByLabel('Class features gained')).toContainText('Action Surge (one use)')
      await expect(panel.getByLabel('Class features gained')).not.toContainText('Tactical Mind')
    },
    3: async (panel) => {
      const box = panel.getByRole('combobox', { name: 'Subclass' })
      await box.focus()
      const list = app.getByRole('listbox')
      await expect(list.getByRole('option', { name: /^Champion/ })).toHaveCount(1)
      await expect(list.getByRole('option', { name: /^Path of Steel/ })).toHaveCount(0)
      await list.getByRole('option', { name: /^Champion/ }).dispatchEvent('mousedown')
      await expect(box).toHaveValue('Champion')
      // the subclass's own feature of this level, not the "choose an archetype" feature the panel asks for itself, not the 2024 Champion's
      const gained = panel.getByLabel('Class features gained')
      await expect(gained).toContainText('Improved Critical')
      await expect(gained).not.toContainText('Martial Archetype')
      await expect(gained).not.toContainText('Remarkable Athlete')
    },
    4: point('STR'), 6: point('STR'), 8: point('CON'), 12: point('STR'), 14: point('DEX'), 16: point('CON'),
    11: async (panel) => { await expect(panel.getByLabel('Class features gained')).toContainText('already on the sheet') },
    17: async (panel) => { await expect(panel.getByLabel('Class features gained')).toContainText('Action Surge (two uses)') },
    19: async (panel) => {
      await panel.getByRole('combobox', { name: 'Feat taken instead' }).focus()
      await app.getByRole('listbox').getByRole('option', { name: /^Alert/ }).dispatchEvent('mousedown')
      await expect(panel.getByLabel('What changes')).toContainText('Feat: Alert')
    },
  })
  await expect(app.getByLabel('Constitution', { exact: true })).toHaveValue('18')
  // d10 + 19 x 6 + 20 x the final Constitution modifier (+4)
  await expect(app.getByLabel('Maximum hit points', { exact: true })).toHaveValue('204')
  await app.getByRole('button', { name: 'Done editing' }).click()
  const sheet = app.getByLabel('Character sheet')
  for (const f of ['Second Wind', 'Action Surge', 'Improved Critical', 'Extra Attack', 'Indomitable', 'Survivor', 'Alert']) await expect(sheet, f).toContainText(f)
  await expect(sheet).toContainText('Fighter 20 (Champion)')

  // a wizard: the subclass at 2, spell slots up to level 9
  await career('Ysolde', 'Wizard', 12, {
    1: async (panel) => { await expect(panel.getByLabel('What changes')).toContainText('Spellbook: six wizard spells of level 1') },
    2: async (panel) => {
      await panel.getByRole('combobox', { name: 'Subclass' }).focus()
      await app.getByRole('listbox').getByRole('option', { name: /^Evoker/ }).dispatchEvent('mousedown')
      await expect(panel.getByLabel('Class features gained')).toContainText('Sculpt Spells')
      await expect(panel.getByLabel('Class features gained')).not.toContainText('Arcane Tradition')
    },
    4: point('INT'), 8: point('INT'), 12: point('CON'), 16: point('CON'), 19: point('DEX'),
    10: async (panel) => { await expect(panel.getByLabel('What changes')).toContainText('Cantrips known: 4 to 5 (learn 1 more)') },
    17: async (panel) => { await expect(panel.getByLabel('What changes')).toContainText('Wizard spells of level 9 can now be learned and cast') },
    20: async (panel) => { await expect(panel.getByLabel('What changes')).toContainText('Spell slots: 4 / 3 / 3 / 3 / 3 / 2 / 2 / 1 / 1') },
  })
  // d6 + 19 x 4 + 20 x the final Constitution modifier (+3)
  await expect(app.getByLabel('Maximum hit points', { exact: true })).toHaveValue('142')
  await app.getByRole('button', { name: 'Done editing' }).click()
  await expect(app.getByLabel('Character sheet')).toContainText('Wizard 20 (Evoker)')
})

test('a barbarian counts rages on the sheet, by level, and gets them back on a rest', { tag: '@feature:sheet.resources' }, async ({ app, api, world, makePage }) => {
  await api.json('patch', `/api/workspaces/${world.id}`, { settings: { system: '5e-2024' } })
  await makePage('Grom', { props: { type: 'pc' } })
  await app.reload()
  await openPage(app, 'Grom')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  await app.getByLabel('Class 1', { exact: true }).fill('Barbarian')
  await app.getByLabel('Level of Barbarian').fill('2')
  await app.getByRole('button', { name: 'Done editing' }).click()
  const res = app.getByLabel('Class resources')
  await expect(res).toContainText('Rages')
  await expect(res).toContainText('2 of 2 left')
  await expect(res).toContainText('one back on a short rest, all on a long rest')
  await expect(res.getByLabel('Class table')).toContainText('Rage damage +2')
  await res.getByLabel('Rages used 1').click()
  await expect(res).toContainText('1 of 2 left')

  // the level up says what changes and the sheet follows
  await app.getByRole('button', { name: 'Level up', exact: true }).click()
  const panel = app.getByRole('dialog', { name: 'Level up' })
  await expect(panel.getByLabel('What changes')).toContainText('Rages: 2 to 3')
  await panel.getByRole('button', { name: 'Level up to 3', exact: true }).click()
  await expect(res).toContainText('2 of 3 left')
  await app.getByRole('button', { name: 'Short rest' }).click()
  await expect(res).toContainText('3 of 3 left')

  // a counter of one's own, kept by hand
  await res.getByLabel('Rages used 2').click()
  await app.getByRole('button', { name: 'Edit sheet' }).click()
  await res.getByRole('button', { name: 'Add a counter' }).click()
  await res.getByLabel('Name of counter 1').fill('Lucky')
  await res.getByLabel('Uses of Lucky').fill('3')
  await app.getByRole('button', { name: 'Done editing' }).click()
  await res.getByLabel('Lucky used 1').click()
  await expect(res).toContainText('2 of 3 left')
  await app.waitForTimeout(1500)
  await app.reload()
  await openPage(app, 'Grom')
  await expect(res).toContainText('1 of 3 left')
  await app.getByRole('button', { name: 'Long rest' }).click()
  await expect(res.getByLabel('Rages used 1')).toHaveAttribute('aria-pressed', 'false')
  await expect(res.getByLabel('Lucky used 1')).toHaveAttribute('aria-pressed', 'false')
})

test('the spellbook puts cantrips and spells with the slots of their level, and casting spends a slot', { tag: '@feature:sheet.spellbook' }, async ({ app, api, world, makePage }) => {
  await api.json('patch', `/api/workspaces/${world.id}`, { settings: { system: '5e' } })
  await makePage('Mirelle', { props: { type: 'pc' } })
  await app.reload()
  await openPage(app, 'Mirelle')
  await app.getByRole('button', { name: 'Add a character sheet' }).click()
  await app.getByLabel('Class 1', { exact: true }).fill('Wizard')
  await app.getByLabel('Level of Wizard').fill('5')
  await app.getByLabel('Intelligence', { exact: true }).fill('16')
  await app.getByLabel('Level 1 slots', { exact: true }).fill('4')
  for (const [level, n] of [[2, '3'], [3, '2']] as const) {
    await app.getByRole('button', { name: `Slots of level ${level}` }).click()
    await app.getByLabel(`Level ${level} slots`, { exact: true }).fill(n)
  }
  // a spell from the library goes to the line of its level; the spellbook line takes its level from the library
  await app.getByLabel('Spells', { exact: true }).fill('Cantrips: Mage Hand\nSpellbook: Fireball, Homebrew Hex')
  await app.getByRole('combobox', { name: 'Add a spell' }).fill('light')
  await app.getByRole('listbox').getByRole('option', { name: /^Light/ }).dispatchEvent('mousedown')
  await expect(app.getByLabel('Spells', { exact: true })).toHaveValue('Cantrips: Mage Hand, Light\nSpellbook: Fireball, Homebrew Hex')
  await app.getByRole('button', { name: 'Done editing' }).click()

  const book = app.getByLabel('Spellbook')
  await expect(book).toContainText('Wizard: 4 cantrips, prepares 8 spells a day')
  await expect(book.getByLabel('Cantrips')).toContainText('2 of 4')
  await expect(book.getByLabel('Cantrips').locator('.sheet-link', { hasText: 'Light' })).toHaveAttribute('data-lib-key', /^spell:/)
  const third = book.getByLabel('3rd level')
  await expect(third).toContainText('Fireball')
  await expect(third).toContainText('Evocation · Spellbook')
  await expect(third).toContainText('2 of 2 slots left')
  await expect(book.getByLabel('Other spells')).toContainText('Homebrew Hex')
  await third.getByRole('button', { name: 'Cast Fireball' }).click()
  await third.getByRole('button', { name: 'Cast Fireball' }).click()
  await expect(third).toContainText('0 of 2 slots left')
  await expect(third.getByRole('button', { name: 'Cast Fireball' })).toBeDisabled()
  await expect(book.getByLabel('2nd level')).toContainText('3 of 3 slots left')
  await app.getByRole('button', { name: 'Long rest' }).click()
  await expect(third).toContainText('2 of 2 slots left')
})

test('feats come from the library: on the sheet, at a background and for a human', { tag: '@feature:sheet.feats' }, async ({ app, api, world, makePage }) => {
  await api.json('patch', `/api/workspaces/${world.id}`, { settings: { system: '5e-2024' } })
  await makePage('Tamsin', { props: { type: 'pc' } })
  await app.reload()
  await openPage(app, 'Tamsin')
  await app.getByRole('button', { name: 'Build a character' }).click()
  const d = app.getByRole('dialog', { name: 'Build a character' })
  await d.getByRole('radio', { name: /^Fighter/ }).click()
  await d.getByRole('button', { name: 'Next' }).click()
  await d.getByRole('radio', { name: /^Human/ }).click()
  const versatile = d.getByRole('combobox', { name: 'Versatile: an Origin feat of your choice' })
  await versatile.fill('skil')
  await app.getByRole('listbox').getByRole('option', { name: /^Skilled/ }).dispatchEvent('mousedown')
  await expect(d.getByRole('group', { name: 'Versatile: an Origin feat of your choice' })).toContainText('three skills or tools')
  await d.getByRole('button', { name: 'Next' }).click()
  await d.getByRole('radio', { name: /^Soldier/ }).click()
  // the background's feat is read from the library
  await expect(d.getByRole('group', { name: 'Origin feat of the soldier background' })).toContainText('roll its damage dice twice')
  await d.getByRole('button', { name: 'Next' }).click()
  await d.getByRole('checkbox', { name: 'One point to each of the three' }).check()
  await d.getByRole('button', { name: 'Next' }).click()
  await d.getByRole('checkbox', { name: /Perception/ }).check()
  await d.getByRole('checkbox', { name: /Survival/ }).check()
  await d.getByRole('button', { name: 'Next' }).click()
  await d.getByRole('button', { name: 'Create the character' }).click()
  const sheet = app.getByLabel('Character sheet')
  await expect(sheet).toContainText('roll its damage dice twice')
  await expect(sheet).toContainText('three skills or tools')
  await expect(sheet.locator('.sheet-link', { hasText: 'Savage Attacker' })).toHaveAttribute('data-lib-key', /^feat:/)

  // a feat added on the sheet brings what it does
  await app.getByRole('button', { name: 'Edit sheet' }).click()
  await app.getByRole('combobox', { name: 'Add a feat' }).fill('alert')
  await app.getByRole('listbox').getByRole('option', { name: /^Alert/ }).dispatchEvent('mousedown')
  await expect(app.getByLabel('Text of Alert')).toHaveValue(/lookout for danger.*proficiency bonus to initiative/)
  await expect(app.getByRole('combobox', { name: 'Add a feat' })).toHaveValue('')
})

