import { bind, bindable, DEFAULT_KEYS, loadKeys, pressed } from '../web/src/lib/tablekeys'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

check('the defaults are the keys of old', DEFAULT_KEYS.fit === 'f' && DEFAULT_KEYS.rotate === 'r' && DEFAULT_KEYS.hide === 'h' && DEFAULT_KEYS.lock === 'l')
check('with nothing chosen the defaults are used', JSON.stringify(loadKeys(null)) === JSON.stringify(DEFAULT_KEYS) && JSON.stringify(loadKeys('not json')) === JSON.stringify(DEFAULT_KEYS))
check('a chosen key replaces the default', loadKeys('{"fit":"G"}').fit === 'g' && loadKeys('{"fit":"g"}').rotate === 'r')
check('a bad or doubled choice is ignored', loadKeys('{"fit":"Escape"}').fit === 'f' && loadKeys('{"fit":"x","rotate":"x"}').rotate === 'r')
check('only a letter or a number can be bound', bindable('a') && bindable('7') && !bindable('Delete') && !bindable('ArrowUp') && !bindable(' ') && !bindable('ab'))
const b = bind(DEFAULT_KEYS, 'fit', 'G') as any
check('binding gives the new keys', b.keys.fit === 'g' && b.keys.rotate === 'r')
check('a key another action has is refused', 'error' in (bind(DEFAULT_KEYS, 'fit', 'r') as any) && 'error' in (bind(DEFAULT_KEYS, 'fit', 'Escape') as any))
check('rebinding the same action to its own key is fine', 'keys' in (bind(DEFAULT_KEYS, 'fit', 'f') as any))
const ev = (key: string, over = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...over })
check('a press matches its key in either case and not with Ctrl', pressed(ev('F'), DEFAULT_KEYS, 'fit') && pressed(ev('f'), DEFAULT_KEYS, 'fit') && !pressed(ev('f', { ctrlKey: true }), DEFAULT_KEYS, 'fit') && !pressed(ev('g'), DEFAULT_KEYS, 'fit'))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
