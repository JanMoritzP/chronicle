import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { alertDialog, askText, confirmDialog } from '../lib/dialog'
import { fillQueries, linesOf, queriesIn, resolveRefs, type Selected } from '../lib/macro'
import { useStore } from '../store'
import { sendTable, useTable } from '../tabletop/state'
import type { Macro } from '../types'
import { loadSheet } from './TableSheet'

// Saved chat lines. Each person keeps their own; the GM account can share one with everyone. A macro may ask questions
// (?{Bonus|0}) and use the selected token's numbers (@{selected|str_mod}); each line is then sent as a chat message.

/** The selected token as a macro sees it: its name, hit points, armor class and, if it has one, its sheet. */
async function selectedToken(): Promise<Selected | null> {
  const st = useTable.getState()
  const t = st.tokens.find((x) => x.id === st.selected[0])
  if (!t) return null
  const hp = t.data.hp as { value?: number; max?: number } | undefined
  const sheet = t.pageId ? (await loadSheet(t.pageId)).sheet : null
  return { name: t.name, hp: hp?.value, maxhp: hp?.max, ac: t.data.ac as number | undefined, sheet }
}

/** Keeps a chat message as one of the person's own macros, after asking what to call it. */
export async function saveMessageAsMacro(line: string) {
  const ws = useStore.getState().wsId
  if (!ws) return
  const name = await askText('Name of the macro', { label: 'Name', placeholder: 'Longsword attack', okLabel: 'Save' })
  if (!name?.trim()) return
  try { await api.createMacro(ws, { name: name.trim().slice(0, 60), text: line.slice(0, 2000), shared: false }); window.dispatchEvent(new Event('tt-macros')) } catch (e: any) { await alertDialog(e.message) }
}

export async function runMacro(text: string) {
  const answers: Record<string, string> = {}
  for (const q of queriesIn(text)) {
    const hint = q.options.length > 1 ? `Choose one: ${q.options.join(', ')}` : undefined
    const a = await askText(q.prompt, { label: hint ?? 'Value', initial: q.options[0] ?? '', okLabel: 'Roll' })
    if (a === null) return
    answers[q.raw] = a.trim()
  }
  const { text: filled, missing } = resolveRefs(fillQueries(text, answers), await selectedToken())
  if (missing.length) { await alertDialog(`Select a token first, or check the name: ${missing.join(', ')}`); return }
  for (const line of linesOf(filled)) sendTable({ t: 'chat', text: line })
}

/** A page with the chat of the latest session in it, for the GM to turn into the story of what happened. */
export async function draftRecap() {
  const ws = useStore.getState().wsId
  if (!ws) return
  try {
    const { lines } = await api.sessionRecap(ws)
    if (!lines.length) { await alertDialog('There is nothing in the table chat to make a recap from yet.'); return }
    const [date, ...rest] = lines
    const content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'A first draft from the table chat. Keep what matters and rewrite the rest.' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What happened' }] },
        ...rest.map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] })),
      ],
    }
    await useStore.getState().createPage({ title: `Session recap, ${date.replace(/^\w+day /, '')}`, content })
  } catch (e: any) { await alertDialog(e.message) }
}

export function MacroBar() {
  const wsId = useStore((s) => s.wsId)
  const owner = useStore((s) => s.user?.role === 'owner')
  const [list, setList] = useState<Macro[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Macro | 'new' | null>(null)
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [shared, setShared] = useState(false)
  const load = () => { if (wsId) api.listMacros(wsId).then(setList).catch(() => setList([])) }
  useEffect(load, [wsId])
  useEffect(() => { window.addEventListener('tt-macros', load); return () => window.removeEventListener('tt-macros', load) })

  const edit = (m: Macro | 'new') => { setEditing(m); setName(m === 'new' ? '' : m.name); setText(m === 'new' ? '' : m.text); setShared(m === 'new' ? false : m.shared) }
  const save = async () => {
    if (!wsId || !name.trim() || !text.trim()) return
    try {
      if (editing === 'new') await api.createMacro(wsId, { name: name.trim(), text, shared })
      else if (editing) await api.patchMacro(editing.id, { name: name.trim(), text, shared })
      setEditing(null); load()
    } catch (e: any) { alertDialog(e.message) }
  }

  return (
    <div className="tt-macros">
      <div className="tt-dicebar" role="group" aria-label="Macros">
        {list.filter((m) => !m.name.includes('/')).map((m) => <button key={m.id} className="btn sm" title={m.text} onClick={() => void runMacro(m.text)}>{m.name}</button>)}
        {[...new Set(list.filter((m) => m.name.includes('/')).map((m) => m.name.split('/')[0].trim()))].map((f) => (
          <details key={f} className="tt-macro-folder"><summary className="btn sm">{f}</summary>
            {list.filter((m) => m.name.startsWith(f + '/')).map((m) => <button key={m.id} className="btn sm" title={m.text} onClick={() => void runMacro(m.text)}>{m.name.slice(f.length + 1).trim()}</button>)}
          </details>
        ))}
        <button className="btn sm ghost" aria-expanded={open} onClick={() => setOpen(!open)}><Pencil size={12} /> Macros</button>
      </div>
      {open && (
        <div className="tt-form" role="region" aria-label="Edit macros">
          <ul className="tt-people">
            {list.map((m) => (
              <li key={m.id}>
                <span className="grow">{m.name}{m.shared ? <small className="muted"> shared</small> : null}</span>
                {(m.mine || owner) && <button className="btn ghost sm" aria-label={`Edit ${m.name}`} onClick={() => edit(m)}><Pencil size={12} /></button>}
                {(m.mine || owner) && <button className="btn ghost sm" aria-label={`Delete ${m.name}`} onClick={async () => { if (await confirmDialog(`Delete the macro “${m.name}”?`, { title: 'Delete macro', okLabel: 'Delete', danger: true })) { await api.deleteMacro(m.id).catch((e) => alertDialog(e.message)); load() } }}><Trash2 size={12} /></button>}
              </li>
            ))}
            {!list.length && <li className="muted">No macros yet.</li>}
          </ul>
          {!editing && <button className="btn sm" onClick={() => edit('new')}><Plus size={12} /> New macro</button>}
          {editing && (
            <>
              <input className="input" aria-label="Macro name" placeholder="Name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              <textarea className="input" aria-label="Macro text" rows={4} maxLength={2000} placeholder={'/roll 1d20+@{selected|str_mod}+?{Bonus|0} attack\n/me swings'} value={text} onChange={(e) => setText(e.target.value)} />
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>One chat line per row. ?{'{'}Question|default{'}'} asks when it runs. @{'{'}selected|name{'}'}, hp, maxhp, ac, level, prof, str, str_mod and the other abilities come from the selected token.</p>
              {owner && <label className="tt-check"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />Share with everyone at the table</label>}
              <div className="tt-row">
                <button className="btn sm primary" disabled={!name.trim() || !text.trim()} onClick={save}>Save macro</button>
                <button className="btn sm" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
