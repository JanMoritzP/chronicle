import { Minus, Plus, Swords, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { alertDialog, askText, confirmDialog } from '../lib/dialog'
import { crText } from '../lib/sheet'
import { useStore } from '../store'
import { pf2eCreatureXp, rate, xpOfCr } from '../tabletop/encounter'
import { sendTable, useTable } from '../tabletop/state'
import type { Encounter } from '../types'
import { PagePicker } from './PagePicker'
import { loadSheet } from './TableSheet'

interface Info { title: string; cr: number | null; xp: number; hasSheet: boolean; /** Pathfinder 2e creature level */ level: number | null }

/** Challenge rating and XP of the creatures on the pages, read once per page. */
function useInfo(ids: string[]) {
  const pages = useStore((s) => s.data.pages)
  const [info, setInfo] = useState<Record<string, Info>>({})
  const key = ids.join(',')
  useEffect(() => {
    let live = true
    for (const id of ids) {
      loadSheet(id).then((r) => {
        if (!live) return
        const cr = r.sheet?.cr ?? null
        setInfo((m) => ({ ...m, [id]: { title: pages.find((p) => p.id === id)?.title ?? r.sheet?.name ?? 'Unknown page', cr, xp: r.sheet?.xp ?? xpOfCr(cr), hasSheet: !!r.sheet, level: r.sheet?.pf2e?.level ?? null } }))
      })
    }
    return () => { live = false }
  }, [key, pages])
  return info
}

const LABEL = { trivial: 'Trivial', easy: 'Easy', medium: 'Medium', hard: 'Hard', deadly: 'Deadly', low: 'Low', moderate: 'Moderate', high: 'High', over: 'Beyond High: more than the party should face', severe: 'Severe', extreme: 'Extreme' } as const

export function EncounterPanel() {
  const wsId = useStore((s) => s.wsId)!
  const system = useStore((s) => s.workspaces.find((w) => w.id === s.wsId)?.settings?.system ?? '5e')
  const sceneId = useTable((s) => s.sceneId)
  const scene = useTable((s) => s.scenes.find((x) => x.id === s.sceneId) ?? null)
  const [list, setList] = useState<Encounter[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [hidden, setHidden] = useState(true)
  const [adding, setAdding] = useState(false)
  useEffect(() => { api.listEncounters(wsId).then(setList).catch((e) => alertDialog(e.message)) }, [wsId])
  const enc = list?.find((e) => e.id === openId) ?? null
  const info = useInfo(enc?.monsters.map((m) => m.pageId) ?? [])
  const save = (next: Encounter) => {
    setList((l) => l?.map((e) => (e.id === next.id ? next : e)) ?? l)
    api.patchEncounter(next.id, { name: next.name, party: next.party, notes: next.notes, monsters: next.monsters }).catch((e) => alertDialog(e.message))
  }
  const rated = useMemo(() => enc ? rate(enc.monsters.map((m) => ({ xp: info[m.pageId]?.xp ?? 0, count: m.count, level: info[m.pageId]?.level ?? undefined })), enc.party, system) : null, [enc, info, system])

  const create = async () => {
    const name = await askText('New encounter', { label: 'Name', placeholder: 'Goblin ambush on the road', okLabel: 'Create' })
    if (!name?.trim()) return
    try {
      const e = await api.createEncounter(wsId, { name: name.trim(), party: [], notes: '', monsters: [] })
      setList((l) => [...(l ?? []), e])
      setOpenId(e.id)
    } catch (e: any) { alertDialog(e.message) }
  }
  const stage = (combat: boolean) => {
    if (!enc || !sceneId || !scene) return
    sendTable({ t: 'encounter.stage', id: enc.id, sceneId, x: scene.width / 2 - scene.gridSize * 2.5, y: scene.height / 2 - scene.gridSize, hidden, combat })
  }

  if (!list) return <p className="muted tt-hint">Loading…</p>
  return (
    <div className="tt-form">
      <b><Swords size={13} /> Encounters</b>
      <div className="tt-row"><button className="btn sm" onClick={create}><Plus size={13} /> New encounter</button></div>
      <ul className="tt-tokens" aria-label="Encounters">
        {list.map((e) => <li key={e.id}><button className={`btn ghost sm${e.id === openId ? ' on' : ''}`} onClick={() => setOpenId(e.id === openId ? null : e.id)}>{e.name}</button></li>)}
        {list.length === 0 && <li className="muted tt-hint">Plan a fight: add creatures from your world's pages, tell Chronicle who is in the party, and see how hard it is.</li>}
      </ul>
      {enc && rated && (
        <>
          <label>Name<input className="input" defaultValue={enc.name} key={enc.id + enc.name} onBlur={(e) => e.target.value.trim() && e.target.value !== enc.name && save({ ...enc, name: e.target.value.trim() })} /></label>
          <label>Party levels, one per character
            <input className="input" placeholder="3, 3, 4, 4" aria-label="Party levels" defaultValue={enc.party.join(', ')} key={enc.id + enc.party.join()}
              onBlur={(e) => { const lv = e.target.value.split(/[ ,]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 20).slice(0, 12); if (lv.join() !== enc.party.join()) save({ ...enc, party: lv }) }} />
          </label>
          <div className="tt-enc-monsters">
            {enc.monsters.map((m, i) => {
              const inf = info[m.pageId]
              return (
                <div key={m.pageId} className="tt-enc-row">
                  <span className="grow ellipsis">{inf?.title ?? '…'}<small className="muted"> {inf?.hasSheet === false ? 'no stat block' : system === 'pf2e' ? (inf?.level != null ? `Level ${inf.level}${rated.method === 'pf2e' ? ` · ${pf2eCreatureXp(inf.level, rated.partyLevel)} XP` : ''}` : 'no Pathfinder sheet') : inf?.cr != null ? `CR ${crText(inf.cr)} · ${inf.xp} XP` : ''}</small></span>
                  <button className="btn ghost sm" aria-label={`One fewer ${inf?.title ?? 'creature'}`} onClick={() => save({ ...enc, monsters: enc.monsters.map((x, j) => (j === i ? { ...x, count: Math.max(1, x.count - 1) } : x)) })}><Minus size={12} /></button>
                  <span className="tt-count" aria-label="Number of creatures">{m.count}</span>
                  <button className="btn ghost sm" aria-label={`One more ${inf?.title ?? 'creature'}`} onClick={() => save({ ...enc, monsters: enc.monsters.map((x, j) => (j === i ? { ...x, count: Math.min(50, x.count + 1) } : x)) })}><Plus size={12} /></button>
                  <button className="btn ghost sm" aria-label={`Remove ${inf?.title ?? 'creature'}`} onClick={() => save({ ...enc, monsters: enc.monsters.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>
                </div>
              )
            })}
          </div>
          {adding
            ? <PagePicker autoFocus placeholder="Find a monster page…" onPick={(p) => { setAdding(false); if (!enc.monsters.some((m) => m.pageId === p.id)) save({ ...enc, monsters: [...enc.monsters, { pageId: p.id, count: 1 }] }) }} />
            : <button className="btn sm" onClick={() => setAdding(true)}><Plus size={13} /> Add a creature</button>}
          <p className="muted tt-hint">Missing a creature? Add it to the world from the Library first (Alt+L).</p>
          <div className={`tt-meter ${rated.difficulty}`} role="group" aria-label="Difficulty">
            <b>{enc.party.length ? LABEL[rated.difficulty] : 'Add the party to rate it'} <small className="muted">{system === 'pf2e' ? 'Pathfinder 2e' : system === '5e-2024' ? '2024 rules' : '2014 rules'}</small></b>
            {rated.method === 'pf2e'
              ? <span>{rated.total} XP of creatures against party level {rated.partyLevel}</span>
              : rated.method === '5e-2024'
              ? <span>{rated.total} XP of creatures</span>
              : <span>{rated.total} XP × {rated.count ? (rated.adjusted / (rated.total || 1)).toFixed(1).replace(/\.0$/, '') : 0} = {rated.adjusted} adjusted XP</span>}
            {enc.party.length > 0 && (rated.method === 'pf2e'
              ? <small className="muted">Trivial {rated.pf2eBudget.trivial} · Low {rated.pf2eBudget.low} · Moderate {rated.pf2eBudget.moderate} · Severe {rated.pf2eBudget.severe} · Extreme {rated.pf2eBudget.extreme}</small>
              : rated.budget
              ? <small className="muted">Budget: Low {rated.budget.low} · Moderate {rated.budget.moderate} · High {rated.budget.high}</small>
              : <small className="muted">Easy {rated.thresholds.easy} · Medium {rated.thresholds.medium} · Hard {rated.thresholds.hard} · Deadly {rated.thresholds.deadly}</small>)}
            {rated.total > 0 && enc.party.length > 0 && rated.method !== 'pf2e' && <small className="muted">{rated.perCharacter} XP for each character</small>}
          </div>
          <label className="tt-check"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />Place them hidden from the players</label>
          <div className="tt-row">
            <button className="btn sm primary" disabled={!scene || !enc.monsters.length} onClick={() => stage(false)}>Place on this scene</button>
            <button className="btn sm" disabled={!scene || !enc.monsters.length} title="Place them, add them to the order of play and roll their initiative" onClick={() => stage(true)}>Place and roll initiative</button>
          </div>
          <button className="btn sm danger" onClick={async () => { if (await confirmDialog(`“${enc.name}” is deleted. Tokens already placed stay.`, { title: 'Delete encounter', okLabel: 'Delete', danger: true })) { await api.deleteEncounter(enc.id).catch((e) => alertDialog(e.message)); setList((l) => l?.filter((x) => x.id !== enc.id) ?? l); setOpenId(null) } }}><Trash2 size={13} /> Delete encounter</button>
        </>
      )}
    </div>
  )
}
