import { Check, ChevronDown } from 'lucide-react'
import { Children, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface SelectOption { value: string; label: ReactNode; text: string }

interface Props {
  value: string
  onChange: (value: string) => void
  /** Same <option> children a native select takes. */
  children?: ReactNode
  className?: string
  style?: CSSProperties
  disabled?: boolean
  title?: string
  placeholder?: string
}

const textOf = (n: ReactNode): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(textOf).join('') : isValidElement(n) ? textOf((n.props as any).children) : ''

function optionsOf(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = []
  Children.toArray(children).forEach((c) => {
    if (!isValidElement(c)) return
    const p = c.props as any
    if (c.type === 'option') out.push({ value: String(p.value ?? textOf(p.children)), label: p.children, text: textOf(p.children) })
    else if (p.children) out.push(...optionsOf(p.children))
  })
  return out
}

/** A dropdown in the app's own style, used instead of the browser's native select (whose popup can't be themed). */
export function Select({ value, onChange, children, className = '', style, disabled, title, placeholder }: Props) {
  const options = useMemo(() => optionsOf(children), [children])
  const current = options.find((o) => o.value === value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const typed = useRef({ s: '', t: 0 })

  const close = () => { setOpen(false); btn.current?.focus() }
  const openMenu = () => {
    if (disabled) return
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const choose = (i: number) => { const o = options[i]; if (o) { if (o.value !== value) onChange(o.value); close() } }

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const flip = below < 180 && above > below
    const width = Math.max(r.width, 140)
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      width,
      maxHeight: Math.min(320, flip ? above : below),
      ...(flip ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (list.current?.contains(t) || btn.current?.contains(t)) return
      setOpen(false)
    }
    const away = (e: Event) => { if (!list.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', down)
    window.addEventListener('resize', away)
    window.addEventListener('scroll', away, true)
    return () => {
      document.removeEventListener('mousedown', down)
      window.removeEventListener('resize', away)
      window.removeEventListener('scroll', away, true)
    }
  }, [open])

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active, pos])

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return
    const n = options.length
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu() }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % n) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + n) % n) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(n - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active) }
    else if (e.key === 'Tab') setOpen(false)
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const t = typed.current, nowMs = Date.now()
      t.s = nowMs - t.t > 700 ? e.key.toLowerCase() : t.s + e.key.toLowerCase()
      t.t = nowMs
      const i = options.findIndex((o) => o.text.toLowerCase().startsWith(t.s))
      if (i >= 0) setActive(i)
    }
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`select ${className}`}
        style={style}
        disabled={disabled}
        title={title}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKey}
      >
        <span className="select-value">{current ? current.label : <span className="muted">{placeholder ?? ''}</span>}</span>
        <ChevronDown size={14} className="select-caret" />
      </button>
      {open && pos && createPortal(
        <div ref={list} className="select-list" role="listbox" style={pos}>
          {options.map((o, i) => (
            <div
              key={o.value + i}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              className={`select-opt${o.value === value ? ' sel' : ''}${i === active ? ' act' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <span className="grow">{o.label}</span>
              {o.value === value && <Check size={14} />}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
