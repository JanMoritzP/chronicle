import { sendTable, useTable } from '../tabletop/state'

// A ready check: the GM asks, each player answers with one click, everyone sees who is ready. The GM ends it.

export function ReadyBanner() {
  const ready = useTable((s) => s.ready)
  const role = useTable((s) => s.role)
  const you = useTable((s) => s.you)
  const online = useTable((s) => s.online)
  if (!ready) return null
  const gm = role === 'gm'
  const people = online.filter((o) => o.role === 'player')
  const mine = you ? ready.answers[you.id] : undefined
  return (
    <div className="tt-ready" role="status" aria-label="Ready check">
      <b>Ready check</b>
      <span className="grow">
        {people.map((o) => <span key={o.id} className={`tt-ready-one ${ready.answers[o.id] === true ? 'yes' : ready.answers[o.id] === false ? 'no' : ''}`}>{o.username}: {ready.answers[o.id] === true ? 'ready' : ready.answers[o.id] === false ? 'not yet' : '…'}</span>)}
      </span>
      {role === 'player' && (
        <>
          <button className={`btn sm${mine === true ? ' primary' : ''}`} onClick={() => sendTable({ t: 'ready.answer', yes: true })}>I am ready</button>
          <button className={`btn sm${mine === false ? ' primary' : ''}`} onClick={() => sendTable({ t: 'ready.answer', yes: false })}>Not yet</button>
        </>
      )}
      {gm && <button className="btn sm" onClick={() => sendTable({ t: 'ready.end' })}>End the check</button>}
    </div>
  )
}
