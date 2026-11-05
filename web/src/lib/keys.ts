export type Action =
  | 'search' | 'newPage' | 'capture' | 'zen' | 'back' | 'forward' | 'closeTab' | 'toggleSidebar' | 'graph' | 'zettels' | 'todos'

export const ACTION_LABELS: Record<Action, string> = {
  search: 'Quick search / commands',
  newPage: 'New page',
  capture: 'Quick capture (zettel)',
  zen: 'Zen writing mode',
  back: 'Navigate back',
  forward: 'Navigate forward',
  closeTab: 'Close tab',
  toggleSidebar: 'Toggle sidebar',
  graph: 'Open graph',
  zettels: 'Open zettelkasten',
  todos: 'Open todos',
}

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  search: ['Ctrl+K'],
  newPage: ['Alt+N'],
  capture: ['Alt+C'],
  zen: ['Alt+Z'],
  back: ['Ctrl+Alt+ArrowLeft', 'Alt+ArrowLeft'],
  forward: ['Ctrl+Alt+ArrowRight', 'Alt+ArrowRight'],
  closeTab: ['Alt+W'],
  toggleSidebar: ['Alt+B'],
  graph: ['Alt+G'],
  zettels: ['Alt+Y'],
  todos: ['Alt+T'],
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'])

/** Normalises a key event to e.g. "Ctrl+Alt+ArrowLeft". Cmd (Meta) counts as Ctrl. Returns null for bare modifiers. */
export function eventToCombo(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let key = e.key
  if (key === ' ') key = 'Space'
  if (key.length === 1) key = key.toUpperCase()
  parts.push(key)
  return parts.join('+')
}

export function prettyCombo(c: string) {
  return c.replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace(/\+/g, ' + ')
}

const KEY = 'keybindings'

export function loadBindings(): Record<Action, string[]> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { ...DEFAULT_BINDINGS, ...saved }
  } catch { return { ...DEFAULT_BINDINGS } }
}

export function saveBindings(b: Record<Action, string[]>) {
  localStorage.setItem(KEY, JSON.stringify(b))
}

export function matchAction(combo: string, bindings: Record<Action, string[]>): Action | null {
  for (const [action, combos] of Object.entries(bindings) as [Action, string[]][]) {
    if (combos.includes(combo)) return action
  }
  return null
}
