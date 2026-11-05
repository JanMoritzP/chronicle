import { Copy, Plus, Shapes, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../api'
import { confirmDialog, askText } from '../lib/dialog'
import { SAMPLE_SOURCE, parseSource, resolveTypes, type ResolvedType } from '../lib/pageTypes'
import { useStore } from '../store'
import { TypeIcon, TYPE_ICONS, useTypes } from './TypeIcon'
import { TypeLayout } from './TypeLayout'

export function PageTypesView() {
  const types = useTypes()
  const readOnly = useStore((s) => s.user?.role === 'viewer')
  const navigate = useStore((s) => s.navigate)
  const wsId = useStore((s) => s.wsId)!
  const pages = useStore((s) => s.data.pages)
  const [error, setError] = useState('')

  const create = async (from?: ResolvedType) => {
    const name = (await askText(from ? `Copy of “${from.name}”` : 'New page type', { label: 'Name', initial: from ? `${from.name} copy` : '', okLabel: 'Create' }))?.trim()
    if (!name) return
    try {
      const source = from?.source ?? SAMPLE_SOURCE
      const t = await api.createPageType(wsId, { name, icon: from?.icon ?? 'shapes', tag: name.toLowerCase().replace(/\s+/g, '-'), source, definition: parseSource(source) })
      useStore.getState().upsertPageType(t)
      navigate({ type: 'pagetype', id: t.id })
    } catch (e: any) { setError(e.message) }
  }

  return (
    <div className="view">
      <h1 style={{ marginTop: 0 }}><Shapes size={26} style={{ verticalAlign: -3 }} /> Special pages</h1>
      <p className="muted">
        A special page has a fixed layout (portrait, stat block, fact sheet…) next to its normal text, and is tagged automatically.
        Create one from the <b>New special page</b> menu in the sidebar. Write your own layout as JSON, YAML or Markdown front matter.
      </p>
      {!readOnly && <p><button className="btn primary" onClick={() => create()}><Plus size={14} style={{ verticalAlign: -2 }} /> New custom type</button></p>}
      {error && <div className="error">{error}</div>}
      {types.map((t) => {
        const count = pages.filter((p) => p.type === t.id).length
        return (
          <div key={t.id} className="todo-row" style={{ cursor: t.builtin ? 'default' : 'pointer' }} onClick={() => navigate({ type: 'pagetype', id: t.id })}>
            <TypeIcon name={t.icon} size={20} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div><b>{t.name}</b> {t.tag && <span className="chip">#{t.tag}</span>} {t.builtin && <span className="muted" style={{ fontSize: 12 }}>built-in</span>}</div>
              <div className="muted todo-context">{count} page{count === 1 ? '' : 's'}</div>
            </div>
            {!readOnly && <button className="btn sm" onClick={(e) => { e.stopPropagation(); useStore.getState().createPage({ type: t.id }) }}>New page</button>}
          </div>
        )
      })}
    </div>
  )
}

export function PageTypeEditor({ id }: { id: string }) {
  const custom = useStore((s) => s.data.pageTypes)
  const loaded = useStore((s) => s.loaded)
  const type = useMemo(() => resolveTypes(custom).find((t) => t.id === id), [custom, id])
  if (!type) return <div className="view muted">{loaded ? 'This page type no longer exists.' : 'Loading…'}</div>
  return <PageTypeBody key={type.id} type={type} />
}

function PageTypeBody({ type }: { type: ResolvedType }) {
  const readOnly = useStore((s) => s.user?.role === 'viewer') || type.builtin
  const editorRole = useStore((s) => s.user?.role !== 'viewer')
  const navigate = useStore((s) => s.navigate)
  const wsId = useStore((s) => s.wsId)!
  const [name, setName] = useState(type.name)
  const [icon, setIcon] = useState(type.icon)
  const [tag, setTag] = useState(type.tag)
  const [source, setSource] = useState(type.source)
  const [saved, setSaved] = useState({ name: type.name, icon: type.icon, tag: type.tag, source: type.source })
  const [error, setError] = useState('')

  const parsed = useMemo(() => { try { return { layout: parseSource(source), err: '' } } catch (e: any) { return { layout: null, err: e.message as string } } }, [source])
  const dirty = name !== saved.name || icon !== saved.icon || tag !== saved.tag || source !== saved.source
  const [previewData, setPreviewData] = useState<Record<string, any>>({})

  const save = async () => {
    if (!parsed.layout) return
    try {
      const t = await api.patchPageType(type.id, { name: name.trim() || type.name, icon, tag, source, definition: parsed.layout })
      useStore.getState().upsertPageType(t)
      setSaved({ name, icon, tag, source })
      setError('')
    } catch (e: any) { setError(e.message) }
  }

  return (
    <div>
      <div className="toolbar">
        <a className="muted grow" style={{ fontSize: 13, cursor: 'pointer' }} onClick={() => navigate({ type: 'pagetypes' })}>Special pages /</a>
        {!readOnly && <span className="save-state">{dirty ? 'Unsaved changes' : 'Saved'}</span>}
        {editorRole && (
          <button className="btn sm" onClick={async () => {
            const n = (await askText('Copy this type', { label: 'Name', initial: `${type.name} copy`, okLabel: 'Create' }))?.trim()
            if (!n) return
            try {
              const t = await api.createPageType(wsId, { name: n, icon, tag: n.toLowerCase().replace(/\s+/g, '-'), source, definition: parsed.layout ?? {} })
              useStore.getState().upsertPageType(t)
              navigate({ type: 'pagetype', id: t.id })
            } catch (e: any) { setError(e.message) }
          }}><Copy size={13} style={{ verticalAlign: -2 }} /> Duplicate</button>
        )}
        {!readOnly && <button className="btn primary sm" disabled={!dirty || !parsed.layout} onClick={save}>Save</button>}
        {!readOnly && (
          <button className="icon-btn" title="Delete this type" onClick={async () => {
            if (!(await confirmDialog(`Delete the page type “${type.name}”? Pages that use it become plain pages; their text is kept.`, { title: 'Delete page type', okLabel: 'Delete', danger: true }))) return
            await api.deletePageType(type.id)
            useStore.getState().removePageTypeLocal(type.id)
            navigate({ type: 'pagetypes' })
          }}><Trash2 size={16} /></button>
        )}
      </div>
      <div className="page" style={{ maxWidth: 1100 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <TypeIcon name={icon} size={28} />
          <input className="page-title" style={{ margin: 0 }} value={name} readOnly={readOnly} placeholder="Type name" onChange={(e) => setName(e.target.value)} />
        </div>
        {type.builtin && <p className="muted">Built-in types can't be edited. Use <b>Duplicate</b> to make your own version.</p>}
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start', gap: 20 }}>
          <label className="field" style={{ width: 200 }}>
            <span>Automatic tag</span>
            <input className="input" value={tag} readOnly={readOnly} placeholder="(none)" onChange={(e) => setTag(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/^#/, ''))} />
            <small className="muted">Added to every page of this type.</small>
          </label>
          <div className="field grow">
            <span>Icon</span>
            <div className="icon-grid">
              {Object.keys(TYPE_ICONS).map((k) => (
                <button key={k} className={`icon-btn ${icon === k ? 'on' : ''}`} disabled={readOnly} title={k} onClick={() => setIcon(k)}><TypeIcon name={k} size={17} /></button>
              ))}
            </div>
          </div>
        </div>
        <div className="pt-split">
          <div className="field">
            <span>Layout (JSON, YAML, or Markdown with front matter)</span>
            <textarea className="input pt-source" spellCheck={false} value={source} readOnly={readOnly} onChange={(e) => setSource(e.target.value)} />
            {parsed.err ? <div className="error">{parsed.err}</div> : <small className="muted">Valid. Zones: top, side, main, bottom. Blocks: image, statblock, fields, body.</small>}
            {error && <div className="error">{error}</div>}
          </div>
          <div className="field">
            <span>Preview</span>
            <div className="pt-preview">
              {parsed.layout ? (
                <TypeLayout layout={parsed.layout} data={previewData} readOnly={false}
                  setValue={(k, v) => setPreviewData((d) => ({ ...d, [k]: v }))}
                  pickImage={async () => null}
                  body={<div className="muted" style={{ padding: '8px 0' }}>The normal page text goes here.</div>} />
              ) : <div className="muted">Fix the error to see a preview.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
