import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { AlignCenter, Captions, PanelLeft, PanelRight, RectangleHorizontal, Trash2 } from 'lucide-react'
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

export const IMAGE_ALIGNS = ['center', 'left', 'right', 'full'] as const
export type ImageAlign = typeof IMAGE_ALIGNS[number]
const SIZES = [{ label: 'S', size: 25 }, { label: 'M', size: 40 }, { label: 'L', size: 60 }]
/** pictures that the text flows around start at this width, so the text keeps most of the line */
const FLOAT_SIZE = 40

const alignOf = (v: unknown): ImageAlign => (IMAGE_ALIGNS.includes(v as ImageAlign) ? v as ImageAlign : 'center')
const clampSize = (n: number) => Math.round(Math.min(100, Math.max(10, n)))

function ImageView({ node, updateAttributes, deleteNode, editor, selected }: NodeViewProps) {
  const editable = editor.isEditable
  const align = alignOf(node.attrs.align)
  const saved: number | null = typeof node.attrs.size === 'number' ? node.attrs.size : null
  const caption: string = node.attrs.caption ?? ''
  const [drag, setDrag] = useState<number | null>(null)
  const [captioning, setCaptioning] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  const size = drag ?? (align === 'full' ? 100 : saved)

  const setAlign = (next: ImageAlign) => {
    // a picture the text flows around needs room for the text: give it a sensible width when it had none
    const floats = next === 'left' || next === 'right'
    updateAttributes({ align: next, ...(floats && (saved == null || saved > 70) ? { size: FLOAT_SIZE } : {}) })
  }

  // drag the corner or a side edge: the width is kept as a share of the text column, so it stays right on every screen
  const startResize = (e: ReactPointerEvent, edge: 'left' | 'right' = align === 'right' ? 'left' : 'right') => {
    e.preventDefault()
    e.stopPropagation()
    const el = frame.current?.parentElement
    const column = editor.view.dom as HTMLElement
    if (!el) return
    const start = e.clientX
    const startWidth = el.getBoundingClientRect().width
    const total = column.clientWidth || 1
    // dragging the left edge outwards means moving left
    const dir = edge === 'left' ? -1 : 1
    let last = clampSize((startWidth / total) * 100)
    const move = (ev: PointerEvent) => {
      // centred pictures grow on both sides
      const dx = (ev.clientX - start) * dir * (align === 'center' ? 2 : 1)
      last = clampSize(((startWidth + dx) / total) * 100)
      setDrag(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      updateAttributes({ size: last, ...(align === 'full' && last < 100 ? { align: 'center' } : {}) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const showCaption = caption || (editable && captioning)
  const btn = (title: string, active: boolean, onClick: () => void, icon: ReactNode) => (
    <button type="button" className={`icon-btn${active ? ' on' : ''}`} title={title} aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{icon}</button>
  )

  return (
    <NodeViewWrapper as="figure" className={`img-node align-${align}`} data-align={align}
      style={size != null && align !== 'full' ? { width: `${size}%` } : undefined}>
      <div className="img-frame" ref={frame} data-drag-handle="">
        <img src={node.attrs.src} alt={node.attrs.alt ?? ''} title={node.attrs.title ?? undefined} draggable={false} />
        {editable && <span className="img-resize" title="Drag to resize" onPointerDown={(e) => startResize(e)} />}
        {editable && align !== 'left' && <span className="img-edge left" title="Drag to resize" onPointerDown={(e) => startResize(e, 'left')} />}
        {editable && align !== 'right' && <span className="img-edge right" title="Drag to resize" onPointerDown={(e) => startResize(e, 'right')} />}
        {editable && drag != null && <span className="img-size-badge">{drag}%</span>}
        {editable && selected && (
          <div className="img-toolbar" contentEditable={false}>
            {btn('Text flows on the right', align === 'left', () => setAlign('left'), <PanelLeft size={15} />)}
            {btn('Centre, no text beside it', align === 'center', () => setAlign('center'), <AlignCenter size={15} />)}
            {btn('Text flows on the left', align === 'right', () => setAlign('right'), <PanelRight size={15} />)}
            {btn('Full width', align === 'full', () => updateAttributes({ align: 'full', size: null }), <RectangleHorizontal size={15} />)}
            <span className="img-toolbar-sep" />
            {SIZES.map((s) => (
              <button key={s.label} type="button" className={`icon-btn text${saved === s.size && align !== 'full' ? ' on' : ''}`} title={`${s.size} percent of the line`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => updateAttributes({ size: s.size, ...(align === 'full' ? { align: 'center' } : {}) })}>{s.label}</button>
            ))}
            <span className="img-toolbar-sep" />
            {btn(caption ? 'Remove caption' : 'Add a caption', !!caption || captioning, () => {
              if (caption || captioning) { updateAttributes({ caption: '' }); setCaptioning(false) } else setCaptioning(true)
            }, <Captions size={15} />)}
            {btn('Remove picture', false, () => deleteNode(), <Trash2 size={15} />)}
          </div>
        )}
      </div>
      {showCaption && (editable ? (
        <input className="img-caption" value={caption} placeholder="Caption" aria-label="Caption" autoFocus={captioning && !caption}
          onFocus={() => setCaptioning(true)} onChange={(e) => updateAttributes({ caption: e.target.value })}
          onBlur={() => setCaptioning(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); editor.commands.focus() } }} />
      ) : <figcaption className="img-caption">{caption}</figcaption>)}
    </NodeViewWrapper>
  )
}

/** A picture in the text: centred, full width, or floating left or right with the text flowing beside it. */
export const FlowImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: { default: 'center', parseHTML: (el) => alignOf(el.getAttribute('data-align')), renderHTML: (a) => ({ 'data-align': a.align }) },
      size: {
        default: null,
        parseHTML: (el) => { const n = Number(el.getAttribute('data-size')); return n ? clampSize(n) : null },
        renderHTML: (a) => (a.size ? { 'data-size': a.size } : {}),
      },
      caption: { default: '', parseHTML: (el) => el.getAttribute('data-caption') ?? '', renderHTML: (a) => (a.caption ? { 'data-caption': a.caption } : {}) },
    }
  },
  addNodeView() { return ReactNodeViewRenderer(ImageView) },
}).configure({ allowBase64: false })
