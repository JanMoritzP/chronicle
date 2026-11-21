import { Pencil, Plus, Shuffle, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { confirmDialog } from '../lib/dialog'
import { sendTable, useTable, type Deck, type RollTable } from '../tabletop/state'

// Roll tables and card decks. A table is a list to roll on (a heavier entry comes up more often, [[2d6]] inside an entry is rolled);
// the GM keeps secret ones. A deck is dealt by the server: your hand is yours alone, a card played or drawn face up is shown to everyone.

export function TablesAndDecks() {
  return (
    <div className="tt-form">
      <RollTables />
      <Decks />
    </div>
  )
}

function RollTables() {
  const tables = useTable((s) => s.rolltables)
  const role = useTable((s) => s.role)
  const gm = role === 'gm'
  const [editing, setEditing] = useState<RollTable | 'new' | null>(null)
  const [name, setName] = useState('')
  const [entries, setEntries] = useState('')
  const [secret, setSecret] = useState(false)
  const edit = (t: RollTable | 'new') => { setEditing(t); setName(t === 'new' ? '' : t.name); setEntries(t === 'new' ? '' : t.entries ?? ''); setSecret(t === 'new' ? false : t.secret) }
  const save = () => {
    if (!name.trim()) return
    sendTable({ t: 'rolltable.save', ...(editing && editing !== 'new' ? { id: editing.id } : {}), name: name.trim(), entries, secret })
    setEditing(null)
  }
  return (
    <section aria-label="Roll tables">
      <b>Roll tables</b>
      <ul className="tt-people" aria-label="Tables">
        {tables.map((t) => (
          <li key={t.id}>
            <span className="grow">{t.name}{t.secret ? <small className="muted"> secret</small> : null}<small className="muted"> {t.size} {t.size === 1 ? 'entry' : 'entries'}</small></span>
            {role !== 'spectator' && <button className="btn sm" aria-label={`Roll on ${t.name}`} disabled={!t.size} onClick={() => sendTable({ t: 'rolltable.roll', id: t.id })}>Roll</button>}
            {gm && <button className="btn ghost sm" aria-label={`Edit ${t.name}`} onClick={() => edit(t)}><Pencil size={12} /></button>}
            {gm && <button className="btn ghost sm" aria-label={`Delete ${t.name}`} onClick={async () => { if (await confirmDialog(`Delete the table “${t.name}”?`, { title: 'Delete table', okLabel: 'Delete', danger: true })) sendTable({ t: 'rolltable.delete', id: t.id }) }}><Trash2 size={12} /></button>}
          </li>
        ))}
        {!tables.length && <li className="muted">{gm ? 'No tables yet.' : 'The GM has not made any tables.'}</li>}
      </ul>
      {gm && !editing && <button className="btn sm" onClick={() => edit('new')}><Plus size={12} /> New table</button>}
      {gm && editing && (
        <>
          <input className="input" aria-label="Table name" placeholder="Name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="input" aria-label="Table entries" rows={6} placeholder={'One entry per line.\n3: A line starting with a number is that many times as likely.\nA gem worth [[2d6]] gp'} value={entries} onChange={(e) => setEntries(e.target.value)} />
          <label className="tt-check"><input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />Secret: only the GM can roll it, and players do not see it</label>
          <div className="tt-row">
            <button className="btn sm primary" disabled={!name.trim()} onClick={save}>Save table</button>
            <button className="btn sm" onClick={() => setEditing(null)}>Cancel</button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>In chat, /table name rolls on it.</p>
        </>
      )}
    </section>
  )
}

function Decks() {
  const decks = useTable((s) => s.decks)
  const role = useTable((s) => s.role)
  const members = useTable((s) => s.members)
  const gm = role === 'gm'
  const [editing, setEditing] = useState<Deck | 'new' | null>(null)
  const [name, setName] = useState('')
  const [cards, setCards] = useState('')
  const names = new Map(members.map((m) => [m.id, m.username]))
  const edit = (d: Deck | 'new') => { setEditing(d); setName(d === 'new' ? '' : d.name); setCards(d === 'new' ? '' : d.cardsText ?? '') }
  const save = () => {
    if (!name.trim()) return
    sendTable({ t: 'deck.save', ...(editing && editing !== 'new' ? { id: editing.id } : {}), name: name.trim(), cards })
    setEditing(null)
  }
  return (
    <section aria-label="Card decks">
      <b>Card decks</b>
      {decks.map((d) => (
        <div key={d.id} className="tt-deck" role="group" aria-label={`Deck ${d.name}`}>
          <div className="tt-row">
            <span className="grow"><b>{d.name}</b> <small className="muted">{d.remaining} of {d.size} to draw, {d.discard.length} discarded</small></span>
            {gm && <button className="btn ghost sm" title="Put every card back and shuffle" aria-label={`Shuffle ${d.name}`} onClick={() => sendTable({ t: 'deck.shuffle', id: d.id })}><Shuffle size={12} /></button>}
            {gm && <button className="btn ghost sm" aria-label={`Edit ${d.name}`} onClick={() => edit(d)}><Pencil size={12} /></button>}
            {gm && <button className="btn ghost sm" aria-label={`Delete ${d.name}`} onClick={async () => { if (await confirmDialog(`Delete the deck “${d.name}”?`, { title: 'Delete deck', okLabel: 'Delete', danger: true })) sendTable({ t: 'deck.delete', id: d.id }) }}><Trash2 size={12} /></button>}
          </div>
          {role !== 'spectator' && (
            <div className="tt-row">
              <button className="btn sm" aria-label={`Draw a card from ${d.name} to your hand`} onClick={() => sendTable({ t: 'deck.draw', id: d.id, count: 1, to: 'hand' })}>Draw to hand</button>
              <button className="btn sm" aria-label={`Draw a card from ${d.name} face up`} onClick={() => sendTable({ t: 'deck.draw', id: d.id, count: 1, to: 'table' })}>Draw face up</button>
            </div>
          )}
          {d.hand.length > 0 && (
            <ul className="tt-people" aria-label={`Your hand from ${d.name}`}>
              {d.hand.map((c, i) => (
                <li key={`${c.id}-${i}`}>
                  <span className="grow"><b>{c.name}</b>{c.text ? <small className="muted"> {c.text}</small> : null}</span>
                  <button className="btn sm" aria-label={`Play ${c.name}`} onClick={() => sendTable({ t: 'deck.play', id: d.id, card: c.id })}>Play</button>
                </li>
              ))}
            </ul>
          )}
          {Object.keys(d.held).length > 0 && <small className="muted">Holding: {Object.entries(d.held).map(([u, n]) => `${names.get(u) ?? 'someone'} ${n}`).join(', ')}</small>}
          {d.discard.length > 0 && <small className="muted" aria-label={`Discard pile of ${d.name}`}>Discard pile, top first: {d.discard.slice(0, 5).map((c) => c.name).join(', ')}{d.discard.length > 5 ? '…' : ''}</small>}
        </div>
      ))}
      {!decks.length && <p className="muted tt-hint">{gm ? 'No decks yet.' : 'The GM has not made any decks.'}</p>}
      {gm && !editing && <button className="btn sm" onClick={() => edit('new')}><Plus size={12} /> New deck</button>}
      {gm && editing && (
        <>
          <input className="input" aria-label="Deck name" placeholder="Name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="input" aria-label="Deck cards" rows={6} placeholder={'One card per line: Name | what it says.\n3x Fireball | 8d6 fire damage'} value={cards} onChange={(e) => setCards(e.target.value)} />
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>Changing the cards deals the deck out again.</p>
          <div className="tt-row">
            <button className="btn sm primary" disabled={!name.trim()} onClick={save}>Save deck</button>
            <button className="btn sm" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </>
      )}
    </section>
  )
}
