export interface FuzzyHit { score: number; indices: number[] }

/** Subsequence fuzzy match. Rewards prefix, word starts and consecutive characters; returns null if no match. */
export function fuzzy(query: string, text: string): FuzzyHit | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return { score: 0, indices: [] }
  if (q.length > t.length) return null

  const sub = t.indexOf(q)
  if (sub >= 0) {
    const indices = Array.from({ length: q.length }, (_, i) => sub + i)
    const wordStart = sub === 0 || /[\s\-_/]/.test(t[sub - 1])
    return { score: 100 + (sub === 0 ? 60 : 0) + (wordStart ? 30 : 0) - sub * 0.5 - (t.length - q.length) * 0.3, indices }
  }

  const indices: number[] = []
  let ti = 0
  let score = 0
  let prev = -2
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]
    let found = -1
    while (ti < t.length) { if (t[ti] === c) { found = ti; break } ti++ }
    if (found < 0) return null
    indices.push(found)
    score += 10
    if (found === prev + 1) score += 15
    if (found === 0 || /[\s\-_/]/.test(t[found - 1])) score += 12
    score -= (found - (prev + 1)) * 0.4
    prev = found
    ti = found + 1
  }
  return { score: score - t.length * 0.2, indices }
}

export function highlight(text: string, indices: number[]): (string | { m: string })[] {
  if (!indices.length) return [text]
  const set = new Set(indices)
  const out: (string | { m: string })[] = []
  let buf = ''
  let inMark = false
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i)
    if (m !== inMark) { if (buf) out.push(inMark ? { m: buf } : buf); buf = ''; inMark = m }
    buf += text[i]
  }
  if (buf) out.push(inMark ? { m: buf } : buf)
  return out
}
