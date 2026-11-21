import { BUILTIN, resolveRules, slugOf, type PackData } from '../web/src/lib/systems'
import { parsePack } from '../server/src/pack'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const r5 = resolveRules('5e', null)
check('without a pack a world has the lists of its rules', r5.conditions.includes('Concentrating') && r5.damageTypes.includes('thunder') && r5.abilities.str.short === 'STR' && r5.initiative === '1d20' && r5.pack === null)
const rp = resolveRules('pf2e', null)
check('Pathfinder has its own conditions and damage types', rp.conditions.includes('Off-guard') && !rp.conditions.includes('Concentrating') && rp.damageTypes.includes('vitality') && !rp.damageTypes.includes('radiant'))

const pack: PackData = { format: 'chronicle-system', v: 1, id: 'grim', name: 'Grim', base: '5e', abilities: { str: { name: 'Might', short: 'MIG' } }, conditions: ['Bleeding'], damageTypes: ['Blood'], initiative: '1d10', grid: { unit: 'm', dist: 1.5, type: 'hex-row' } }
const r = resolveRules('5e', pack)
check('a pack puts its own over the built-in lists', r.conditions.join() === 'Bleeding' && r.damageTypes.join() === 'blood' && r.initiative === '1d10' && r.grid.unit === 'm' && r.name === 'Grim')
check('and keeps the rest', r.abilities.str.short === 'MIG' && r.abilities.dex.name === 'Dexterity')
check('a pack with nothing of a kind leaves that kind alone', resolveRules('5e', { ...pack, conditions: [], damageTypes: undefined }).conditions.includes('Prone') && resolveRules('5e', { ...pack, conditions: [] }).damageTypes.join() === 'blood')
check('the pack\'s engine decides which built-in lists are the base', resolveRules('5e', { ...pack, base: 'pf2e', conditions: undefined, damageTypes: undefined }).conditions.includes('Off-guard'))

for (const k of ['5e', '5e-2024', 'pf2e'] as const) check(`the built-in ${k} system is a pack the server accepts`, 'pack' in (parsePack(BUILTIN[k]) as any), JSON.stringify((parsePack(BUILTIN[k]) as any).error ?? ''))
check('names become ids', slugOf('Dark Fantasy!') === 'dark-fantasy' && slugOf('  ') === 'pack-pack' && slugOf('A') === 'a-pack' && slugOf('x'.repeat(80)).length === 40)

check('a pack adds fields to the character sheet', resolveRules('5e', { ...pack, sheetFields: [{ id: 'doom', label: 'Doom', kind: 'number' }] }).sheetFields[0].id === 'doom' && resolveRules('5e', null).sheetFields.length === 0)
check('and the server accepts them', 'pack' in (parsePack({ ...pack, sheetFields: [{ id: 'doom', label: 'Doom', kind: 'number' }, { id: 'faith', label: 'Faith', kind: 'text' }] }) as any) && 'error' in (parsePack({ ...pack, sheetFields: [{ id: 'Bad Id', label: 'x', kind: 'number' }] }) as any) && 'error' in (parsePack({ ...pack, sheetFields: [{ id: 'a', label: 'x', kind: 'dice' }] }) as any))
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
