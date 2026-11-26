import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { GripVertical, PanelLeft, PanelRight, RectangleHorizontal, Undo2 } from 'lucide-react'
import { createContext, useContext, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { BOX_ZONES, type BoxZone } from '../lib/pageTypes'

/** What a special page gives the boxes in its text: the blocks of each zone, drawn with the page's values. */
export interface InfoboxHost { render: (zone: BoxZone) => ReactNode | null }
export const InfoboxContext = createContext<InfoboxHost | null>(null)

const SIDES = ['right', 'left', 'full'] as const
type Side = typeof SIDES[number]
const SIZES = [{ label: 'S', size: 30 }, { label: 'M', size: 40 }, { label: 'L', size: 50 }]
const ZONE_LABEL: Record<BoxZone, string> = { top: 'top', side: 'side column', bottom: 'bottom' }
const zoneOf = (v: unknown): BoxZone => (BOX_ZONES.includes(v as BoxZone) ? v as BoxZone : 'side')
const sideOf = (v: unknown): Side => (SIDES.includes(v as Side) ? v as Side : 'right')
const clampSize = (n: number) => Math.round(Math.min(100, Math.max(20, n)))

function InfoboxView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const host = useContext(InfoboxContext)
  const editable = editor.isEditable
  const zone = zoneOf(node.attrs.zone)
  const side = sideOf(node.attrs.side)
  const saved = clampSize(Number(node.attrs.size) || 40)
  const [drag, setDrag] = useState<number | null>(null)
  const size = drag ?? saved
  const inner = host?.render(zone) ?? null

  // drag the edge: the width is a share of the text column, like pictures
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const box = (e.currentTarget as HTMLElement).parentElement
    if (!box) return
    const start = e.clientX
    const startWidth = box.getBoundingClientRect().width
    const total = (editor.view.dom as HTMLElement).clientWidth || 1
    const dir = side === 'right' ? -1 : 1
    let last = saved
    const move = (ev: PointerEvent) => { last = clampSize(((startWidth + (ev.clientX - start) * dir) / total) * 100); setDrag(last) }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      updateAttributes({ size: last })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // outside a special page (a template, an embed, a shared page) there are no values to show
  if (!host || !inner) {
    if (!editable) return <NodeViewWrapper className="infobox-empty" contentEditable={false} />
    return (
      <NodeViewWrapper className="infobox infobox-placeholder" contentEditable={false} data-drag-handle="">
        <span className="muted">Details box: on a special page, its {ZONE_LABEL[zone]} shows here.</span>
        <button type="button" className="icon-btn" title="Remove the box" onClick={() => deleteNode()}><Undo2 size={14} /></button>
      </NodeViewWrapper>
    )
  }

  const btn = (title: string, active: boolean, onClick: () => void, icon: ReactNode) => (
    <button type="button" className={`icon-btn${active ? ' on' : ''}`} title={title} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{icon}</button>
  )
  return (
    <NodeViewWrapper className={`infobox infobox-${side}`} data-infobox="" data-zone={zone} contentEditable={false}
      style={side === 'full' ? undefined : { width: `${size}%` }}>
      {editable && (
        <div className="aside-tools infobox-tools">
          <span className="icon-btn grip" title="Drag to move the box" data-drag-handle="" draggable="true"><GripVertical size={14} /></span>
          {btn('Box on the left, text on the right', side === 'left', () => updateAttributes({ side: 'left' }), <PanelLeft size={14} />)}
          {btn('Box on the right, text on the left', side === 'right', () => updateAttributes({ side: 'right' }), <PanelRight size={14} />)}
          {btn('Full width, no text beside it', side === 'full', () => updateAttributes({ side: 'full' }), <RectangleHorizontal size={14} />)}
          {SIZES.map((s) => (
            <button key={s.label} type="button" className={`icon-btn text${side !== 'full' && saved === s.size ? ' on' : ''}`} title={`${s.size} percent of the line`}
              onMouseDown={(e) => e.preventDefault()} onClick={() => updateAttributes({ size: s.size, ...(side === 'full' ? { side: 'right' } : {}) })}>{s.label}</button>
          ))}
          {btn(`Back to the fixed ${ZONE_LABEL[zone]}`, false, () => deleteNode(), <Undo2 size={14} />)}
        </div>
      )}
      <div className="infobox-body">{inner}</div>
      {editable && side !== 'full' && <span className={`infobox-resize ${side}`} title="Drag to change the width" onPointerDown={startResize} />}
      {drag != null && <span className="img-size-badge">{drag}%</span>}
    </NodeViewWrapper>
  )
}

/**
 * The fields, picture and stat block of a special page as a box inside its text. The values stay in the page's fields
 * (props.data), so links, the character builder and hover cards keep working; the node only says where the box sits.
 */
export const Infobox = Node.create({
  name: 'infobox',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      zone: { default: 'side', parseHTML: (el) => zoneOf(el.getAttribute('data-zone')), renderHTML: (a) => ({ 'data-zone': a.zone }) },
      side: { default: 'right', parseHTML: (el) => sideOf(el.getAttribute('data-side')), renderHTML: (a) => ({ 'data-side': a.side }) },
      size: { default: 40, parseHTML: (el) => clampSize(Number(el.getAttribute('data-size')) || 40), renderHTML: (a) => ({ 'data-size': a.size }) },
    }
  },
  parseHTML() { return [{ tag: 'div[data-infobox]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-infobox': '' })] },
  addNodeView() { return ReactNodeViewRenderer(InfoboxView) },
})
