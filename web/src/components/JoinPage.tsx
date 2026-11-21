import { useEffect, useState } from 'react'

// The page an invite link opens. No sign in is needed to see it: it says which world the link is for and offers to make an account
// (or to use one the person already has). Nothing else about the world is shown before they are in.

export function JoinPage({ token }: { token: string }) {
  const [info, setInfo] = useState<{ world: string; role: 'editor' | 'viewer' } | null>(null)
  const [problem, setProblem] = useState('')
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/public/invite/${encodeURIComponent(token)}`)
      .then(async (r) => { const d = await r.json().catch(() => null); if (r.ok) setInfo(d); else setProblem(d?.error ?? 'This invite link is not valid any more. Ask for a new one.') })
      .catch(() => setProblem('Cannot reach the server. Check your connection and try again.'))
  }, [token])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (mode === 'new' && password !== again) return setError('The two passwords are not the same.')
    setBusy(true)
    try {
      const r = await fetch(`/api/public/invite/${encodeURIComponent(token)}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, username: username.trim(), password }) })
      const d = await r.json().catch(() => null)
      if (!r.ok) { setError(d?.error ?? 'Something went wrong. Try again.'); setBusy(false); return }
      // the cookie is set; the app opens on the world they were let into
      try { localStorage.setItem('workspace', d.worldId) } catch { /* private window */ }
      location.replace('/')
    } catch {
      setError('Cannot reach the server. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <main className="join">
      <div className="join-card">
        <h1>Chronicle</h1>
        {problem ? <p role="alert">{problem}</p> : !info ? <p className="muted">Opening the invitation…</p> : (
          <>
            <p className="join-lead">You are invited to <b>{info.world}</b> as {info.role === 'editor' ? 'a player' : 'a spectator'}.</p>
            <div className="seg" role="group" aria-label="Account">
              <button className={mode === 'new' ? 'on' : ''} type="button" onClick={() => setMode('new')}>Make an account</button>
              <button className={mode === 'existing' ? 'on' : ''} type="button" onClick={() => setMode('existing')}>I have an account</button>
            </div>
            <form onSubmit={submit}>
              <label className="field"><span>{mode === 'new' ? 'Choose a name' : 'Your name'}</span>
                <input className="input" value={username} autoFocus autoComplete="username" placeholder="Aria" onChange={(e) => setUsername(e.target.value)} />
              </label>
              <label className="field"><span>Password</span>
                <input className="input" type="password" value={password} autoComplete={mode === 'new' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" onChange={(e) => setPassword(e.target.value)} />
              </label>
              {mode === 'new' && (
                <label className="field"><span>Password again</span>
                  <input className="input" type="password" value={again} autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />
                </label>
              )}
              {error && <p className="join-error" role="alert">{error}</p>}
              <button className="btn primary" type="submit" disabled={busy || username.trim().length < 2 || password.length < 8}>{mode === 'new' ? 'Create account and join' : 'Sign in and join'}</button>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
