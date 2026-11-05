import { ArrowDown, ArrowUp, Copy, Plus, Shapes, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../api'
import { TEMPLATES } from '../editor/templates'
import { useTemplates } from '../editor/useTemplates'
import { alertDialog, confirmDialog, askText } from '../lib/dialog'
import { SHAPES, SAMPLE_SOURCE, duplicateKeys, freshKey, layoutKeys, layoutToSource, parseSource, resolveTypes, type Block, type FieldDef, type Layout, type ResolvedType } from '../lib/pageTypes'
import { useStore } from '../store'
import { Select } from './Select'
import { TypeIcon, TYPE_ICONS, useTypes } from './TypeIcon'
import { TypeLayout } from './TypeLayout'

export function PageTypesView() {
  const types = useTypes()
  const readOnly = useStore((s) => s.user?.role === 'viewer')
  const navigate = useStore((s) => s.navigate)
  const pages = useStore((s) => s.data.pages)
  const [error, setError] = useState('')

  const create = async (from?: ResolvedType) => {
    const name = (await askText(from ? `Copy of “${from.name}”` : 'New page type', { label: 'Name', initial: from ? `${from.name} copy` : '', okLabel: 'Create' }))?.trim()
    if (!name) return
    try {
      const wsId = await useStore.getState().ensureWorkspace()
      if (!wsId) return
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
        Create one from the <b>New special page</b> menu in the sidebar. Design your own layout with the designer, or as JSON, YAML or Markdown front matter.
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
            {!readOnly && <button className="btn sm" onClick={(e) => { e.stopPropagation(); useStore.getState().createPage({ type: t.id }).catch((er) => alertDialog(er.message)) }}>New page</button>}
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

type ZoneName = 'top' | 'side' | 'main' | 'bottom'
const ZONES: { key: ZoneName; title: string }[] = [
  { key: 'top', title: 'Top' },
  { key: 'side', title: 'Side' },
  { key: 'main', title: 'Main' },
  { key: 'bottom', title: 'Bottom' },
]
const BLOCK_LABEL: Record<Block['type'], string> = { image: 'Image', statblock: 'Stat block', fields: 'Fields', body: 'Text' }

const move = <T,>(list: T[], i: number, d: number): T[] => {
  const j = i + d
  if (j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

function newBlock(kind: Block['type'], layout: Layout): Block {
  switch (kind) {
    case 'image': return { type: 'image', key: freshKey(layout, 'portrait'), shape: 'square' }
    case 'statblock': return { type: 'statblock', key: freshKey(layout, 'main'), template: TEMPLATES[0].id }
    case 'fields': return { type: 'fields', fields: [{ key: freshKey(layout, 'field'), label: 'New field' }] }
    default: return { type: 'body' }
  }
}

function PageTypeBody({ type }: { type: ResolvedType }) {
  const readOnly = useStore((s) => s.user?.role === 'viewer') || type.builtin
  const editorRole = useStore((s) => s.user?.role !== 'viewer')
  const navigate = useStore((s) => s.navigate)
  const wsId = useStore((s) => s.wsId)!
  const [name, setName] = useState(type.name)
  const [icon, setIcon] = useState(type.icon)
  const [tag, setTag] = useState(type.tag)
  const [layout, setLayout] = useState<Layout>(type.layout)
  const [source, setSource] = useState(type.source)
  const [saved, setSaved] = useState({ name: type.name, icon: type.icon, tag: type.tag, layout: type.layout, source: type.source })
  const [mode, setMode] = useState<'visual' | 'source'>('visual')
  const [srcErr, setSrcErr] = useState('')
  const [error, setError] = useState('')
  const [previewData, setPreviewData] = useState<Record<string, any>>({})

  const dups = useMemo(() => duplicateKeys(layout), [layout])
  const noKey = useMemo(() => layoutKeys(layout).some((k) => !k.trim()), [layout])
  const dirty = name !== saved.name || icon !== saved.icon || tag !== saved.tag || source !== saved.source || JSON.stringify(layout) !== JSON.stringify(saved.layout)
  const canSave = dirty && !srcErr && !dups.length && !noKey && name.trim().length > 0

  /** Designer edits keep the stored source in step, as canonical YAML. */
  const editLayout = (l: Layout) => { setLayout(l); setSource(layoutToSource(l)) }

  const setColumns = (c: Layout['columns']) => {
    // normalizeLayout merges the side into main for single columns; do it here so a reload can never change what the designer shows
    if (c === 'single') editLayout({ ...layout, columns: c, main: [...layout.side, ...layout.main], side: [] })
    else editLayout({ ...layout, columns: c })
  }

  const onSource = (text: string) => {
    setSource(text)
    try { setLayout(parseSource(text)); setSrcErr('') } catch (e: any) { setSrcErr(e.message) }
  }

  const switchMode = (m: 'visual' | 'source') => {
    // leaving source mode discards any broken text: the designer works on the last valid layout
    if (m === 'source') setSource(layoutToSource(layout))
    setSrcErr('')
    setMode(m)
  }

  const save = async () => {
    try {
      const t = await api.patchPageType(type.id, { name: name.trim() || type.name, icon, tag, source, definition: layout })
      useStore.getState().upsertPageType(t)
      setSaved({ name, icon, tag, layout, source })
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
              const t = await api.createPageType(wsId, { name: n, icon, tag: n.toLowerCase().replace(/\s+/g, '-'), source, definition: layout })
              useStore.getState().upsertPageType(t)
              navigate({ type: 'pagetype', id: t.id })
            } catch (e: any) { setError(e.message) }
          }}><Copy size={13} style={{ verticalAlign: -2 }} /> Duplicate</button>
        )}
        {!readOnly && <button className="btn primary sm" disabled={!canSave} onClick={save}>Save</button>}
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
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Layout</span>
              <span className="seg">
                <button className={mode === 'visual' ? 'on' : ''} onClick={() => switchMode('visual')}>Designer</button>
                <button className={mode === 'source' ? 'on' : ''} onClick={() => switchMode('source')}>Source</button>
              </span>
            </div>
            {mode === 'visual' ? (
              <>
                <fieldset className="sd-set" disabled={readOnly}>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
                    <label className="field" style={{ width: 190 }}>
                      <span>Columns</span>
                      <Select className="input" value={layout.columns} onChange={(v) => setColumns(v as Layout['columns'])}>
                        <option value="single">One column</option>
                        <option value="side-right">Side on the right</option>
                        <option value="side-left">Side on the left</option>
                      </Select>
                    </label>
                    <label className="field" style={{ width: 140 }}>
                      <span>Side width (px)</span>
                      <input className="input" type="number" min={160} max={520} disabled={layout.columns === 'single'} value={layout.sideWidth} onChange={(e) => editLayout({ ...layout, sideWidth: Math.min(520, Math.max(160, Math.round(Number(e.target.value) || 280))) })} />
                    </label>
                  </div>
                </fieldset>
                {ZONES.map((z) => (
                  <ZoneEditor key={z.key} zone={z.key} title={z.title} layout={layout} readOnly={readOnly} onChange={editLayout}
                    hint={z.key === 'side' ? (layout.columns === 'single' ? 'unused with one column' : `narrow column, ${layout.sideWidth} px`) : z.key === 'main' ? 'wide column' : 'full width'} />
                ))}
              </>
            ) : (
              <>
                <textarea className="input pt-source" spellCheck={false} value={source} readOnly={readOnly} onChange={(e) => onSource(e.target.value)} />
                {srcErr
                  ? <div className="error">{srcErr}</div>
                  : <small className="muted">JSON, YAML, or Markdown with this as front matter. Zones: top, side, main, bottom. Blocks: image, statblock, fields, body.</small>}
              </>
            )}
            {dups.length > 0 && <div className="error">Each value needs its own key. Used twice: {dups.join(', ')}.</div>}
            {noKey && <div className="error">Every image, stat block and field needs a key.</div>}
            {error && <div className="error">{error}</div>}
          </div>
          <div className="field">
            <span>Preview (try it out)</span>
            <div className="pt-preview">
              <TypeLayout layout={layout} data={previewData} readOnly={false}
                setValue={(k, v) => setPreviewData((d) => ({ ...d, [k]: v }))}
                pickImage={async () => null}
                body={<div className="muted" style={{ padding: '8px 0' }}>The normal page text goes here.</div>} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ZoneEditor({ zone, title, hint, layout, readOnly, onChange }: { zone: ZoneName; title: string; hint: string; layout: Layout; readOnly: boolean; onChange: (l: Layout) => void }) {
  const blocks = layout[zone]
  const set = (bs: Block[]) => onChange({ ...layout, [zone]: bs })
  return (
    <fieldset className="sd-set" disabled={readOnly}>
      <div className="sd-head">
        <b className="grow">{title}</b>
        <span className="muted sd-hint">{hint}</span>
      </div>
      {blocks.map((b, i) => (
        <BlockEditor key={i} b={b} zone={zone} layout={layout}
          onChange={(nb) => set(blocks.map((x, j) => (j === i ? nb : x)))}
          onRemove={() => set(blocks.filter((_, j) => j !== i))}
          onMove={(d) => set(move(blocks, i, d))}
          onZone={(z) => z !== zone && onChange({ ...layout, [zone]: blocks.filter((_, j) => j !== i), [z]: [...layout[z], b] })} />
      ))}
      {!readOnly && (
        <div className="sd-add">
          <span className="muted">Add:</span>
          <button className="btn sm" onClick={() => set([...blocks, newBlock('image', layout)])}><Plus size={12} style={{ verticalAlign: -1 }} /> Image</button>
          <button className="btn sm" onClick={() => set([...blocks, newBlock('statblock', layout)])}><Plus size={12} style={{ verticalAlign: -1 }} /> Stat block</button>
          <button className="btn sm" onClick={() => set([...blocks, newBlock('fields', layout)])}><Plus size={12} style={{ verticalAlign: -1 }} /> Fields</button>
          <button className="btn sm" onClick={() => set([...blocks, newBlock('body', layout)])}><Plus size={12} style={{ verticalAlign: -1 }} /> Text</button>
        </div>
      )}
    </fieldset>
  )
}

function BlockEditor({ b, zone, layout, onChange, onRemove, onMove, onZone }: { b: Block; zone: ZoneName; layout: Layout; onChange: (b: Block) => void; onRemove: () => void; onMove: (d: number) => void; onZone: (z: ZoneName) => void }) {
  const templates = useTemplates()
  return (
    <div className="sd-card">
      <div className="sd-head">
        <b className="grow">{BLOCK_LABEL[b.type]}</b>
        <Select className="input sd-zone" title="Move to another zone" value={zone} onChange={(v) => onZone(v as ZoneName)}>
          {ZONES.map((z) => <option key={z.key} value={z.key}>{z.title}</option>)}
        </Select>
        <button className="icon-btn" title="Move up" onClick={() => onMove(-1)}><ArrowUp size={14} /></button>
        <button className="icon-btn" title="Move down" onClick={() => onMove(1)}><ArrowDown size={14} /></button>
        <button className="icon-btn" title="Remove" onClick={onRemove}><X size={14} /></button>
      </div>
      {b.type === 'image' && (
        <div className="sd-field-main">
          <input className="input" value={b.label ?? ''} placeholder="Label (optional)" onChange={(e) => onChange({ ...b, label: e.target.value || undefined })} />
          <input className="input sd-key" value={b.key} placeholder="key" title="Internal name the value is stored under. 'portrait' is also the page thumbnail." onChange={(e) => onChange({ ...b, key: e.target.value })} />
          <Select className="input sd-type" title="Shape" value={b.shape} onChange={(v) => onChange({ ...b, shape: v as (typeof SHAPES)[number] })}>
            {SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
      )}
      {b.type === 'statblock' && (
        <div className="sd-field-main">
          <Select className="input grow" title="Stat block form" value={b.template} onChange={(v) => onChange({ ...b, template: v })}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <input className="input sd-key" value={b.key} placeholder="key" title="Internal name the value is stored under" onChange={(e) => onChange({ ...b, key: e.target.value })} />
        </div>
      )}
      {b.type === 'fields' && <FieldsEditor b={b} layout={layout} onChange={onChange} />}
      {b.type === 'body' && <small className="muted">The normal text of the page goes here.</small>}
    </div>
  )
}

function FieldsEditor({ b, layout, onChange }: { b: Extract<Block, { type: 'fields' }>; layout: Layout; onChange: (b: Block) => void }) {
  const fields = b.fields
  const set = (fs: FieldDef[]) => onChange({ ...b, fields: fs })
  return (
    <div className="sd-field">
      <input className="input" value={b.title ?? ''} placeholder="Heading (optional)" onChange={(e) => onChange({ ...b, title: e.target.value || undefined })} />
      {fields.map((f, i) => (
        <div key={i} className="sd-field-main">
          <input className="input" value={f.label} placeholder="Label" onChange={(e) => set(fields.map((x, j) => (j === i ? { ...f, label: e.target.value } : x)))} />
          <input className="input sd-key" value={f.key} placeholder="key" title="Internal name the value is stored under. Changing it later hides values already entered." onChange={(e) => set(fields.map((x, j) => (j === i ? { ...f, key: e.target.value } : x)))} />
          <label className="row" style={{ fontSize: 13, whiteSpace: 'nowrap' }}><input type="checkbox" checked={!!f.multiline} onChange={(e) => set(fields.map((x, j) => (j === i ? { ...f, multiline: e.target.checked || undefined } : x)))} /> Long</label>
          <button className="icon-btn" title="Move up" onClick={() => set(move(fields, i, -1))}><ArrowUp size={14} /></button>
          <button className="icon-btn" title="Move down" onClick={() => set(move(fields, i, 1))}><ArrowDown size={14} /></button>
          <button className="icon-btn" title="Remove field" onClick={() => set(fields.filter((_, j) => j !== i))}><X size={14} /></button>
        </div>
      ))}
      <button className="btn sm" onClick={() => set([...fields, { key: freshKey(layout, 'field'), label: 'New field' }])}><Plus size={13} style={{ verticalAlign: -2 }} /> Add field</button>
    </div>
  )
}
