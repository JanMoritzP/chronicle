import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Eye, Pencil } from 'lucide-react'
import { Fragment, useState, type CSSProperties, type ReactNode } from 'react'
import { Select } from '../components/Select'
import { ABILITY_KEYS, findTemplate, TEMPLATES, type Field, type StatTemplate } from './templates'
import { useTemplates } from './useTemplates'

const modOf = (v: string) => {
  const n = Number(v)
  if (v.trim() === '' || !Number.isFinite(n)) return ''
  const m = Math.floor((n - 10) / 2)
  return m >= 0 ? `+${m}` : `−${Math.abs(m)}`
}

/** ***Name.*** for bold italic entry names, **bold**, *italic*; line breaks stay as they are. */
export function richText(text: string): ReactNode[] {
  return text.split(/(\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).map((part, i) => {
    if (part.startsWith('***') && part.endsWith('***') && part.length > 6) return <b key={i}><i>{part.slice(3, -3)}</i></b>
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <b key={i}>{part.slice(2, -2)}</b>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <i key={i}>{part.slice(1, -1)}</i>
    return <Fragment key={i}>{part}</Fragment>
  })
}

const paragraphs = (text: string) => text.split(/\n+/).filter((p) => p.trim()).map((p, i) => <p key={i}>{richText(p)}</p>)

function FieldValue({ f, value, onChange }: { f: Field; value: string; onChange?: (v: string) => void }) {
  const ro = !onChange
  const mod = f.mod ? modOf(value) : ''
  switch (f.type) {
    case 'checkbox':
      return <input type="checkbox" className="sb-check" checked={value === 'true'} disabled={ro} onChange={(e) => onChange?.(e.target.checked ? 'true' : '')} />
    case 'select':
      return ro ? <span>{value}</span> : (
        <Select className="sb-select" value={value} onChange={onChange!} placeholder="–">
          <option value="">–</option>
          {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      )
    case 'long':
      return ro ? <span className="sb-rich">{paragraphs(value)}</span> : <textarea value={value} placeholder={f.placeholder} onChange={(e) => onChange!(e.target.value)} />
    case 'number':
      return ro ? <span>{value}{mod && ` (${mod})`}</span> : (
        <>
          <input type="number" value={value} placeholder={f.placeholder} onChange={(e) => onChange!(e.target.value)} />
          {mod && <span className="sb-mod">{mod}</span>}
        </>
      )
    default:
      return ro ? <span>{richText(value)}</span> : <input value={value} placeholder={f.placeholder} onChange={(e) => onChange!(e.target.value)} />
  }
}

const filled = (f: Field, v: string) => (f.type === 'checkbox' ? v === 'true' : v !== '')

function Abilities({ s, val, onChange }: { s: { layout: 'row' | 'table'; saves?: boolean }; val: (k: string) => string; onChange?: (k: string, v: string) => void }) {
  const ro = !onChange
  if (s.layout === 'row') {
    return (
      <div className="sb-abilities">
        {ABILITY_KEYS.map((k) => (
          <div key={k} className="sb-ab">
            <b>{k.toUpperCase()}</b>
            {ro ? <span>{val(k) ? `${val(k)} (${modOf(val(k))})` : '–'}</span> : (
              <>
                <input type="number" value={val(k)} placeholder="10" aria-label={k.toUpperCase()} onChange={(e) => onChange!(k, e.target.value)} />
                <span className="sb-mod">{modOf(val(k))}</span>
              </>
            )}
          </div>
        ))}
      </div>
    )
  }
  // 2024 layout: Mental and physical scores side by side as Score / Mod / Save
  return (
    <div className="sb-abilities2">
      {ABILITY_KEYS.map((k) => {
        const mod = modOf(val(k))
        const save = val(`${k}_save`)
        return (
          <div key={k} className="sb-ab2">
            <b>{k.toUpperCase()}</b>
            {ro ? <span>{val(k) || '–'}</span> : <input type="number" value={val(k)} placeholder="10" aria-label={k.toUpperCase()} onChange={(e) => onChange!(k, e.target.value)} />}
            <span className="sb-mod">{mod}</span>
            {s.saves && (
              <>
                <small>Save</small>
                {ro ? <span className="sb-mod">{save || mod}</span> : <input className="sb-save" value={save} placeholder={mod} aria-label={`${k.toUpperCase()} save`} onChange={(e) => onChange!(`${k}_save`, e.target.value)} />}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function StatBlockBody({ template, data, onChange }: { template: StatTemplate; data: Record<string, string>; onChange?: (key: string, v: string) => void }) {
  const ro = !onChange
  const val = (k: string) => (data[k] == null ? '' : String(data[k]))
  const look = template.look
  const style = { '--sb-width': `${look.width}px`, ...(look.accent ? { '--sb-accent': look.accent } : {}) } as CSSProperties
  return (
    <div className={`statblock sb-${look.style} sb-font-${look.font}${look.columns === 2 ? ' sb-two' : ''}${ro ? '' : ' sb-editing'}`} style={style}>
      {template.sections.map((s, i) => {
        switch (s.kind) {
          case 'title':
            return ro ? (
              <div key={i} className="sb-name">{val(s.key) || 'Unnamed'}</div>
            ) : (
              <input key={i} className="sb-name" value={val(s.key)} placeholder={s.placeholder} onChange={(e) => onChange!(s.key, e.target.value)} />
            )
          case 'subtitle':
            return ro ? (
              val(s.key) ? <div key={i} className="sb-sub">{val(s.key)}</div> : null
            ) : (
              <input key={i} className="sb-sub sb-sub-input" value={val(s.key)} placeholder={s.placeholder} onChange={(e) => onChange!(s.key, e.target.value)} />
            )
          case 'rule':
            return <hr key={i} className="sb-rule" />
          case 'heading':
            return s.text ? <h4 key={i} className="sb-heading">{s.text}</h4> : null
          case 'abilities':
            return <Abilities key={i} s={s} val={val} onChange={onChange} />
          case 'rows': {
            const shown = s.fields.filter((f) => !ro || filled(f, val(f.key)))
            if (!shown.length) return null
            return (
              <div key={i} className={s.columns === 2 ? 'sb-rows2' : undefined}>
                {shown.map((f) => (
                  <div key={f.key} className={`sb-row${f.type === 'long' ? ' sb-row-long' : ''}`}>
                    <b>{f.label}</b>
                    <FieldValue f={f} value={val(f.key)} onChange={ro ? undefined : (v) => onChange!(f.key, v)} />
                  </div>
                ))}
              </div>
            )
          }
          case 'group':
            return (
              <div key={i} className="sb-group">
                {s.fields.map((f) => (
                  <div key={f.key} className="sb-cell">
                    <b>{f.label}</b>
                    {ro && !filled(f, val(f.key)) ? <span>–</span> : <FieldValue f={f} value={val(f.key)} onChange={ro ? undefined : (v) => onChange!(f.key, v)} />}
                  </div>
                ))}
              </div>
            )
          case 'long':
            if (ro && !val(s.key)) return null
            return (
              <div key={i} className="sb-long">
                {s.heading && <h4>{s.heading}</h4>}
                {ro ? <div className="sb-rich">{paragraphs(val(s.key))}</div> : <textarea className="sb-text" value={val(s.key)} placeholder={s.placeholder ?? s.heading} onChange={(e) => onChange!(s.key, e.target.value)} />}
              </div>
            )
          case 'list': {
            const items = val(s.key).split('\n').map((x) => x.trim()).filter(Boolean)
            if (ro && !items.length) return null
            return (
              <div key={i} className="sb-long">
                {s.heading && <h4>{s.heading}</h4>}
                {ro ? (
                  <ul className="sb-list">{items.map((x, j) => <li key={j}>{richText(x)}</li>)}</ul>
                ) : (
                  <textarea className="sb-text" value={val(s.key)} placeholder={s.placeholder ?? 'One item per line'} onChange={(e) => onChange!(s.key, e.target.value)} />
                )}
              </div>
            )
          }
        }
      })}
    </div>
  )
}

/** The stat block with its form picker and an Edit / Preview switch (Preview shows it as printed). */
export function StatBlockEditor({ template, data, onChange, onTemplate, extra }: {
  template: StatTemplate
  data: Record<string, string>
  onChange: (key: string, v: string) => void
  onTemplate: (id: string) => void
  extra?: ReactNode
}) {
  const all = useTemplates()
  const [preview, setPreview] = useState(false)
  return (
    <>
      <StatBlockBody template={template} data={data} onChange={preview ? undefined : onChange} />
      <div className="sb-toolbar">
        <Select className="input" style={{ width: 'auto', padding: '2px 6px' }} value={template.id} onChange={onTemplate}>
          {all.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <button className="btn sm" title={preview ? 'Back to editing' : 'See it as printed'} onClick={() => setPreview(!preview)}>
          {preview ? <><Pencil size={12} style={{ verticalAlign: -1 }} /> Edit</> : <><Eye size={12} style={{ verticalAlign: -1 }} /> Preview</>}
        </button>
        {extra}
      </div>
    </>
  )
}

function StatBlockView({ node, updateAttributes, editor, deleteNode }: NodeViewProps) {
  const all = useTemplates()
  const template = findTemplate(all, node.attrs.template) ?? TEMPLATES[0]
  const data: Record<string, string> = node.attrs.data ?? {}
  const editable = editor.isEditable
  return (
    <NodeViewWrapper contentEditable={false} data-statblock>
      {editable ? (
        <StatBlockEditor
          template={template}
          data={data}
          onChange={(k, v) => updateAttributes({ data: { ...data, [k]: v } })}
          onTemplate={(id) => updateAttributes({ template: id })}
          extra={<button className="btn sm danger" onClick={deleteNode}>Remove</button>}
        />
      ) : (
        <StatBlockBody template={template} data={data} />
      )}
    </NodeViewWrapper>
  )
}

export const StatBlock = Node.create({
  name: 'statblock',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { template: { default: '5e-monster' }, data: { default: {} } }
  },
  parseHTML() {
    return [{ tag: 'div[data-statblock]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-statblock': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(StatBlockView)
  },
})
