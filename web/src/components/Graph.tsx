import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Select } from './Select'

interface N extends SimulationNodeDatum { id: string; title: string; degree: number; tags: string[] }

export function GraphView() {
  const pages = useStore((s) => s.data.pages)
  const links = useStore((s) => s.data.links)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [hideOrphans, setHideOrphans] = useState(false)
  const [tagFilter, setTagFilter] = useState('')
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    const cv = canvas.current!
    const ctx = cv.getContext('2d')!
    const css = getComputedStyle(document.documentElement)
    const color = (v: string) => css.getPropertyValue(v).trim()

    const ids = new Set(pages.map((p) => p.id))
    const edges = new Map<string, { source: string; target: string }>()
    for (const l of links) {
      if (!l.targetId || l.targetId === l.sourceId || !ids.has(l.sourceId) || !ids.has(l.targetId)) continue
      const k = [l.sourceId, l.targetId].sort().join('|')
      if (!edges.has(k)) edges.set(k, { source: l.sourceId, target: l.targetId })
    }
    const degree = new Map<string, number>()
    for (const e of edges.values()) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
    }
    let nodes: N[] = pages
      .filter((p) => (!hideOrphans || degree.get(p.id)) && (!tagFilter || p.tags.some((t) => t === tagFilter || t.startsWith(`${tagFilter}/`))))
      .map((p) => ({ id: p.id, title: p.title || 'Untitled', degree: degree.get(p.id) ?? 0, tags: p.tags }))
    const present = new Set(nodes.map((n) => n.id))
    const es = [...edges.values()].filter((e) => present.has(e.source) && present.has(e.target)).map((e) => ({ ...e }))

    let w = 0, h = 0
    const resize = () => {
      const r = cv.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      w = r.width; h = r.height
      cv.width = w * dpr; cv.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(() => { resize(); draw() })
    ro.observe(cv)

    const view = { x: 0, y: 0, k: 1 }
    const radius = (n: N) => 5 + Math.min(10, Math.sqrt(n.degree) * 3)
    const sim = forceSimulation(nodes)
      .force('link', forceLink<N, any>(es).id((d) => d.id).distance(70).strength(0.5))
      .force('charge', forceManyBody().strength(-160))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide<N>().radius((n) => radius(n) + 6))
      .on('tick', draw)

    const toWorld = (px: number, py: number) => ({ x: (px - w / 2 - view.x) / view.k, y: (py - h / 2 - view.y) / view.k })
    const pick = (px: number, py: number) => {
      const p = toWorld(px, py)
      let best: N | null = null
      let bd = Infinity
      for (const n of nodes) {
        const d = Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y)
        if (d < radius(n) + 5 && d < bd) { best = n; bd = d }
      }
      return best
    }

    let hoverId: string | null = null
    function draw() {
      ctx.clearRect(0, 0, w, h)
      ctx.save()
      ctx.translate(w / 2 + view.x, h / 2 + view.y)
      ctx.scale(view.k, view.k)
      const nb = new Set<string>()
      if (hoverId) for (const e of es) { const s = (e.source as any).id, t = (e.target as any).id; if (s === hoverId) nb.add(t); if (t === hoverId) nb.add(s) }
      ctx.lineWidth = 1 / view.k
      for (const e of es) {
        const s = e.source as any, t = e.target as any
        const hot = hoverId && (s.id === hoverId || t.id === hoverId)
        ctx.strokeStyle = hot ? color('--accent') : color('--border')
        ctx.globalAlpha = hoverId && !hot ? 0.25 : 1
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke()
      }
      for (const n of nodes) {
        const dim = hoverId && n.id !== hoverId && !nb.has(n.id)
        ctx.globalAlpha = dim ? 0.3 : 1
        ctx.fillStyle = n.id === hoverId ? color('--link') : n.degree ? color('--accent') : color('--muted')
        ctx.beginPath(); ctx.arc(n.x ?? 0, n.y ?? 0, radius(n), 0, Math.PI * 2); ctx.fill()
        if (view.k > 0.6 || n.id === hoverId || nb.has(n.id)) {
          ctx.fillStyle = color('--text')
          ctx.font = `${12 / Math.max(view.k, 0.8)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText(n.title, n.x ?? 0, (n.y ?? 0) + radius(n) + 13 / Math.max(view.k, 0.8))
        }
      }
      ctx.restore()
    }

    let drag: { n: N | null; px: number; py: number; moved: boolean } | null = null
    const pos = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    const down = (e: PointerEvent) => {
      const p = pos(e)
      drag = { n: pick(p.x, p.y), px: p.x, py: p.y, moved: false }
      cv.setPointerCapture(e.pointerId)
      if (drag.n) { sim.alphaTarget(0.3).restart(); drag.n.fx = drag.n.x; drag.n.fy = drag.n.y }
    }
    const move = (e: PointerEvent) => {
      const p = pos(e)
      if (!drag) {
        const n = pick(p.x, p.y)
        const id = n?.id ?? null
        if (id !== hoverId) { hoverId = id; setHover(id); cv.style.cursor = id ? 'pointer' : 'grab'; draw() }
        return
      }
      if (Math.hypot(p.x - drag.px, p.y - drag.py) > 3) drag.moved = true
      if (drag.n) { const w0 = toWorld(p.x, p.y); drag.n.fx = w0.x; drag.n.fy = w0.y }
      else { view.x += p.x - drag.px; view.y += p.y - drag.py; drag.px = p.x; drag.py = p.y; draw() }
    }
    const up = () => {
      if (drag?.n) {
        if (!drag.moved) useStore.getState().navigate({ type: 'page', id: drag.n.id })
        drag.n.fx = null; drag.n.fy = null; sim.alphaTarget(0)
      }
      drag = null
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = pos(e as any)
      const before = toWorld(p.x, p.y)
      view.k = Math.max(0.15, Math.min(4, view.k * Math.exp(-e.deltaY * 0.0012)))
      view.x = p.x - w / 2 - before.x * view.k
      view.y = p.y - h / 2 - before.y * view.k
      draw()
    }
    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('wheel', wheel, { passive: false })
    return () => {
      sim.stop(); ro.disconnect()
      cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move)
      cv.removeEventListener('pointerup', up); cv.removeEventListener('wheel', wheel)
    }
  }, [pages, links, hideOrphans, tagFilter])

  const allTags = [...new Set(pages.flatMap((p) => p.tags))].sort()
  return (
    <div className="graph-wrap">
      <div className="graph-panel">
        <label className="row"><input type="checkbox" checked={hideOrphans} onChange={(e) => setHideOrphans(e.target.checked)} /> Hide unlinked pages</label>
        <Select className="input" value={tagFilter} onChange={setTagFilter}>
          <option value="">All tags</option>
          {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
        </Select>
        <span className="muted" style={{ fontSize: 12 }}>{hover ? pages.find((p) => p.id === hover)?.title : 'Scroll to zoom, drag to pan, click a node to open'}</span>
      </div>
      <canvas ref={canvas} style={{ cursor: 'grab' }} />
    </div>
  )
}
