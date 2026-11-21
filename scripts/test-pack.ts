import { contentCounts, packDamageTypes, parsePack, PACK_FORMAT } from '../server/src/pack'
import { adjustDamage, typesIn } from '../server/src/rules5e'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const good = {
  format: PACK_FORMAT, v: 1, id: 'dark-fantasy', name: 'Dark fantasy', version: '1.0', author: 'Someone', base: '5e',
  abilities: { str: { name: 'Might', short: 'MIG' }, dex: { name: 'Grace', short: 'GRC' } },
  conditions: ['Bleeding', 'Cursed', 'Terrified'], damageTypes: ['Blood', 'Shadow', 'fire'], initiative: '1d10',
  grid: { unit: 'm', dist: 1.5, type: 'hex-row' },
  content: { rollTables: [{ name: 'Omens', entries: 'A raven\n2: A bell' }], decks: [{ name: 'Fates', cards: '3x Boon' }], macros: [{ name: 'Brace', text: '/me braces' }] },
}
const r = parsePack(good) as any
check('a good pack is read', !!r.pack && r.pack.name === 'Dark fantasy' && r.pack.base === '5e')
check('what comes with it is counted', JSON.stringify(contentCounts(r.pack)) === '{"rollTables":1,"decks":1,"macros":1}')
check('a pack can be small', 'pack' in (parsePack({ format: PACK_FORMAT, v: 1, id: 'tiny-one', name: 'Tiny', base: 'pf2e' }) as any))
check('a file of another kind is refused', 'error' in (parsePack({ format: 'something', v: 1 }) as any) && 'error' in (parsePack(null) as any) && 'error' in (parsePack('x') as any))
check('an unknown field is refused, so a typo does not pass silently', 'error' in (parsePack({ ...good, conditons: ['x'] }) as any))
check('a bad id is refused', 'error' in (parsePack({ ...good, id: 'Bad Id!' }) as any) && 'error' in (parsePack({ ...good, id: 'a' }) as any))
check('an engine that does not exist is refused', 'error' in (parsePack({ ...good, base: 'dnd4' }) as any))
check('a bad initiative is refused, a good one is kept', 'error' in (parsePack({ ...good, initiative: 'roll it' }) as any) && (parsePack({ ...good, initiative: 'd6' }) as any).pack.initiative === 'd6')
check('too many conditions are refused', 'error' in (parsePack({ ...good, conditions: Array.from({ length: 61 }, (_, i) => `c${i}`) }) as any))
check('the error says where', /conditions/.test((parsePack({ ...good, conditions: [''] }) as any).error))
check('damage types are lower cased for matching', packDamageTypes(r.pack)!.join() === 'blood,shadow,fire' && packDamageTypes(null) === null && packDamageTypes({ ...r.pack, damageTypes: [] }) === null)

const types = packDamageTypes(r.pack)!
check('resistance is read for the pack\'s own damage types', [...typesIn('blood, shadow; poison', types)].sort().join() === 'blood,shadow')
check('a type the engine knows but the pack does not is not matched', !typesIn('poison', types).has('poison') && typesIn('poison').has('poison'))
const sheet = { resistances: 'Shadow', vulnerabilities: 'blood', immunities: '' }
check('so a pack\'s damage types halve, double and stop', adjustDamage(8, 'shadow', sheet, types).amount === 4 && adjustDamage(8, 'blood', sheet, types).amount === 16 && adjustDamage(8, 'fire', sheet, types).amount === 8)
check('without the pack\'s types they do nothing', adjustDamage(8, 'shadow', sheet).effect === null)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
