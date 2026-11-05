import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'

export function CaptureDialog() {
  const open = useStore((s) => s.captureOpen)
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const close = () => useStore.getState().setUi({ captureOpen: false })

  useEffect(() => { if (open) setTimeout(() => ref.current?.focus(), 0) }, [open])
  if (!open) return null

  const submit = async () => {
    if (!body.trim() || busy) return
    setBusy(true)
    setErr('')
    try {
      await useStore.getState().addZettel(body.trim(), tags.split(/[\s,]+/).map((t) => t.replace(/^#/, '').toLowerCase()).filter(Boolean))
      setBody(''); setTags(''); close()
    } catch (e: any) {
      setErr(e.message || 'Could not save')
    } finally { setBusy(false) }
  }

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ padding: '14px 16px 0' }}><b>Quick capture</b> <span className="muted">Goes to your zettelkasten inbox</span></div>
        <textarea ref={ref} className="input" style={{ border: 0, boxShadow: 'none', minHeight: 130, resize: 'vertical', background: 'transparent', padding: '10px 16px' }}
          placeholder="Any thought, name, idea…" value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }} />
        <div className="row" style={{ padding: '8px 16px 14px' }}>
          <input className="input grow" placeholder="tags (space separated)" value={tags} onChange={(e) => setTags(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
          <button className="btn primary" disabled={busy || !body.trim()} onClick={submit}>Save <kbd style={{ marginLeft: 4 }}>Ctrl ↵</kbd></button>
        </div>
        {err && <div className="error" style={{ padding: '0 16px 12px' }}>{err}</div>}
      </div>
    </div>
  )
}
