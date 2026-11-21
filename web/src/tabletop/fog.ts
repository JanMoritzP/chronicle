import { Container, Graphics, RenderTexture, Sprite, Texture, type Application } from 'pixi.js'
import type { Pt } from './grid'
import type { Scene } from './state'
import { pointInPolygon, visibility, type Seg } from './visibility'

// Fog of war and light. A player sees what their own tokens can see (walls block sight) and that is also lit (by the sky, a light source,
// or the token's darkvision). What they have seen stays on the map, dimmed. Everything is drawn into small off-screen pictures that are
// combined into one dark layer with holes in it, laid over the scene.

export interface Wall { id: string; x1: number; y1: number; x2: number; y2: number; kind: 'wall' | 'door' | 'secret' | 'window' | 'oneway'; open: boolean; locked?: boolean }
export interface Rect { id?: string; x: number; y: number; w: number; h: number }
export interface Light { id: string; x: number; y: number; bright?: number; dim?: number; color?: string; animation?: 'flicker' | 'pulse' }
export interface Viewer { id: string; x: number; y: number; sight: number | null; dark: number }

const MAX_SIDE = 768
const SAVE_EVERY_MS = 4000

/** Walls that stop sight: closed doors and plain walls. Windows and open doors let it through. */
export const blocksSight = (w: Wall) => w.kind === 'wall' || w.kind === 'secret' || w.kind === 'oneway' || (w.kind === 'door' && !w.open)
/** A one-way wall can be seen through from the side its arrow points to. */
export const seesThrough = (w: Wall, p: Pt) => w.kind === 'oneway' && (w.x2 - w.x1) * (p.y - w.y1) - (w.y2 - w.y1) * (p.x - w.x1) < 0

export class FogLayer {
  readonly view = new Container()
  private scene: Scene | null = null
  private enabled = false
  private walls: Wall[] = []
  private lights: Light[] = []
  private viewers: Viewer[] = []
  private k = 1
  private v?: RenderTexture
  private d?: RenderTexture
  private r?: RenderTexture
  private e?: RenderTexture
  private o?: RenderTexture
  private out?: Sprite
  /** the colour of coloured lights, under the darkness so unseen places stay dark */
  private tint = new Graphics()
  private tintPolys: { pts: number[]; color: number; anim?: string }[] = []
  private reveals: Rect[] = []
  private queued = false
  private seen: Pt[][] = []
  private lit: Pt[][] = []
  private dirtyExplored = false
  private saveTimer: number | undefined
  /** Called with the explored area as a PNG (base64) a few seconds after it changed. */
  onExplored: (png: string) => void = () => {}
  /** Called when the dark layer was redrawn, so the screen can be painted again. */
  onDrawn: () => void = () => {}

  constructor(private app: Application) { this.view.eventMode = 'none' }

  private px(units: number) { return this.scene ? (units / this.scene.dist) * this.scene.gridSize : units }

  configure(scene: Scene | null, enabled: boolean) {
    const sizeChanged = !this.scene || !scene || this.scene.id !== scene.id || this.scene.width !== scene.width || this.scene.height !== scene.height
    this.scene = scene
    this.enabled = enabled && !!scene && (scene.fog || scene.darkness > 0)
    this.view.visible = this.enabled
    if (sizeChanged) this.rebuild()
    this.update()
  }

  private free() {
    for (const t of [this.v, this.d, this.r, this.e, this.o]) t?.destroy(true)
    this.v = this.d = this.r = this.e = this.o = undefined
    this.out?.destroy()
    this.out = undefined
    this.view.removeChildren()
    this.tint.clear()
  }

  private rebuild() {
    this.flushSave()
    this.free()
    const s = this.scene
    if (!s) return
    this.k = Math.min(1, MAX_SIDE / Math.max(s.width, s.height))
    const w = Math.max(16, Math.round(s.width * this.k)), h = Math.max(16, Math.round(s.height * this.k))
    const make = () => RenderTexture.create({ width: w, height: h, resolution: 1 })
    this.v = make(); this.d = make(); this.r = make(); this.e = make(); this.o = make()
    this.out = new Sprite(this.o)
    this.out.scale.set(1 / this.k)
    this.view.addChild(this.tint, this.out)
  }

