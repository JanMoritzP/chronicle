import { ImagePlus, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { StatBlockBody, StatBlockEditor } from '../editor/StatBlock'
import { findTemplate, TEMPLATES } from '../editor/templates'
import { useTemplates } from '../editor/useTemplates'
import type { Block, Layout } from '../lib/pageTypes'
import type { Sheet } from '../lib/sheet'
import { LibraryField, refsOf } from './LibraryField'
import { Pf2eSheet } from './Pf2eSheet'
import { SheetView, type SheetPatch } from './SheetView'

export type TypeData = Record<string, any>

interface Props {
  layout: Layout
  data: TypeData
  readOnly: boolean
  setValue: (key: string, value: any) => void
  pickImage: () => Promise<string | null>
  body: ReactNode
  /** The page's structured sheet; creature stat blocks draw and edit it instead of the old text form. */
  sheet?: { value: Sheet | null; set: (patch: SheetPatch) => void; /** makes a Pathfinder 2e sheet for a page that has none, in a world that plays Pathfinder 2e */ createPf2e?: () => void }
}

function ImageBlock({ b, value, readOnly, set, pick }: { b: Extract<Block, { type: 'image' }>; value?: string; readOnly: boolean; set: (v: string | null) => void; pick: () => Promise<string | null> }) {
  if (!value && readOnly) return null
  return (
    <div className={`tl-image ${value ? b.shape : 'empty'}`}>
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
          <ImagePlus size={16} /> <span>Add {(b.label ?? (b.key === 'portrait' ? 'portrait' : 'picture')).toLowerCase()}</span>
        </button>
      )}
    </div>
  )
}

function StatBlockSlot({ b, value, readOnly, set, sheet }: { b: Extract<Block, { type: 'statblock' }>; value?: { template?: string; data?: Record<string, string> }; readOnly: boolean; set: (v: any) => void; sheet?: Props['sheet'] }) {
  const all = useTemplates()
  const [textForm, setTextForm] = useState(false)
  const template = findTemplate(all, value?.template ?? b.template) ?? TEMPLATES[0]
  const data = value?.data ?? {}
  if (sheet?.value?.ruleset === 'pf2e' && template.id.startsWith('5e-monster')) {
    return <div className="tl-statblock"><Pf2eSheet sheet={sheet.value} set={readOnly ? undefined : sheet.set} /></div>
  }
  if (sheet?.createPf2e && !sheet.value && !readOnly && template.id.startsWith('5e-monster')) {
    return (
      <div className="tl-statblock">
        <button className="btn sm primary" onClick={sheet.createPf2e}>Use a Pathfinder 2e sheet</button>
        <p className="muted" style={{ fontSize: 13 }}>This world plays Pathfinder 2e. The old 5e text form is below.</p>
        <StatBlockEditor template={template} data={data} onChange={(k, v, extra) => set({ template: template.id, data: { ...data, [k]: v, ...extra } })} onTemplate={(id) => set({ template: id, data })} />
      </div>
    )
  }
  if (sheet?.value && template.id.startsWith('5e-monster') && !textForm) {
    return (
      <div className="tl-statblock">
        <SheetView sheet={sheet.value} set={readOnly ? undefined : sheet.set} />
        {!readOnly && <div className="sb-toolbar"><button className="btn sm" title="Edit the old text form. The sheet is rebuilt from it." onClick={() => setTextForm(true)}>Edit as text form</button></div>}
      </div>
    )
  }
  return (
    <div className="tl-statblock">
      {readOnly
        ? <StatBlockBody template={template} data={data} />
        : <StatBlockEditor template={template} data={data} onChange={(k, v, extra) => set({ template: template.id, data: { ...data, [k]: v, ...extra } })} onTemplate={(id) => set({ template: id, data })} />}
    </div>
  )
}

function FieldsBlock({ b, data, readOnly, set }: { b: Extract<Block, { type: 'fields' }>; data: TypeData; readOnly: boolean; set: (k: string, v: any) => void }) {
  const shown = readOnly ? b.fields.filter((f) => (f.library ? refsOf(data[f.key]).length > 0 : data[f.key])) : b.fields
  if (!shown.length) return null
  return (
    <div className="tl-fields">
      {b.title && <h4>{b.title}</h4>}
      {shown.map((f) => f.library ? (
        <div key={f.key} className="tl-field">
          <span>{f.label}</span>
          <LibraryField def={f} value={data[f.key]} readOnly={readOnly} onChange={(v) => set(f.key, v)} />
        </div>
      ) : (
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

export function TypeLayout({ layout, data, readOnly, setValue, pickImage, body, sheet }: Props) {
  const render = (blocks: Block[], zone: string) =>
    blocks.map((b, i) => {
      const k = `${zone}-${i}`
      switch (b.type) {
        case 'body': return <div key={k} className="editor">{body}</div>
        case 'image': return <ImageBlock key={k} b={b} value={data[b.key]} readOnly={readOnly} set={(v) => setValue(b.key, v)} pick={pickImage} />
        case 'statblock': return <StatBlockSlot key={k} b={b} value={data[b.key]} readOnly={readOnly} set={(v) => setValue(b.key, v)} sheet={sheet} />
        case 'fields': return <FieldsBlock key={k} b={b} data={data} readOnly={readOnly} set={setValue} />
      }
    })
  const columns = layout.side.length > 0 && layout.columns !== 'single'
  return (
    <div className="tl">
      {layout.top.length > 0 && <div className="tl-top">{render(layout.top, 'top')}</div>}
      {columns ? (
        <div className={`tl-cols ${layout.columns} ${layout.flow}${layout.flow === 'columns' && layout.sticky ? ' sticky' : ''}`} style={{ ['--side' as any]: `${layout.sideWidth}px` }}>
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
