import { create } from 'zustand'

// In-app replacements for window.prompt/confirm/alert. Electron has no prompt(), and the native ones look out of place.
export type DialogRequest =
  | { kind: 'prompt'; title: string; label?: string; initial: string; placeholder?: string; okLabel: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; okLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'alert'; title: string; message: string; resolve: () => void }

interface DialogState { queue: DialogRequest[] }
export const useDialogs = create<DialogState>(() => ({ queue: [] }))

const ids = new WeakMap<DialogRequest, number>()
let nextId = 1
export const dialogKey = (r: DialogRequest) => ids.get(r) ?? 0
const push = (r: DialogRequest) => {
  ids.set(r, nextId++)
  useDialogs.setState((s) => ({ queue: [...s.queue, r] }))
}
export const shiftDialog = () => useDialogs.setState((s) => ({ queue: s.queue.slice(1) }))

export function askText(title: string, opts: { label?: string; initial?: string; placeholder?: string; okLabel?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => push({ kind: 'prompt', title, label: opts.label, initial: opts.initial ?? '', placeholder: opts.placeholder, okLabel: opts.okLabel ?? 'OK', resolve }))
}

export function confirmDialog(message: string, opts: { title?: string; okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => push({ kind: 'confirm', title: opts.title ?? 'Are you sure?', message, okLabel: opts.okLabel ?? 'OK', danger: opts.danger ?? false, resolve }))
}

export function alertDialog(message: string, title = 'Notice'): Promise<void> {
  return new Promise((resolve) => push({ kind: 'alert', title, message, resolve }))
}