  setWalls(walls: Wall[]) { this.walls = walls; this.update() }
  setLights(lights: Light[]) { this.lights = lights; this.update() }
  setViewers(viewers: Viewer[]) { this.viewers = viewers; this.update() }
  /** Areas the GM showed the players: seen and lit, whatever the walls. */
  setReveals(reveals: Rect[]) { this.reveals = reveals; this.update() }
  /** Does a coloured light move (flicker, pulse)? Then the screen is painted again every frame. */
  get animated() { return this.enabled && this.tintPolys.some((t) => t.anim) }
  /** The tint of moving lights for this moment. */
  animate(now: number) {
    this.tint.clear()
    for (const t of this.tintPolys) {
      const wave = t.anim === 'pulse' ? 0.5 + 0.5 * Math.sin(now / 600) : t.anim === 'flicker' ? 0.5 + 0.5 * Math.sin(now / 90) * Math.sin(now / 37 + 1) : 0.5
      this.tint.poly(t.pts).fill({ color: t.color, alpha: t.anim ? 0.12 + 0.2 * wave : 0.22 })
    }
  }

  /** Brings back the explored area that was stored on the server. */
  async loadExplored(png: string | null) {
    if (!this.e) return
    this.app.renderer.render({ container: new Container(), target: this.e, clear: true })
    if (png) {
      try {
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const sprite = new Sprite(Texture.from(bmp))
        sprite.width = this.e.width
        sprite.height = this.e.height
        this.app.renderer.render({ container: sprite, target: this.e, clear: false })
        sprite.destroy()
      } catch { /* a damaged picture just means nothing was explored */ }
    }
    this.dirtyExplored = false
    this.update()
  }

  reset() { void this.loadExplored(null) }

  /** Can this point be seen right now? Used to hide tokens in the dark and behind walls. */
  isVisible(p: Pt): boolean {
    if (!this.enabled) return true
    if (!this.seen.some((poly) => pointInPolygon(p, poly))) return false
    const s = this.scene!
    return s.darkness <= 0.02 || this.lit.some((poly) => pointInPolygon(p, poly))
  }

  update() {
    if (this.queued) return
    this.queued = true
    requestAnimationFrame(() => { this.queued = false; this.draw() })
  }

  private draw() {
    const s = this.scene
    if (!this.enabled || !s || !this.v || !this.d || !this.r || !this.e || !this.o) return
    const k = this.k
    const bounds = { x: 0, y: 0, w: s.width, h: s.height }
    const segs: Seg[] = this.walls.filter(blocksSight)
    const flat = (poly: Pt[]) => poly.flatMap((p) => [p.x * k, p.y * k])
    const clear = { r: 0, g: 0, b: 0, a: 0 }

    // coloured lights tint what they reach
    this.tint.clear()
    this.tintPolys = []
    for (const l of this.lights) {
      if (!l.color && !l.animation) continue
      const reach = this.px(Math.max(l.dim ?? 0, l.bright ?? 0))
      if (reach <= 0) continue
      const poly = visibility(l, segs, bounds, reach)
      const col = l.color ?? '#ffd9a0'
      if (poly.length > 2) this.tintPolys.push({ pts: poly.flatMap((p) => [p.x, p.y]), color: Number.parseInt(col.length === 4 ? col.slice(1).replace(/./g, (c) => c + c) : col.slice(1, 7), 16) || 0xffffff, anim: l.animation })
    }
    this.animate(performance.now())

    // what the players' tokens see
    this.seen = this.viewers.map((vw) => visibility(vw, this.walls.filter((w) => blocksSight(w) && !seesThrough(w, vw)), bounds, vw.sight == null ? Infinity : this.px(vw.sight)))
    const rectPoly = (r: Rect): Pt[] => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]
    for (const r of this.reveals) this.seen.push(rectPoly(r))
    const seenG = new Graphics()
    for (const poly of this.seen) if (poly.length > 2) seenG.poly(flat(poly)).fill({ color: 0xffffff, alpha: 1 })
    this.app.renderer.render({ container: seenG, target: this.v, clear: true, clearColor: clear })
    seenG.destroy()

