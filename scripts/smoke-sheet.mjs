// node scripts/smoke-sheet.mjs http://localhost:3222 gm testpass123
const [base = 'http://localhost:3000', user = 'gm', pass] = process.argv.slice(2)
let cookie = ''
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })
cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
const ws = (await call('POST', '/api/workspaces', { name: 'sheet-test-' + Math.floor(Math.random() * 1e6) })).data.id

const sheet = () => ({
  v: 1, ruleset: '5e', name: 'Goblin', size: 'Small', type: 'humanoid', alignment: 'neutral evil',
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  ac: { value: 15, note: 'leather armor, shield' }, hp: { max: 7, formula: '2d6' },
  speed: { walk: 30 }, saves: {}, skills: { stealth: 6 }, senses: { darkvision: 60 }, passivePerception: 9,
  vulnerabilities: '', resistances: '', immunities: '', conditionImmunities: '', languages: 'Common, Goblin', cr: 0.25, xp: 50,
  features: { traits: [{ name: 'Nimble Escape', text: 'Disengage or Hide as a bonus action.' }], actions: [{ name: 'Scimitar', text: 'Melee Weapon Attack.' }], bonus: [], reactions: [], legendary: [] },
})

let r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Goblin', props: { type: 'monster', sheet: { ...sheet(), extra: 'dropped' } } })
check('create a page with a sheet', r.status === 200, JSON.stringify(r.data).slice(0, 80))
const id = r.data.id
r = await call('GET', `/api/pages/${id}`)
check('sheet is stored', r.data.props.sheet?.hp.max === 7 && r.data.props.sheet.name === 'Goblin')
check('unknown keys are dropped', !('extra' in r.data.props.sheet))

r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Bad', props: { sheet: { ...sheet(), hp: { max: -4, formula: '' } } } })
check('a sheet with negative hit points is refused', r.status === 400)
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Bad', props: { sheet: { v: 1 } } })
check('an incomplete sheet is refused', r.status === 400)

r = await call('PATCH', `/api/pages/${id}`, { propsPatch: { sheet: { 'hp.max': 11, 'abilities.dex': 16 } } })
check('patch fields by path', r.status === 200)
r = await call('GET', `/api/pages/${id}`)
check('other fields are untouched', r.data.props.sheet.hp.max === 11 && r.data.props.sheet.abilities.dex === 16 && r.data.props.sheet.abilities.str === 8 && r.data.props.sheet.ac.value === 15)

r = await call('PATCH', `/api/pages/${id}`, { propsPatch: { sheet: { 'skills.perception': 2, 'skills.stealth': null, 'features.bonus': [{ name: 'Hide', text: 'Hides.' }] } } })
r = await call('GET', `/api/pages/${id}`)
check('add and remove a skill, replace a feature list', r.data.props.sheet.skills.perception === 2 && !('stealth' in r.data.props.sheet.skills) && r.data.props.sheet.features.bonus.length === 1)

r = await call('PATCH', `/api/pages/${id}`, { propsPatch: { sheet: { 'hp.max': 'many' } } })
check('a wrong type is refused', r.status === 400)
r = await call('PATCH', `/api/pages/${id}`, { propsPatch: { sheet: { '__proto__.polluted': 1 } } })
check('a prototype path is refused', r.status === 400 && ({}).polluted === undefined)
r = await call('PATCH', `/api/pages/${id}`, { propsPatch: { sheet: { 'features.actions': Array.from({ length: 61 }, () => ({ name: 'x', text: '' })) } } })
check('too many features are refused', r.status === 400)
r = await call('GET', `/api/pages/${id}`)
check('a refused patch changes nothing', r.data.props.sheet.hp.max === 11)

r = await call('PATCH', `/api/pages/${id}`, { propsPatch: { data: { race: 'Goblinoid' } } })
r = await call('GET', `/api/pages/${id}`)
check('editing another field keeps the sheet', !!r.data.props.sheet && r.data.props.data.race === 'Goblinoid')

r = await call('PATCH', `/api/pages/${id}`, { propsPatch: { data: { main: { template: '5e-monster', data: { name: 'Hobgoblin' } } } } })
r = await call('GET', `/api/pages/${id}`)
check('editing the old stat block drops the sheet made from older text', !('sheet' in r.data.props) && r.data.props.data.main.data.name === 'Hobgoblin')

