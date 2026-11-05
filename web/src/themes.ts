export interface Theme { id: string; name: string; dark: boolean; swatch: [string, string, string] }

// The actual colour values live in styles.css as [data-theme="<id>"] blocks. To add a theme: add a block there and an entry here.
export const THEMES: Theme[] = [
  { id: 'parchment', name: 'Parchment', dark: false, swatch: ['#efe6d8', '#8b6b4a', '#3b2f25'] },
  { id: 'linen', name: 'Linen', dark: false, swatch: ['#f4f1ec', '#a07a54', '#2f2a25'] },
  { id: 'sage', name: 'Sage', dark: false, swatch: ['#e9eee4', '#6f8a5f', '#27311f'] },
  { id: 'tide', name: 'Tide', dark: false, swatch: ['#e6edf0', '#4f7f94', '#1f2f38'] },
  { id: 'rosewood', name: 'Rosewood', dark: false, swatch: ['#f1e6e4', '#a35d62', '#35201f'] },
  { id: 'tavern', name: 'Tavern', dark: true, swatch: ['#2a211b', '#c58f55', '#eadcc8'] },
  { id: 'ink', name: 'Ink', dark: true, swatch: ['#1c1d21', '#9a8cff', '#e4e4ea'] },
  { id: 'forest', name: 'Forest', dark: true, swatch: ['#1b2420', '#7fb089', '#dbe8dd'] },
  { id: 'dusk', name: 'Dusk', dark: true, swatch: ['#241f2d', '#c08ad8', '#e8e0f0'] },
  { id: 'slate', name: 'Slate', dark: true, swatch: ['#1f252b', '#6aa6c9', '#dde6ec'] },
]

export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id
  localStorage.setItem('theme', id)
  const t = THEMES.find((x) => x.id === id)
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t?.swatch[0] ?? '#e9dfd0')
}
