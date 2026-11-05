import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { highlight } from '../lib/fuzzy'
import { useSuggest } from './suggest'

export function SuggestPopup() {
  const { open, items, index, rect, range } = useSuggest()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !rect) return setPos(null)
    const h = ref.current?.offsetHeight ?? 260
    const w = 340
    const left = Math.min(rect.left, window.innerWidth - w - 8)
    const below = rect.bottom + 6
    const top = below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 6) : below
    setPos({ left: Math.max(8, left), top })
  }, [open, rect, items.length])

  useEffect(() => {
    ref.current?.querySelector('.result.sel')?.scrollIntoView({ block: 'nearest' })
  }, [index, items])

  if (!open || !items.length) return null
  let lastGroup: string | undefined
  return (
    <div className="suggest" ref={ref} style={{ left: pos?.left ?? -999, top: pos?.top ?? -999 }} onMouseDown={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        const header = it.group !== lastGroup ? it.group : undefined
        lastGroup = it.group
        return (
          <div key={it.key}>
            {header && <div className="group">{header}</div>}
            <div className={`result ${i === index ? 'sel' : ''}`} onMouseEnter={() => useSuggest.getState().set({ index: i })}
              onClick={() => range && it.run(range)}>
              {it.icon && <span className="muted row">{it.icon}</span>}
              <div className="grow">
                <div className="ellipsis">{it.indices?.length ? highlight(it.label, it.indices).map((p, k) => typeof p === 'string' ? p : <mark key={k}>{p.m}</mark>) : it.label}</div>
                {it.sub && <div className="sub ellipsis">{it.sub}</div>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
