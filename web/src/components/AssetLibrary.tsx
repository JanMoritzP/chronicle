import { Music, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { alertDialog, askText, confirmDialog } from '../lib/dialog'
import { sendTable, useTable, type Scene } from '../tabletop/state'
import { uploadImage, uploadSound } from '../tabletop/upload'

// Every picture and sound the world has uploaded, in one place: search by name or tag, add many at once, and use a picture as the map, a token or a
// prop, or a sound in the jukebox. The owner account only.

interface Asset { id: string; url: string; filename: string; mime: string; size: number; createdAt: number; tags: string[]; kind: 'image' | 'sound' }
interface Listing { quota: number; used: number; items: Asset[] }

const mb = (n: number) => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1)} MB`

export function AssetLibrary({ scene, wsId, onClose }: { scene: Scene; wsId: string; onClose: () => void }) {
  const [list, setList] = useState<Listing | null>(null)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'image' | 'sound'>('all')
  const [busy, setBusy] = useState(false)
  const load = () => fetch(`/api/workspaces/${wsId}/uploads`).then((r) => r.json()).then(setList).catch(() => setList({ quota: 0, used: 0, items: [] }))
  useEffect(() => { void load() }, [wsId])

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (list?.items ?? []).filter((a) => (kind === 'all' || a.kind === kind) && words.every((w) => a.filename.toLowerCase().includes(w) || a.tags.some((t) => t.includes(w))))
  }, [list, q, kind])

  const add = async () => {
    const files = await new Promise<File[]>((resolve) => {
      const el = document.createElement('input')
      el.type = 'file'; el.multiple = true
      el.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif,audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,audio/aac,.mp3,.ogg,.wav,.m4a'
      el.onchange = () => resolve([...(el.files ?? [])]); el.oncancel = () => resolve([])
      el.click()
    })
    if (!files.length) return
    setBusy(true)
    for (const f of files) { if (f.type.startsWith('audio/')) await uploadSound(wsId, f); else await uploadImage(wsId, f) }
    setBusy(false); void load()
  }
  const tag = async (a: Asset) => {
    const t = await askText(`Tags for ${a.filename}`, { label: 'Separated by commas', initial: a.tags.join(', '), placeholder: 'forest, night, token', okLabel: 'Save' })
    if (t === null) return
    await fetch(`/api/uploads/${a.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tags: t.split(',').map((x) => x.trim()).filter(Boolean) }) }).catch(() => undefined)
    void load()
  }
  const remove = async (a: Asset) => {
    if (!(await confirmDialog(`“${a.filename}” is deleted from the world. Anything that uses it (a map, a token, a prop, a track) loses it.`, { title: 'Delete the file', okLabel: 'Delete', danger: true }))) return
    const r = await fetch(`/api/uploads/${a.id}`, { method: 'DELETE' })
    if (!r.ok) await alertDialog('The file could not be deleted.')
    void load()
  }
  const centre = { x: Math.round(scene.width / 2), y: Math.round(scene.height / 2) }
  const stem = (a: Asset) => a.filename.replace(/\.[a-z0-9]+$/i, '').slice(0, 60)

  return (
    <div className="map-editor-overlay" role="dialog" aria-label="Asset library">
      <div className="map-editor-bar">
        <b>Asset library</b>
        <input className="input" aria-label="Search the files" placeholder="Search by name or tag" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="seg" role="group" aria-label="Kind of file">
          {(['all', 'image', 'sound'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'all' ? 'All' : k === 'image' ? 'Pictures' : 'Sounds'}</button>)}
        </span>
        <button className="btn sm" disabled={busy} onClick={add}>{busy ? 'Adding…' : 'Add files'}</button>
        <span className="muted" style={{ fontSize: 12 }}>{list ? `${mb(list.used)} of ${mb(list.quota)} used, ${list.items.length} files` : ''}</span>
        <span className="grow" />
        <button className="btn" aria-label="Close the asset library" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="map-editor-scroll" style={{ background: 'var(--bg)' }}>
        {list && !shown.length && <p className="muted">{list.items.length ? 'Nothing matches.' : 'No files yet. Add pictures and sounds, or upload them where you use them.'}</p>}
        <ul className="asset-grid" aria-label="Files">
          {shown.map((a) => (
            <li key={a.id} className="asset">
              {a.kind === 'image' ? <img src={a.url} alt="" loading="lazy" /> : <div className="asset-sound"><Music size={26} /></div>}
              <b className="ellipsis" title={a.filename}>{a.filename}</b>
              <small className="muted">{mb(a.size)}{a.tags.length ? ` · ${a.tags.join(', ')}` : ''}</small>
              <div className="tt-row">
                {a.kind === 'image' ? (
                  <>
                    <button className="btn sm" aria-label={`Use ${a.filename} as the map`} onClick={() => { sendTable({ t: 'scene.update', id: scene.id, patch: { bg: a.url } }); onClose() }}>Map</button>
                    <button className="btn sm" aria-label={`Make a token of ${a.filename}`} onClick={() => sendTable({ t: 'token.add', sceneId: scene.id, token: { name: stem(a), image: a.url, x: centre.x, y: centre.y } })}>Token</button>
                    <button className="btn sm" aria-label={`Put ${a.filename} on the map as a prop`} onClick={() => sendTable({ t: 'tile.add', sceneId: scene.id, image: a.url, x: centre.x, y: centre.y })}>Prop</button>
                  </>
                ) : <button className="btn sm" aria-label={`Add ${a.filename} to the jukebox`} onClick={() => sendTable({ t: 'jukebox.add', name: stem(a), url: a.url, loop: false })}>Jukebox</button>}
                <button className="btn ghost sm" aria-label={`Tags of ${a.filename}`} onClick={() => tag(a)}>Tags</button>
                <button className="btn ghost sm" aria-label={`Delete ${a.filename}`} onClick={() => remove(a)}><Trash2 size={12} /></button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
