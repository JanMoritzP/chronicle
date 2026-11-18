import type { LibraryCategory } from '../types'

// Finds the names of library entries inside running text so that a class page can link "Charisma", "Charmed"
// or *Fireball* without anyone typing {{ }}. The rules are deliberately strict: a name is only linked where it
// is clearly meant as the term, never where it is an ordinary word ("light armor", "fire", "range").

export interface Target { key: string; name: string; category: LibraryCategory }
export interface Hit { start: number; end: number; target: Target }
export interface FindOpts {
  /** the text is italic: spells are written in italics and only link then */
  italic?: boolean
  /** entries already linked in this scope (one section, one field); filled as links are found */
  seen: Set<string>
  /** the entry whose own text this is: it never links to itself */
  selfKey?: string
  selfName?: string
}
export interface Matcher { find: (text: string, opts: FindOpts) => Hit[] }

/**
 * exact: the written form must be the entry's name with its capitals (Charisma, Wizard, Hit Points)
 * loose: any capitals (a prone or charmed creature)
 * damage: only before the word "damage" (fire damage)
 * school: only before "spell" or "school" (an evocation spell)
 * italic: only in italics, matching the name in any case (*fireball*)
 */
type Mode = 'exact' | 'loose' | 'damage' | 'school' | 'italic'
const MODE: Partial<Record<LibraryCategory, Mode>> = {
  ability: 'exact', skill: 'exact', class: 'exact', species: 'exact', feat: 'exact', item: 'exact', magicitem: 'exact', language: 'exact', rule: 'exact',
  condition: 'loose', damagetype: 'damage', school: 'school', spell: 'italic',
}
// first wins when one name belongs to several kinds
const ORDER: LibraryCategory[] = ['ability', 'skill', 'condition', 'class', 'species', 'feat', 'spell', 'magicitem', 'item', 'language', 'rule', 'damagetype', 'school']

// ordinary words that are also names; never linked as plain text
const STOP = new Set(['common', 'light', 'heavy', 'range', 'reach', 'special', 'loading', 'thrown', 'shield', 'armor', 'tool', 'tools', 'magic', 'level', 'class', 'feat', 'species', 'size', 'speed', 'skill', 'target', 'effect', 'object', 'creature', 'weapon', 'attack', 'rest', 'turn', 'round', 'time', 'bonus', 'action'])
// conditions that are also everyday adjectives: only when written with a capital
const CAPITAL_ONLY = new Set(['invisible'])

