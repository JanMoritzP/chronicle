import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force'
import { Maximize2, Trash2, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { familyComponents, layoutFamily, NODE_H, NODE_W } from '../lib/family'
import { useWorld } from '../lib/world'
import { useStore } from '../store'
import type { PageMeta, Relation } from '../types'
import { PagePicker } from './PagePicker'
import { Select } from './Select'

function useWorldFor(wsId: string) {
  const loaded = useWorld((s) => s.wsId)
  useEffect(() => { if (loaded !== wsId) useWorld.getState().load(wsId).catch(() => {}) }, [wsId, loaded])
  return loaded === wsId
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

type Choice = 'parent-of' | 'child-of' | 'spouse' | 'sibling' | 'other'
const CHOICES: { id: Choice; label: string }[] = [
  { id: 'parent-of', label: 'is a parent of' },
  { id: 'child-of', label: 'is a child of' },
  { id: 'spouse', label: 'is married to' },
  { id: 'sibling', label: 'is a sibling of' },
  { id: 'other', label: 'custom…' },
]

/** /relation: connect this page to another one (family or any custom relationship). */
export function RelationDialog({ pageId, pageTitle, onClose, onSaved }: { pageId: string; pageTitle: string; onClose: () => void; onSaved: () => void }) {
  const wsId = useStore((s) => s.wsId)!
  const ready = useWorldFor(wsId)
  const [other, setOther] = useState<PageMeta | null>(null)
  const [choice, setChoice] = useState<Choice>('parent-of')
  const [label, setLabel] = useState('')
  const [err, setErr] = useState('')
  if (!ready) return null
  const save = async () => {
    if (!other) return setErr('Pick the other page first')
    if (choice === 'other' && !label.trim()) return setErr('Describe the relationship, e.g. "rival of"')
    const mine = pageId, theirs = other.id
    const body =
      choice === 'child-of' ? { sourceId: theirs, targetId: mine, kind: 'parent' }
      : choice === 'parent-of' ? { sourceId: mine, targetId: theirs, kind: 'parent' }
      : { sourceId: mine, targetId: theirs, kind: choice, label: label.trim() }
    try {
      await api.createRelation(wsId, body)
      await useWorld.getState().reloadRelations()
      onSaved()
      onClose()
    } catch (e: any) { setErr(e.message) }
  }
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" style={{ padding: 16, gap: 12, maxHeight: 'none' }} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <b>Relate “{pageTitle || 'Untitled'}” to…</b>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {CHOICES.map((c) => (
            <button key={c.id} className={`btn ${choice === c.id ? 'primary' : ''}`} onClick={() => setChoice(c.id)}>{c.label}</button>
          ))}
        </div>
        {choice === 'other' && <input className="input" value={label} maxLength={80} placeholder="e.g. rival of, sworn to, employs" onChange={(e) => setLabel(e.target.value)} />}
        {other
          ? <div className="row"><b className="grow">{other.title || 'Untitled'}</b><button className="btn" onClick={() => setOther(null)}>Change</button></div>
          : <PagePicker autoFocus placeholder="Which page?" onPick={(p) => { if (p.id === pageId) setErr('Pick a different page'); else { setOther(p); setErr('') } }} />}
        {err && <div className="error">{err}</div>}
        <div className="row"><button className="btn primary" onClick={save}>Add relation</button><button className="btn" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  )
}

function describe(r: Relation, pageId: string): { text: string; otherId: string } {
  const mine = r.sourceId === pageId
  const otherId = mine ? r.targetId : r.sourceId
  switch (r.kind) {
    case 'parent': return { text: mine ? 'Parent of' : 'Child of', otherId }
    case 'spouse': return { text: 'Married to', otherId }
    case 'sibling': return { text: 'Sibling of', otherId }
    default: return { text: mine ? r.label : `${r.label} (reverse)`, otherId }
  }
}

