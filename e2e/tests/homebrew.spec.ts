import { expect, test, unique } from '../fixtures'
import { dismissAlert, menuItem, openPage, openView } from '../lib/ui'

// Homebrew: classes, species and backgrounds made in place, pages put into libraries of your own, libraries as files, and a
// character's banner, portrait and token. Libraries belong to the whole server, so every test names its own.

test('a new class is made in the character builder and chosen there', { tag: '@feature:library.homebrew-builder' }, async ({ app, makePage }) => {
  await makePage('Wren', { props: { type: 'pc' } })
  await app.reload()
  await openPage(app, 'Wren')
  await app.getByRole('button', { name: 'Build a character' }).click()
  const builder = app.getByRole('dialog', { name: 'Build a character' })
  await builder.getByRole('button', { name: /New class/ }).click()

  const d = app.getByRole('dialog', { name: 'New class' })
  await expect(d.getByRole('button', { name: 'Create the class' })).toBeDisabled()
  await d.getByLabel('Name').fill('Storm knight')
  await d.getByRole('group', { name: 'Hit die' }).getByRole('button', { name: 'd10' }).click()
  await d.getByRole('group', { name: 'Main abilities' }).getByRole('button', { name: 'STR' }).click()
  await d.getByRole('group', { name: 'Saving throws' }).getByRole('button', { name: 'STR' }).click()
  await d.getByRole('group', { name: 'Saving throws' }).getByRole('button', { name: 'CON' }).click()
  await d.getByRole('checkbox', { name: 'from any skill' }).check()
  // kept as a page and in a library made right in the dialog
  const lib = unique('Builder brew')
  await d.getByRole('radio', { name: /As a page and in a library/ }).check()
  // with no library yet the name is asked at once, else "New library…" is picked from the list
  const naming = d.getByLabel('Name of the new library')
  await expect(d.getByTitle('Library').or(naming)).toBeVisible()
  if (await naming.isHidden()) {
    // the list closes when the dialog body still scrolls the picker into view, so try again until it stays open
    await expect(async () => { await d.getByTitle('Library').click(); await app.getByRole('option', { name: 'New library…' }).click({ timeout: 1000 }) }).toPass({ timeout: 10_000 })
  }
  await naming.fill(lib)
  await d.getByRole('button', { name: 'Make the library' }).click()
  await d.getByRole('button', { name: 'Create the class' }).click()
  await expect(d).toHaveCount(0)

  // the builder offers it and has chosen it
  await expect(builder.getByRole('radio', { name: /Storm knight/ })).toHaveAttribute('aria-checked', 'true')
  await expect(builder.getByRole('radio', { name: /Storm knight/ })).toContainText('d10 hit die')
  await expect(builder.getByRole('button', { name: 'Next' })).toBeEnabled()
  await builder.getByLabel('Close').click()

  // its page carries the rules, and the library has the entry
  await openPage(app, 'Storm knight')
  await expect(app.getByLabel('Character builder rules')).toContainText('Strength and Constitution')
  // a hover card of a page link may sit over the sidebar
  await app.keyboard.press('Escape')
  await app.mouse.move(700, 5)
  await expect(app.locator('.hover-card')).toHaveCount(0)
  await openView(app, 'Library')
  await app.getByLabel('Your libraries').getByRole('button', { name: lib }).click()
  await expect(app.locator('.lib-collection')).toContainText('Storm knight')
})

