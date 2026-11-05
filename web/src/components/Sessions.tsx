import { BookOpen, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { formatRange } from '../lib/calendar'
import { useWorld } from '../lib/world'
import { confirmDialog } from '../lib/dialog'
import { useStore } from '../store'
import type { GameSession, PageMeta, StatsResult } from '../types'
import { DateField } from './DateField'
import { PagePicker } from './PagePicker'

const pad = (n: number) => String(n).padStart(2, '0')
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d) }
const niceDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const num = (n: number) => n.toLocaleString()

function useWorldFor(wsId: string) {
  const loaded = useWorld((s) => s.wsId)
  useEffect(() => { if (loaded !== wsId) useWorld.getState().load(wsId).catch(() => {}) }, [wsId, loaded])
  return loaded === wsId
}

type PageChoice = { mode: 'none' } | { mode: 'create' } | { mode: 'link'; page: PageMeta }

interface Draft {
  id: string | null
  title: string
  playedOn: string
  inWorld: boolean
  tStart: number
  tEnd: number
  page: PageChoice
}

function SessionForm({ draft, onChange, onCancel, onSave, busy, error }: {
  draft: Draft; onChange: (d: Draft) => void; onCancel: () => void; onSave: () => void; busy: boolean; error: string
}) {
  const cal = useWorld((s) => s.calendar)
  const set = (p: Partial<Draft>) => onChange({ ...draft, ...p })
  return (
    <div className="session-form">
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field grow" style={{ minWidth: 200 }}><span>Title</span>
          <input className="input" autoFocus placeholder="e.g. The Heist" value={draft.title} onChange={(e) => set({ title: e.target.value })} /></label>
        <label className="field"><span>Played on</span>
          <input className="input" type="date" value={draft.playedOn} onChange={(e) => e.target.value && set({ playedOn: e.target.value })} /></label>
      </div>
      <label className="row"><input type="checkbox" checked={draft.inWorld} onChange={(e) => set({ inWorld: e.target.checked })} /> Record the in-world dates this session covered</label>
      {draft.inWorld && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
          <div><div className="muted" style={{ fontSize: 12 }}>From</div>
            <DateField cal={cal} value={draft.tStart} onChange={(t) => set({ tStart: t, tEnd: Math.max(draft.tEnd, t) })} /></div>
          <div><div className="muted" style={{ fontSize: 12 }}>To</div>
            <DateField cal={cal} value={draft.tEnd} onChange={(t) => set({ tEnd: t })} /></div>
        </div>
      )}
      {!draft.id && (
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Write-up page</div>
          <div className="seg">
            <button className={draft.page.mode === 'create' ? 'on' : ''} onClick={() => set({ page: { mode: 'create' } })}>Create one</button>
            <button className={draft.page.mode === 'link' ? 'on' : ''} onClick={() => set({ page: draft.page.mode === 'link' ? draft.page : { mode: 'none' } })}>Use an existing page</button>
            <button className={draft.page.mode === 'none' ? 'on' : ''} onClick={() => set({ page: { mode: 'none' } })}>None</button>
          </div>
        </div>
      )}
      {draft.page.mode === 'create' && !draft.id && <div className="muted" style={{ fontSize: 13 }}>Creates “Session N: title” in a Sessions folder with Recap, Decisions and consequences, Loose ends and Next session.</div>}
      {draft.page.mode !== 'create' && !draft.id && draft.page.mode !== 'none' && (
        draft.page.page
          ? <div className="row"><FileText size={14} /> <b>{draft.page.page.title || 'Untitled'}</b> <button className="btn sm" onClick={() => set({ page: { mode: 'none' } })}>Change</button></div>
          : null
      )}
      {draft.page.mode === 'none' && !draft.id && (
        <div className="muted" style={{ fontSize: 12 }}>Or find a page to attach:</div>
      )}
      {draft.page.mode === 'none' && !draft.id && <PagePicker placeholder="Find a page…" onPick={(page) => set({ page: { mode: 'link', page } })} />}
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={onSave}>{draft.id ? 'Save' : 'Add session'}</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function Chart({ stats, from, to }: { stats: StatsResult; from: string | null; to: string | null }) {
  const days = useMemo(() => {
    if (!stats.daily.length) return []
    const start = from ?? stats.daily[0].day
    const end = to ?? stats.daily[stats.daily.length - 1].day
    const by = new Map(stats.daily.map((d) => [d.day, d]))
    const out: { day: string; words: number; pages: number }[] = []
    for (let d = start, i = 0; d <= end && i < 400; d = addDays(d, 1), i++) out.push(by.get(d) ?? { day: d, words: 0, pages: 0 })
    return out.length ? out : stats.daily
  }, [stats, from, to])
  if (!days.length) return <div className="muted">Nothing written in this range.</div>
  const max = Math.max(1, ...days.map((d) => d.words))
  const W = 640, H = 120, gap = days.length > 90 ? 0 : 2
  const bw = Math.max(1, W / days.length - gap)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="stat-chart" role="img" aria-label="Words written per day">
        {days.map((d, i) => {
          const h = Math.round((d.words / max) * H)
          return (
            <g key={d.day}>
              <rect x={i * (bw + gap)} y={H - h} width={bw} height={Math.max(h, d.words ? 1 : 0)} rx={1} className="stat-bar"><title>{`${niceDate(d.day)}: ${num(d.words)} words, ${d.pages} new ${d.pages === 1 ? 'page' : 'pages'}`}</title></rect>
              {d.pages > 0 && <circle cx={i * (bw + gap) + bw / 2} cy={H + 8} r={2.5} className="stat-dot" />}
            </g>
          )
        })}
      </svg>
      <div className="row muted" style={{ fontSize: 12, justifyContent: 'space-between' }}>
        <span>{niceDate(days[0].day)}</span><span>bars: words written · dots: days with new pages</span><span>{niceDate(days[days.length - 1].day)}</span>
      </div>
    </div>
  )
}