    // how dark it is: darkness everywhere, pushed back by light and darkvision
    this.lit = []
    const darkC = new Container()
    if (s.darkness > 0.02) {
      darkC.addChild(new Graphics().rect(0, 0, s.width * k, s.height * k).fill({ color: 0x000000, alpha: s.darkness }))
      const carve = (origin: Pt, radius: number, alpha: number, remember: boolean) => {
        const poly = visibility(origin, segs, bounds, radius)
        if (poly.length < 3) return
        if (remember) this.lit.push(poly)
        const g = new Graphics().poly(flat(poly)).fill({ color: 0xffffff, alpha })
        g.blendMode = 'erase'
        darkC.addChild(g)
      }
      for (const l of this.lights) {
        const dim = this.px(Math.max(l.dim ?? 0, l.bright ?? 0)), bright = this.px(l.bright ?? 0)
        if (dim > 0) carve(l, dim, 0.55, true)
        if (bright > 0) carve(l, bright, 0.9, true)
      }
      this.viewers.forEach((vw) => { if (vw.dark > 0) carve(vw, this.px(vw.dark), 0.85, true) })
      for (const r of this.reveals) { this.lit.push(rectPoly(r)); const g = new Graphics().poly(flat(rectPoly(r))).fill({ color: 0xffffff, alpha: 0.9 }); g.blendMode = 'erase'; darkC.addChild(g) }
    }
    this.app.renderer.render({ container: darkC, target: this.d, clear: true, clearColor: clear })
    darkC.destroy({ children: true })

    // seen and lit: the part of the view that is not dark
    const combine = new Container()
    const sv = new Sprite(this.v)
    const sd = new Sprite(this.d)
    sd.blendMode = 'erase'
    combine.addChild(sv, sd)
    this.app.renderer.render({ container: combine, target: this.r, clear: true, clearColor: clear })
    combine.destroy()

    // remember it
    const keep = new Sprite(this.r)
    this.app.renderer.render({ container: keep, target: this.e, clear: false })
    keep.destroy()
    this.dirtyExplored = true
    this.scheduleSave()

    // the dark layer: black everywhere, dimmed where it was seen before, clear where it is seen now
    const cover = new Container()
    cover.addChild(new Graphics().rect(0, 0, s.width * k, s.height * k).fill({ color: 0x000000, alpha: 0.96 }))
    const old = new Sprite(this.e)
    old.blendMode = 'erase'
    old.alpha = 0.55
    const now = new Sprite(this.r)
    now.blendMode = 'erase'
    cover.addChild(old, now)
    this.app.renderer.render({ container: cover, target: this.o, clear: true, clearColor: clear })
    cover.destroy({ children: true })
    this.onDrawn()
  }

  private scheduleSave() {
    if (this.saveTimer) return
    this.saveTimer = window.setTimeout(() => { this.saveTimer = undefined; this.flushSave() }, SAVE_EVERY_MS)
  }

  flushSave() {
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    if (!this.dirtyExplored || !this.e) return
    this.dirtyExplored = false
    try {
      const canvas = this.app.renderer.extract.canvas({ target: this.e }) as HTMLCanvasElement
      const url = canvas.toDataURL('image/png')
      const png = url.slice(url.indexOf(',') + 1)
      if (png.length < 280_000) this.onExplored(png)
    } catch { /* extraction can fail while the page is closing */ }
  }

  destroy() {
    this.flushSave()
    this.free()
    this.view.destroy()
  }
}