/** The relations of one page, shown under it. */
export function PageRelationsSection({ pageId, readOnly, version }: { pageId: string; readOnly: boolean; version: number }) {
  const wsId = useStore((s) => s.wsId)!
  const ready = useWorldFor(wsId)
  const all = useWorld((s) => s.relations)
  const pages = useStore((s) => s.data.pages)
  void version
  const mine = all.filter((r) => r.sourceId === pageId || r.targetId === pageId)
  if (!ready || !mine.length) return null
  const nav = useStore.getState().navigate
  const title = (id: string) => pages.find((p) => p.id === id)?.title || 'Untitled'
  return (
    <div className="section">
      <h3>Relations</h3>
      {mine.map((r) => {
        const d = describe(r, pageId)
        return (
          <div key={r.id} className="row" style={{ padding: '2px 0' }}>
            <Users size={13} className="muted" />
            <span className="grow"><span className="muted">{d.text}</span> <a className="backlink" data-page-id={d.otherId} onClick={() => nav({ type: 'page', id: d.otherId })}>{title(d.otherId)}</a></span>
            {!readOnly && <button className="icon-btn" title="Remove relation" onClick={async () => { await api.deleteRelation(r.id); useWorld.getState().reloadRelations() }}><Trash2 size={13} /></button>}
          </div>
        )
      })}
      <a className="muted" style={{ cursor: 'pointer', fontSize: 12 }} onClick={() => nav({ type: 'relations' })}>Open relationship diagrams</a>
    </div>
  )
}

interface Cam { x: number; y: number; k: number }

