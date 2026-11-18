// Linked fields of stat blocks. A stat block keeps plain strings, so a linked field stores its shown text under
// its own key ("Wizard, Sorcerer") and the links as JSON under "<key>:refs". Text-only consumers (search, export,
// old clients) keep working, and the links can be indexed, moved and copied here.
export interface Ref { name: string; libKey?: string; pageId?: string }

const SUFFIX = ':refs'

export function parseRefs(v: unknown): Ref[] {
  if (typeof v !== 'string' || !v.startsWith('[')) return []
  try {
    const list = JSON.parse(v)
    if (!Array.isArray(list)) return []
    return list.filter((r): r is Ref => !!r && typeof r === 'object' && typeof r.name === 'string')
  } catch { return [] }
}

/** Entries that carry a link (a library entry or a page); plain-text entries are left out. */
export function linkedRefs(refs: Ref[]): Ref[] {
  return refs.filter((r) => typeof r.libKey === 'string' || typeof r.pageId === 'string')
}

export function dataRefs(data: unknown): Ref[] {
  if (!data || typeof data !== 'object') return []
  return Object.entries(data as Record<string, unknown>).filter(([k]) => k.endsWith(SUFFIX)).flatMap(([, v]) => linkedRefs(parseRefs(v)))
}

/**
 * Lets `fn` replace entries of every linked field in a stat block's data (mutates it). Return null to keep an entry as it is.
 * The shown text of a changed field is rewritten from its entries. Returns how many fields changed.
 */
export function rewriteDataRefs(data: unknown, fn: (r: Ref) => Ref | null): number {
  if (!data || typeof data !== 'object') return 0
  const d = data as Record<string, unknown>
  let changed = 0
  for (const k of Object.keys(d)) {
    if (!k.endsWith(SUFFIX)) continue
    const refs = parseRefs(d[k])
    let hit = false
    const next = refs.map((r) => { const n = fn(r); if (n) hit = true; return n ?? r })
    if (!hit) continue
    d[k] = JSON.stringify(next)
    d[k.slice(0, -SUFFIX.length)] = next.map((r) => r.name).join(', ')
    changed++
  }
  return changed
}

/** Every stat block data map found in a page's props (special page slots: { template, data }). */
export function propsStatData(props: any): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const v of Object.values(props?.data ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && (v as any).data && typeof (v as any).data === 'object') out.push((v as any).data)
  }
  return out
}