r = await call('PATCH', `/api/pages/${id}`, { propsPatch: { data: { main: { template: '5e-monster', data: { name: 'Both' } } }, sheet: { ...sheet() } } })
r = await call('GET', `/api/pages/${id}`)
check('writing both keeps the new sheet', r.data.props.sheet?.name === 'Goblin')

r = await call('PATCH', `/api/pages/${id}`, { props: { sheet: { v: 2 } } })
check('whole props with a bad sheet are refused', r.status === 400)

// Pathfinder 2e
const pf2eSheet = () => ({ ...sheet(), ruleset: 'pf2e', pf2e: { level: 3, perception: 9, fort: 10, ref: 7, will: 6, mods: { str: 3, dex: 1, con: 2, int: -1, wis: 0, cha: 0 }, traits: ['Humanoid', 'Orc'], rarity: 'common' }, features: { traits: [{ name: 'Ferocity', text: 'Keeps fighting.', actions: 'reaction' }], actions: [{ name: 'Greataxe', text: '', actions: 'one', bonus: 12, damage: '1d12+7 slashing', agile: false }], bonus: [], reactions: [], legendary: [] } })
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Orc warrior', props: { type: 'monster', sheet: pf2eSheet() } })
check('a Pathfinder 2e sheet is stored', r.status === 200)
const pfId = r.data.id
r = await call('GET', `/api/pages/${pfId}`)
check('with level, saves, modifiers and strikes', r.data.props.sheet.pf2e.level === 3 && r.data.props.sheet.pf2e.fort === 10 && r.data.props.sheet.pf2e.mods.str === 3 && r.data.props.sheet.features.actions[0].bonus === 12 && r.data.props.sheet.features.actions[0].actions === 'one')
r = await call('PATCH', `/api/pages/${pfId}`, { propsPatch: { sheet: { 'pf2e.level': 4, 'pf2e.mods.dex': 2, 'pf2e.traits': ['Humanoid'] } } })
r = await call('GET', `/api/pages/${pfId}`)
check('Pathfinder fields are patched by path', r.data.props.sheet.pf2e.level === 4 && r.data.props.sheet.pf2e.mods.dex === 2 && r.data.props.sheet.pf2e.mods.str === 3 && r.data.props.sheet.pf2e.traits.length === 1)
r = await call('PATCH', `/api/pages/${pfId}`, { propsPatch: { sheet: { 'pf2e.level': 99 } } })
check('a creature level above 30 is refused', r.status === 400)
r = await call('PATCH', `/api/pages/${pfId}`, { propsPatch: { sheet: { 'features.actions': [{ name: 'x', text: '', actions: 'seven' }] } } })
check('an unknown action cost is refused', r.status === 400)

// Pathfinder 2e characters
const pcSheet = () => ({ ...pf2eSheet(), kind: 'character', hp: { max: 60, formula: '', current: 60, temp: 0 }, inventory: [], currency: { cp: 0, sp: 0, ep: 0, gp: 15, pp: 0 }, spellcasting: { ability: '', slots: [{ total: 3, used: 0 }, { total: 2, used: 0 }, { total: 0, used: 0 }, { total: 0, used: 0 }, { total: 0, used: 0 }, { total: 0, used: 0 }, { total: 0, used: 0 }, { total: 0, used: 0 }, { total: 0, used: 0 }, { total: 1, used: 0 }] }, pf2e: { ...pf2eSheet().pf2e, char: { ancestry: 'Human', heritage: 'Versatile', background: 'Warrior', className: 'Fighter', keyAbility: 'str', ranks: { perception: 2, fort: 2, ref: 1, will: 2, classDc: 1, spell: 0, armor: 1, skills: { athletics: 3 } }, lores: [{ name: 'Warfare', rank: 1 }], armor: { name: 'Breastplate', bonus: 4, dexCap: 1 }, acExtra: 0, strikes: [{ name: 'Longsword', ability: 'str', rank: 2, item: 1, damage: '1d8+4 slashing', agile: false, note: '' }], heroPoints: 1, dying: 0, wounded: 0, focus: { max: 1, current: 1 }, tradition: '', spellAbility: '' } } })
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Valeros', props: { type: 'person', sheet: pcSheet() } })
check('a Pathfinder character sheet is stored', r.status === 200)
const pcId = r.data.id
r = await call('GET', `/api/pages/${pcId}`)
check('with ranks, armor, strikes and ten spell ranks', r.data.props.sheet.pf2e.char.ranks.skills.athletics === 3 && r.data.props.sheet.pf2e.char.armor.bonus === 4 && r.data.props.sheet.pf2e.char.strikes[0].damage === '1d8+4 slashing' && r.data.props.sheet.spellcasting.slots.length === 10)
r = await call('PATCH', `/api/pages/${pcId}`, { propsPatch: { sheet: { 'pf2e.char': { ...pcSheet().pf2e.char, heroPoints: 2 }, 'pf2e.perception': 13 } } })
r = await call('GET', `/api/pages/${pcId}`)
check('the character part and the derived numbers are patched together', r.data.props.sheet.pf2e.char.heroPoints === 2 && r.data.props.sheet.pf2e.perception === 13)
r = await call('PATCH', `/api/pages/${pcId}`, { propsPatch: { sheet: { 'pf2e.char': { ...pcSheet().pf2e.char, ranks: { ...pcSheet().pf2e.char.ranks, will: 7 } } } } })
check('a proficiency rank above legendary is refused', r.status === 400)
r = await call('PATCH', `/api/pages/${pcId}`, { propsPatch: { sheet: { 'pf2e.char': { ...pcSheet().pf2e.char, heroPoints: 9 } } } })
check('more than three hero points is refused', r.status === 400)

