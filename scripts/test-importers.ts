import { exportCharacter, fromBeyond, fromFoundry, fromRoll20, importCharacter } from '../web/src/lib/importers'
import { emptyCharacter } from '../web/src/lib/sheet'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const foundry = {
  name: 'Seraphine', type: 'character',
  system: {
    abilities: { str: { value: 10, proficient: 0 }, dex: { value: 16, proficient: 1 }, con: { value: 14, proficient: 0 }, int: { value: 12, proficient: 0 }, wis: { value: 13, proficient: 0 }, cha: { value: 8, proficient: 1 } },
    attributes: { hp: { value: 21, max: 30, temp: 3 }, ac: { value: 15 }, movement: { walk: 35 } },
    skills: { ste: { value: 2 }, prc: { value: 1 }, acr: { value: 0 } },
    currency: { gp: 120, sp: 5, cp: 0, ep: 0, pp: 1 }, details: { alignment: 'Chaotic Good' },
  },
  items: [
    { type: 'class', name: 'Rogue', system: { levels: 5, subclass: 'Thief' } },
    { type: 'race', name: 'Half-elf' }, { type: 'background', name: 'Urchin' },
    { type: 'weapon', name: 'Rapier', system: { quantity: 1, equipped: true, weight: 2, attunement: 0 } },
    { type: 'equipment', name: 'Ring of Protection', system: { quantity: 1, equipped: true, weight: { value: 0.1 }, attunement: 2 } },
    { type: 'feat', name: 'Cunning Action', system: { description: { value: '<p>You can <b>dash</b>, disengage or hide.</p>' } } },
    { type: 'spell', name: 'Minor Illusion', system: { level: 0 } },
  ],
}
const f = fromFoundry(foundry) as any
check('a Foundry actor keeps its name, scores and hit points', f.sheet.name === 'Seraphine' && f.sheet.abilities.dex === 16 && f.sheet.hp.max === 30 && f.sheet.hp.current === 21 && f.sheet.hp.temp === 3 && f.sheet.ac.value === 15 && f.sheet.speed.walk === 35)
check('its class, level, species and background', f.sheet.classes[0].name === 'Rogue' && f.sheet.classes[0].level === 5 && f.sheet.classes[0].subclass === 'Thief' && f.sheet.species === 'Half-elf' && f.sheet.background === 'Urchin')
check('its proficiencies in saves and skills, with expertise', f.sheet.profs.saves.join() === 'dex,cha' && f.sheet.profs.skills.stealth === 'e' && f.sheet.profs.skills.perception === 'p' && !('acrobatics' in f.sheet.profs.skills))
check('its things, with weight and attunement', f.sheet.inventory.length === 2 && f.sheet.inventory[0].equipped === true && f.sheet.inventory[0].weight === 2 && f.sheet.inventory[1].attuned === true && f.sheet.inventory[1].weight === 0.1)
check('its features without the markup, and its spells', f.sheet.features.traits[0].text === 'You can dash, disengage or hide.' && f.sheet.spells.includes('Cantrip: Minor Illusion'))
check('its money', f.sheet.currency.gp === 120 && f.sheet.currency.pp === 1)
check('an actor with no scores is refused', 'error' in (fromFoundry({ name: 'x', system: {} }) as any))

const beyond = { success: true, data: { name: 'Brann', stats: [{ id: 1, value: 15 }, { id: 2, value: 10 }, { id: 3, value: 14 }, { id: 4, value: 8 }, { id: 5, value: 12 }, { id: 6, value: 10 }], baseHitPoints: 40, bonusHitPoints: 4, removedHitPoints: 10, temporaryHitPoints: 2, classes: [{ level: 3, definition: { name: 'Cleric' }, subclassDefinition: { name: 'Life' } }, { level: 1, definition: { name: 'Fighter' } }], race: { fullName: 'Dwarf' }, background: { definition: { name: 'Acolyte' } }, inventory: [{ definition: { name: 'Mace', weight: 4 }, quantity: 1, equipped: true }, { definition: { name: 'Amulet' }, quantity: 1, equipped: true, isAttuned: true }], currencies: { gp: 33 } } }
const b = fromBeyond(beyond) as any
check('a D&D Beyond character keeps scores, hit points and classes', b.sheet.name === 'Brann' && b.sheet.abilities.str === 15 && b.sheet.abilities.cha === 10 && b.sheet.hp.max === 44 && b.sheet.hp.current === 34 && b.sheet.hp.temp === 2 && b.sheet.classes.length === 2 && b.sheet.classes[0].subclass === 'Life')
check('and its things and money', b.sheet.inventory[0].weight === 4 && b.sheet.inventory[1].attuned === true && b.sheet.currency.gp === 33 && b.sheet.species === 'Dwarf' && b.sheet.background === 'Acolyte')

const r20 = { name: 'Tamsin', attribs: [{ name: 'strength', current: '9' }, { name: 'dexterity', current: 14 }, { name: 'constitution', current: 12 }, { name: 'intelligence', current: 17 }, { name: 'wisdom', current: 10 }, { name: 'charisma', current: 11 }, { name: 'hp', current: 18, max: 22 }, { name: 'ac', current: 13 }, { name: 'class', current: 'Wizard' }, { name: 'level', current: 4 }, { name: 'race', current: 'Gnome' }, { name: 'speed', current: '25 ft.' }] }
const r = fromRoll20(r20) as any
check('a Roll20 character keeps scores, hit points, class and speed', r.sheet.name === 'Tamsin' && r.sheet.abilities.str === 9 && r.sheet.abilities.int === 17 && r.sheet.hp.max === 22 && r.sheet.hp.current === 18 && r.sheet.ac.value === 13 && r.sheet.classes[0].name === 'Wizard' && r.sheet.classes[0].level === 4 && r.sheet.speed.walk === 25)
check('with no attributes it is refused', 'error' in (fromRoll20({ attribs: [] }) as any))

check('each file is recognised by what it holds', importCharacter(foundry).from === 'Foundry' && importCharacter(beyond).from === 'D&D Beyond' && importCharacter(r20).from === 'Roll20')
const mine = { ...emptyCharacter('5e'), name: 'Mine', hp: { max: 12, formula: '', current: 12, temp: 0 } }
const back = importCharacter(JSON.parse(JSON.stringify(exportCharacter(mine)))) as any
check('a Chronicle character goes out and comes back the same', back.from === 'Chronicle' && back.sheet.name === 'Mine' && back.sheet.hp.max === 12 && back.sheet.kind === 'character')
check('something else is refused with the formats that work', 'error' in (importCharacter({ hello: 1 }) as any) && /Foundry/.test((importCharacter({ hello: 1 }) as any).error) && 'error' in (importCharacter(null) as any))
check('numbers are kept in bounds', (fromFoundry({ name: 'x', system: { abilities: { str: { value: 999 } }, attributes: { hp: { max: -4 } } }, items: [] }) as any).sheet.abilities.str === 60 && (fromFoundry({ name: 'x', system: { abilities: {}, attributes: { hp: { max: -4 } } }, items: [] }) as any).sheet.hp.max === 0)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
