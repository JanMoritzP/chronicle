import { Sparkles, X } from 'lucide-react'
import { useMemo } from 'react'
import { useLibrary } from '../lib/library'
import { spellLimits } from '../lib/levelup'
import type { Sheet } from '../lib/sheet'
import { readSpells, removeSpell, slotFor, type BookSpell } from '../lib/spellbook'
import { Bubbles, Num } from './CharacterSheet'
import { EntryLink } from './SheetLinks'
import type { SheetPatch } from './SheetView'

// The spells of a character by level, each level with its slots: the cantrips, then level 1 with its slots and the level 1 spells, and so on.
// Casting a spell spends the lowest slot that fits; the names lead to the library. How many cantrips and spells the classes allow is
// shown beside them. The list itself stays the sheet's text (`sheet.spells`), so typing it by hand keeps working.

const ORDINAL = ['Cantrips', '1st level', '2nd level', '3rd level', '4th level', '5th level', '6th level', '7th level', '8th level', '9th level']

/** The level of each spell in the library, by lower case name: "Level 3 · Evocation" is 3, "Cantrip · …" is 0; also its school. */
function useSpellIndex() {
  const index = useLibrary((s) => s.index)
  return useMemo(() => {
    const map = new Map<string, { level: number; school: string }>()
    for (const [, category, name, , sub] of index?.rows ?? []) {
      if (category !== 'spell') continue
      const m = /^(?:Cantrip|Level (\d))\s*·?\s*(.*)$/.exec(sub)
      if (m && !map.has(name.toLowerCase())) map.set(name.toLowerCase(), { level: m[1] ? Number(m[1]) : 0, school: m[2].trim() })
    }
    return map
  }, [index])
}

export function Spellbook({ sheet, set, edit }: { sheet: Sheet; set?: (patch: SheetPatch) => void; edit: boolean }) {
  const lib = useSpellIndex()
  const look = (name: string) => lib.get(name.toLowerCase()) ?? lib.get(name.replace(/\s*\(.*\)$/, '').toLowerCase())
  const text = sheet.spells ?? ''
  const spells = useMemo(() => readSpells(text, (n) => look(n)?.level ?? null), [text, lib])
  const slots = sheet.spellcasting?.slots ?? []
  const limits = spellLimits(sheet)
  const cantripLimit = limits.reduce((n, l) => n + (l.cantrips ?? 0), 0)
  const highest = Math.max(0, ...slots.map((s, i) => (s.total > 0 ? i + 1 : 0)), ...spells.map((s) => s.level ?? 0))
  // the form always offers level 1, and a button for the level after the highest
  const levels = Array.from({ length: (edit ? Math.max(1, highest) : highest) + 1 }, (_, l) => l).filter((l) => l > 0 || cantripLimit > 0 || spells.some((s) => s.level === 0))
  const other = spells.filter((s) => s.level == null)
  const setSlots = (i: number, next: { total: number; used: number }) =>
    set?.({ 'spellcasting.slots': Array.from({ length: Math.max(slots.length, i + 1) }, (_, j) => (j === i ? next : slots[j] ?? { total: 0, used: 0 })) })
  const cast = (s: BookSpell) => {
    const i = slotFor(slots, s.level ?? 0)
    if (i >= 0) setSlots(i, { ...slots[i], used: slots[i].used + 1 })
  }
  const chip = (s: BookSpell) => {
    const info = look(s.name)
    const i = s.level ? slotFor(slots, s.level) : -1
    return (
      <li key={`${s.line}.${s.name}`} className="cs-spell">
        <EntryLink name={s.name} categories={['spell']} />
        {(info?.school || s.tag) && <small className="muted">{[info?.school, s.tag].filter(Boolean).join(' · ')}</small>}
        {set && !edit && !!s.level && (
          <button className="btn ghost sm" disabled={i < 0} title={i < 0 ? `No slot of level ${s.level} or higher is left` : `Cast it with a level ${i + 1} slot`} aria-label={`Cast ${s.name}`} onClick={() => cast(s)}>
            <Sparkles size={11} /> Cast{i >= 0 && i + 1 > (s.level ?? 0) ? ` (level ${i + 1})` : ''}
          </button>
        )}
        {edit && set && <button className="icon-btn" aria-label={`Remove ${s.name}`} title="Remove" onClick={() => set({ spells: removeSpell(text, s.line, s.name) })}><X size={11} /></button>}
      </li>
    )
  }
  return (
    <div className="cs-book" aria-label="Spellbook">
      {limits.length > 0 && (
        <p className="muted cs-book-limits">
          {limits.map((l) => `${l.from}: ${[l.cantrips && `${l.cantrips} cantrips`, l.known && `${l.known} spells known`, l.prepared && `prepares ${l.prepared} spells a day`].filter(Boolean).join(', ')}`).join('. ')}.
        </p>
      )}
      {levels.map((l) => {
        const list = spells.filter((s) => s.level === l)
        const sl = slots[l - 1] ?? { total: 0, used: 0 }
        return (
          <div key={l} className="cs-book-level" aria-label={ORDINAL[l]}>
            <div className="cs-book-head">
              <b>{ORDINAL[l]}</b>
              {l === 0 ? (cantripLimit > 0 && <small className={`muted${list.length > cantripLimit ? ' cs-warn' : ''}`}>{list.length} of {cantripLimit}</small>) : (
                <span className="cs-book-slots">
                  {sl.total > 0 && <Bubbles label={`Level ${l} slots used`} total={sl.total} used={sl.used} onChange={(n) => setSlots(l - 1, { ...sl, used: n })} />}
                  {edit ? <Num label={`Level ${l} slots`} value={sl.total} max={20} width={44} onChange={(n) => setSlots(l - 1, { total: n, used: Math.min(sl.used, n) })} />
                    : <small className="muted">{sl.total ? `${sl.total - sl.used} of ${sl.total} slots left` : 'no slots'}</small>}
                </span>
              )}
            </div>
            {list.length > 0 ? <ul className="cs-spell-list">{list.map(chip)}</ul> : <small className="muted">{l === 0 ? 'No cantrips yet.' : 'No spells of this level yet.'}</small>}
          </div>
        )
      })}
      {edit && set && Math.max(1, highest) < 9 && <button className="btn ghost sm" onClick={() => setSlots(Math.max(1, highest), { total: 1, used: 0 })}>Slots of level {Math.max(1, highest) + 1}</button>}
      {other.length > 0 && (
        <div className="cs-book-level" aria-label="Other spells">
          <div className="cs-book-head"><b>Level not known</b><small className="muted">Write them after “Level 2:” or similar, or pick them from the library.</small></div>
          <ul className="cs-spell-list">{other.map(chip)}</ul>
        </div>
      )}
    </div>
  )
}
