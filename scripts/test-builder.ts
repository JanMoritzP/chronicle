import { buildCharacter, CLASSES, finalScores, grantedSkills, pointsSpent, problems, rollScores, suggestedScores, type Choices } from '../web/src/lib/builder'
import { characterLevel, proficiency, saveBonus, skillBonus, spellDC } from '../web/src/lib/sheet'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const fighter = CLASSES.find((c) => c.id === 'fighter')!
const base: Choices = {
  ruleset: '5e', name: 'Brann', classId: 'fighter', speciesId: 'dwarf', backgroundId: 'soldier',
  base: suggestedScores(fighter), bonus: {}, skills: ['perception', 'survival'],
}

check('the standard array goes to what the class needs first', JSON.stringify(suggestedScores(fighter)) === JSON.stringify({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }))
check('a 2014 hill dwarf adds 2 to Constitution and 1 to Wisdom', finalScores(base).con === 15 && finalScores(base).wis === 11)
check('the background and species give their skills', grantedSkills(base).join() === 'athletics,intimidation')
check('nothing is missing from a full set of choices', problems(base).length === 0, problems(base).join(' '))
check('too few skills is named', problems({ ...base, skills: ['perception'] }).some((p) => p.includes('Choose 2 skills')))
check('a missing name is named', problems({ ...base, name: ' ' }).some((p) => p.includes('name')))

const s = buildCharacter(base)
check('a level 1 fighter: hit die plus Constitution plus dwarven toughness', s.hp.max === 13 && s.hp.current === 13)
check('chain mail, a shield and the Defense style make 19', s.ac.value === 19)
check('one d10 hit die', s.hitDice?.length === 1 && s.hitDice[0].sides === 10 && s.hitDice[0].total === 1)
check('proficient in Strength and Constitution saves', saveBonus(s, 'str') === 4 && saveBonus(s, 'con') === 4 && saveBonus(s, 'dex') === 2)
check('chosen and granted skills both count', skillBonus(s, 'athletics') === 4 && skillBonus(s, 'perception') === 2 && skillBonus(s, 'stealth') === 2)
check('level 1, proficiency +2, a character sheet', characterLevel(s) === 1 && proficiency(s) === 2 && s.kind === 'character')
check('a dwarf walks 25 feet and sees in the dark', s.speed.walk === 25 && s.senses.darkvision === 60)
check('the attacks are worked out', s.features.actions[0].text.includes('+4 to hit') && s.features.actions[0].text.includes('1d8+2'))
check('a fighter casts nothing', !s.spellcasting?.ability && !(s.spellcasting?.slots ?? []).length)

const wiz = buildCharacter({ ...base, classId: 'wizard', speciesId: 'elf', backgroundId: 'sage', base: suggestedScores(CLASSES.find((c) => c.id === 'wizard')!), skills: ['investigation', 'insight'] })
check('a high elf wizard: Intelligence 16, two first-level slots, spell save DC 13', wiz.abilities.int === 16 && wiz.spellcasting?.ability === 'int' && wiz.spellcasting.slots[0]?.total === 2 && spellDC(wiz) === 13)
check('a wizard has 6 + Constitution hit points', wiz.hp.max === 6 + Math.floor((wiz.abilities.con - 10) / 2))

const halfElf: Choices = { ...base, speciesId: 'half-elf', bonus: { free: ['str', 'con', 'dex'] } }
check('a half-elf raises only two more scores', finalScores(halfElf).str === 16 && finalScores(halfElf).con === 14 && finalScores(halfElf).dex === 14)

const modern: Choices = { ...base, ruleset: '5e-2024', speciesId: 'dwarf', backgroundId: 'soldier', bonus: { plus2: 'str', plus1: 'con' } }
check('2024: the background raises the scores, the species does not', finalScores(modern).str === 17 && finalScores(modern).con === 14 && finalScores(modern).wis === 10)
check('2024: three +1 instead', finalScores({ ...modern, bonus: { spread: true } }).dex === 15)
check('2024: a score the background does not list is not raised', finalScores({ ...modern, bonus: { plus2: 'cha', plus1: 'con' } }).cha === 8)
check('2024: the background feat is on the sheet', buildCharacter(modern).features.traits.some((f) => f.name.startsWith('Savage Attacker')))
check('2024: the choice of raised scores is asked for', problems({ ...modern, bonus: {} }).some((p) => p.includes('background raises')))
check('2024 dwarves see 120 feet', buildCharacter(modern).senses.darkvision === 120)

check('point buy counts 27 points for 15, 15, 15, 8, 8, 8', pointsSpent({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }) === 27)
let i = 0
const fixed = () => [0.99, 0.0, 0.5, 0.99][i++ % 4]
check('4d6 drops the lowest die', rollScores(fixed)[0] === 6 + 6 + 4)
check('scores never go above 20', finalScores({ ...base, base: { ...base.base, con: 20 } }).con === 20)

if (failed) { console.log(`${failed} failed`); process.exit(1) }
console.log('all passed')
