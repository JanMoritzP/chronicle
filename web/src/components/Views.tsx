import { Check, Download, FilePlus2, RotateCcw, Search, Trash2, X, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { BackupsSection } from './Backups'
import { ago, unresolvedByName } from '../lib/data'
import { ACTION_LABELS, DEFAULT_BINDINGS, eventToCombo, prettyCombo, type Action } from '../lib/keys'
import { alertDialog, askText, confirmDialog } from '../lib/dialog'
import { FONTS, loadFonts, saveFonts, type FontPrefs } from '../fonts'
import { useStore } from '../store'
import { THEMES, applyTheme } from '../themes'
import { PageIcon } from './TypeIcon'
import { Select } from './Select'
import type { PageMeta, Zettel } from '../types'

function PageCard({ p, lead = false }: { p: PageMeta; lead?: boolean }) {
  const navigate = useStore((s) => s.navigate)
  return (
    <div className={`card ${lead ? 'lead' : ''}`} data-page-id={p.id} onClick={() => navigate({ type: 'page', id: p.id })}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate({ type: 'page', id: p.id }) } }}
      tabIndex={0} role="button" aria-label={p.title || 'Untitled'}
      onAuxClick={(e) => { if (e.button === 1) navigate({ type: 'page', id: p.id }, { newTab: true }) }}>
      <div className="title row" style={{ gap: 6 }}><PageIcon page={p} /> {p.title || 'Untitled'}</div>
      <p>{p.text.slice(0, lead ? 320 : 160) || 'Empty'}</p>
      <div className="card-foot">
        {p.tags.slice(0, 3).map((t) => <span key={t} className="chip">#{t}</span>)}
        <span className="muted card-time">{ago(p.updatedAt)}</span>
      </div>
    </div>
  )
}

