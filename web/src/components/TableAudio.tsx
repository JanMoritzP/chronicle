import { Music, Play, Square, Trash2, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { alertDialog, askText } from '../lib/dialog'
import { Select } from './Select'
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
      el.onended = () => { map.delete(id); if (useTable.getState().role === 'gm' && t.name.includes('/')) sendTable({ t: 'jukebox.next', id }) }
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
  const scenes = useTable((s) => s.scenes)
  if (!gm && !tracks.length) return null
  const addStream = async () => {
    const url = await askText('Play a stream', { label: 'Address of the sound (https)', placeholder: 'https://example.com/tavern.ogg', okLabel: 'Next' })
    if (!url?.trim()) return
    if (!/^https:\/\/[^\s]{4,280}$/.test(url.trim())) { await alertDialog('The address must start with https:// and point at a sound file or stream.'); return }
    const name = await askText('Name this track', { label: 'Name (Playlist/Track puts it in a playlist)', okLabel: 'Add' })
    if (name?.trim()) sendTable({ t: 'jukebox.add', name: name.trim(), url: url.trim(), loop: false })
  }
  const add = async () => {
    const f = await pickSound()
    if (!f || !wsId) return
    const name = await askText('Name this track', { label: 'Name (Playlist/Track puts it in a playlist)', initial: f.name.replace(/\.[a-z0-9]+$/i, ''), okLabel: 'Add' })
    if (!name?.trim()) return
    const url = await uploadSound(wsId, f)
    if (url) sendTable({ t: 'jukebox.add', name: name.trim(), url, loop: /loop|ambient|rain|wind|tavern|forest|cave/i.test(name) })
  }
  const playlists = [...new Set(tracks.filter((t) => t.name.includes('/')).map((t) => t.name.split('/')[0].trim()))].filter(Boolean)
  const track = (t: (typeof tracks)[number], shown: string) => {
    const on = playing.includes(t.id)
    return (
      <li key={t.id}>
        <span className="grow">{shown}{t.loop ? <small className="muted"> loops</small> : null}{on ? <small className="muted"> playing</small> : null}</span>
        {gm && (
          <Select className="input tt-type" value={t.scene ?? ''} title={`Scene for ${t.name}`} onChange={(v) => sendTable({ t: 'jukebox.scene', id: t.id, scene: v || null })}>
            <option value="">Any scene</option>
            {scenes.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
          </Select>
        )}
        {gm && (on
          ? <button className="btn sm" aria-label={`Stop ${t.name}`} onClick={() => sendTable({ t: 'jukebox.stop', id: t.id })}><Square size={12} /></button>
          : <button className="btn sm" aria-label={`Play ${t.name}`} onClick={() => sendTable({ t: 'jukebox.play', id: t.id })}><Play size={12} /></button>)}
        {gm && <button className="btn ghost sm" aria-label={`Remove ${t.name}`} onClick={() => sendTable({ t: 'jukebox.remove', id: t.id })}><Trash2 size={12} /></button>}
      </li>
    )
  }
  return (
    <section aria-label="Jukebox">
      <b>Jukebox</b>
      <ul className="tt-people" aria-label="Tracks">
        {tracks.filter((t) => !t.name.includes('/')).map((t) => track(t, t.name))}
        {playlists.map((p) => {
          const mine = tracks.filter((t) => t.name.includes('/') && t.name.split('/')[0].trim().toLowerCase() === p.toLowerCase())
          const any = mine.some((t) => playing.includes(t.id))
          return (
            <li key={`pl-${p}`} className="tt-playlist" aria-label={`Playlist ${p}`}>
              <b className="grow">{p} <small className="muted">playlist of {mine.length}</small></b>
              {gm && (any
                ? <button className="btn sm" aria-label={`Stop the playlist ${p}`} onClick={() => { for (const t of mine) if (playing.includes(t.id)) sendTable({ t: 'jukebox.stop', id: t.id }) }}><Square size={12} /> Stop</button>
                : <button className="btn sm" aria-label={`Play the playlist ${p}`} onClick={() => sendTable({ t: 'jukebox.playlist', name: p })}><Play size={12} /> Play all</button>)}
            </li>
          )
        }).flatMap((header, i) => [header, ...tracks.filter((t) => t.name.includes('/') && t.name.split('/')[0].trim().toLowerCase() === playlists[i].toLowerCase()).map((t) => track(t, t.name.slice(t.name.indexOf('/') + 1).trim()))])}
        {!tracks.length && <li className="muted">No tracks yet.</li>}
      </ul>
      {gm && (
        <div className="tt-row">
          <button className="btn sm" onClick={add}>Add a sound file</button>
          <button className="btn sm" onClick={addStream}>Add a stream</button>
          {playing.length > 0 && <button className="btn sm" onClick={() => sendTable({ t: 'jukebox.stop', id: 'all' })}>Stop everything</button>}
        </div>
      )}
    </section>
  )
}
