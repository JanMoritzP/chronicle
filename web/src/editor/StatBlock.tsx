import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Select } from '../components/Select'
import { findTemplate, TEMPLATES, type Field, type StatTemplate } from './templates'
import { useTemplates } from './useTemplates'

const modOf = (v: string) => {
  const n = Number(v)
  if (v.trim() === '' || !Number.isFinite(n)) return ''
  const m = Math.floor((n - 10) / 2)
  return m >= 0 ? `+${m}` : `−${Math.abs(m)}`
}

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
      return ro ? <span className="sb-pre">{value}</span> : <textarea value={value} placeholder={f.placeholder} onChange={(e) => onChange!(e.target.value)} />
    case 'number':
      return ro ? <span>{value}{mod && ` (${mod})`}</span> : (
        <>
          <input type="number" value={value} placeholder={f.placeholder} onChange={(e) => onChange!(e.target.value)} />
          {mod && <span className="sb-mod">{mod}</span>}
        </>
      )
    default:
      return ro ? <span>{value}</span> : <input value={value} placeholder={f.placeholder} onChange={(e) => onChange!(e.target.value)} />
  }
}

const filled = (f: Field, v: string) => (f.type === 'checkbox' ? v === 'true' : v !== '')

export function StatBlockBody({ template, data, onChange }: { template: StatTemplate; data: Record<string, string>; onChange?: (key: string, v: string) => void }) {
  const ro = !onChange
  const val = (k: string) => (data[k] == null ? '' : String(data[k]))
  return (
    <div className="statblock">
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
              <input key={i} className="sb-row sb-sub" style={{ border: 0, background: 'transparent', outline: 0, width: '100%' }} value={val(s.key)} placeholder={s.placeholder} onChange={(e) => onChange!(s.key, e.target.value)} />
            )
          case 'rule':
            return <hr key={i} className="sb-rule" />
          case 'heading':
            return s.text ? <h4 key={i} className="sb-heading">{s.text}</h4> : null
          case 'rows': {
            const shown = s.fields.filter((f) => !ro || filled(f, val(f.key)))
            if (!shown.length) return null
            return (
              <div key={i}>
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
                {ro ? val(s.key) : <textarea className="input" style={{ minHeight: 70 }} value={val(s.key)} placeholder={s.placeholder ?? s.heading} onChange={(e) => onChange!(s.key, e.target.value)} />}
              </div>
            )
          case 'list': {
            const items = val(s.key).split('\n').map((x) => x.trim()).filter(Boolean)
            if (ro && !items.length) return null
            return (
              <div key={i} className="sb-long">
                {s.heading && <h4>{s.heading}</h4>}
                {ro ? (
                  <ul className="sb-list">{items.map((x, j) => <li key={j}>{x}</li>)}</ul>
                ) : (
                  <textarea className="input" style={{ minHeight: 60 }} value={val(s.key)} placeholder={s.placeholder ?? 'One item per line'} onChange={(e) => onChange!(s.key, e.target.value)} />
                )}
              </div>
            )
          }
        }
      })}
    </div>
  )
}

function StatBlockView({ node, updateAttributes, editor, deleteNode }: NodeViewProps) {
  const all = useTemplates()
  const template = findTemplate(all, node.attrs.template) ?? TEMPLATES[0]
  const data: Record<string, string> = node.attrs.data ?? {}
  const editable = editor.isEditable
  return (
    <NodeViewWrapper contentEditable={false} data-statblock>
      <StatBlockBody
        template={template}
        data={data}
        onChange={editable ? (k, v) => updateAttributes({ data: { ...data, [k]: v } }) : undefined}
      />
      {editable && (
        <div className="sb-toolbar">
          <Select className="input" style={{ width: 'auto', padding: '2px 6px' }} value={template.id} onChange={(v) => updateAttributes({ template: v })}>
            {all.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <button className="btn sm danger" onClick={deleteNode}>Remove</button>
        </div>
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
