import { tumbles } from '../web/src/lib/dicefaces'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const die = (v: number, dropped = false) => ({ v, ...(dropped ? { dropped } : {}) })
const roll = (terms: any[]) => ({ id: 'm1', parts: [{ t: 'roll', roll: { expr: '', label: '', total: 0, terms, crit: null } }] }) as any
const fixed = () => 0.5

const t = tumbles(roll([{ kind: 'dice', sign: 1, count: 2, sides: 20, dice: [die(14), die(3, true)], subtotal: 14, text: '' }, { kind: 'num', sign: 1, value: 5 }]), fixed)
check('each die rolled is a die to show, with its number', t.length === 2 && t[0].value === 14 && t[0].sides === 20 && t[1].value === 3)
check('a dropped die is marked', t[1].dropped === true && t[0].dropped === false)
check('the other faces are numbers the die could show', t[0].faces.length === 5 && t[0].faces.every((n) => n >= 1 && n <= 20))
check('a plain number shows no die, and talk shows none', tumbles(roll([{ kind: 'num', sign: 1, value: 4 }]), fixed).length === 0 && tumbles({ id: 'x', parts: [{ t: 'text', text: 'hi' }] } as any, fixed).length === 0)
check('only a handful of dice tumble', tumbles(roll([{ kind: 'dice', sign: 1, count: 30, sides: 6, dice: Array.from({ length: 30 }, () => die(3)), subtotal: 90, text: '' }]), fixed).length === 8)
check('every die has its own key', new Set(t.map((x) => x.key)).size === t.length)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
