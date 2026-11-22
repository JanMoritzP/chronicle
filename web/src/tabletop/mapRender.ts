import { THEMES, wallSegments, type DocProp, type MapDoc } from './mapdoc'

// Draws a map document: the picture the scene will use, and (in the editor) the lights on top. Canvas 2D, nothing from the page.

const shade = (x: number, y: number) => ((x * 73 + y * 151 + x * y * 7) % 9) / 9

const pictures = new Map<string, HTMLImageElement | 'loading' | 'failed'>()
/** A picture of the world for a prop: drawn once it has loaded (`onLoad` asks for the map to be drawn again), and waited for by `loadPictures`. */
function pictureFor(url: string, onLoad?: () => void): HTMLImageElement | null {
  const have = pictures.get(url)
  if (have && have !== 'loading' && have !== 'failed') return have
  if (!have) {
    pictures.set(url, 'loading')
    const img = new Image()
    img.onload = () => { pictures.set(url, img); onLoad?.() }
    img.onerror = () => pictures.set(url, 'failed')
    img.src = url
  }
  return null
}
export const loadPictures = (d: MapDoc) => Promise.all([...new Set(d.props.filter((p) => p.kind === 'picture' && p.image).map((p) => p.image!))].map((u) => new Promise<void>((resolve) => {
  if (pictureFor(u, resolve)) resolve(); else if (pictures.get(u) === 'failed') resolve()
  else setTimeout(resolve, 8000)
})))

function prop(ctx: CanvasRenderingContext2D, p: DocProp, px: number, onLoad?: () => void) {
  const cx = (p.x + 0.5) * px, cy = (p.y + 0.5) * px, u = px / 10
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((p.turn * Math.PI) / 2)
  if (p.kind === 'picture' && p.image) {
    const img = pictureFor(p.image, onLoad)
    if (img) { const w = (p.size ?? 1) * px, h = (w * img.naturalHeight) / (img.naturalWidth || 1); ctx.drawImage(img, -w / 2, -h / 2, w, h) }
    ctx.restore()
    return
  }
  ctx.lineWidth = Math.max(1, u * 0.35)
  ctx.strokeStyle = 'rgba(0,0,0,0.65)'
  const rect = (w: number, h: number, fill: string, r = u * 0.6) => { ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, r); ctx.fillStyle = fill; ctx.fill(); ctx.stroke() }
  const disc = (r: number, fill: string) => { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.stroke() }
  switch (p.kind) {
    case 'table': rect(u * 7.5, u * 4.6, '#7a5230'); break
    case 'pillar': disc(u * 3.4, '#9a9aa2'); ctx.beginPath(); ctx.arc(-u * 0.8, -u * 0.8, u * 1.2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill(); break
    case 'chest': rect(u * 6.4, u * 4.2, '#8a5a2b'); ctx.beginPath(); ctx.moveTo(-u * 3.2, -u * 0.6); ctx.lineTo(u * 3.2, -u * 0.6); ctx.stroke(); rect(u * 1, u * 1.4, '#d4af37', u * 0.3); break
    case 'altar': rect(u * 6, u * 3.6, '#b9b4aa'); ctx.beginPath(); ctx.moveTo(0, -u * 1.2); ctx.lineTo(0, u * 1.2); ctx.moveTo(-u * 0.9, -u * 0.2); ctx.lineTo(u * 0.9, -u * 0.2); ctx.stroke(); break
    case 'statue': disc(u * 3.2, '#c3c3c8'); ctx.beginPath(); ctx.moveTo(0, -u * 2); ctx.lineTo(u * 1.6, 0); ctx.lineTo(0, u * 2); ctx.lineTo(-u * 1.6, 0); ctx.closePath(); ctx.fillStyle = '#8f8f96'; ctx.fill(); ctx.stroke(); break
    case 'bed': rect(u * 4.6, u * 8, '#6d3b3b'); rect(u * 3.6, u * 2, '#e8e2d4', u * 0.8); break
    case 'barrel': disc(u * 3.4, '#8a5a2b'); ctx.beginPath(); ctx.arc(0, 0, u * 2.2, 0, Math.PI * 2); ctx.stroke(); break
    case 'stairs': for (let i = 0; i < 5; i++) { ctx.fillStyle = `rgba(40,36,44,${0.15 + i * 0.12})`; ctx.fillRect(-u * 4, -u * 4.5 + i * u * 1.8, u * 8, u * 1.7); ctx.strokeRect(-u * 4, -u * 4.5 + i * u * 1.8, u * 8, u * 1.7) } break
    case 'rug': rect(u * 8.6, u * 8.6, '#8e2f3a', u * 0.5); ctx.strokeStyle = '#e6c27a'; ctx.strokeRect(-u * 3.6, -u * 3.6, u * 7.2, u * 7.2); break
    case 'fire': disc(u * 3.4, '#3a3a3f'); ctx.beginPath(); ctx.arc(0, 0, u * 2.2, 0, Math.PI * 2); ctx.fillStyle = '#e8741f'; ctx.fill(); ctx.beginPath(); ctx.arc(0, 0, u * 1.1, 0, Math.PI * 2); ctx.fillStyle = '#ffd24a'; ctx.fill(); break
  }
  ctx.restore()
}

