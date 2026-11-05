import { useEffect, useRef, useState } from 'react'
import { dialogKey, shiftDialog, useDialogs, type DialogRequest } from '../lib/dialog'

function Current({ req }: { req: DialogRequest }) {
  const [text, setText] = useState(req.kind === 'prompt' ? req.initial : '')
  const input = useRef<HTMLInputElement>(null)
  const okBtn = useRef<HTMLButtonElement>(null)

  const finish = (ok: boolean) => {
    if (req.kind === 'prompt') req.resolve(ok ? text : null)
    else if (req.kind === 'confirm') req.resolve(ok)
    else req.resolve()
    shiftDialog()
  }

  useEffect(() => {
    if (req.kind === 'prompt') { input.current?.focus(); input.current?.select() } else okBtn.current?.focus()
  }, [req])

  return (
    <div className="overlay dialog-overlay" onMouseDown={() => finish(false)}>
      <form
        className="dialog small-dialog" role="dialog" aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (req.kind !== 'prompt' || text.trim()) finish(true) }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(false) } }}
      >
        <div className="dialog-body">
          <h3 className="dialog-title">{req.title}</h3>
          {req.kind === 'prompt' && (
            <label className="field">
              {req.label && <span>{req.label}</span>}
              <input ref={input} className="input" value={text} placeholder={req.placeholder} onChange={(e) => setText(e.target.value)} />
            </label>
          )}
          {req.kind !== 'prompt' && <p className="dialog-message">{req.message}</p>}
        </div>
        <div className="dialog-actions">
          {req.kind !== 'alert' && <button type="button" className="btn" onClick={() => finish(false)}>Cancel</button>}
          <button
            ref={okBtn} type="submit" disabled={req.kind === 'prompt' && !text.trim()}
            className={`btn ${req.kind === 'confirm' && req.danger ? 'danger-solid' : 'primary'}`}
          >
            {req.kind === 'alert' ? 'OK' : req.okLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

export function DialogHost() {
  const req = useDialogs((s) => s.queue[0])
  if (!req) return null
  return <Current key={dialogKey(req)} req={req} />
}