/** SVG surface with wheel zoom and drag panning. */
function PanZoom({ width, height, children, resetKey }: { width: number; height: number; children: ReactNode; resetKey: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [cam, setCam] = useState<Cam>({ x: 0, y: 0, k: 1 })
  const moved = useRef(false)
  const fit = () => {
    const el = box.current
    if (!el) return
    const pad = 30
    const k = Math.min(1.2, (el.clientWidth - pad * 2) / Math.max(width, 1), (el.clientHeight - pad * 2) / Math.max(height, 1))
    setCam({ k, x: (el.clientWidth - width * k) / 2, y: (el.clientHeight - height * k) / 2 })
  }
  useEffect(fit, [resetKey, width, height])
  useEffect(() => {
    const el = box.current!
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left, py = e.clientY - r.top
      setCam((c) => {
        const k = Math.max(0.15, Math.min(3, c.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
        return { k, x: px - ((px - c.x) / c.k) * k, y: py - ((py - c.y) / c.k) * k }
      })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    moved.current = false
    let lx = e.clientX, ly = e.clientY
    const move = (m: PointerEvent) => {
      const dx = m.clientX - lx, dy = m.clientY - ly
      if (!moved.current && Math.abs(dx) + Math.abs(dy) < 4) return
      moved.current = true
      lx = m.clientX; ly = m.clientY
      setCam((c) => ({ ...c, x: c.x + dx, y: c.y + dy }))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="rel-canvas" ref={box} onPointerDown={down} onClickCapture={(e) => { if (moved.current) { e.stopPropagation(); moved.current = false } }}>
      <svg width="100%" height="100%">
        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>{children}</g>
      </svg>
      <button className="btn rel-fit" title="Fit to screen" onClick={fit}><Maximize2 size={14} /></button>
    </div>
  )
}

function FamilyTree({ ids, rels }: { ids: string[]; rels: Relation[] }) {
  const pages = useStore((s) => s.data.pages)
  const nav = useStore.getState().navigate
  const title = useMemo(() => new Map(pages.map((p) => [p.id, p.title || 'Untitled'])), [pages])
  const layout = useMemo(() => layoutFamily(ids, rels, (id) => title.get(id) ?? ''), [ids, rels, title])
  const at = new Map(layout.nodes.map((n) => [n.id, n]))
  const fam = rels.filter((r) => r.kind !== 'other' && at.has(r.sourceId) && at.has(r.targetId))
  return (
    <PanZoom width={layout.width} height={layout.height} resetKey={ids.join(',')}>
      {fam.map((r) => {
        const a = at.get(r.sourceId)!, b = at.get(r.targetId)!
        if (r.kind === 'parent') {
          // when both parents are a couple, draw one line from the middle of the couple
          const partner = fam.find((s) => s.kind === 'spouse' && (s.sourceId === r.sourceId || s.targetId === r.sourceId)
            && fam.some((p) => p.kind === 'parent' && p.targetId === r.targetId && p.sourceId === (s.sourceId === r.sourceId ? s.targetId : s.sourceId)))
          const pid = partner ? (partner.sourceId === r.sourceId ? partner.targetId : partner.sourceId) : null
          if (pid && pid < r.sourceId) return null
          const pn = pid ? at.get(pid)! : null
          const x1 = pn ? (a.x + pn.x + NODE_W) / 2 : a.x + NODE_W / 2
          const y1 = pn ? a.y + NODE_H / 2 : a.y + NODE_H
          const x2 = b.x + NODE_W / 2, y2 = b.y, my = (a.y + NODE_H + y2) / 2
          return <path key={r.id} className="rel-edge" d={`M${x1} ${y1} V${my} H${x2} V${y2}`} fill="none" />
        }
        if (r.kind === 'spouse') {
          const [l, rr] = a.x <= b.x ? [a, b] : [b, a]
          return <path key={r.id} className="rel-edge spouse" d={`M${l.x + NODE_W} ${l.y + NODE_H / 2} H${rr.x}`} fill="none" />
        }
        const [l, rr] = a.x <= b.x ? [a, b] : [b, a]
        const y = l.y - 14
        return <path key={r.id} className="rel-edge dashed" d={`M${l.x + NODE_W / 2} ${l.y} V${y} H${rr.x + NODE_W / 2} V${rr.y}`} fill="none" />
      })}
      {layout.nodes.map((n) => (
        <g key={n.id} className="rel-node" data-page-id={n.id} transform={`translate(${n.x} ${n.y})`} onClick={() => nav({ type: 'page', id: n.id })}>
          <rect width={NODE_W} height={NODE_H} rx={8} />
          <text x={NODE_W / 2} y={NODE_H / 2} textAnchor="middle" dominantBaseline="central">{clip(title.get(n.id) ?? '', 20)}</text>
        </g>
      ))}
    </PanZoom>
  )
}

interface DN extends SimulationNodeDatum { id: string; w: number }

function clipToBox(from: { x: number; y: number }, to: { x: number; y: number }, w: number, h: number) {
  const dx = from.x - to.x, dy = from.y - to.y
  if (!dx && !dy) return to
  const s = Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity)
  return { x: to.x + dx * s, y: to.y + dy * s }
}

function Diagram({ rels, withFamily }: { rels: Relation[]; withFamily: boolean }) {
  const pages = useStore((s) => s.data.pages)
  const nav = useStore.getState().navigate
  const title = useMemo(() => new Map(pages.map((p) => [p.id, p.title || 'Untitled'])), [pages])
  const used = useMemo(() => rels.filter((r) => withFamily || r.kind === 'other'), [rels, withFamily])
  const sim = useMemo(() => {
    const ids = [...new Set(used.flatMap((r) => [r.sourceId, r.targetId]))]
    const nodes: DN[] = ids.map((id, i) => ({ id, w: Math.min((title.get(id) ?? '').length, 20) * 7 + 24, x: Math.cos(i) * 100, y: Math.sin(i) * 100 }))
    const links = used.map((r) => ({ source: r.sourceId, target: r.targetId }))
    const s = forceSimulation(nodes).force('link', forceLink<DN, any>(links).id((d) => d.id).distance(190).strength(0.5))
      .force('charge', forceManyBody().strength(-700)).force('center', forceCenter(0, 0)).force('collide', forceCollide<DN>().radius((d) => d.w / 2 + 24)).stop()
    for (let i = 0; i < 320; i++) s.tick()
    const minX = Math.min(...nodes.map((n) => n.x! - n.w / 2)), maxX = Math.max(...nodes.map((n) => n.x! + n.w / 2))
    const minY = Math.min(...nodes.map((n) => n.y! - 20)), maxY = Math.max(...nodes.map((n) => n.y! + 20))
    return { nodes, minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
  }, [used, title])
  if (!used.length) return <div className="muted" style={{ padding: 20 }}>No custom relationships yet. Use <code>/relation</code> on a page and choose “custom…”.</div>
  const byId = new Map(sim.nodes.map((n) => [n.id, n]))
  const labelOf = (r: Relation) => (r.kind === 'other' ? r.label : r.kind === 'parent' ? 'parent of' : r.kind === 'spouse' ? 'married' : 'siblings')
  return (
    <PanZoom width={sim.width} height={sim.height} resetKey={used.map((r) => r.id).join(',')}>
      <defs>
        <marker id="rel-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="rel-arrow" /></marker>
      </defs>
      <g transform={`translate(${-sim.minX} ${-sim.minY})`}>
        {used.map((r) => {
          const a = byId.get(r.sourceId)!, b = byId.get(r.targetId)!
          const p1 = clipToBox(b as any, a as any, a.w, 32), p2 = clipToBox(a as any, b as any, b.w, 32)
          const directed = r.kind === 'parent' || r.kind === 'other'
          const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
          const lab = labelOf(r)
          return (
            <g key={r.id}>
              <line className={`rel-edge ${r.kind === 'sibling' ? 'dashed' : ''}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} markerEnd={directed ? 'url(#rel-arrow)' : undefined} />
              {lab && <text className="rel-label" x={mx} y={my - 5} textAnchor="middle">{lab}</text>}
            </g>
          )
        })}
        {sim.nodes.map((n) => (
          <g key={n.id} className="rel-node" data-page-id={n.id} transform={`translate(${n.x! - n.w / 2} ${n.y! - 16})`} onClick={() => nav({ type: 'page', id: n.id })}>
            <rect width={n.w} height={32} rx={16} />
            <text x={n.w / 2} y={16} textAnchor="middle" dominantBaseline="central">{clip(title.get(n.id) ?? '', 20)}</text>
          </g>
        ))}
      </g>
    </PanZoom>
  )
}

export function RelationsView() {
  const wsId = useStore((s) => s.wsId)!
  const ready = useWorldFor(wsId)
  const rels = useWorld((s) => s.relations)
  const pages = useStore((s) => s.data.pages)
  const [tab, setTab] = useState<'family' | 'diagram'>('family')
  const [withFamily, setWithFamily] = useState(false)
  const [pick, setPick] = useState(0)
  const families = useMemo(() => familyComponents(rels), [rels])
  const name = (ids: string[]) => {
    const titles = ids.map((i) => pages.find((p) => p.id === i)?.title || 'Untitled').sort()
    return `${titles[0]}${titles.length > 1 ? ` + ${titles.length - 1}` : ''}`
  }
  if (!ready) return <div className="view muted">Loading…</div>
  const fam = families[Math.min(pick, families.length - 1)]
  return (
    <div className="view rel-view">
      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 className="grow" style={{ margin: 0 }}>Relations</h1>
        <div className="seg">
          <button className={tab === 'family' ? 'on' : ''} onClick={() => setTab('family')}>Family trees</button>
          <button className={tab === 'diagram' ? 'on' : ''} onClick={() => setTab('diagram')}>Diagram</button>
        </div>
      </div>
      {tab === 'family' && (
        families.length
          ? <>
            {families.length > 1 && (
              <Select className="input" value={String(Math.min(pick, families.length - 1))} onChange={(v) => setPick(+v)} style={{ marginBottom: 8, maxWidth: 360 }}>
                {families.map((f, i) => <option key={i} value={i}>{name(f)} ({f.length} people)</option>)}
              </Select>
            )}
            <FamilyTree ids={fam} rels={rels} />
          </>
          : <div className="muted">No family links yet. Open a page and type <code>/relation</code> to say who is whose parent, spouse or sibling.</div>
      )}
      {tab === 'diagram' && (
        <>
          <label className="row" style={{ marginBottom: 8 }}><input type="checkbox" checked={withFamily} onChange={(e) => setWithFamily(e.target.checked)} /> Include family links</label>
          <Diagram rels={rels} withFamily={withFamily} />
        </>
      )}
      <small className="muted">Scroll to zoom, drag to pan, click a name to open the page.</small>
    </div>
  )
}