/** Paints the map into a canvas context for cells `px` wide. `lights` draws the light sources and their reach (for the editor, not the picture). */
export function drawMap(ctx: CanvasRenderingContext2D, d: MapDoc, px: number, opts: { lights?: boolean; /** called when a picture of a prop has loaded and the map should be drawn again */ onLoad?: () => void } = {}) {
  const t = THEMES[d.theme]
  ctx.fillStyle = t.bg
  ctx.fillRect(0, 0, d.cols * px, d.rows * px)
  for (let y = 0; y < d.rows; y++) for (let x = 0; x < d.cols; x++) {
    if (d.floor[y][x] !== '1') continue
    ctx.fillStyle = t.floor
    ctx.fillRect(x * px, y * px, px, px)
    ctx.fillStyle = `rgba(0,0,0,${shade(x, y) * 0.12})`
    ctx.fillRect(x * px, y * px, px, px)
  }
  ctx.strokeStyle = t.line
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let y = 0; y < d.rows; y++) for (let x = 0; x < d.cols; x++) if (d.floor[y][x] === '1') ctx.rect(x * px + 0.5, y * px + 0.5, px, px)
  ctx.stroke()
  for (const p of d.props) if (p.kind === 'rug') prop(ctx, p, px, opts.onLoad)
  // walls: a dark line with a light edge, and doors as small wooden slabs across their edge
  ctx.lineCap = 'round'
  for (const w of wallSegments(d, px)) {
    if (w.kind === 'wall' || w.kind === 'secret') {
      ctx.strokeStyle = t.wall; ctx.lineWidth = Math.max(3, px * 0.16)
      ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke()
    } else if (w.kind === 'window') {
      // a window: the wall with a pale pane in it
      ctx.strokeStyle = t.wall; ctx.lineWidth = Math.max(3, px * 0.16)
      ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke()
      ctx.strokeStyle = '#9fd6ee'; ctx.lineWidth = Math.max(2, px * 0.07)
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1
      ctx.beginPath(); ctx.moveTo(w.x1 + dx * 0.15, w.y1 + dy * 0.15); ctx.lineTo(w.x2 - dx * 0.15, w.y2 - dy * 0.15); ctx.stroke()
    } else {
      const horizontal = w.y1 === w.y2
      ctx.save()
      ctx.translate((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2)
      ctx.fillStyle = '#9b6a35'; ctx.strokeStyle = '#2a1a0c'; ctx.lineWidth = Math.max(1, px * 0.04)
      const len = px * 0.8, th = px * 0.2
      ctx.beginPath(); ctx.roundRect(horizontal ? -len / 2 : -th / 2, horizontal ? -th / 2 : -len / 2, horizontal ? len : th, horizontal ? th : len, px * 0.04); ctx.fill(); ctx.stroke()
      ctx.restore()
    }
  }
  for (const p of d.props) if (p.kind !== 'rug') prop(ctx, p, px, opts.onLoad)
  if (opts.lights) {
    for (const l of d.lights) {
      const cx = (l.x + 0.5) * px, cy = (l.y + 0.5) * px
      ctx.beginPath(); ctx.arc(cx, cy, l.radius * px, 0, Math.PI * 2); ctx.fillStyle = `${l.color}22`; ctx.fill()
      ctx.strokeStyle = `${l.color}aa`; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([])
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(4, px * 0.2), 0, Math.PI * 2); ctx.fillStyle = l.color; ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke()
    }
  }
}

/** The map as the picture a scene uses, with cells `px` wide. */
export async function mapPicture(d: MapDoc, px: number): Promise<Blob> {
  await loadPictures(d)
  const c = document.createElement('canvas')
  c.width = d.cols * px; c.height = d.rows * px
  drawMap(c.getContext('2d')!, d, px)
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png'))
}
