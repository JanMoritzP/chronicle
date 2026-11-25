import { Gamepad2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { worldPeople } from '../lib/people'
import { useStore } from '../store'
import type { Person } from '../types'
import { Select } from './Select'

// Who plays a character. The people named here may change this page's text and sheet even when they only read the world,
// and at the table they move every token linked to it.

export function PlayedBy({ players, readOnly, onChange }: { players: string[]; readOnly: boolean; onChange: (next: string[]) => void }) {
  const wsId = useStore((s) => s.wsId)
  const [people, setPeople] = useState<Person[]>([])
  useEffect(() => { if (wsId) void worldPeople(wsId).then(setPeople) }, [wsId])
  const nameOf = (id: string) => people.find((p) => p.id === id)?.username ?? 'Someone'
  const candidates = people.filter((p) => p.role !== 'owner' && !players.includes(p.id))
  if (readOnly && !players.length) return null
  return (
    <span className="played-by" title="The people who play this character: they may change its text and sheet, and move its tokens at the table">
      <Gamepad2 size={14} aria-hidden />
      {players.length ? null : <span className="muted">Nobody plays this yet</span>}
      {players.map((id) => (
        <span key={id} className="chip">
          {nameOf(id)}
          {!readOnly && <button aria-label={`${nameOf(id)} no longer plays this`} onClick={() => onChange(players.filter((p) => p !== id))}><X size={11} /></button>}
        </span>
      ))}
      {!readOnly && candidates.length > 0 && (
        <Select className="played-by-add" value="" placeholder={players.length ? 'Add a player' : 'Choose who plays it'} title="Who plays this character" onChange={(id) => id && onChange([...players, id])}>
          {candidates.map((p) => <option key={p.id} value={p.id}>{p.username}{p.role === 'viewer' ? ' (reads the world)' : ''}</option>)}
        </Select>
      )}
      {!readOnly && !candidates.length && !players.length && <span className="muted">Invite players to the world first</span>}
    </span>
  )
}
