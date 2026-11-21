import { sendTable, useTable } from '../tabletop/state'

// Someone walked away from a creature that could hit back: its owner (and the GM) is offered the opportunity attack, which uses the reaction.

export function ThreatBanner() {
  const threats = useTable((s) => s.threats)
  const drop = (i: number) => useTable.setState((s) => ({ threats: s.threats.filter((_, j) => j !== i) }))
  if (!threats.length) return null
  return (
    <div className="tt-ready" role="alert" aria-label="Opportunity attacks">
      {threats.map((t, i) => (
        <span key={`${t.from}-${t.target}-${i}`} className="tt-row">
          <b>{t.fromName}</b> can attack {t.targetName} as it leaves.
          <button className="btn sm primary" onClick={() => { sendTable({ t: 'reaction.attack', from: t.from, target: t.target }); drop(i) }}>Attack</button>
          <button className="btn sm" onClick={() => drop(i)}>Let it go</button>
        </span>
      ))}
    </div>
  )
}
