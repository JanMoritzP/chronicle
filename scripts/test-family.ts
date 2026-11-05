import { familyComponents, layoutFamily, NODE_W } from '../web/src/lib/family'
import type { Relation } from '../web/src/types'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }
let n = 0
const r = (sourceId: string, targetId: string, kind: Relation['kind']): Relation => ({ id: String(n++), sourceId, targetId, kind, label: '' })

// grandparents G1+G2 -> Dad, Mum is Dad's spouse -> Kid1, Kid2; Uncle is Dad's sibling
const rels = [
  r('G1', 'G2', 'spouse'), r('G1', 'Dad', 'parent'), r('G2', 'Dad', 'parent'), r('G1', 'Uncle', 'parent'),
  r('Dad', 'Mum', 'spouse'), r('Dad', 'Kid1', 'parent'), r('Mum', 'Kid1', 'parent'), r('Dad', 'Kid2', 'parent'),
  r('Dad', 'Uncle', 'sibling'), r('X', 'Y', 'other'), r('Lone', 'Other', 'spouse'),
]
const comps = familyComponents(rels)
check('other-type links are not family', !comps.flat().includes('X'))
check('two separate families found', comps.length === 2, JSON.stringify(comps.map((c) => c.length)))
check('largest family first', comps[0].length === 7)

const L = layoutFamily(comps[0], rels)
const at = (id: string) => L.nodes.find((x) => x.id === id)!
check('grandparents are generation 0', at('G1').gen === 0 && at('G2').gen === 0)
check('children one generation down', at('Dad').gen === 1 && at('Kid1').gen === 2)
check('spouse shares the generation', at('Mum').gen === at('Dad').gen)
check('sibling shares the generation', at('Uncle').gen === at('Dad').gen)
check('spouses sit side by side', Math.abs(at('G1').x - at('G2').x) >= NODE_W && Math.abs(at('G1').x - at('G2').x) < NODE_W * 2)
const overlap = L.nodes.some((a) => L.nodes.some((b) => a.id < b.id && a.gen === b.gen && Math.abs(a.x - b.x) < NODE_W))
check('no overlapping boxes', !overlap)
check('children are below parents', at('Kid1').y > at('Dad').y)
const mid = (at('Kid1').x + at('Kid2').x) / 2
check('children centred roughly under their parents', Math.abs(mid - (at('Dad').x + at('Mum').x) / 2) < NODE_W * 1.5, `${mid}`)
check('layout has no negative x', L.nodes.every((x) => x.x >= 0))

// robustness: a bad cycle (should be blocked by the server, but must not hang)
const cyc = [r('A', 'B', 'parent'), r('B', 'C', 'parent'), r('C', 'A', 'parent')]
const t0 = Date.now()
const cl = layoutFamily(['A', 'B', 'C'], cyc)
check('cycle does not hang', Date.now() - t0 < 500 && cl.nodes.length === 3)

// scale
const big: Relation[] = []
for (let i = 1; i < 400; i++) big.push(r('p' + Math.floor(i / 2), 'p' + i, 'parent'))
const t1 = Date.now()
const bl = layoutFamily(Array.from({ length: 400 }, (_, i) => 'p' + i), big)
check('400 people lay out quickly', Date.now() - t1 < 500 && bl.nodes.length === 400, `${Date.now() - t1}ms`)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