export function HomeView() {
  const { data, user, workspaces, wsId } = useStore()
  const recent = useMemo(() => [...data.pages].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12), [data.pages])
  const missing = useMemo(() => [...unresolvedByName(data.links).entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 10), [data.links])
  const unprocessed = data.zettels.filter((z) => !z.processedAt).length
  const readOnly = user?.role === 'viewer'
  const ws = workspaces.find((w) => w.id === wsId)
  if (!ws) return (
    <div className="view">
      <h1>Welcome</h1>
      <p className="muted">Create your first world to get started.</p>
      {!readOnly && <button className="btn primary" onClick={async () => { const n = await askText('New world', { label: 'World name', okLabel: 'Create' }); if (n?.trim()) useStore.getState().createWorkspace(n.trim()) }}>Create world</button>}
    </div>
  )
  const openTodos = data.pages.reduce((n, p) => n + (p.todos ?? 0), 0)
  const navigate = useStore.getState().navigate
  return (
    <div className="view home">
      <header className="home-head">
        <h1>{ws.name}</h1>
        <div className="home-stats muted">
          <span>{data.pages.length} {data.pages.length === 1 ? 'page' : 'pages'}</span>
          <button type="button" className="link-btn" onClick={() => navigate({ type: 'zettels' })}>{unprocessed} unprocessed zettels</button>
          <button type="button" className="link-btn" onClick={() => navigate({ type: 'todos' })}>{openTodos} open {openTodos === 1 ? 'todo' : 'todos'}</button>
        </div>
        {!readOnly && (
          <div className="home-actions">
            <button className="btn primary row" onClick={() => useStore.getState().createPage().catch((e) => alertDialog(e.message))}><FilePlus2 size={15} /> Write a page <kbd className="kbd">Alt N</kbd></button>
            <button className="btn row" onClick={() => useStore.getState().setUi({ captureOpen: true })}><Zap size={15} /> Capture a thought <kbd className="kbd">Alt C</kbd></button>
            <button className="btn row" onClick={() => useStore.getState().setUi({ searchOpen: true, searchInitial: '' })}><Search size={15} /> Find anything <kbd className="kbd">Ctrl K</kbd></button>
          </div>
        )}
      </header>
      {!data.pages.length && <p className="muted home-empty">Nothing here yet. Write your first page, or capture a quick thought and sort it out later.</p>}
      {recent.length > 0 && <><h3 className="home-h">Recently edited</h3><div className="grid home-grid">{recent.map((p, i) => <PageCard key={p.id} p={p} lead={i === 0} />)}</div></>}
      {missing.length > 0 && !readOnly && (
        <>
          <h3 className="home-h">Linked but not written yet</h3>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {missing.map(([name, from]) => (
              <button key={name} className="chip" onClick={() => useStore.getState().createPageFromName(name).then((p) => p && useStore.getState().navigate({ type: 'page', id: p.id }))}>
                {name} · {from.size}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function TagView({ tag }: { tag: string }) {
  const pages = useStore((s) => s.data.pages)
  const list = pages.filter((p) => p.tags.some((t) => t === tag || t.startsWith(`${tag}/`)))
  return (
    <div className="view">
      <h1>#{tag}</h1>
      <div className="grid">{list.map((p) => <PageCard key={p.id} p={p} />)}</div>
      {!list.length && <p className="muted">No pages with this tag.</p>}
    </div>
  )
}

export function ZettelView() {
  const { data, user } = useStore()
  const [showDone, setShowDone] = useState(false)
  const [draft, setDraft] = useState('')
  const readOnly = user?.role === 'viewer'
  const list = data.zettels.filter((z) => showDone || !z.processedAt)

  const promote = async (z: Zettel) => {
    const first = z.body.split('\n')[0].slice(0, 80)
    const title = await askText('Make page from zettel', { label: 'Title for the new page', initial: first, okLabel: 'Create' })
    if (title === null) return
    const content = { type: 'doc', content: z.body.split('\n').map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' })) }
    await useStore.getState().createPage({ title: title.trim() || first, content, tags: z.tags, sourceZettelId: z.id })
  }
  const toggle = async (z: Zettel) => {
    const processed = !z.processedAt
    useStore.getState().updateZettelLocal(z.id, { processedAt: processed ? Date.now() : null })
    await api.patchZettel(z.id, { processed })
  }
  const remove = async (z: Zettel) => {
    if (!(await confirmDialog('Delete this zettel?', { okLabel: 'Delete', danger: true }))) return
    useStore.getState().removeZettelLocal(z.id)
    await api.deleteZettel(z.id)
  }
  return (
    <div className="view">
      <h1>Zettelkasten</h1>
      {!readOnly && (
        <div className="row" style={{ marginBottom: 16, alignItems: 'flex-start' }}>
          <textarea className="input" rows={2} placeholder="Capture a thought… (Ctrl+Enter to save)" aria-label="Capture a thought" value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && draft.trim()) { useStore.getState().addZettel(draft.trim(), []); setDraft('') } }} />
          <button className="btn primary" disabled={!draft.trim()} onClick={() => { useStore.getState().addZettel(draft.trim(), []); setDraft('') }}>Add</button>
        </div>
      )}
      <label className="row muted" style={{ marginBottom: 12 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show processed zettels</label>
      <div style={{ display: 'grid', gap: 8 }}>
        {list.map((z) => {
          const page = z.pageId ? data.pages.find((p) => p.id === z.pageId) : null
          return (
            <div key={z.id} className={`zettel ${z.processedAt ? 'done' : ''}`}>
              <p>{z.body}</p>
              <div className="row muted" style={{ fontSize: 12.5 }}>
                <span>{ago(z.createdAt)}</span>
                {z.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
                {page && <a data-page-id={page.id} style={{ cursor: 'pointer' }} onClick={() => useStore.getState().navigate({ type: 'page', id: page.id })}>→ {page.title || 'Untitled'}</a>}
                <span className="grow" />
                {!readOnly && !z.pageId && <button className="btn sm" onClick={() => promote(z)}>Make page</button>}
                {!readOnly && <button className="icon-btn" title={z.processedAt ? 'Mark unread' : 'Mark as read'} onClick={() => toggle(z)}>{z.processedAt ? <RotateCcw size={15} /> : <Check size={15} />}</button>}
                {!readOnly && <button className="icon-btn" title="Delete" onClick={() => remove(z)}><X size={15} /></button>}
              </div>
            </div>
          )
        })}
        {!list.length && <p className="muted">Inbox zero. {data.zettels.length ? 'Tick “show processed” to see old zettels.' : 'Capture anything with Alt+C.'}</p>}
      </div>
    </div>
  )
}

export function TrashView() {
  const wsId = useStore((s) => s.wsId)!
  const [items, setItems] = useState<any[]>([])
  const load = () => api.trash(wsId).then(setItems)
  useEffect(() => { load() }, [wsId])
  const readOnly = useStore((s) => s.user?.role === 'viewer')
  return (
    <div className="view">
      <h1>Trash</h1>
      <table className="simple"><tbody>
        {items.map((p) => (
          <tr key={p.id}>
            <td>{p.title || 'Untitled'}</td>
            <td className="muted">deleted {ago(p.deletedAt)}</td>
            <td style={{ textAlign: 'right' }}>
              {!readOnly && <>
                <button className="btn sm" onClick={async () => { await api.restorePage(p.id); await useStore.getState().refresh(); load() }}>Restore</button>{' '}
                <button className="btn sm danger" onClick={async () => { if (await confirmDialog('This page is deleted forever.', { title: 'Delete forever?', okLabel: 'Delete', danger: true })) { await api.purgePage(p.id); load() } }} title="Delete forever" aria-label="Delete forever"><Trash2 size={13} /></button>
              </>}
            </td>
          </tr>
        ))}
      </tbody></table>
      {!items.length && <p className="muted">Trash is empty.</p>}
    </div>
  )
}

function KeyEditor({ action }: { action: Action }) {
  const bindings = useStore((s) => s.bindings)
  const [rec, setRec] = useState(false)
  const set = (list: string[]) => useStore.getState().setBindings({ ...bindings, [action]: list })
  useEffect(() => {
    if (!rec) return
    const h = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') return setRec(false)
      const c = eventToCombo(e)
      if (!c) return
      set([...new Set([...bindings[action], c])])
      setRec(false)
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [rec, bindings])
  return (
    <tr>
      <td>{ACTION_LABELS[action]}</td>
      <td>
        {bindings[action].map((c) => (
          <span key={c} className="chip" style={{ marginRight: 4 }}>{prettyCombo(c)} <button onClick={() => set(bindings[action].filter((x) => x !== c))}>×</button></span>
        ))}
        <button className="btn sm" onClick={() => setRec(true)}>{rec ? 'Press keys… (Esc cancels)' : '+ Add'}</button>
        {JSON.stringify(bindings[action]) !== JSON.stringify(DEFAULT_BINDINGS[action]) && <button className="btn sm ghost" onClick={() => set(DEFAULT_BINDINGS[action])}>Reset</button>}
      </td>
    </tr>
  )
}

function SharedPages() {
  const wsId = useStore((s) => s.wsId)!
  const readOnly = useStore((s) => s.user?.role === 'viewer')
  const [rows, setRows] = useState<{ token: string; pageId: string; title: string }[]>([])
  const load = () => api.shares(wsId).then(setRows).catch(() => {})
  useEffect(() => { load() }, [wsId])
  return (
    <>
      <h3 className="muted" style={{ marginTop: 28 }}>Publicly shared pages</h3>
      {!rows.length && <p className="muted" style={{ fontSize: 13 }}>Nothing is shared. Use a page’s … menu → Share publicly.</p>}
      <table className="simple"><tbody>
        {rows.map((r) => (
          <tr key={r.token}>
            <td><a style={{ cursor: 'pointer' }} onClick={() => useStore.getState().navigate({ type: 'page', id: r.pageId })}>{r.title || 'Untitled'}</a></td>
            <td className="muted" style={{ fontSize: 12 }}>{location.origin}/s/{r.token}</td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              <button className="btn sm" onClick={() => navigator.clipboard?.writeText(`${location.origin}/s/${r.token}`)}>Copy link</button>
              {!readOnly && <> <button className="btn sm danger" onClick={async () => { await api.unshare(r.pageId); load() }}>Stop</button></>}
            </td>
          </tr>
        ))}
      </tbody></table>
    </>
  )
}

function PasswordForm() {
  const [f, setF] = useState({ current: '', next: '', again: '' })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const submit = async () => {
    if (f.next !== f.again) return setMsg({ ok: false, text: 'The two new passwords differ' })
    try { await api.changePassword(f.current, f.next); setF({ current: '', next: '', again: '' }); setMsg({ ok: true, text: 'Password changed. Other devices were logged out.' }) }
    catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  return (
    <>
      <h3 className="muted" style={{ marginTop: 28 }}>Change my password</h3>
      <form className="row" style={{ flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); submit() }}>
        <input className="input" style={{ width: 170 }} type="password" autoComplete="current-password" placeholder="current password" aria-label="Current password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        <input className="input" style={{ width: 170 }} type="password" autoComplete="new-password" placeholder="new (8+)" aria-label="New password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        <input className="input" style={{ width: 170 }} type="password" autoComplete="new-password" placeholder="new again" aria-label="New password confirmation" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />
        <button className="btn" disabled={!f.current || !f.next}>Change</button>
      </form>
      {msg && <div className={msg.ok ? 'muted' : 'error'} style={{ marginTop: 6 }}>{msg.text}</div>}
    </>
  )
}

function FontPicker({ label, value, extra, onChange }: { label: string; value: string; extra?: { id: string; name: string }[]; onChange: (v: string) => void }) {
  const known = FONTS.some((f) => f.id === value) || extra?.some((e) => e.id === value)
  const [custom, setCustom] = useState(!known)
  return (
    <div className="field" style={{ minWidth: 230 }}>
      <span>{label}</span>
      <Select className="input" value={custom ? '__custom' : value} onChange={(v) => {
        if (v === '__custom') { setCustom(true); onChange(known ? '' : value) } else { setCustom(false); onChange(v) }
      }} aria-label={label} title={label}>
        {extra?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        {FONTS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        <option value="__custom">Custom font name…</option>
      </Select>
      {custom && <input className="input" style={{ marginTop: 4 }} value={value} placeholder='e.g. "Fira Sans", Arial' onChange={(e) => onChange(e.target.value)} />}
    </div>
  )
}

function FontSettings() {
  const [p, setP] = useState<FontPrefs>(loadFonts)
  const set = (patch: Partial<FontPrefs>) => { const n = { ...p, ...patch }; setP(n); saveFonts(n) }
  return (
    <>
      <h3 className="muted" style={{ marginTop: 28 }}>Font</h3>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 }}>
        <FontPicker label="Interface" value={p.ui} onChange={(v) => set({ ui: v })} />
        <FontPicker label="Page text" value={p.body} extra={[{ id: 'same', name: 'Same as interface' }]} onChange={(v) => set({ body: v })} />
        <label className="field" style={{ width: 200 }}>
          <span>Text size: {p.size}%</span>
          <input type="range" min={80} max={140} step={5} value={p.size} onChange={(e) => set({ size: Number(e.target.value) })} />
        </label>
      </div>
      <p className="font-sample muted">The quick brown fox jumps over the lazy dog. 0123456789</p>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>Custom names must be installed on this device. Stored per device, not per account.</p>
    </>
  )
}

// The desktop app adds this token to its user agent; its window opens the address below to start an update check (see electron/main.js).
const IN_DESKTOP_APP = /ChronicleDesktop\//.test(navigator.userAgent)

function DesktopSettings() {
  if (!IN_DESKTOP_APP) return null
  return (
    <>
      <h3 className="muted" style={{ marginTop: 28 }}>Desktop app</h3>
      <p>
        <button className="btn sm" onClick={() => window.open('chronicle-desktop://check-updates')}>Check for updates</button>
        <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>The app also looks by itself a few seconds after it starts and every six hours.</span>
      </p>
    </>
  )
}

function WorldOptions({ id }: { id: string }) {
  const world = useStore((s) => s.workspaces.find((w) => w.id === id))
  const readOnly = useStore((s) => s.user?.role === 'viewer')
  const owner = useStore((s) => s.account?.role === 'owner')
  const saved = world?.settings?.newPageTodo ?? 'Fill me'
  const [text, setText] = useState(saved)
  useEffect(() => setText(saved), [id, saved])
  if (!world) return null
  const save = () => {
    if (text === saved) return
    useStore.getState().setWorldSettings(id, { newPageTodo: text.trim() }).catch((e) => alertDialog(e.message))
  }
  return (
    <div style={{ marginTop: 14 }}>
      <label className="field" style={{ maxWidth: 420 }}>
        <span>Todo every new page starts with</span>
        <input className="input" value={text} disabled={readOnly} placeholder="Fill me" onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
      </label>
      <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>Added to each new page in “{world.name}”. Leave it empty to start pages without one.</p>
      {owner && (
        <p style={{ marginTop: 14 }}>
          <button className="btn sm danger" onClick={async () => {
            if (!(await confirmDialog(`Delete the world “${world.name}”? Its pages, maps, templates and everything else in it disappear from the app. Export it first if you may want it back.`, { okLabel: 'Delete world', danger: true }))) return
            useStore.getState().deleteWorkspace(id).catch((e) => alertDialog(e.message))
          }}>Delete this world</button>
        </p>
      )}
    </div>
  )
}

export function SettingsView() {
  const { user, workspaces, wsId } = useStore()
  const [theme, setTheme] = useState(document.documentElement.dataset.theme)
  const [users, setUsers] = useState<any[]>([])
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer' })
  const [msg, setMsg] = useState('')
  const owner = user?.role === 'owner'
  const loadUsers = () => api.users().then(setUsers)
  useEffect(() => { if (owner) loadUsers() }, [owner])

  return (
    <div className="view">
      <h1>Settings</h1>
      <h3 className="muted">Theme</h3>
      <div className="swatches">
        {THEMES.map((t) => (
          <button key={t.id} className={`theme-card ${theme === t.id ? 'on' : ''}`} onClick={() => { applyTheme(t.id); setTheme(t.id) }} aria-label={theme === t.id ? `Selected: ${t.name}` : `Switch to ${t.name} theme`} aria-pressed={theme === t.id}>
            <div className="bars" style={{ background: t.swatch[0] }}><i style={{ background: t.swatch[0] }} /><i style={{ background: t.swatch[1] }} /><i style={{ background: t.swatch[2] }} /></div>
            <span>{t.name}</span>
          </button>
        ))}
      </div>

      <FontSettings />

      <DesktopSettings />

      <h3 className="muted" style={{ marginTop: 28 }}>Worlds</h3>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {workspaces.map((w) => <button key={w.id} className={`btn ${w.id === wsId ? 'primary' : ''}`} onClick={() => useStore.getState().selectWorkspace(w.id)}>{w.name}</button>)}
        {user?.role !== 'viewer' && <button className="btn ghost" onClick={async () => { const n = await askText('New world', { label: 'World name', okLabel: 'Create' }); if (n?.trim()) useStore.getState().createWorkspace(n.trim()) }}>+ New world</button>}
      </div>
      {wsId && <WorldOptions id={wsId} />}
      {wsId && (
        <p style={{ marginTop: 10 }}>
          <a className="btn sm" href={`/api/workspaces/${wsId}/export`} download><Download size={13} style={{ verticalAlign: -2 }} /> Export this world (.zip)</a>
          <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>Markdown pages in their folders, images, and world.json with everything else.</span>
        </p>
      )}

      <SharedPages />

      <h3 className="muted" style={{ marginTop: 28 }}>Keyboard shortcuts</h3>
      <p className="muted" style={{ fontSize: 13 }}>On a German keyboard AltGr counts as Ctrl+Alt, so typing <kbd>{'{'}</kbd> and <kbd>{'}'}</kbd> never triggers shortcuts that need other keys. Mouse back/forward buttons also work.</p>
      <table className="simple"><tbody>{(Object.keys(ACTION_LABELS) as Action[]).map((a) => <KeyEditor key={a} action={a} />)}</tbody></table>

      {owner && (
        <>
          <h3 className="muted" style={{ marginTop: 28 }}>Accounts</h3>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>New accounts can open every world. To limit a person to some worlds, use the admin dashboard.</p>
          <table className="simple"><tbody>
            {users.map((u) => (
              <tr key={u.id}><td>{u.username}</td><td className="muted">{u.role}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{u.id !== user!.id && <button className="btn sm" onClick={async () => { const p = await askText(`New password for ${u.username}`, { label: '8+ characters. They will be logged out everywhere.', okLabel: 'Set password' }); if (p) { try { await api.setUserPassword(u.id, p); alertDialog('Password set.') } catch (e: any) { alertDialog(e.message) } } }}>Set password</button>}{' '}{u.id !== user!.id && <button className="btn sm danger" onClick={async () => { if (await confirmDialog(`Delete ${u.username}?`, { okLabel: 'Delete', danger: true })) { await api.deleteUser(u.id); loadUsers() } }}>Remove</button>}</td></tr>
            ))}
          </tbody></table>
          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <input className="input" style={{ width: 150 }} placeholder="username" aria-label="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <input className="input" style={{ width: 170 }} type="password" placeholder="password (8+)" aria-label="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <Select className="input" style={{ width: 120 }} value={form.role} onChange={(v) => setForm({ ...form, role: v })} aria-label="User role" title="User role"><option value="viewer">Viewer</option><option value="editor">Editor</option></Select>
            <button className="btn primary" onClick={async () => { try { await api.createUser(form); setForm({ username: '', password: '', role: 'viewer' }); setMsg(''); loadUsers() } catch (e: any) { setMsg(e.message) } }}>Add account</button>
          </div>
          {msg && <div className="error">{msg}</div>}

          <BackupsSection />
        </>
      )}
      <PasswordForm />
      <div style={{ marginTop: 28 }}><button className="btn" onClick={() => useStore.getState().logout()}>Log out ({user?.username})</button></div>
    </div>
  )
}
