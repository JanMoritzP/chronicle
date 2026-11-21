import { Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { colorFor } from '../lib/collab'
import { describe, mainScene, standingAt, type ReplayEvent } from '../tabletop/replay'

// The last session played back: tokens moving over the map as they did, with the chat beside it. The GM account only.

interface Data { events: ReplayEvent[]; chat: { ts: number; name: string; kind: string; text: string }[]; scenes: { id: string; name: string; bg: string; width: number; height: number }[] }

export function Replay({ wsId, onClose }: { wsId: string; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [sceneId, setSceneId] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const bg = useRef<HTMLImageElement | null>(null)
  const [bgReady, setBgReady] = useState(0)

  useEffect(() => { fetch(`/api/workspaces/${wsId}/replay`).then((r) => r.json()).then((d: Data) => { setData(d); setSceneId(mainScene(d.events)); setAt(0) }).catch(() => setData({ events: [], chat: [], scenes: [] })) }, [wsId])
  const scene = data?.scenes.find((s) => s.id === sceneId) ?? null
  useEffect(() => {
    bg.current = null
    if (!scene?.bg) { setBgReady((n) => n + 1); return }
    const img = new Image()
    img.onload = () => { bg.current = img; setBgReady((n) => n + 1) }
    img.src = scene.bg
  }, [scene?.id, scene?.bg])
  useEffect(() => {
    if (!playing || !data) return
    const t = window.setInterval(() => setAt((a) => { if (a >= data.events.length) { setPlaying(false); return a } return a + 1 }), 220)
    return () => clearInterval(t)
  }, [playing, data])

  const stand = useMemo(() => (data ? standingAt(data.events, at, sceneId) : []), [data, at, sceneId])
  useEffect(() => {
    const c = canvas.current
    if (!c || !scene) return
    const W = 880, H = Math.round((880 * scene.height) / scene.width)
    c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#15131a'; ctx.fillRect(0, 0, W, H)
    if (bg.current) ctx.drawImage(bg.current, 0, 0, W, H)
    const k = W / scene.width
    for (const t of stand) {
      ctx.globalAlpha = t.hidden ? 0.45 : 1
      ctx.beginPath(); ctx.arc(t.x * k, t.y * k, 11, 0, Math.PI * 2); ctx.fillStyle = colorFor(t.id); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke()
      ctx.globalAlpha = 1
      ctx.font = '12px sans-serif'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3
      ctx.strokeText(t.name, t.x * k + 14, t.y * k + 4); ctx.fillText(t.name, t.x * k + 14, t.y * k + 4)
    }
  }, [stand, scene, bgReady])

  const now = at > 0 ? data?.events[at - 1] : undefined
  const atEnd = !!data && at >= data.events.length
  const said = (data?.chat ?? []).filter((m) => atEnd || (now && m.ts <= now.ts + 1)).slice(-10)
  const sceneIds = [...new Set((data?.events ?? []).map((e) => e.scene).filter((s): s is string => !!s))]
  return (
    <div className="map-editor-overlay" role="dialog" aria-label="Session replay">
      <div className="map-editor-bar">
        <b>Replay of the last session</b>
        {data && data.events.length > 0 && (
          <>
            <button className="btn sm" aria-label={playing ? 'Pause' : 'Play'} onClick={() => { if (at >= data.events.length) setAt(0); setPlaying(!playing) }}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
            <input type="range" min={0} max={data.events.length} aria-label="Position in the session" value={at} style={{ flex: 1, minWidth: 160 }} onChange={(e) => { setAt(Number(e.target.value)); setPlaying(false) }} />
            <span className="muted" style={{ fontSize: 12 }}>{at} of {data.events.length}</span>
            {sceneIds.length > 1 && (
              <span className="seg" role="group" aria-label="Scene to watch">
                {sceneIds.map((id) => <button key={id} className={sceneId === id ? 'on' : ''} onClick={() => setSceneId(id)}>{data.scenes.find((s) => s.id === id)?.name ?? 'Scene'}</button>)}
              </span>
            )}
          </>
        )}
        <span className="grow" />
        <button className="btn" aria-label="Close the replay" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="map-editor-scroll" style={{ background: 'var(--bg)' }}>
        {!data && <p className="muted">Opening the session…</p>}
        {data && !data.events.length && <p className="muted">Nothing has been played at this table yet. Moves, new tokens and hit point changes are noted as they happen.</p>}
        {data && data.events.length > 0 && (
          <div className="replay">
            <div>
              <canvas ref={canvas} aria-label="The map" style={{ width: '100%', maxWidth: 880, borderRadius: 8 }} />
              <p role="status" aria-live="polite">{now ? describe(now) : 'The start of the session'}</p>
            </div>
            <ul className="replay-chat" aria-label="What was said">
              {said.map((m, i) => <li key={i}><b>{m.name}</b> {m.kind === 'whisper' ? <em>(whispers)</em> : null} {m.text}</li>)}
              {!said.length && <li className="muted">Nothing said yet.</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