const TITLE_TAIL = /[A-Z][A-Za-z'’-]* $/
const MAX_WORDS = 6
const WORD = /[A-Za-z][A-Za-z'’-]*/g
const norm = (s: string) => s.toLowerCase().replace(/’/g, "'")

function linkable(category: LibraryCategory, name: string): boolean {
  const mode = MODE[category]
  if (!mode || name.length < 3 || !/^[A-Za-z][A-Za-z'’ -]*$/.test(name)) return false
  const words = name.split(' ').length
  if (words > MAX_WORDS) return false
  if ((mode === 'exact' || mode === 'loose') && STOP.has(name.toLowerCase())) return false
  switch (category) {
    case 'feat': return words >= 2 || name.length >= 7
    case 'rule': return words >= 2 || name.length >= 8
    case 'item': return words >= 2 || name.length >= 5
    default: return true
  }
}

function allowed(t: Target, written: string, before: string, after: string, opts: FindOpts): boolean {
  switch (MODE[t.category]) {
    // a one word rule at the end of a capitalised phrase is part of that phrase (Weapon Proficiencies, Armor Training)
    case 'exact': return written === t.name && !(t.category === 'rule' && !written.includes(' ') && TITLE_TAIL.test(before))
    case 'loose': return !CAPITAL_ONLY.has(t.name.toLowerCase()) || written === t.name
    case 'damage': return /^\s+damage\b/i.test(after)
    case 'school': return /^\s+(spell|spells|school)\b/i.test(after)
    case 'italic': return !!opts.italic && norm(written) === norm(t.name)
    default: return false
  }
}

const cache = new WeakMap<object, Matcher>()

export function buildMatcher(index: { rows: readonly (readonly string[])[] }): Matcher {
  const hit = cache.get(index)
  if (hit) return hit
  const byName = new Map<string, Target[]>()
  for (const [key, cat, name] of index.rows) {
    const category = cat as LibraryCategory
    if (!linkable(category, name)) continue
    const k = norm(name)
    const list = byName.get(k)
    const t: Target = { key, name, category }
    if (list) list.push(t); else byName.set(k, [t])
  }
  for (const list of byName.values()) list.sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category))

  const matcher: Matcher = {
    find(text, opts) {
      const tokens = [...text.matchAll(WORD)].map((m) => ({ w: m[0], start: m.index!, end: m.index! + m[0].length }))
      const hits: Hit[] = []
      for (let i = 0; i < tokens.length; i++) {
        let consumed = 0
        for (let len = Math.min(MAX_WORDS, tokens.length - i); len >= 1 && !consumed; len--) {
          // the words of a name are separated by single spaces
          let contiguous = true
          for (let j = i; j < i + len - 1; j++) if (text.slice(tokens[j].end, tokens[j + 1].start) !== ' ') { contiguous = false; break }
          if (!contiguous) continue
          const words = tokens.slice(i, i + len).map((t) => norm(t.w))
          const start = tokens[i].start
          let end = tokens[i + len - 1].end
          let targets = byName.get(words.join(' '))
          // "Charisma's modifier"
          if (!targets && /'s$/.test(words[len - 1])) {
            words[len - 1] = words[len - 1].slice(0, -2)
            targets = byName.get(words.join(' '))
            if (targets) end -= 2
          }
          if (!targets) continue
          const written = text.slice(start, end)
          const after = text.slice(end)
          const t = targets.find((x) => allowed(x, written, text.slice(0, start), after, opts))
          if (!t) continue
          consumed = len
          // a mention that is already linked, or is the entry itself, is skipped but still uses up its words
          if (t.key === opts.selfKey || (opts.selfName && norm(t.name) === norm(opts.selfName)) || opts.seen.has(t.key)) continue
          opts.seen.add(t.key)
          hits.push({ start, end, target: t })
        }
        if (consumed > 1) i += consumed - 1
      }
      return hits
    },
  }
  cache.set(index, matcher)
  return matcher
}

/** The text cut into plain pieces and hits, in order. */
export function splitByHits(text: string, hits: Hit[]): (string | Hit)[] {
  const out: (string | Hit)[] = []
  let at = 0
  for (const h of hits) {
    if (h.start > at) out.push(text.slice(at, h.start))
    out.push(h)
    at = h.end
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}

// ---------- editor documents ----------

interface DocNode { type?: string; text?: string; attrs?: Record<string, any>; content?: DocNode[]; marks?: { type: string; attrs?: Record<string, any> }[] }

const SKIP = new Set(['heading', 'codeBlock', 'statblock', 'todo', 'embed', 'image'])

/**
 * Turns the library names in the text of a document into links to the library entry (wikilinks with a libKey).
 * Headings, code, stat blocks and existing links are left alone, and each entry is linked once per section.
 * Returns a new document; the input is not changed.
 */
export function autolinkDoc(doc: DocNode, matcher: Matcher, self: { key?: string; name?: string } = {}): { doc: DocNode; count: number } {
  let seen = new Set<string>()
  let count = 0
  const inline = (nodes: DocNode[]): DocNode[] => nodes.flatMap((n) => {
    if (n.type !== 'text' || !n.text) return [n]
    const marks = n.marks ?? []
    if (marks.some((m) => m.type === 'link' || m.type === 'code')) return [n]
    const hits = matcher.find(n.text, { italic: marks.some((m) => m.type === 'italic'), seen, selfKey: self.key, selfName: self.name })
    if (!hits.length) return [n]
    return splitByHits(n.text, hits).map((p): DocNode => {
      if (typeof p === 'string') return { ...n, text: p }
      count++
      const written = n.text!.slice(p.start, p.end)
      return { type: 'wikilink', attrs: { name: p.target.name, pageId: null, anchor: null, anchorText: null, alias: written === p.target.name ? null : written, libKey: p.target.key } }
    })
  })
  const walk = (n: DocNode): DocNode => {
    if (n.type === 'heading') { seen = new Set(); return n }
    if (n.type && SKIP.has(n.type)) return n
    if (!n.content) return n
    const textual = n.content.some((c) => c.type === 'text' || c.type === 'wikilink' || c.type === 'hardBreak')
    return { ...n, content: textual ? inline(n.content) : n.content.map(walk) }
  }
  return { doc: walk(doc), count }
}