test('the builder offers Open5e species it does not have and homebrew without rules', { tag: '@feature:sheet.builder-library' }, async ({ app, api, makePage }) => {
  // the library is shared by every test; download it from the stand-in when no other test has yet
  const status = await api.json<{ open5e: number }>('get', '/api/library/status')
  if (!status.open5e) await api.json('post', '/api/library/refresh')
  await expect.poll(async () => (await api.json<{ open5e: number; running: boolean }>('get', '/api/library/status')).open5e, { timeout: 30_000 }).toBeGreaterThan(5)
  await makePage('Tide warden', { props: { type: 'class', data: { hit_die: 'd12', saves: [{ name: 'Wisdom' }, { name: 'Constitution' }] } } })
  await makePage('Pell', { props: { type: 'pc' } })
  await app.reload()
  await openPage(app, 'Pell')
  await app.getByRole('button', { name: 'Build a character' }).click()
  const d = app.getByRole('dialog', { name: 'Build a character' })
  // a class page without rules is offered with rules worked out from its fields
  const warden = d.getByRole('radio', { name: /Tide warden/ })
  await expect(warden).toContainText('rules guessed')
  await expect(warden).toContainText('d12 hit die')
  await warden.click()
  await d.getByRole('button', { name: 'Next' }).click()
  // Open5e: the subspecies with its parent's traits; the parent and the builder's own elves are not repeated
  const malkin = d.getByRole('radio', { name: /Malkin \(Catfolk\)/ })
  await expect(malkin).toContainText('Open5e')
  await expect(malkin).toContainText('DEX +2, INT +1')
  await expect(d.getByRole('radio', { name: /^Catfolk/ })).toHaveCount(0)
  await expect(d.getByRole('radio', { name: /^High Elf/ })).toHaveCount(0)
  await malkin.click()
  await d.getByRole('button', { name: 'Next' }).click()
  await d.getByRole('radio', { name: /^Sage/ }).first().click()
  await d.getByRole('button', { name: 'Next' }).click()
  await d.getByRole('button', { name: 'Next' }).click()
  for (const box of (await d.locator('.cb-skill input:not(:disabled):not(:checked)').all()).slice(0, 2)) await box.check()
  await d.getByRole('button', { name: 'Next' }).click()
  await expect(d.getByLabel('The finished character')).toContainText('malkin (catfolk) tide warden')
  await expect(d.getByLabel('The finished character')).toContainText("Hunter's Senses")
})

test('level up follows the 2024 rules and a homebrew class brings its own', { tag: '@feature:sheet.levelup-rules' }, async ({ app, api, world, makePage }) => {
  await api.json('patch', `/api/workspaces/${world.id}`, { settings: { system: '5e-2024' } })
  const sheet = (name: string, cls: string) => ({ v: 1, kind: 'character', ruleset: '5e-2024', name, size: 'Medium', type: 'humanoid', alignment: '', abilities: { str: 14, dex: 12, con: 14, int: 10, wis: 15, cha: 10 }, ac: { value: 16, note: '' }, hp: { max: 10, formula: '', current: 10, temp: 0 }, speed: { walk: 30 }, saves: {}, skills: {}, senses: {}, vulnerabilities: '', resistances: '', immunities: '', conditionImmunities: '', languages: '', features: { traits: [], actions: [], bonus: [], reactions: [], legendary: [] }, classes: [{ name: cls, level: 1 }], hitDice: [], profs: { saves: [], skills: {} } })
  await makePage('Storm knight', { props: { type: 'class', rules: { die: 12, primary: ['str'], saves: ['str', 'con'], skills: { count: 2, from: 'any' }, spell: 'wis', caster: 'half', subclassLevel: 2, armor: { base: 16, dex: 'none', note: 'chain mail' } } } })
  await makePage('Ilse', { props: { type: 'person', sheet: sheet('Ilse', 'Paladin') } })
  await makePage('Vex', { props: { type: 'person', sheet: sheet('Vex', 'Storm knight') } })
  await app.reload()

  // a 2024 paladin of level 2: slots as a half caster from level 1, no subclass yet (that is level 3 in 2024)
  await openPage(app, 'Ilse')
  await app.getByRole('button', { name: 'Level up' }).click()
  const panel = app.getByRole('dialog', { name: 'Level up' })
  await expect(panel).toContainText('2024 rules')
  await expect(panel.getByLabel('What changes')).toContainText('Spell slots: 2')
  await expect(panel.getByLabel('Subclass')).toHaveCount(0)
  await panel.getByRole('button', { name: 'Cancel' }).click()

  // the homebrew class: its d12, its half caster slots, its subclass at level 2
  await openPage(app, 'Vex')
  await app.getByRole('button', { name: 'Level up' }).click()
  const changes = panel.getByLabel('What changes')
  await expect(changes).toContainText('One more d12 hit die')
  await expect(changes).toContainText('Spell slots: 2')
  await panel.getByLabel('Subclass').fill('Order of the Gale')
  await panel.getByRole('button', { name: 'Level up to 2' }).click()
  await expect(app.getByLabel('Character sheet')).toContainText('Storm knight 2 (Order of the Gale)')
})

