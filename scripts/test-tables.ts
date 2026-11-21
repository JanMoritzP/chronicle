import { cardsText, discardFromHand, drawCards, entriesText, freshDeck, parseCards, parseEntries, pick, shuffle, toDiscard, toHand, totalWeight, handOf } from '../server/src/tables'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

// a small deterministic random source
const seq = (...v: number[]) => { let i = 0; return (sides: number) => Math.min(sides, Math.max(1, v[i++ % v.length])) }
const lcg = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed }
const rnd = (seed = 1) => { const g = lcg(seed); return (sides: number) => (g() % sides) + 1 }

const es = parseEntries('A rusty key\n\n3: A silver coin\n  2:   A torn map  \nnot a weight: really')
check('entries are one per line, with an optional weight', es.map((e) => `${e.weight}:${e.text}`).join('|') === '1:A rusty key|3:A silver coin|2:A torn map|1:not a weight: really')
check('the text can be read back', entriesText(es) === 'A rusty key\n3: A silver coin\n2: A torn map\nnot a weight: really' && parseEntries(entriesText(es)).length === 4)
check('weights add up', totalWeight(es) === 7)
check('a roll lands in the right entry', pick(es, seq(1))!.index === 0 && pick(es, seq(2))!.index === 1 && pick(es, seq(4))!.index === 1 && pick(es, seq(5))!.index === 2 && pick(es, seq(7))!.index === 3)
check('the die is as big as the total', pick(es, (s) => (s === 7 ? 3 : 1))!.total === 7)
check('an empty table gives nothing', pick([], seq(1)) === null && parseEntries('  \n ').length === 0)
check('a weight is kept in range', parseEntries('5000: x')[0].weight === 1000 && parseEntries('0: x')[0].weight === 1)

const cards = parseCards('3x Fireball | 8d6 fire\nShield\n\n2x  Counterspell')
check('cards expand copies and read the text', cards.length === 6 && cards.filter((c) => c.name === 'Fireball').length === 3 && cards[0].text === '8d6 fire' && cards[3].text === '')
check('and read back', cardsText(cards) === '3x Fireball | 8d6 fire\nShield\n2x Counterspell')
check('a deck has a limit', parseCards('99x A\n99x B\n99x C').length === 200)

const sh = shuffle([1, 2, 3, 4, 5, 6, 7, 8], rnd(7))
check('a shuffle keeps every card', sh.slice().sort().join() === '1,2,3,4,5,6,7,8' && sh.join() !== '1,2,3,4,5,6,7,8')
check('and does not change what went in', [1, 2, 3].join() === '1,2,3')

let st = freshDeck(5, rnd(3))
check('a new deck has every card to draw', st.draw.length === 5 && st.discard.length === 0 && Object.keys(st.hands).length === 0)
const d1 = drawCards(st, 2, rnd(4))
check('drawing takes from the top', d1.drawn.length === 2 && d1.state.draw.length === 3 && d1.drawn.join() === st.draw.slice(0, 2).join())
st = toHand(d1.state, 'ann', d1.drawn)
check('cards go to a hand', handOf(st, 'ann').length === 2 && handOf(st, 'ben').length === 0)
const played = discardFromHand(st, 'ann', d1.drawn[0])!
check('a played card goes to the top of the discard pile', played.discard[0] === d1.drawn[0] && handOf(played, 'ann').length === 1)
check('a card not in the hand cannot be played', discardFromHand(st, 'ben', d1.drawn[0]) === null && discardFromHand(st, 'ann', 99) === null)
check('the last card out of a hand clears it', Object.keys(discardFromHand(played, 'ann', d1.drawn[1])!.hands).length === 0)

// running out: the discard pile comes back shuffled
const empty = { draw: [], discard: [4, 5, 6], hands: {} }
const r = drawCards(empty, 2, rnd(5))
check('an empty pile is refilled from the discard pile', r.drawn.length === 2 && r.state.draw.length === 1 && r.state.discard.length === 0 && r.drawn.every((c) => [4, 5, 6].includes(c)))
check('with nothing anywhere fewer cards come', drawCards({ draw: [1], discard: [], hands: {} }, 3, rnd()).drawn.length === 1 && drawCards({ draw: [], discard: [], hands: {} }, 3, rnd()).drawn.length === 0)
check('cards can be put straight on the discard pile', toDiscard({ draw: [], discard: [1], hands: {} }, [2, 3]).discard.join() === '3,2,1')
const everyCard = freshDeck(52, rnd(9))
let all: number[] = []
let s2 = everyCard
for (let i = 0; i < 4; i++) { const x = drawCards(s2, 13, rnd(i)); s2 = x.state; all = all.concat(x.drawn) }
check('a whole deck can be dealt out once each', new Set(all).size === 52 && s2.draw.length === 0)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
