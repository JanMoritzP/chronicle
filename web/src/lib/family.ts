import type { Relation } from '../types'

export const NODE_W = 140
export const NODE_H = 44
const GAP_X = 28
const GAP_Y = 90

export interface FamilyNode { id: string; x: number; y: number; gen: number }
export interface FamilyLayout { nodes: FamilyNode[]; width: number; height: number }

const FAMILY = new Set(['parent', 'spouse', 'sibling'])

/** Groups pages into families: sets of pages connected by parent / spouse / sibling links. */
export function familyComponents(rels: Relation[]): string[][] {
  const adj = new Map<string, Set<string>>()
  const add = (a: string, b: string) => { (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b) }
  for (const r of rels) if (FAMILY.has(r.kind)) { add(r.sourceId, r.targetId); add(r.targetId, r.sourceId) }
  const seen = new Set<string>()
  const out: string[][] = []
  for (const start of adj.keys()) {
    if (seen.has(start)) continue
    const comp: string[] = []
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const cur = stack.pop()!
      comp.push(cur)
      for (const n of adj.get(cur) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n) }
    }
    out.push(comp)
  }
  return out.sort((a, b) => b.length - a.length)
}

/**
 * Layered family-tree layout. Generation = depth below the oldest ancestors; spouses and siblings share a generation.
 * Spouses sit side by side, and children are centred under their parents where space allows.
 */
export function layoutFamily(ids: string[], rels: Relation[], order: (id: string) => string = (x) => x): FamilyLayout {
  const set = new Set(ids)
  const fam = rels.filter((r) => FAMILY.has(r.kind) && set.has(r.sourceId) && set.has(r.targetId))
  const parents = new Map<string, string[]>()
  for (const r of fam) if (r.kind === 'parent') (parents.get(r.targetId) ?? parents.set(r.targetId, []).get(r.targetId)!).push(r.sourceId)

  const gen = new Map(ids.map((i) => [i, 0]))
  for (let pass = 0; pass <= ids.length + 1; pass++) {
    let changed = false
    for (const r of fam) {
      const a = gen.get(r.sourceId)!, b = gen.get(r.targetId)!
      if (r.kind === 'parent' && b < a + 1) { gen.set(r.targetId, a + 1); changed = true }
      else if (r.kind !== 'parent' && a !== b) { const m = Math.max(a, b); gen.set(r.sourceId, m); gen.set(r.targetId, m); changed = true }
    }
    if (!changed) break
  }

  // couples (people linked by spouse) become one unit that is laid out as a block
  const unitOf = new Map<string, string>()
  const find = (x: string): string => { let r = x; while (unitOf.get(r) && unitOf.get(r) !== r) r = unitOf.get(r)!; return r }
  for (const i of ids) unitOf.set(i, i)
  for (const r of fam) if (r.kind === 'spouse') unitOf.set(find(r.sourceId), find(r.targetId))
  const units = new Map<string, string[]>()
  for (const i of ids) { const u = find(i); (units.get(u) ?? units.set(u, []).get(u)!).push(i) }
  for (const m of units.values()) m.sort((a, b) => order(a).localeCompare(order(b)))

  const maxGen = Math.max(0, ...gen.values())
  const x = new Map<string, number>()
  const unitW = (u: string) => units.get(u)!.length * NODE_W + (units.get(u)!.length - 1) * 14
  const layers: string[][] = Array.from({ length: maxGen + 1 }, () => [])
  for (const u of units.keys()) layers[gen.get(units.get(u)![0])!].push(u)

  let cursor = 0
  layers.forEach((layer, g) => {
    const desired = (u: string): number => {
      const ps = units.get(u)!.flatMap((m) => parents.get(m) ?? []).filter((p) => x.has(p))
      return ps.length ? ps.reduce((s, p) => s + x.get(p)!, 0) / ps.length : Infinity
    }
    layer.sort((a, b) => {
      const da = desired(a), db = desired(b)
      if (da !== db) return da === Infinity ? 1 : db === Infinity ? -1 : da - db
      return order(units.get(a)![0]).localeCompare(order(units.get(b)![0]))
    })
    let left = -Infinity
    for (const u of layer) {
      const w = unitW(u)
      const d = desired(u)
      const want = d === Infinity ? (left === -Infinity ? 0 : left + GAP_X) : d - w / 2 + NODE_W / 2
      const start = Math.max(want, left === -Infinity ? want : left + GAP_X)
      units.get(u)!.forEach((m, k) => x.set(m, start + k * (NODE_W + 14)))
      left = start + w
    }
    cursor = Math.max(cursor, left)
    void g
  })

  const minX = Math.min(...x.values())
  const nodes = ids.map((id) => ({ id, x: x.get(id)! - minX, y: gen.get(id)! * (NODE_H + GAP_Y), gen: gen.get(id)! }))
  return { nodes, width: cursor - minX, height: (maxGen + 1) * NODE_H + maxGen * GAP_Y }
}