test('a page goes into a library, comes out as a file, and goes away again', { tag: '@feature:library.homebrew-push' }, async ({ app, api, makePage }) => {
  const lib = await api.json<{ id: string; name: string }>('post', '/api/library/collections', { name: unique('Push brew') })
  await makePage('The drowned god', { props: { type: 'rule' } })
  await app.reload()
  await openPage(app, 'The drowned god')
  await menuItem(app, /Put in a library/)
  const d = app.getByRole('dialog', { name: 'Put the page in a library' })
  await d.getByTitle('Library').click()
  await app.getByRole('option', { name: lib.name }).click()
  await d.getByRole('button', { name: 'Put in the library' }).click()
  await dismissAlert(app)
  // the page remembers its entry: the menu now offers to update it
  await app.getByTitle('More actions').click()
  await expect(app.getByRole('button', { name: /Update in the library/ })).toBeVisible()
  await app.keyboard.press('Escape')

  await openView(app, 'Library')
  await app.getByLabel('Your libraries').getByRole('button', { name: lib.name }).click()
  const download = app.waitForEvent('download')
  await app.getByRole('button', { name: 'Export' }).click()
  expect((await download).suggestedFilename()).toMatch(/\.chronicle-library\.json$/)
  await app.locator('.lib-collection').getByText('The drowned god').click()
  await expect(app.locator('.lib-detail')).toContainText(lib.name)
  await app.locator('.lib-detail').getByRole('button', { name: 'Delete' }).click()
  await app.locator('.dialog-host').getByRole('button', { name: 'Delete the entry' }).click()
  await expect.poll(async () => (await api.json<{ count: number }>('get', `/api/library/collections/${lib.id}`)).count).toBe(0)
  await api.json('delete', `/api/library/collections/${lib.id}`)
})

test('a new species is made from a linked field and linked there', { tag: '@feature:library.homebrew-field' }, async ({ app, makePage }) => {
  await makePage('Nell', { props: { type: 'person' } })
  await app.reload()
  await openPage(app, 'Nell')
  const race = app.getByRole('combobox', { name: 'Race' })
  await race.fill('Tidekin')
  await app.locator('.lf-pop').getByText(/New species “Tidekin”/).dispatchEvent('mousedown')
  const d = app.getByRole('dialog', { name: 'New species' })
  await expect(d.getByLabel('Name')).toHaveValue('Tidekin')
  await d.getByRole('button', { name: 'Create the species' }).click()
  await expect(d).toHaveCount(0)
  await expect(app.locator('.lf-chip')).toContainText('Tidekin')
  await expect(app.getByRole('complementary').getByRole('button', { name: /Tidekin/ })).toBeVisible()
})

test('a character shows its banner and portrait, and its pictures are kept on the sheet', { tag: '@feature:sheet.pictures' }, async ({ app, api, world, makePage }) => {
  // a picture of the world, used for all three
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const up = await api.post(`/api/workspaces/${world.id}/images?name=pic.png`, { data: png, headers: { 'content-type': 'image/png' } })
  const url = (await up.json()).url as string
  const sheet = { v: 1, kind: 'character', ruleset: '5e', name: 'Ilse', size: 'Medium', type: 'humanoid', alignment: '', abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, ac: { value: 10, note: '' }, hp: { max: 8, formula: '' }, speed: { walk: 30 }, saves: {}, skills: {}, senses: {}, vulnerabilities: '', resistances: '', immunities: '', conditionImmunities: '', languages: '', features: { traits: [], actions: [], bonus: [], reactions: [], legendary: [] }, classes: [{ name: 'Wizard', level: 1 }] }
  await makePage('Ilse', { props: { type: 'person', sheet, portrait: url, data: { banner: url, token: url } } })
  await app.reload()
  await openPage(app, 'Ilse')
  const cs = app.getByLabel('Character sheet')
  await expect(cs).toHaveClass(/has-banner/)
  await expect(cs.locator('.cs-banner')).toHaveAttribute('style', new RegExp(url))
  await expect(cs.getByRole('img', { name: 'Portrait of Ilse' })).toBeVisible()
  await cs.getByRole('button', { name: 'Edit sheet' }).click()
  const pics = cs.getByRole('group', { name: 'Pictures' })
  await expect(pics).toContainText('Banner')
  await pics.getByRole('button', { name: 'Remove the banner' }).click()
  await expect(cs).not.toHaveClass(/has-banner/)
  await expect.poll(async () => (await api.json<{ props: any }>('get', `/api/pages/${(await api.json<any>('get', `/api/workspaces/${world.id}/bootstrap`)).pages.find((p: any) => p.title === 'Ilse').id}`)).props.data?.banner ?? null, { timeout: 5000 }).toBeNull()
})
