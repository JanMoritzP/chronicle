import { ArrowDown, ArrowUp, Copy, Plus, ScrollText, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../api'
import { StatBlockBody } from '../editor/StatBlock'
import { ABILITY_KEYS, CLASSIC_LOOK, DEFAULT_LOOK, normalizeLook, parseTemplateSource, resolveTemplates, sectionsToSource, type Field, type FieldType, type Look, type Section, type StatTemplate } from '../editor/templates'
import { askText, confirmDialog } from '../lib/dialog'
import { useStore } from '../store'
import { Select } from './Select'

const slug = (s: string) => s.trim().replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/\W+/g, '_').replace(/^_+|_+$/g, '')

/** Fields and sections added in the designer have an empty key until saved; the key then follows the label. */
function withKeys(sections: Section[]): Section[] {
  const used = new Set<string>()
  const unique = (base: string) => {
    let k = base || 'field', n = 2
    while (used.has(k)) k = `${base || 'field'}_${n++}`
    used.add(k)
    return k
  }
  return sections.map((s): Section => {
    switch (s.kind) {
      case 'title': case 'subtitle': return { ...s, key: unique(s.key || slug(s.kind)) }
      case 'long': case 'list': return { ...s, key: unique(s.key || slug(s.heading ?? '') || s.kind) }
      case 'rows': case 'group': return { ...s, fields: s.fields.map((f) => ({ ...f, key: unique(f.key || slug(f.label)) })) }
      case 'abilities': ABILITY_KEYS.forEach((k) => { used.add(k); if (s.saves) used.add(`${k}_save`) }); return s
      default: return s
    }
  })
}

/** Keys used twice would make two inputs edit the same value. */
function duplicateKeys(sections: Section[]): string[] {
  const seen = new Set<string>(), dup = new Set<string>()
  const add = (k: string) => { if (!k) return; if (seen.has(k)) dup.add(k); seen.add(k) }
  for (const s of sections) {
    if (s.kind === 'abilities') ABILITY_KEYS.forEach((k) => { add(k); if (s.saves) add(`${k}_save`) })
    if ('key' in s) add(s.key)
    if ('fields' in s) s.fields.forEach((f) => add(f.key))
  }
  return [...dup]
}

const KIND_LABEL: Record<Section['kind'], string> = {
  title: 'Title', subtitle: 'Subtitle', rule: 'Divider line', heading: 'Heading', rows: 'Labelled fields', group: 'Grid of small fields', abilities: 'Ability scores', long: 'Text area', list: 'Bullet list',
}
const ADD: { kind: Section['kind']; make: () => Section }[] = [
  { kind: 'title', make: () => ({ kind: 'title', key: '', placeholder: 'Name' }) },
  { kind: 'subtitle', make: () => ({ kind: 'subtitle', key: '', placeholder: 'Subtitle' }) },
  { kind: 'rows', make: () => ({ kind: 'rows', fields: [{ key: '', label: 'New field' }] }) },
  { kind: 'abilities', make: () => ({ kind: 'abilities', layout: 'row' }) },
  { kind: 'group', make: () => ({ kind: 'group', fields: [{ key: '', label: 'A', type: 'number' }, { key: '', label: 'B', type: 'number' }, { key: '', label: 'C', type: 'number' }] }) },
  { kind: 'long', make: () => ({ kind: 'long', key: '', heading: 'Notes' }) },
  { kind: 'list', make: () => ({ kind: 'list', key: '', heading: 'Items' }) },
  { kind: 'heading', make: () => ({ kind: 'heading', text: 'Section heading' }) },
  { kind: 'rule', make: () => ({ kind: 'rule' }) },
]
const FIELD_TYPE_LABEL: Record<FieldType, string> = { text: 'Short text', number: 'Number', checkbox: 'Checkbox', select: 'Choice list', long: 'Long text' }

