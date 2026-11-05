export interface FontChoice { id: string; name: string; stack: string }

// Only fonts that ship with the OS (or are generic families) so the app keeps working offline.
export const FONTS: FontChoice[] = [
  { id: 'system', name: 'System sans', stack: '-apple-system, "Segoe UI", Inter, system-ui, sans-serif' },
  { id: 'serif', name: 'Serif (Georgia)', stack: 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif' },
  { id: 'book', name: 'Book (Palatino)', stack: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif' },
  { id: 'humanist', name: 'Humanist (Candara)', stack: 'Candara, Optima, Calibri, "Segoe UI", sans-serif' },
  { id: 'rounded', name: 'Rounded', stack: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif' },
  { id: 'mono', name: 'Monospace', stack: 'ui-monospace, "Cascadia Code", Consolas, Menlo, monospace' },
  { id: 'dyslexic', name: 'Readable (Verdana)', stack: 'Verdana, Tahoma, sans-serif' },
]

export interface FontPrefs { ui: string; body: string; size: number }

const KEY = 'fonts'
export const DEFAULT_FONTS: FontPrefs = { ui: 'system', body: 'system', size: 100 }

export function loadFonts(): FontPrefs {
  try { return { ...DEFAULT_FONTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return DEFAULT_FONTS }
}

/** A choice id from FONTS, or any custom CSS font-family string the user typed. */
const stackOf = (v: string) => FONTS.find((f) => f.id === v)?.stack ?? (v.trim() || FONTS[0].stack)

export function applyFonts(p: FontPrefs = loadFonts()) {
  const root = document.documentElement.style
  root.setProperty('--font-ui', stackOf(p.ui))
  root.setProperty('--font-body', p.body === 'same' ? stackOf(p.ui) : stackOf(p.body))
  root.setProperty('--font-scale', String(Math.min(1.6, Math.max(0.7, p.size / 100))))
}

export function saveFonts(p: FontPrefs) {
  localStorage.setItem(KEY, JSON.stringify(p))
  applyFonts(p)
}
