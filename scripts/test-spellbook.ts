import { addSpell, labelLevel, readSpells, removeSpell, slotFor } from '../web/src/lib/spellbook'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

check('labels name levels in several ways', labelLevel('Cantrips (3)') === 0 && labelLevel('Level 1 (4)') === 1 && labelLevel('3rd level') === 3 && labelLevel('2nd-level spells') === 2 && labelLevel('Prepared') === null)
const text = 'Cantrips (3): Fire Bolt, Mage Hand, Light\nSpellbook: Magic Missile, Shield, Fireball\nLevel 2: Misty Step'
const lib: Record<string, number> = { 'magic missile': 1, shield: 1, fireball: 3 }
const book = readSpells(text, (n) => lib[n.toLowerCase()] ?? null)
check('every spell is read with its level', book.length === 7 && book.filter((s) => s.level === 0).length === 3 && book.find((s) => s.name === 'Fireball')!.level === 3 && book.find((s) => s.name === 'Misty Step')!.level === 2)
check('a line that is not a level keeps its label as a tag', book.find((s) => s.name === 'Shield')!.tag === 'Spellbook' && !book.find((s) => s.name === 'Light')!.tag)
check('a spell the library does not know has no level', readSpells('Prepared: Homebrew Bolt')[0].level === null)
check('a spell goes to the line of its level', addSpell(text, 'Hold Person', 2) === 'Cantrips (3): Fire Bolt, Mage Hand, Light\nSpellbook: Magic Missile, Shield, Fireball\nLevel 2: Misty Step, Hold Person')
check('a new level goes after the lower ones', addSpell('Cantrips: Light\nLevel 3: Fireball', 'Shield', 1) === 'Cantrips: Light\nLevel 1: Shield\nLevel 3: Fireball')
check('a new level goes before the higher ones when there is no lower one', addSpell('Level 3: Fireball', 'Light', 0) === 'Cantrips: Light\nLevel 3: Fireball')
check('a spell already there is not added twice', addSpell(text, 'shield', 1) === text)
check('a spell of no known level goes at the end', addSpell('Level 1: Shield', 'Odd Spell', null) === 'Level 1: Shield\nOdd Spell')
check('the first spell makes the first line', addSpell('', 'Light', 0) === 'Cantrips: Light')
check('removing a spell keeps the rest of its line', removeSpell(text, 1, 'Shield') === 'Cantrips (3): Fire Bolt, Mage Hand, Light\nSpellbook: Magic Missile, Fireball\nLevel 2: Misty Step')
check('removing the last spell of a line removes the line', removeSpell(text, 2, 'Misty Step') === 'Cantrips (3): Fire Bolt, Mage Hand, Light\nSpellbook: Magic Missile, Shield, Fireball')
const slots = [{ total: 4, used: 4 }, { total: 3, used: 1 }, { total: 2, used: 2 }]
check('a spell is cast with the lowest slot left at or above its level', slotFor(slots, 1) === 1 && slotFor(slots, 2) === 1 && slotFor(slots, 3) === -1 && slotFor(slots, 0) === -1)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
