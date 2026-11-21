// The single-key shortcuts of the table, and the keys a person has chosen for them instead (kept in this browser only).

export type KeyAction = 'fit' | 'rotate' | 'hide' | 'lock'
export const KEY_ACTIONS: { id: KeyAction; label: string; gm?: boolean }[] = [
  { id: 'fit', label: 'Fit the map to the screen' },
  { id: 'rotate', label: 'Turn the selected tokens' },
  { id: 'hide', label: 'Hide or show the selected tokens', gm: true },
  { id: 'lock', label: 'Lock or unlock the selected tokens', gm: true },
]
export const DEFAULT_KEYS: Record<KeyAction, string> = { fit: 'f', rotate: 'r', hide: 'h', lock: 'l' }
const STORE = 'tt-keys'

/** A key that can be bound: one letter or digit. Anything else is refused so the arrows, Delete and Escape keep their meaning. */
export const bindable = (k: string) => /^[a-z0-9]$/i.test(k)

/** The keys in use: the defaults with a person's own choices over them. Two actions never share a key. */
export function loadKeys(raw: string | null = (() => { try { return localStorage.getItem(STORE) } catch { return null } })()): Record<KeyAction, string> {
  const out = { ...DEFAULT_KEYS }
  try {
    const saved = raw ? JSON.parse(raw) : {}
    const used = new Set<string>()
    for (const a of Object.keys(DEFAULT_KEYS) as KeyAction[]) {
      const k = typeof saved?.[a] === 'string' ? saved[a].toLowerCase() : ''
      if (bindable(k) && !used.has(k)) { out[a] = k; used.add(k) }
    }
    // a default that a choice took over moves out of the way of nobody: a clash falls back to the default
    for (const a of Object.keys(DEFAULT_KEYS) as KeyAction[]) if (!bindable(saved?.[a] ?? '') && used.has(out[a])) out[a] = DEFAULT_KEYS[a]
  } catch { /* unreadable choices are ignored */ }
  return out
}

/** Binds a key to an action. Returns the new keys, or an error sentence when another action already has that key. */
export function bind(keys: Record<KeyAction, string>, action: KeyAction, key: string): { keys: Record<KeyAction, string> } | { error: string } {
  const k = key.toLowerCase()
  if (!bindable(k)) return { error: 'Use a letter or a number.' }
  const taken = (Object.keys(keys) as KeyAction[]).find((a) => a !== action && keys[a] === k)
  if (taken) return { error: `${k.toUpperCase()} already does something else here.` }
  return { keys: { ...keys, [action]: k } }
}

export function saveKeys(keys: Record<KeyAction, string>) {
  try { localStorage.setItem(STORE, JSON.stringify(keys)) } catch { /* not kept */ }
}

/** Is this the key bound to the action (without Ctrl, Alt or Meta)? */
export const pressed = (e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, keys: Record<KeyAction, string>, action: KeyAction) => !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === keys[action]