type Range = 'all' | '30' | 'custom'

function StatsPanel({ wsId, sessions }: { wsId: string; sessions: GameSession[] }) {
  const [range, setRange] = useState<Range>('30')
  const [cFrom, setCFrom] = useState(() => addDays(isoDay(new Date()), -7))
  const [cTo, setCTo] = useState(() => isoDay(new Date()))
  const [stats, setStats] = useState<StatsResult | null>(null)
  const [err, setErr] = useState('')
  const navigate = useStore((s) => s.navigate)
  const today = isoDay(new Date())
  const from = range === 'all' ? null : range === '30' ? addDays(today, -29) : cFrom
  const to = range === 'all' ? null : range === '30' ? today : cTo
  useEffect(() => {
    let alive = true
    setErr('')
    if (from && to && from > to) { setErr('The start is after the end.'); return }
    api.stats(wsId, from ?? undefined, to ?? undefined).then((s) => alive && setStats(s)).catch((e) => alive && setErr(e.message))
    return () => { alive = false }
  }, [wsId, from, to, sessions])
  return (
    <section className="stat-panel">
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        <h2 className="grow" style={{ margin: 0, flex: '1 0 auto' }}>Statistics</h2>
        <div className="seg">
          <button className={range === '30' ? 'on' : ''} onClick={() => setRange('30')}>Last 30 days</button>
          <button className={range === 'all' ? 'on' : ''} onClick={() => setRange('all')}>All time</button>
          <button className={range === 'custom' ? 'on' : ''} onClick={() => setRange('custom')}>Custom</button>
        </div>
      </div>
      {range === 'custom' && (
        <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
          <label className="row">From <input className="input" type="date" value={cFrom} onChange={(e) => e.target.value && setCFrom(e.target.value)} /></label>
          <label className="row">to <input className="input" type="date" value={cTo} onChange={(e) => e.target.value && setCTo(e.target.value)} /></label>
        </div>
      )}
      {err && <div className="error">{err}</div>}
      {stats && !err && (
        <>
          <div className="stat-cards">
            <div><b>{num(stats.totals.pagesCreated)}</b><span>pages created</span></div>
            <div><b>{num(stats.totals.wordsWritten)}</b><span>words written</span></div>
            <div><b>{num(stats.totals.pagesTouched)}</b><span>pages touched</span></div>
            <div><b>{num(stats.world.pages)}</b><span>pages in this world ({num(stats.world.words)} words)</span></div>
          </div>
          <Chart stats={stats} from={from} to={to} />
          {stats.top.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Most written pages</div>
              {stats.top.map((t) => (
                <div key={t.pageId} className="row stat-top" onClick={() => navigate({ type: 'page', id: t.pageId })}>
                  <span className="grow ellipsis">{t.title || 'Untitled'}</span><span className="muted">{num(t.words)} words</span>
                </div>
              ))}
            </div>
          )}
          <small className="muted">“Words written” counts what you add, not what you delete, so tidying up never lowers it.</small>
        </>
      )}
    </section>
  )
}

