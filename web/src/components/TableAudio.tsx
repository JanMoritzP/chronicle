import { Music, Play, Square, Trash2, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { askText } from '../lib/dialog'
import { useStore } from '../store'
import { sendTable, useTable } from '../tabletop/state'
import { pickSound, uploadSound } from '../tabletop/upload'

// The jukebox: sound files the GM keeps in the world and plays for everyone (a looping rain, a tavern, a battle theme). Several can play together.
// Every person has their own volume and can mute it; the first sound needs one click in the page, because browsers do not start sound on their own.

const loadVolume = () => { try { const v = Number(localStorage.getItem('tt-volume') ?? '0.6'); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6 } catch { return 0.6 } }

/** Plays what the GM has switched on. Rendered once per table, shows controls only while something plays or the browser holds the sound back. */
export function AudioPlayer() {
  const tracks = useTable((s) => s.jukebox.tracks)
  const playing = useTable((s) => s.jukebox.playing)
  const [volume, setVolume] = useState(loadVolume)
  const [muted, setMuted] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const els = useRef(new Map<string, HTMLAudioElement>())

  useEffect(() => {
    const map = els.current
    for (const [id, el] of map) if (!playing.includes(id)) { el.pause(); map.delete(id) }
    for (const id of playing) {
      const t = tracks.find((x) => x.id === id)
      if (!t || map.has(id)) continue
      const el = new Audio(t.url)
      el.loop = t.loop
      el.volume = muted ? 0 : volume
      el.onended = () => map.delete(id)
      map.set(id, el)
      el.play().then(() => setBlocked(false)).catch(() => setBlocked(true))
    }
  }, [playing, tracks])

  useEffect(() => {
    for (const el of els.current.values()) el.volume = muted ? 0 : volume
    try { localStorage.setItem('tt-volume', String(volume)) } catch { /* private window */ }
  }, [volume, muted])
  useEffect(() => () => { for (const el of els.current.values()) el.pause(); els.current.clear() }, [])

  if (!playing.length && !blocked) return null
  return (
    <div className="tt-audio" role="group" aria-label="Sound">
      <Music size={13} />
      {blocked && <button className="btn sm primary" onClick={() => { for (const el of els.current.values()) void el.play().then(() => setBlocked(false)).catch(() => undefined) }}>Turn the sound on</button>}
      <button className="btn ghost sm" aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>
      <input type="range" min={0} max={100} aria-label="Volume" value={Math.round(volume * 100)} onChange={(e) => { setVolume(Number(e.target.value) / 100); setMuted(false) }} />
    </div>
  )
}

/** The list of tracks and what is playing; the GM adds, plays and removes them. */
export function Jukebox() {
  const tracks = useTable((s) => s.jukebox.tracks)
  const playing = useTable((s) => s.jukebox.playing)
  const role = useTable((s) => s.role)
  const wsId = useStore((s) => s.wsId)
  const gm = role === 'gm'
  if (!gm && !tracks.length) return null
  const add = async () => {
    const f = await pickSound()
    if (!f || !wsId) return
    const name = await askText('Name this track', { label: 'Name', initial: f.name.replace(/\.[a-z0-9]+$/i, ''), okLabel: 'Add' })
    if (!name?.trim()) return
    const url = await uploadSound(wsId, f)
    if (url) sendTable({ t: 'jukebox.add', name: name.trim(), url, loop: /loop|ambient|rain|wind|tavern|forest|cave/i.test(name) })
  }
  return (
    <section aria-label="Jukebox">
      <b>Jukebox</b>
      <ul className="tt-people" aria-label="Tracks">
        {tracks.map((t) => {
          const on = playing.includes(t.id)
          return (
            <li key={t.id}>
              <span className="grow">{t.name}{t.loop ? <small className="muted"> loops</small> : null}{on ? <small className="muted"> playing</small> : null}</span>
              {gm && (on
                ? <button className="btn sm" aria-label={`Stop ${t.name}`} onClick={() => sendTable({ t: 'jukebox.stop', id: t.id })}><Square size={12} /></button>
                : <button className="btn sm" aria-label={`Play ${t.name}`} onClick={() => sendTable({ t: 'jukebox.play', id: t.id })}><Play size={12} /></button>)}
              {gm && <button className="btn ghost sm" aria-label={`Remove ${t.name}`} onClick={() => sendTable({ t: 'jukebox.remove', id: t.id })}><Trash2 size={12} /></button>}
            </li>
          )
        })}
        {!tracks.length && <li className="muted">No tracks yet.</li>}
      </ul>
      {gm && (
        <div className="tt-row">
          <button className="btn sm" onClick={add}>Add a sound file</button>
          {playing.length > 0 && <button className="btn sm" onClick={() => sendTable({ t: 'jukebox.stop', id: 'all' })}>Stop everything</button>}
        </div>
      )}
    </section>
  )
}
