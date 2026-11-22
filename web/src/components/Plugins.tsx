import { useEffect, useState } from 'react'
import { api } from '../api'
import { alertDialog } from '../lib/dialog'
import type { PluginInfo } from '../types'

type Draft = Record<string, string | number | boolean>

function PluginCard({ plugin, onChange }: { plugin: PluginInfo; onChange: (p: PluginInfo) => void }) {
  const initial = (): Draft => Object.fromEntries(plugin.config.map((f) => [f.key, f.value]))
  const [draft, setDraft] = useState<Draft>(initial)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const dirty = plugin.config.some((f) => draft[f.key] !== f.value)

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setMsg('')
    try { await fn() } catch (e: any) { await alertDialog(e.message) }
    setBusy('')
  }
  const toggle = () => run('toggle', async () => {
    if (dirty) await api.patchPlugin(plugin.id, { config: draft })
    onChange(await api.patchPlugin(plugin.id, { enabled: !plugin.enabled }))
  })
  const save = () => run('save', async () => { onChange(await api.patchPlugin(plugin.id, { config: draft })); setMsg('Saved.') })

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>{plugin.name} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{plugin.version}{plugin.bundled ? ' · ships with Chronicle' : ''}</span></strong>
        <button className={`btn sm${plugin.enabled ? '' : ' primary'}`} disabled={!!busy} onClick={toggle}>{plugin.enabled ? 'Turn off' : 'Turn on'}</button>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>{plugin.description}</p>
      {plugin.active && plugin.status && <p style={{ fontSize: 13 }}>{plugin.status}</p>}
      {plugin.error && <div className="error">{plugin.error}</div>}
      {plugin.config.map((f) => (
        <label key={f.key} style={{ display: 'block', margin: '8px 0' }}>
          {f.type === 'boolean' ? (
            <><input type="checkbox" checked={!!draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })} /> {f.label}</>
          ) : (
            <>
              <div style={{ fontSize: 13 }}>{f.label}</div>
              <input
                type={f.type === 'number' ? 'number' : 'text'} style={{ width: '100%' }} placeholder={f.placeholder} value={String(draft[f.key] ?? '')}
                onChange={(e) => setDraft({ ...draft, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
              />
            </>
          )}
          {f.help && <div className="muted" style={{ fontSize: 12 }}>{f.help}</div>}
        </label>
      ))}
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {plugin.config.length > 0 && <button className="btn sm" disabled={!dirty || !!busy} onClick={save}>Save settings</button>}
        {plugin.active && plugin.actions.map((a) => (
          <button key={a.route} className="btn sm" title={a.help} disabled={!!busy} onClick={() => run(a.route, async () => { const r = await api.pluginAction(plugin.id, a.route); setMsg(r.message ?? 'Done.'); onChange((await api.plugins()).find((p) => p.id === plugin.id) ?? plugin) })}>{a.label}</button>
        ))}
      </div>
      {msg && <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>{msg}</div>}
    </div>
  )
}

/** Owner only: the plugins found on this server, their settings, and the switch that starts them. */
export function PluginsSection() {
  const [list, setList] = useState<PluginInfo[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.plugins().then(setList).catch((e) => setErr(e.message)) }, [])
  const replace = (p: PluginInfo) => setList((l) => (l ?? []).map((x) => (x.id === p.id ? p : x)))

  return (
    <>
      <p className="muted" style={{ fontSize: 13 }}>
        A plugin is a folder with a plugin.json and a small program. It runs inside the server with full access to it, so turn on only plugins you trust. Put your own in the plugins folder of the data directory and reload this page.
      </p>
      {err && <div className="error">{err}</div>}
      {list && list.length === 0 && <p className="muted">No plugins found.</p>}
      {list?.map((p) => <PluginCard key={p.id} plugin={p} onChange={replace} />)}
    </>
  )
}
