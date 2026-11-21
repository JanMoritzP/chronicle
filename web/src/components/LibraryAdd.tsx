import { useEffect, useMemo, useState } from 'react'
import { fetchLibraryEntry, searchLibrary, useLibrary } from '../lib/library'
import type { LibraryCategory, LibraryEntry } from '../types'

// A search box on a character sheet that adds something from the library (a spell, a weapon, a magic item) to the sheet without leaving it.

export function LibraryAdd({ label, categories, onPick }: { label: string; categories: LibraryCategory[]; onPick: (entry: LibraryEntry) => void }) {
  const index = useLibrary((s) => s.index)
  const loaded = useLibrary((s) => s.loaded)
  const load = useLibrary((s) => s.load)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!loaded) void load() }, [loaded, load])
  const hits = useMemo(() => (q.trim().length < 2 ? [] : categories.flatMap((c) => searchLibrary(index, q, c, 6)).sort((a, b) => b.score - a.score).slice(0, 8)), [index, q, categories])
  const pick = async (key: string) => {
    setBusy(true)
    try { onPick(await fetchLibraryEntry(key)); setQ('') } catch { /* the entry could not be fetched: nothing is added */ } finally { setBusy(false) }
  }
  if (loaded && !index) return null
  return (
    <div className="cs-libadd">
      <input className="sv-text" aria-label={label} placeholder={label} value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <ul className="cs-libadd-hits" aria-label={`Results for ${label}`}>
          {hits.map((h) => <li key={h.row[0]}><button className="btn ghost sm" disabled={busy} onClick={() => void pick(h.row[0])}>{h.row[2]}</button></li>)}
        </ul>
      )}
    </div>
  )
}