const move = <T,>(list: T[], i: number, d: number): T[] => {
  const j = i + d
  if (j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

function FieldEditor({ f, onChange, onRemove, onMove }: { f: Field; onChange: (f: Field) => void; onRemove: () => void; onMove: (d: number) => void }) {
  const type = f.type ?? 'text'
  return (
    <div className="sd-field">
      <div className="sd-field-main">
        <input className="input" value={f.label} placeholder="Label" onChange={(e) => onChange({ ...f, label: e.target.value })} />
        <input className="input sd-key" value={f.key} placeholder={slug(f.label) || 'key'} title="Internal name the value is stored under. Changing it later hides values already entered." onChange={(e) => onChange({ ...f, key: slug(e.target.value) })} />
        <Select className="input sd-type" value={type} onChange={(v) => { const t = v as FieldType; const n = { ...f, type: t === 'text' ? undefined : t }; if (t !== 'select') delete n.options; if (t !== 'number') delete n.mod; onChange(n) }}>
          {(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
        </Select>
        <button className="icon-btn" title="Move up" onClick={() => onMove(-1)}><ArrowUp size={14} /></button>
        <button className="icon-btn" title="Move down" onClick={() => onMove(1)}><ArrowDown size={14} /></button>
        <button className="icon-btn" title="Remove field" onClick={onRemove}><X size={14} /></button>
      </div>
      {type === 'select' && (
        <input className="input" value={(f.options ?? []).join(', ')} placeholder="Choices, separated by commas" onChange={(e) => onChange({ ...f, options: e.target.value.split(',').map((s) => s.trimStart()) })} onBlur={(e) => onChange({ ...f, options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
      )}
      {type === 'number' && (
        <label className="row" style={{ fontSize: 13 }}><input type="checkbox" checked={!!f.mod} onChange={(e) => onChange({ ...f, mod: e.target.checked || undefined })} /> Show ability modifier (16 → +3)</label>
      )}
    </div>
  )
}

function SectionEditor({ s, onChange, onRemove, onMove }: { s: Section; onChange: (s: Section) => void; onRemove: () => void; onMove: (d: number) => void }) {
  const fieldsOf = (sec: Extract<Section, { fields: Field[] }>) => (
    <>
      {sec.fields.map((f, i) => (
        <FieldEditor key={i} f={f}
          onChange={(nf) => onChange({ ...sec, fields: sec.fields.map((x, j) => (j === i ? nf : x)) })}
          onRemove={() => onChange({ ...sec, fields: sec.fields.filter((_, j) => j !== i) })}
          onMove={(d) => onChange({ ...sec, fields: move(sec.fields, i, d) })} />
      ))}
      <button className="btn sm" onClick={() => onChange({ ...sec, fields: [...sec.fields, { key: '', label: 'New field', ...(sec.kind === 'group' ? { type: 'number' as const } : {}) }] })}><Plus size={13} style={{ verticalAlign: -2 }} /> Add field</button>
    </>
  )
  return (
    <div className="sd-card">
      <div className="sd-head">
        <b className="grow">{KIND_LABEL[s.kind]}</b>
        <button className="icon-btn" title="Move up" onClick={() => onMove(-1)}><ArrowUp size={14} /></button>
        <button className="icon-btn" title="Move down" onClick={() => onMove(1)}><ArrowDown size={14} /></button>
        <button className="icon-btn" title="Remove section" onClick={onRemove}><Trash2 size={14} /></button>
      </div>
      {(s.kind === 'title' || s.kind === 'subtitle') && (
        <div className="sd-field-main">
          <input className="input" value={s.placeholder ?? ''} placeholder="Hint text shown when empty" onChange={(e) => onChange({ ...s, placeholder: e.target.value })} />
          <input className="input sd-key" value={s.key} placeholder={s.kind} title="Internal name the value is stored under" onChange={(e) => onChange({ ...s, key: slug(e.target.value) })} />
        </div>
      )}
      {(s.kind === 'long' || s.kind === 'list') && (
        <div className="sd-field-main">
          <input className="input" value={s.heading ?? ''} placeholder="Heading (optional)" onChange={(e) => onChange({ ...s, heading: e.target.value })} />
          <input className="input sd-key" value={s.key} placeholder={slug(s.heading ?? '') || s.kind} title="Internal name the value is stored under" onChange={(e) => onChange({ ...s, key: slug(e.target.value) })} />
        </div>
      )}
      {s.kind === 'heading' && <input className="input" value={s.text} placeholder="Heading text" onChange={(e) => onChange({ ...s, text: e.target.value })} />}
      {s.kind === 'abilities' && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <Select className="input" style={{ width: 230 }} value={s.layout} onChange={(v) => onChange({ kind: 'abilities', layout: v === 'table' ? 'table' : 'row' })}>
            <option value="row">One row of six (classic)</option>
            <option value="table">Three columns (2024 style)</option>
          </Select>
          {s.layout === 'table' && <label className="row" style={{ fontSize: 13 }}><input type="checkbox" checked={!!s.saves} onChange={(e) => onChange({ ...s, saves: e.target.checked || undefined })} /> Saving throw column</label>}
          <small className="muted">Strength to Charisma with their modifiers. Values are stored as str, dex, con, int, wis, cha.</small>
        </div>
      )}
      {s.kind === 'rows' && (
        <label className="row" style={{ fontSize: 13 }}><input type="checkbox" checked={s.columns === 2} onChange={(e) => onChange({ ...s, columns: e.target.checked ? 2 : undefined })} /> Two fields side by side</label>
      )}
      {(s.kind === 'rows' || s.kind === 'group') && fieldsOf(s)}
    </div>
  )
}

const ACCENTS = [
  { name: 'Dragon red', value: '#7a200d' }, { name: 'Ink blue', value: '#1f4e79' }, { name: 'Forest green', value: '#2f5d27' },
  { name: 'Violet', value: '#5b2d82' }, { name: 'Bronze', value: '#8a5a12' }, { name: 'Slate', value: '#3b4252' },
]

/** Style, colour, font, width and columns of the whole form. */
function LookEditor({ look, onChange, readOnly }: { look: Look; onChange: (l: Look) => void; readOnly: boolean }) {
  const set = (p: Partial<Look>) => onChange(normalizeLook({ ...look, ...p }))
  return (
    <fieldset className="sd-set" disabled={readOnly}>
      <div className="sd-card">
        <div className="sd-head"><b className="grow">Look</b>
          {!readOnly && <button className="btn sm ghost" title="Use the printed monster stat block look" onClick={() => onChange(CLASSIC_LOOK)}>Use classic look</button>}
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 190 }}><span>Style</span>
            <Select className="input" value={look.style} onChange={(v) => set({ style: v as Look['style'] })}>
              <option value="classic">Classic (parchment)</option>
              <option value="card">Card (follows the theme)</option>
              <option value="plain">Plain (no frame)</option>
            </Select>
          </label>
          <label className="field" style={{ width: 150 }}><span>Font</span>
            <Select className="input" value={look.font} onChange={(v) => set({ font: v as Look['font'] })}>
              <option value="serif">Serif</option>
              <option value="sans">Sans-serif</option>
              <option value="page">Same as page</option>
            </Select>
          </label>
          <label className="field" style={{ width: 110 }}><span>Width (px)</span>
            <input className="input" type="number" min={260} max={760} value={look.width} onChange={(e) => set({ width: Number(e.target.value) })} />
          </label>
          <label className="field" style={{ width: 130 }}><span>Columns</span>
            <Select className="input" value={String(look.columns)} onChange={(v) => set({ columns: v === '2' ? 2 : 1 })}>
              <option value="1">One</option>
              <option value="2">Two</option>
            </Select>
          </label>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 13 }}>Accent colour</span>
          <button className={`btn sm ${look.accent ? '' : 'primary'}`} onClick={() => set({ accent: '' })}>Style default</button>
          {ACCENTS.map((a) => (
            <button key={a.value} className="icon-btn" title={a.name} aria-label={a.name} aria-pressed={look.accent === a.value} onClick={() => set({ accent: a.value })}
              style={{ background: a.value, width: 22, height: 22, borderRadius: '50%', outline: look.accent === a.value ? '2px solid var(--text)' : 'none', outlineOffset: 2 }} />
          ))}
          <input type="color" title="Custom colour" aria-label="Custom accent colour" value={/^#[0-9a-f]{6}$/i.test(look.accent) ? look.accent : '#7a200d'} onChange={(e) => set({ accent: e.target.value })} />
        </div>
      </div>
    </fieldset>
  )
}

export function StatTemplatesView() {
  const custom = useStore((s) => s.data.statTemplates)
  const readOnly = useStore((s) => s.user?.role === 'viewer')
  const navigate = useStore((s) => s.navigate)
  const [error, setError] = useState('')
  const list = useMemo(() => resolveTemplates(custom), [custom])

  const create = async (from?: StatTemplate) => {
    const name = (await askText(from ? `Copy of “${from.name}”` : 'New stat block form', { label: 'Name', initial: from ? `${from.name} copy` : '', okLabel: 'Create' }))?.trim()
    if (!name) return
    try {
      const wsId = await useStore.getState().ensureWorkspace()
      if (!wsId) return
      const look = from ? from.look : DEFAULT_LOOK
      const sections = from ? structuredClone(from.sections) : [{ kind: 'title', key: 'name', placeholder: 'Name' }, { kind: 'rule' }, { kind: 'rows', fields: [{ key: 'field_1', label: 'First field' }] }]
      const t = await api.createStatTemplate(wsId, { name, sections, look })
      useStore.getState().upsertStatTemplate(t)
      navigate({ type: 'stattemplate', id: t.id })
    } catch (e: any) { setError(e.message) }
  }

  return (
    <div className="view">
      <h1 style={{ marginTop: 0 }}><ScrollText size={26} style={{ verticalAlign: -3 }} /> Stat block forms</h1>
      <p className="muted">
        Design your own stat block: choose the fields, their order and their kind (text, number, checkbox, choice list…). Use a form with <code>/stat</code> in any page, or in a special page's stat block.
      </p>
      {!readOnly && <p><button className="btn primary" onClick={() => create()}><Plus size={14} style={{ verticalAlign: -2 }} /> New form</button></p>}
      {error && <div className="error">{error}</div>}
      {list.map((t) => (
        <div key={t.id} className="todo-row" style={{ cursor: 'pointer' }} onClick={() => navigate({ type: 'stattemplate', id: t.id })}>
          <ScrollText size={20} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div><b>{t.name}</b> {t.builtin && <span className="muted" style={{ fontSize: 12 }}>built-in</span>}</div>
            <div className="muted todo-context">{t.sections.reduce((n, s) => n + ('fields' in s ? s.fields.length : 'key' in s ? 1 : 0), 0)} fields</div>
          </div>
          {!readOnly && <button className="btn sm" onClick={(e) => { e.stopPropagation(); create(t) }}>Duplicate</button>}
        </div>
      ))}
    </div>
  )
}

export function StatTemplateEditor({ id }: { id: string }) {
  const custom = useStore((s) => s.data.statTemplates)
  const loaded = useStore((s) => s.loaded)
  const template = useMemo(() => resolveTemplates(custom).find((t) => t.id === id), [custom, id])
  if (!template) return <div className="view muted">{loaded ? 'This form no longer exists.' : 'Loading…'}</div>
  return <TemplateBody key={template.id} template={template} />
}

function TemplateBody({ template }: { template: StatTemplate }) {
  const readOnly = useStore((s) => s.user?.role === 'viewer') || !!template.builtin
  const editorRole = useStore((s) => s.user?.role !== 'viewer')
  const navigate = useStore((s) => s.navigate)
  const wsId = useStore((s) => s.wsId)!
  const [name, setName] = useState(template.name)
  const [sections, setSections] = useState<Section[]>(template.sections)
  const [look, setLook] = useState<Look>(template.look)
  const [saved, setSaved] = useState(() => JSON.stringify({ name: template.name, sections: template.sections, look: template.look }))
  const [mode, setMode] = useState<'visual' | 'source'>('visual')
  const [source, setSource] = useState('')
  const [srcErr, setSrcErr] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Record<string, string>>({})

  const keyed = useMemo(() => withKeys(sections), [sections])
  const dups = useMemo(() => duplicateKeys(keyed), [keyed])
  const dirty = JSON.stringify({ name, sections: keyed, look }) !== saved
  const canSave = dirty && !dups.length && !srcErr && name.trim().length > 0

  const update = (i: number, s: Section) => setSections((l) => l.map((x, j) => (j === i ? s : x)))

  const save = async () => {
    try {
      const t = await api.patchStatTemplate(template.id, { name: name.trim(), sections: keyed, look })
      useStore.getState().upsertStatTemplate(t)
      setSections(keyed)
      setSaved(JSON.stringify({ name: name.trim(), sections: keyed, look }))
      setError('')
    } catch (e: any) { setError(e.message) }
  }

  const switchMode = (m: 'visual' | 'source') => {
    if (m === 'source') { setSource(sectionsToSource(keyed, look)); setSrcErr('') }
    setMode(m)
  }

  const onSource = (text: string) => {
    setSource(text)
    try { const p = parseTemplateSource(text); setSections(p.sections); setLook(p.look); setSrcErr('') } catch (e: any) { setSrcErr(e.message) }
  }

  const duplicate = async () => {
    const n = (await askText('Copy this form', { label: 'Name', initial: `${name} copy`, okLabel: 'Create' }))?.trim()
    if (!n) return
    try {
      const t = await api.createStatTemplate(wsId, { name: n, sections: structuredClone(keyed), look })
      useStore.getState().upsertStatTemplate(t)
      navigate({ type: 'stattemplate', id: t.id })
    } catch (e: any) { setError(e.message) }
  }

  const previewTemplate: StatTemplate = { id: template.id, name, sections: keyed, look }

  return (
    <div>
      <div className="toolbar">
        <a className="muted grow" style={{ fontSize: 13, cursor: 'pointer' }} onClick={() => navigate({ type: 'stattemplates' })}>Stat block forms /</a>
        {!readOnly && <span className="save-state">{dirty ? 'Unsaved changes' : 'Saved'}</span>}
        {editorRole && <button className="btn sm" onClick={duplicate}><Copy size={13} style={{ verticalAlign: -2 }} /> Duplicate</button>}
        {!readOnly && <button className="btn primary sm" disabled={!canSave} onClick={save}>Save</button>}
        {!readOnly && (
          <button className="icon-btn" title="Delete this form" onClick={async () => {
            if (!(await confirmDialog(`Delete the form “${template.name}”? Stat blocks that use it show the first built-in form instead; the values you entered stay stored.`, { title: 'Delete form', okLabel: 'Delete', danger: true }))) return
            await api.deleteStatTemplate(template.id)
            useStore.getState().removeStatTemplateLocal(template.id)
            navigate({ type: 'stattemplates' })
          }}><Trash2 size={16} /></button>
        )}
      </div>
      <div className="page" style={{ maxWidth: 1100 }}>
        <input className="page-title" value={name} readOnly={readOnly} placeholder="Form name" onChange={(e) => setName(e.target.value)} />
        {template.builtin && <p className="muted">Built-in forms can't be edited. Use <b>Duplicate</b> to make your own version.</p>}
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
                <LookEditor look={look} onChange={setLook} readOnly={readOnly} />
                {keyed.length === 0 && <div className="muted">Nothing here yet. Add a first section below.</div>}
                {sections.map((s, i) => (
                  <fieldset key={i} disabled={readOnly} className="sd-set">
                    <SectionEditor s={s} onChange={(n) => update(i, n)} onRemove={() => setSections((l) => l.filter((_, j) => j !== i))} onMove={(d) => setSections((l) => move(l, i, d))} />
                  </fieldset>
                ))}
                {!readOnly && (
                  <div className="sd-add">
                    <span className="muted">Add:</span>
                    {ADD.map((a) => <button key={a.kind} className="btn sm" onClick={() => setSections((l) => [...l, a.make()])}><Plus size={12} style={{ verticalAlign: -1 }} /> {KIND_LABEL[a.kind]}</button>)}
                  </div>
                )}
              </>
            ) : (
              <>
                <textarea className="input pt-source" spellCheck={false} value={source} readOnly={readOnly} onChange={(e) => onSource(e.target.value)} />
                {srcErr
                  ? <div className="error">{srcErr}</div>
                  : <small className="muted">YAML or JSON. Kinds: title, subtitle, rule, heading, rows, group, abilities, long, list. Field types: text, number, checkbox, select, long. The look: block sets style, accent, font, width and columns.</small>}
              </>
            )}
            {dups.length > 0 && <div className="error">Each field needs its own key. Used twice: {dups.join(', ')}.</div>}
            {error && <div className="error">{error}</div>}
          </div>
          <div className="field">
            <span>Preview (try it out)</span>
            <div className="pt-preview">
              <StatBlockBody template={previewTemplate} data={preview} onChange={(k, v) => setPreview((d) => ({ ...d, [k]: v }))} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