export function SessionsView() {
  const wsId = useStore((s) => s.wsId)!
  const readOnly = useStore((s) => s.user?.role === 'viewer')
  const navigate = useStore((s) => s.navigate)
  const pages = useStore((s) => s.data.pages)
  const ready = useWorldFor(wsId)
  const cal = useWorld((s) => s.calendar)
  const [sessions, setSessions] = useState<GameSession[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const reload = () => api.sessions(wsId).then(setSessions).catch((e) => setErr(e.message))
  useEffect(() => { setSessions(null); reload() }, [wsId])

  const blank = (): Draft => {
    const last = sessions?.[0]
    const t = last?.tEnd ?? last?.tStart ?? 0
    return { id: null, title: '', playedOn: isoDay(new Date()), inWorld: false, tStart: t, tEnd: t, page: { mode: 'create' } }
  }
  const edit = (s: GameSession): Draft => ({
    id: s.id, title: s.title, playedOn: s.playedOn, inWorld: s.tStart != null,
    tStart: s.tStart ?? 0, tEnd: s.tEnd ?? s.tStart ?? 0, page: { mode: 'none' },
  })

  const save = async () => {
    if (!draft) return
    setBusy(true); setErr('')
    try {
      const body: any = { title: draft.title.trim(), playedOn: draft.playedOn, tStart: draft.inWorld ? draft.tStart : null, tEnd: draft.inWorld ? draft.tEnd : null }
      if (draft.id) await api.patchSession(draft.id, body)
      else {
        if (draft.page.mode === 'create') body.createPage = true
        if (draft.page.mode === 'link') body.pageId = draft.page.page.id
        const made = await api.createSession(wsId, body)
        if (made.pageId) await useStore.getState().refresh()
      }
      setDraft(null)
      await reload()
    } catch (e: any) { setErr(e.message) }
    setBusy(false)
  }

  if (!ready || !sessions) return <div className="view muted">Loading…</div>
  const pageExists = (id: string | null) => !!id && pages.some((p) => p.id === id)

  return (
    <div className="view sessions-view">
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>Sessions</h1>
        {!readOnly && !draft && <button className="btn primary" onClick={() => { setErr(''); setDraft(blank()) }}><Plus size={14} /> New session</button>}
      </div>
      {draft && !draft.id && <SessionForm draft={draft} onChange={setDraft} onCancel={() => setDraft(null)} onSave={save} busy={busy} error={err} />}
      {err && !draft && <div className="error">{err}</div>}

      <StatsPanel wsId={wsId} sessions={sessions} />

      <h2>Journal</h2>
      {!sessions.length && <div className="muted">No sessions yet. Add one after your next game and the journal and statistics start filling in.</div>}
      <div className="session-list">
        {sessions.map((s) => draft?.id === s.id ? (
          <SessionForm key={s.id} draft={draft} onChange={setDraft} onCancel={() => setDraft(null)} onSave={save} busy={busy} error={err} />
        ) : (
          <div key={s.id} className="session-card">
            <div className="row" style={{ alignItems: 'baseline' }}>
              <span className="session-no">#{s.number}</span>
              <b className="grow">{s.title || 'Untitled session'}</b>
              {!readOnly && <>
                <button className="icon-btn" title="Edit" onClick={() => { setErr(''); setDraft(edit(s)) }}><Pencil size={14} /></button>
                <button className="icon-btn" title="Delete session (its page stays)" onClick={async () => { if (await confirmDialog('Its page, if any, is kept.', { title: `Delete session #${s.number}?`, okLabel: 'Delete', danger: true })) { await api.deleteSession(s.id); reload() } }}><Trash2 size={14} /></button>
              </>}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              Played {niceDate(s.playedOn)}
              {s.tStart != null && <> · in the world: {formatRange(cal, s.tStart, s.tEnd)}</>}
            </div>
            <div className="session-stats">
              <span><b>{num(s.stats.pagesCreated)}</b> pages created</span>
              <span><b>{num(s.stats.wordsWritten)}</b> words written</span>
              <span><b>{num(s.stats.pagesTouched)}</b> pages touched</span>
            </div>
            {s.pageId && pageExists(s.pageId)
              ? <button className="btn sm" onClick={() => navigate({ type: 'page', id: s.pageId! })}><BookOpen size={13} /> {s.pageTitle || 'Open write-up'}</button>
              : <span className="muted" style={{ fontSize: 12 }}>No write-up page</span>}
          </div>
        ))}
      </div>
      {sessions.length > 0 && <small className="muted">A session counts everything from its own date until the next session starts: the game, the write-up and the prep for next time.</small>}
    </div>
  )
}