// characters
const hero = () => ({ ...sheet(), kind: 'character', name: 'Aria', player: 'Sam', species: 'Elf', background: 'Sage', classes: [{ name: 'Wizard', level: 5, subclass: 'Evoker' }], profs: { saves: ['int', 'wis'], skills: { arcana: 'e' }, tools: 'Calligrapher' }, hitDice: [{ sides: 6, total: 5, used: 1 }], deathSaves: { ok: 0, fail: 0 }, spellcasting: { ability: 'int', slots: [{ total: 4, used: 1 }] }, spells: 'Fire Bolt', inventory: [{ name: 'Quarterstaff', qty: 1, equipped: true, note: '' }], currency: { cp: 0, sp: 0, ep: 0, gp: 25, pp: 0 }, inspiration: false })
r = await call('POST', `/api/workspaces/${ws}/pages`, { title: 'Aria', props: { type: 'person', sheet: hero() } })
check('a character sheet is stored', r.status === 200)
const heroId = r.data.id
r = await call('GET', `/api/pages/${heroId}`)
check('with its class levels, proficiencies and slots', r.data.props.sheet.kind === 'character' && r.data.props.sheet.classes[0].level === 5 && r.data.props.sheet.profs.skills.arcana === 'e' && r.data.props.sheet.spellcasting.slots[0].total === 4)
r = await call('PATCH', `/api/pages/${heroId}`, { propsPatch: { sheet: { 'currency.gp': 40, 'spellcasting.slots': [{ total: 4, used: 3 }, { total: 2, used: 0 }], 'hp.current': 11, 'hp.temp': 3, inspiration: true } } })
r = await call('GET', `/api/pages/${heroId}`)
check('character fields are patched by path', r.data.props.sheet.currency.gp === 40 && r.data.props.sheet.currency.sp === 0 && r.data.props.sheet.spellcasting.slots[0].used === 3 && r.data.props.sheet.hp.current === 11 && r.data.props.sheet.inspiration === true)
r = await call('PATCH', `/api/pages/${heroId}`, { propsPatch: { sheet: { 'classes': [{ name: 'Wizard', level: 99 }] } } })
check('a level above 20 is refused', r.status === 400)
r = await call('PATCH', `/api/pages/${heroId}`, { propsPatch: { sheet: { 'profs': { saves: ['luck'], skills: {} } } } })
check('an unknown ability is refused', r.status === 400)
r = await call('PATCH', `/api/pages/${heroId}`, { propsPatch: { sheet: { 'inventory': Array.from({ length: 201 }, () => ({ name: 'x', qty: 1, equipped: false, note: '' })) } } })
check('an endless inventory is refused', r.status === 400)
r = await call('GET', `/api/pages/${heroId}`)
check('refused patches change nothing', r.data.props.sheet.currency.gp === 40 && r.data.props.sheet.classes[0].level === 5)

await call('DELETE', `/api/workspaces/${ws}`)
if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nall passed')
