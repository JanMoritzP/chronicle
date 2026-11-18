import { autolinkDoc, buildMatcher, splitByHits } from '../web/src/lib/autolink'
import type { LibraryCategory, LibraryIndex } from '../web/src/types'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const names: [LibraryCategory, string][] = [
  ['ability', 'Charisma'], ['ability', 'Dexterity'], ['skill', 'Stealth'], ['condition', 'Charmed'], ['condition', 'Prone'], ['condition', 'Invisible'],
  ['spell', 'Fireball'], ['spell', 'Light'], ['spell', 'Power Word Kill'], ['damagetype', 'Fire'], ['damagetype', 'Cold'], ['school', 'Evocation'],
  ['class', 'Wizard'], ['class', 'Bard'], ['species', 'Elf'], ['rule', 'Hit Points'], ['rule', 'Cover'], ['rule', 'Proficiencies'], ['rule', 'Advantage'], ['weaponproperty', 'Light'], ['weaponproperty', 'Finesse'],
  ['item', 'Chain Mail'], ['item', 'Shield'], ['feat', 'Alert'], ['feat', 'Magic Initiate'], ['language', 'Common'], ['language', 'Elvish'], ['magicitem', 'Bag of Holding'],
  ['condition', 'Armor +1'],
]
const index: LibraryIndex = { version: 1, sources: {}, rows: names.map(([c, n]) => [`${c}:${n.toLowerCase().replace(/ /g, '-')}`, c, n, 'srd', '']) }
const m = buildMatcher(index)
const run = (text: string, o: { italic?: boolean; selfKey?: string; selfName?: string } = {}) => {
  const hits = m.find(text, { seen: new Set(), ...o })
  return hits.map((h) => text.slice(h.start, h.end) + '=' + h.target.key)
}
const keys = (text: string, o: { italic?: boolean } = {}) => run(text, o).map((x) => x.split('=')[1])

check('an ability is linked', keys('a number of times equal to your Charisma modifier').join() === 'ability:charisma')
check('a possessive still links', keys("Charisma's bonus").join() === 'ability:charisma' && run("Charisma's bonus")[0].startsWith('Charisma='))
check('lower case ability is left alone', keys('your charisma').length === 0)
check('conditions link in any case', keys('applies the Charmed or Frightened condition, a prone target').join() === 'condition:charmed,condition:prone')
check('an everyday adjective condition needs a capital', keys('an invisible foe').length === 0 && keys('the Invisible condition').length === 1)
check('spells link only in italics', keys('cast fireball', {}).length === 0 && keys('Fireball', { italic: true }).join() === 'spell:fireball')
check('a multi word spell links whole', keys('Power Word Kill', { italic: true }).join() === 'spell:power-word-kill')
check('weapon properties are not linked in prose', keys('light armor and a Light weapon with Finesse').length === 0)
check('damage types need the word damage', keys('takes fire damage and 3 cold damage').join() === 'damagetype:fire,damagetype:cold' && keys('a fire in the cold').length === 0)
check('a school needs spell or school after it', keys('an Evocation spell').join() === 'school:evocation' && keys('Evocation is fun').length === 0)
check('classes and species link with capitals', keys('the Wizard and the Elf').join() === 'class:wizard,species:elf' && keys('a wizard').length === 0)
check('rules need to be long enough or several words', keys('your Hit Points and Cover').join() === 'rule:hit-points')
check('a one word rule links on its own but not as the tail of a capitalised phrase', keys('Weapon Proficiencies').length === 0 && keys('with Advantage').join() === 'rule:advantage' && keys('Advantage on rolls').join() === 'rule:advantage')
check('common words that are names stay plain', keys('Shield, Common and Alert').length === 0)
check('several word items and feats link', keys('Chain Mail, Magic Initiate and a Bag of Holding').join() === 'item:chain-mail,feat:magic-initiate,magicitem:bag-of-holding')
check('names with a plus sign are not matched', keys('Armor +1').length === 0)
check('words inside other words are not matched', keys('Charismatic Wizardry').length === 0)
check('the longest name wins', keys('Hit Points').join() === 'rule:hit-points')

const seen = new Set<string>()
const first = m.find('Charisma and Charisma again', { seen })
check('each entry is linked once per scope', first.length === 1 && first[0].start === 0)
check('an entry never links to itself', run('Charisma', { selfKey: 'ability:charisma' }).length === 0 && run('Bard', { selfName: 'Bard' }).length === 0)
const pieces = splitByHits('Wizard, Bard', m.find('Wizard, Bard', { seen: new Set() }))
check('text is cut around the hits', pieces.length === 3 && pieces[1] === ', ')

// documents
const doc = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Charisma' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Uses ' }, { type: 'text', text: 'Charisma', marks: [{ type: 'bold' }] }, { type: 'text', text: ' and Charisma; cast ' }, { type: 'text', text: 'Fireball', marks: [{ type: 'italic' }] }] },
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Next' }] },
  { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Charisma again' }] }] }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Dexterity', marks: [{ type: 'link', attrs: { href: 'x' } }] }] },
] }
const before = JSON.stringify(doc)
const out = autolinkDoc(doc, m, { key: 'class:bard', name: 'Bard' })
const flat = JSON.stringify(out.doc)
check('a document is linked without touching the input', JSON.stringify(doc) === before && out.count === 3, 'links ' + out.count)
check('headings stay text', out.doc.content![0].content![0].type === 'text')
check('only the first mention in a section is linked', (flat.match(/ability:charisma/g) ?? []).length === 2)
check('the count restarts after a heading', JSON.stringify(out.doc.content![3]).includes('ability:charisma'))
check('an italic spell in a document is linked', flat.includes('spell:fireball'))
check('existing links are left alone', !JSON.stringify(out.doc.content![4]).includes('wikilink'))

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\nall passed')
