import { backgroundPatch, speciesPatch } from '../web/src/lib/origin'
import { emptyCharacter } from '../web/src/lib/sheet'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const ch = emptyCharacter('5e')
const dragonborn = { traits: [
  { name: 'Size', desc: 'Medium (about 5-7 feet tall)', type: 'SIZE' }, { name: 'Speed', desc: '30 feet', type: 'SPEED' },
  { name: 'Breath Weapon', desc: 'You exhale **magical** energy.', type: null }, { name: 'Darkvision', desc: 'Range of 60 feet', type: null },
] }
const sp = speciesPatch(ch, dragonborn, 'Dragonborn') as any
check('a species sets its name, speed and size', sp.species === 'Dragonborn' && sp['speed.walk'] === 30 && sp.size === 'Medium')
check('its traits become features, without size and speed', sp['features.traits'].map((f: any) => f.name).join() === 'Breath Weapon,Darkvision' && sp['features.traits'][0].text === 'You exhale magical energy.')
const again = speciesPatch({ ...ch, features: { ...ch.features, traits: sp['features.traits'] } } as any, dragonborn, 'Dragonborn') as any
check('a trait the sheet already has is not added twice', again['features.traits'] === undefined)

const acolyte = { benefits: [
  { name: 'Ability Scores', desc: 'Intelligence, Wisdom, Charisma', type: 'ability_score' }, { name: 'Feat', desc: 'Magic Initiate (Cleric)', type: 'feat' },
  { name: 'Skill Proficiencies', desc: 'Insight and Religion', type: 'skill_proficiency' }, { name: 'Tool Proficiency', desc: "Calligrapher's Supplies", type: 'tool_proficiency' },
] }
const bg = backgroundPatch(ch, acolyte, 'Acolyte') as any
check('a background sets its name and skills', bg.background === 'Acolyte' && bg['profs.skills'].insight === 'p' && bg['profs.skills'].religion === 'p')
check('and a tool, its feat and a note about its ability scores', bg['profs.tools'] === "Calligrapher's Supplies" && bg['features.traits'].some((f: any) => f.name === 'Magic Initiate (Cleric)') && bg['features.traits'].some((f: any) => f.text.includes('Intelligence, Wisdom, Charisma')))
const keep = backgroundPatch({ ...ch, profs: { saves: [], skills: { insight: 'e' }, tools: 'Dice set' } } as any, acolyte, 'Acolyte') as any
check('what the sheet already has is kept', keep['profs.skills'].insight === 'e' && keep['profs.tools'] === "Dice set, Calligrapher's Supplies")
check('nothing in the data changes only the name', Object.keys(speciesPatch(ch, {}, 'Elf')).join() === 'species' && Object.keys(backgroundPatch(ch, {}, 'Sage')).join() === 'background')

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
