import { BUILTIN_TYPES, SAMPLE_SOURCE, duplicateKeys, freshKey, layoutKeys, layoutToSource, normalizeLayout, parseSource, type Layout } from '../web/src/lib/pageTypes'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

// built-in and sample layouts round trip through YAML
for (const t of BUILTIN_TYPES)
  check(`built-in ${t.id} round trips through YAML`, JSON.stringify(parseSource(layoutToSource(t.layout))) === JSON.stringify(t.layout))
check('sample source round trips through YAML', JSON.stringify(parseSource(layoutToSource(parseSource(SAMPLE_SOURCE)))) === JSON.stringify(parseSource(SAMPLE_SOURCE)))

// YAML, JSON and Markdown front matter all parse to the same layout
const yaml = `columns: side-left
side:
  - type: image
    key: portrait
    shape: circle
  - type: fields
    title: Facts
    fields:
      - { key: origin, label: Origin }
      - { key: motto, label: Motto, multiline: true }
main:
  - type: body
`
const json = JSON.stringify({ columns: 'side-left', side: [{ type: 'image', key: 'portrait', shape: 'circle' }, { type: 'fields', title: 'Facts', fields: [{ key: 'origin', label: 'Origin' }, { key: 'motto', label: 'Motto', multiline: true }] }], main: [{ type: 'body' }] })
const md = `---\n${yaml}---\n# Some page text\n`
const a = parseSource(yaml), b = parseSource(json), c = parseSource(md)
check('YAML, JSON and front matter parse the same', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(b) === JSON.stringify(c))
check('multiline flag survives the round trip', a.side[1].type === 'fields' && a.side[1].fields[1].multiline === true)

// normalization
check('a layout without body gets one in main', normalizeLayout({}).main.length === 1 && normalizeLayout({}).main[0].type === 'body')
check('single column merges side into main', JSON.stringify(normalizeLayout({ columns: 'single', side: [{ type: 'image', key: 'p' }], main: [{ type: 'body' }] })) === JSON.stringify(normalizeLayout({ columns: 'single', main: [{ type: 'image', key: 'p' }, { type: 'body' }] })))
check('side width is clamped to 160..520', normalizeLayout({ sideWidth: 5 }).sideWidth === 160 && normalizeLayout({ sideWidth: 9999 }).sideWidth === 520)
const throws = (src: string) => { try { parseSource(src); return false } catch { return true } }
check('unknown block type is rejected', throws('main:\n  - type: table\n'))
check('a fields block without fields is rejected', throws('main:\n  - type: fields\n'))
check('an empty definition is rejected', throws('   '))

// value keys
const withDups: Layout = { columns: 'side-right', sideWidth: 280, top: [], side: [{ type: 'image', key: 'portrait', shape: 'square' }, { type: 'statblock', key: 'stats', template: '5e-monster' }], main: [{ type: 'fields', fields: [{ key: 'portrait', label: 'Dup' }, { key: 'solo', label: 'Solo' }] }, { type: 'body' }], bottom: [] }
check('duplicate keys are found', JSON.stringify(duplicateKeys(withDups)) === '["portrait"]', JSON.stringify(duplicateKeys(withDups)))
check('built-in layouts have no duplicate keys', BUILTIN_TYPES.every((t) => duplicateKeys(t.layout).length === 0))
check('layoutKeys collects image, statblock and field keys', JSON.stringify(layoutKeys(withDups).sort()) === JSON.stringify(['portrait', 'stats', 'portrait', 'solo'].sort()))
check('freshKey picks a free key', freshKey(withDups, 'portrait') === 'portrait_2' && freshKey(withDups, 'solo') === 'solo_2' && freshKey(withDups, 'new') === 'new')

console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)
