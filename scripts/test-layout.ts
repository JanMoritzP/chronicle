import { BUILTIN_TYPES, SAMPLE_SOURCE, coverBlock, duplicateKeys, freshKey, infoboxNode, layoutKeys, layoutToSource, normalizeLayout, parseSource, startingDoc, zonesInText, type Layout } from '../web/src/lib/pageTypes'

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
// zones as boxes in the text
check('inText is off unless set', normalizeLayout({}).inText === false && normalizeLayout({ inText: true }).inText === true)
check('every built-in type puts its zones in the text', BUILTIN_TYPES.every((t) => t.layout.inText))
const person = BUILTIN_TYPES.find((t) => t.id === 'person')!
const fresh = startingDoc(person)
check('a new person starts with its side as a box, then the starter text', fresh.content[0].type === 'infobox' && fresh.content[0].attrs.zone === 'side' && fresh.content.some((n: any) => n.type === 'heading'))
check('the box floats where the side column was', infoboxNode(normalizeLayout({ columns: 'side-left' }), 'side').attrs!.side === 'left' && infoboxNode(person.layout, 'side').attrs!.side === 'right')
check('the box is about as wide as the side column was', (infoboxNode(normalizeLayout({ sideWidth: 380 }), 'side').attrs!.size as number) > (infoboxNode(normalizeLayout({ sideWidth: 240 }), 'side').attrs!.size as number))
const location = startingDoc(BUILTIN_TYPES.find((t) => t.id === 'location')!)
check('a location keeps its banner as the cover and gets a side box', location.content[0].attrs.zone === 'side' && !location.content.some((n: any) => n.attrs?.zone === 'top'))
check('a top zone of one picture is the cover', coverBlock(BUILTIN_TYPES.find((t) => t.id === 'location')!.layout)?.key === 'portrait' && coverBlock(person.layout) === null)
const fieldsTop = normalizeLayout({ inText: true, top: [{ type: 'fields', fields: [{ key: 'a', label: 'A' }] }], main: [{ type: 'body' }] })
check('a top zone of fields still starts as a full-width box', startingDoc({ ...person, layout: fieldsTop }).content[0].attrs.zone === 'top')
const imported = startingDoc(person, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Imported' }] }] })
check('given text is kept, with the box before it', imported.content.length === 2 && imported.content[0].type === 'infobox' && imported.content[1].content[0].text === 'Imported')
check('a text that already has the box gets no second one', startingDoc(person, fresh).content.filter((n: any) => n.type === 'infobox').length === 1)
check('zonesInText finds boxes inside other blocks', zonesInText({ type: 'doc', content: [{ type: 'columns', content: [{ type: 'column', content: [{ type: 'infobox', attrs: { zone: 'top' } }] }] }] }).has('top'))
const fixed = { ...person, layout: { ...person.layout, inText: false } }
check('a type with fixed zones keeps the text as given', startingDoc(fixed, undefined) === undefined)
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
