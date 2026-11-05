import { ImagePlus, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { StatBlockBody } from '../editor/StatBlock'
import { findTemplate, TEMPLATES } from '../editor/templates'
import { useTemplates } from '../editor/useTemplates'
import { Select } from './Select'
import type { Block, Layout } from '../lib/pageTypes'

export type TypeData = Record<string, any>

interface Props {
  layout: Layout
  data: TypeData
  readOnly: boolean
  setValue: (key: string, value: any) => void
  pickImage: () => Promise<string | null>
  body: ReactNode
}

function ImageBlock({ b, value, readOnly, set, pick }: { b: Extract<Block, { type: 'image' }>; value?: string; readOnly: boolean; set: (v: string | null) => void; pick: () => Promise<string | null> }) {
  if (!value && readOnly) return null
  return (
    <div className={`tl-image ${b.shape}`}>
      {value ? (
        <>
          <img src={value} alt={b.label ?? b.key} draggable={false} />
          {!readOnly && (
            <div className="tl-image-actions">
              <button className="icon-btn" title="Replace image" onClick={async () => { const u = await pick(); if (u) set(u) }}><ImagePlus size={14} /></button>
              <button className="icon-btn" title="Remove image" onClick={() => set(null)}><X size={14} /></button>
            </div>
          )}
        </>
      ) : (
        <button className="tl-image-empty" onClick={async () => { const u = await pick(); if (u) set(u) }}>
          <ImagePlus size={22} /> <span>{b.label ?? 'Add image'}</span>
        </button>
      )}
    </div>
  )
}

function StatBlockSlot({ b, value, readOnly, set }: { b: Extract<Block, { type: 'statblock' }>; value?: { template?: string; data?: Record<string, string> }; readOnly: boolean; set: (v: any) => void }) {
  const all = useTemplates()
  const template = findTemplate(all, value?.template ?? b.template) ?? TEMPLATES[0]
  const data = value?.data ?? {}
  return (
    <div className="tl-statblock">
      <StatBlockBody template={template} data={data} onChange={readOnly ? undefined : (k, v) => set({ template: template.id, data: { ...data, [k]: v } })} />
      {!readOnly && (
        <div className="sb-toolbar">
          <Select className="input" style={{ width: 'auto', padding: '2px 6px' }} value={template.id} onChange={(v) => set({ template: v, data })}>
            {all.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </div>
      )}
    </div>
  )
}

function FieldsBlock({ b, data, readOnly, set }: { b: Extract<Block, { type: 'fields' }>; data: TypeData; readOnly: boolean; set: (k: string, v: string) => void }) {
  const shown = readOnly ? b.fields.filter((f) => data[f.key]) : b.fields
  if (!shown.length) return null
  return (
    <div className="tl-fields">
      {b.title && <h4>{b.title}</h4>}
      {shown.map((f) => (
        <label key={f.key} className="tl-field">
          <span>{f.label}</span>
          {readOnly ? <div>{data[f.key]}</div> : f.multiline
            ? <textarea className="tl-input" rows={2} value={data[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            : <input className="tl-input" value={data[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />}
        </label>
      ))}
    </div>
  )
}

export function TypeLayout({ layout, data, readOnly, setValue, pickImage, body }: Props) {
  const render = (blocks: Block[], zone: string) =>
    blocks.map((b, i) => {
      const k = `${zone}-${i}`
      switch (b.type) {
        case 'body': return <div key={k} className="editor">{body}</div>
        case 'image': return <ImageBlock key={k} b={b} value={data[b.key]} readOnly={readOnly} set={(v) => setValue(b.key, v)} pick={pickImage} />
        case 'statblock': return <StatBlockSlot key={k} b={b} value={data[b.key]} readOnly={readOnly} set={(v) => setValue(b.key, v)} />
        case 'fields': return <FieldsBlock key={k} b={b} data={data} readOnly={readOnly} set={setValue} />
      }
    })
  const columns = layout.side.length > 0 && layout.columns !== 'single'
  return (
    <div className="tl">
      {layout.top.length > 0 && <div className="tl-top">{render(layout.top, 'top')}</div>}
      {columns ? (
        <div className={`tl-cols ${layout.columns}`} style={{ ['--side' as any]: `${layout.sideWidth}px` }}>
          <div className="tl-side">{render(layout.side, 'side')}</div>
          <div className="tl-main">{render(layout.main, 'main')}</div>
        </div>
      ) : (
        <div className="tl-main">{render([...layout.side, ...layout.main], 'main')}</div>
      )}
      {layout.bottom.length > 0 && <div className="tl-bottom">{render(layout.bottom, 'bottom')}</div>}
    </div>
  )
}
