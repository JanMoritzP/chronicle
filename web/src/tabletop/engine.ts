import { Application, Color, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import { FogLayer, type Light, type Rect, type Wall } from './fog'
import type { Pin } from './state'
import type { DrawKind, Drawing, Tile } from './state'
import { formatDistance, hexCentres, hexCorners, inTemplate, measure, snap, tokenPixels, type Pt } from './grid'
import { blockedPath, reach } from './movement'
import { isLightSource, type Cursor, type Ruler, type Scene, type Token } from './state'

// The picture of a scene: background, grid, tokens, rulers, pings and other people's cursors, drawn with WebGL.
// The engine knows nothing about the network. It reports what the person did through hooks and shows what it is told.

export interface Hooks {
  canMove(t: Token): boolean
  /** how far a token may still walk this turn, in the scene's units, or null when that is not known */
  moveLeft(t: Token): number | null
  onMove(moves: { id: string; x: number; y: number }[]): void
  onSelect(ids: string[]): void
  onPing(p: Pt): void
  onCursor(p: Pt): void
  onRuler(points: Pt[] | null): void
  onWallAdd(walls: { x1: number; y1: number; x2: number; y2: number; kind: Wall['kind'] }[]): void
  onWallErase(id: string): void
  /** wall ends were dragged somewhere else */
  onWallMove(updates: { id: string; patch: Partial<Pick<Wall, 'x1' | 'y1' | 'x2' | 'y2'>> }[]): void
  onDoor(id: string): void
  onDoorLock(id: string, locked: boolean): void
  /** the GM showed an area to the players, or took one back */
  onReveal(r: { x: number; y: number; w: number; h: number }): void
  onUnreveal(id: string): void
  /** the GM held Alt and Shift: ping here and bring everyone to look at it */
  onPull(p: Pt): void
  onPinPlace(p: Pt): void
  /** the GM clicked empty ground with the light tool */
  onLightPlace(p: Pt): void
  onPin(pin: Pin): void
  onPinDelete(id: string): void
  onExplored(png: string): void
  onDraw(d: { kind: DrawKind; points: Pt[]; color: string; width: number; fill: string }): void
  onText(p: Pt, done: (text: string | null) => void): void
  onDrawErase(id: string): void
  onDrawMove(id: string, dx: number, dy: number): void
  onTileSelect(id: string | null): void
  onTileMove(id: string, x: number, y: number): void
  colorOf(userId: string): number
}
export type Tool = 'select' | 'ruler' | 'wall' | 'erase' | 'draw' | 'reveal' | 'conceal' | 'pin' | 'light'

const textures = new Map<string, Promise<Texture | null>>()
/** Images come from our own server behind the login cookie, so they are fetched rather than handed to the loader by address. */
function loadTexture(url: string) {
  let p = textures.get(url)
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error('missing')))).then((b) => createImageBitmap(b)).then((bmp) => Texture.from(bmp)).catch(() => null)
    textures.set(url, p)
  }
  return p
}

const videoKinds = new Map<string, Promise<boolean>>()
/** Is the map picture at this address a looping video? Asked once, from the type the server gives it. */
function isVideoUrl(url: string) {
  let p = videoKinds.get(url)
  if (!p) { p = fetch(url, { method: 'HEAD' }).then((r) => (r.headers.get('content-type') ?? '').startsWith('video/')).catch(() => false); videoKinds.set(url, p) }
  return p
}
function makeVideo(url: string): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.preload = 'auto'
    v.onloadeddata = () => resolve(v)
    v.onerror = () => resolve(null)
    v.src = url
    void v.play().catch(() => undefined)
  })
}

interface TokenView { box: Container; token: Token; key: string }

const HIT_PAD = 4

export class TableEngine {
  private app = new Application()
  private ready = false
  private gone = false
  private world = new Container()
  private bg = new Container()
  private gridG = new Graphics()
  private tokenLayer = new Container()
  private overlay = new Container()
  private scene: Scene | null = null
  private views = new Map<string, TokenView>()
  private selected = new Set<string>()
  private tokens = new Map<string, Token>()
  private fitted = ''
  private tool: Tool = 'select'
  private pings: { g: Graphics; born: number }[] = []
  private others = new Container()
  private ruleG = new Graphics()
  private ruleLabel = new Text({ text: '', style: { fontSize: 14, fill: 0xffffff, fontFamily: 'sans-serif', stroke: { color: 0x000000, width: 3 } } })
  private marquee = new Graphics()
  private wallG = new Graphics()
  private triggerG = new Graphics()
  /** A colour over the whole scene (candle light, dusk), under the fog. */
  private ambientG = new Graphics()
  /** Rain or snow over the screen (not the map), drawn while the scene has any. */
  private weatherG = new Graphics()
  private weather: 'none' | 'rain' | 'snow' = 'none'
  private drops: { x: number; y: number; v: number; s: number }[] = []
  private triggers: { x: number; y: number; radius: number; fired: boolean }[] = []
  private drawLayer = new Container()
  private tileBg = new Container()
  private tileOver = new Container()
  private tileGm = new Container()
  private tileSel = new Graphics()
  private tiles: Tile[] = []
  private tileBoxes = new Map<string, Container>()
  private selectedTile: string | null = null
  private drawStyle: { kind: DrawKind; color: string; width: number; fill: string } = { kind: 'free', color: '#ff5252', width: 4, fill: '' }
  private drawings: Drawing[] = []
  private stroke: Pt[] = []
  private strokeG = new Graphics()
  private wallPreview = new Graphics()
  private walls: Wall[] = []
  private wallKind: Wall['kind'] = 'wall'
  private wallShape: 'line' | 'rect' = 'line'
  private pins: Pin[] = []
  private pinLayer = new Container()
  /** corners of a polygon being drawn, one click each */
  private polyPts: Pt[] = []
  private reveals: Rect[] = []
  private revealG = new Graphics()
  private wallPoly: Pt[] = []
  private lastClick = { t: 0, x: 0, y: 0 }
  private fog!: FogLayer
  private turnId: string | null = null
  private me = { id: '', gm: true, canDoors: false }
  /** walls stop dragged tokens (the GM passes by holding Ctrl) */
  private wallsBlock = true
  /** The GM looking through the eyes of players or tokens: fog, darkness, secret doors and hidden tokens work as they do for them. */
  private preview: { users: string[]; tokens: string[] } | null = null
  private explored: string | null = null
  /** Does this person see everything? False for players, and for a GM who is previewing. */
  private get gmView() { return this.me.gm && !this.preview }
  /** The GM sees the scene's light, softened, unless they switched that off. */
  private gmLight = true
  private get fogMode() { return this.gmView ? (this.gmLight ? 'gm' as const : 'off' as const) : 'player' as const }
  setGmLight(on: boolean) { this.gmLight = on; if (this.ready) this.fog.configure(this.scene, this.fogMode) }
  private shared = false
  private isViewer(t: Token) { const p = this.preview; return t.data?.sharedSight === true || (p ? p.tokens.includes(t.id) || t.owners.some((o) => p.users.includes(o)) : this.shared ? t.owners.length > 0 : t.owners.includes(this.me.id)) }
  private drag: null | { kind: 'pan' | 'tokens' | 'ruler' | 'marquee' | 'draw' | 'tile' | 'wallend' | 'wallrect' | 'revealrect' | 'drawmove'; /** the drawing being moved */ drawing?: Drawing; start: Pt; screen: Pt; origins?: Map<string, Pt>; lead?: string; /** how far dragged tokens are from where they started, and how far they were when last sent */ off?: Pt; sentOff?: Pt; moved: boolean; sent: number; /** wall ends that move together, and where they went */ ends?: { id: string; end: 1 | 2 }[]; to?: Pt } = null
  private pointers = new Map<number, Pt>()
  private pinch: null | { dist: number; scale: number } = null
  private longPress: number | undefined
  private lastCursor = 0
  private raf = 0
  private needFit = false
  private activeUntil = 0

  constructor(private host: HTMLElement, private hooks: Hooks) {}

  async init() {
    const bg = getComputedStyle(this.host).getPropertyValue('--bg-side').trim() || '#17181b'
    await this.app.init({ resizeTo: this.host, background: new Color(bg).toNumber(), antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 })
    if (this.gone) { this.app.destroy(true, { children: true }); return }
    this.ready = true
    this.host.appendChild(this.app.canvas)
    this.app.canvas.style.touchAction = 'none'
    this.fog = new FogLayer(this.app)
    this.fog.setDetail(this.perf.light); this.fog.still = this.perf.light
    this.fog.onExplored = (png) => { if (!this.preview) this.hooks.onExplored(png) }
    this.fog.onDrawn = () => this.poke()
    this.world.addChild(this.bg, this.gridG, this.tileBg, this.drawLayer, this.tokenLayer, this.tileOver, this.tileGm, this.ambientG, this.fog.view, this.revealG, this.pinLayer, this.wallG, this.triggerG, this.others, this.ruleG, this.ruleLabel, this.overlay, this.wallPreview, this.strokeG, this.tileSel, this.marquee)
    this.ruleLabel.visible = false
    this.app.stage.addChild(this.world, this.weatherG)
    this.weatherG.eventMode = 'none'
    this.weatherG.visible = false
    const c = this.app.canvas
    c.addEventListener('pointerdown', this.down)
    c.addEventListener('pointermove', this.move)
    c.addEventListener('pointerup', this.up)
    c.addEventListener('pointercancel', this.up)
    c.addEventListener('wheel', this.wheel, { passive: false })
    c.addEventListener('contextmenu', (e) => e.preventDefault())
    // the picture is painted only while something is happening, so an idle table costs nothing
    this.app.ticker.stop()
    window.addEventListener('resize', this.poke)
    this.raf = requestAnimationFrame(this.loop)
    if (this.scene) this.setScene(this.scene)
    this.drawWalls()
    this.setTokens([...this.tokens.values()])
  }

  destroy() {
    this.gone = true
    this.videoEl?.pause(); this.videoEl = null
    clearTimeout(this.longPress)
    if (!this.ready) return
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.poke)
    this.fog.destroy()
    this.app.destroy(true, { children: true })
  }

  // ---------- what to show ----------

  setScene(scene: Scene | null) { this.poke();
    const changed = this.scene?.id !== scene?.id || this.scene?.bg !== scene?.bg
    this.scene = scene
    if (!this.ready) return
    this.drawGrid()
    if (changed) this.drawBackground()
    if (scene && this.fitted !== scene.id) { this.fitted = scene.id; this.needFit = true; this.fit() }
    for (const v of this.views.values()) this.layout(v)
    this.fog.configure(scene, this.fogMode)
    this.setWeather(scene?.weather ?? 'none')
    this.ambientG.clear()
    if (scene?.ambient) this.ambientG.rect(0, 0, scene.width, scene.height).fill({ color: Number.parseInt(scene.ambient.slice(1), 16), alpha: 0.28 })
    this.refreshVision()
  }

  private async drawBackground() {
    const scene = this.scene
    this.bg.removeChildren().forEach((c) => c.destroy())
    if (!scene) return
    const base = new Graphics().rect(0, 0, scene.width, scene.height).fill({ color: 0x20222a })
    this.bg.addChild(base)
    if (!scene.bg) return
    this.videoEl?.pause(); this.videoEl = null
    const video = (await isVideoUrl(scene.bg)) ? await makeVideo(scene.bg) : null
    const tex = video ? Texture.from(video) : await loadTexture(scene.bg)
    this.poke()
    if (!tex || this.scene?.id !== scene.id || this.scene.bg !== scene.bg || this.gone) { video?.pause(); return }
    if (video) { this.videoEl = video; if (this.perf.light) video.pause() }
    const sprite = new Sprite(tex)
    sprite.width = scene.width
    sprite.height = scene.height
    this.bg.addChild(sprite)
  }

  private drawGrid() {
    const g = this.gridG
    g.clear()
    const s = this.scene
    if (!s || s.grid === 'none') return
    const w = s.width, h = s.height
    const gridColor = Number.parseInt((s.gridColor ?? '#ffffff').slice(1), 16) || 0xffffff, gridAlpha = s.gridOpacity ?? 0.28
    const paint = () => { g.stroke({ width: 1, color: 0x000000, alpha: 0.35, pixelLine: true }) }
    if (s.grid === 'square') {
      for (let x = 0; x <= w; x += s.gridSize) g.moveTo(x, 0).lineTo(x, h)
      for (let y = 0; y <= h; y += s.gridSize) g.moveTo(0, y).lineTo(w, y)
      paint()
      for (let x = 0; x <= w; x += s.gridSize) g.moveTo(x, 0).lineTo(x, h)
      for (let y = 0; y <= h; y += s.gridSize) g.moveTo(0, y).lineTo(w, y)
      g.stroke({ width: 1, color: gridColor, alpha: gridAlpha, pixelLine: true })
      return
    }
    const centres = hexCentres(w, h, s)
    for (const pass of [{ width: 1, color: 0x000000, alpha: 0.35, pixelLine: true }, { width: 1, color: gridColor, alpha: gridAlpha, pixelLine: true }]) {
      for (const c of centres) {
        const pts = hexCorners(c, s)
        g.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < 6; i++) g.lineTo(pts[i].x, pts[i].y)
        g.closePath()
      }
      g.stroke(pass)
    }
  }

  setTokens(list: Token[]) { this.poke();
    this.tokens = new Map(list.map((t) => [t.id, t]))
    if (!this.ready) return
    for (const [id, v] of this.views) if (!this.tokens.has(id)) { v.box.destroy({ children: true }); this.views.delete(id) }
    for (const t of list) this.upsert(t)
    this.sortLayer()
    this.refreshVision()
  }

  upsert(t: Token) { this.poke();
    this.tokens.set(t.id, t)
    if (!this.ready) return
    const key = [t.image, t.color, t.name, t.size, t.hidden, t.locked, JSON.stringify(t.data.hp ?? null), (t.data.conditions ?? []).join(','), JSON.stringify([t.data.shape, t.data.border, t.data.tint, t.data.flip, t.data.nameplate, t.data.elevation, t.data.aura, t.data.bars, isLightSource(t), isLightSource(t) ? t.data.light : null])].join('|')
    let v = this.views.get(t.id)
    if (!v || v.key !== key) {
      v?.box.destroy({ children: true })
      v = { box: new Container(), token: t, key }
      this.views.set(t.id, v)
      this.tokenLayer.addChild(v.box)
      this.build(v)
    }
    v.token = t
    if (!this.gmView && this.tokens.size) this.refreshVision()
    // a token the person is dragging is theirs to place; the server's older position must not pull it back
    if (!(this.drag?.kind === 'tokens' && this.drag.origins?.has(t.id))) this.layout(v)
  }

  private sortLayer() {
    const order = [...this.views.values()].sort((a, b) => a.token.z - b.token.z)
    order.forEach((v, i) => this.tokenLayer.setChildIndex(v.box, i))
  }

  private px(t: Token) { return this.scene ? tokenPixels(t.size, this.scene) : 70 * t.size }

  /** The outline of a token: round, square with soft corners, or a hexagon. */
  private shapePath(g: Graphics, r: number, shape: string) {
    if (shape === 'square') return g.roundRect(-r, -r, r * 2, r * 2, r * 0.18)
    if (shape === 'hex') return g.poly(Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i - Math.PI / 2; return [Math.cos(a) * r, Math.sin(a) * r] }).flat())
    return g.circle(0, 0, r)
  }

  private build(v: TokenView) {
    const t = v.token
    if (isLightSource(t)) return this.buildLight(v)
    const d = this.px(t)
    const r = d / 2
    const shape = (t.data.shape as string) ?? 'round'
    const border = typeof t.data.border === 'string' ? new Color(t.data.border).toNumber() : null
    const aura = t.data.aura as { radius?: number; color?: string } | undefined
    if (aura?.radius && aura.color && this.scene) {
      const ar = (aura.radius / this.scene.dist) * this.scene.gridSize + r
      const a = new Graphics().circle(0, 0, ar).fill({ color: new Color(aura.color).toNumber(), alpha: 0.16 }).stroke({ width: 2, color: new Color(aura.color).toNumber(), alpha: 0.55 })
      a.label = 'aura'
      v.box.addChild(a)
    }
    const ring = this.shapePath(new Graphics(), r, shape).fill({ color: new Color(t.color || '#6b7280').toNumber() }).stroke({ width: 3, color: border ?? 0x000000, alpha: border != null ? 1 : 0.55 })
    v.box.addChild(ring)
    if (!t.image) {
      const initial = new Text({ text: (t.name || '?').trim().slice(0, 2).toUpperCase(), style: { fontSize: Math.max(12, r * 0.8), fill: 0xffffff, fontFamily: 'sans-serif', fontWeight: '700' } })
      initial.anchor.set(0.5)
      v.box.addChild(initial)
    } else {
      loadTexture(t.image).then((tex) => {
        this.poke()
        if (!tex || v.box.destroyed) return
        const sprite = new Sprite(tex)
        sprite.anchor.set(0.5)
        const scale = d / Math.min(tex.width, tex.height)
        sprite.scale.set(t.data.flip ? -scale : scale, scale)
        if (typeof t.data.tint === 'string') sprite.tint = new Color(t.data.tint).toNumber()
        const mask = this.shapePath(new Graphics(), r - 1.5, shape).fill({ color: 0xffffff })
        v.box.addChild(mask, sprite)
        sprite.mask = mask
        v.box.addChild(this.shapePath(new Graphics(), r, shape).stroke({ width: 3, color: border ?? 0x000000, alpha: border != null ? 1 : 0.55 }))
        this.drawSelection(v)
      })
    }
    const hp = t.data.hp as { value?: number; max?: number; temp?: number } | undefined
    const hasBar = !!hp && (hp.max ?? 0) > 0
    if (hasBar) {
      const w = d * 0.9, ratio = Math.max(0, Math.min(1, (hp!.value ?? 0) / hp!.max!))
      const bar = new Graphics().roundRect(-w / 2, r + 2, w, 7, 3).fill({ color: 0x000000, alpha: 0.7 })
      if (ratio > 0) bar.roundRect(-w / 2 + 1, r + 3, (w - 2) * ratio, 5, 2).fill({ color: ratio > 0.5 ? 0x4caf50 : ratio > 0.25 ? 0xf1c40f : 0xe74c3c })
      if ((hp!.temp ?? 0) > 0) bar.roundRect(-w / 2 + 1, r + 3, Math.min(w - 2, (w - 2) * ((hp!.temp ?? 0) / hp!.max!)), 2, 1).fill({ color: 0x5dade2 })
      bar.label = 'hp'
      v.box.addChild(bar)
      if ((hp!.value ?? 0) <= 0) {
        const x = new Text({ text: '✕', style: { fontSize: r * 1.1, fill: 0xffffff, fontFamily: 'sans-serif', fontWeight: '700', stroke: { color: 0x000000, width: 4 } } })
        x.anchor.set(0.5)
        x.alpha = 0.85
        x.label = 'down'
        v.box.addChild(x)
      }
    }
    // extra bars (mana, ammunition, a clock): up to three, under the hit points
    const bars = (t.data.bars ?? []) as { name: string; value: number; max: number; color: string }[]
    const barTop = r + 2 + (hasBar ? 9 : 0)
    bars.slice(0, 3).forEach((b, i) => {
      const w = d * 0.9, ratio = b.max > 0 ? Math.max(0, Math.min(1, b.value / b.max)) : 0
      const g = new Graphics().roundRect(-w / 2, barTop + i * 9, w, 7, 3).fill({ color: 0x000000, alpha: 0.7 })
      if (ratio > 0) g.roundRect(-w / 2 + 1, barTop + i * 9 + 1, (w - 2) * ratio, 5, 2).fill({ color: new Color(b.color).toNumber() })
      g.label = 'bar'
      v.box.addChild(g)
    })
    if (typeof t.data.elevation === 'number' && t.data.elevation !== 0) {
      const e = new Text({ text: `${t.data.elevation > 0 ? '↑' : '↓'}${Math.abs(t.data.elevation)}`, style: { fontSize: 11, fill: 0xffffff, fontFamily: 'sans-serif', fontWeight: '700', stroke: { color: 0x000000, width: 3 } } })
      e.anchor.set(0.5)
      e.position.set(r * 0.75, -r * 0.8)
      e.label = 'cond'
      v.box.addChild(e)
    }
    const conditions = (t.data.conditions ?? []) as string[]
    conditions.slice(0, 5).forEach((c, i) => {
      const pip = new Graphics().circle(0, 0, 8).fill({ color: pipColor(c) }).stroke({ width: 1.5, color: 0x000000, alpha: 0.7 })
      const letter = new Text({ text: c.slice(0, 1).toUpperCase(), style: { fontSize: 11, fill: 0xffffff, fontFamily: 'sans-serif', fontWeight: '700' } })
      letter.anchor.set(0.5)
      pip.addChild(letter)
      pip.position.set(-r + 6 + i * 14, -r - 4)
      pip.label = 'cond'
      v.box.addChild(pip)
    })
    const label = new Text({ text: t.name, style: { fontSize: 13, fill: 0xffffff, fontFamily: 'sans-serif', stroke: { color: 0x000000, width: 4 } } })
    label.anchor.set(0.5, 0)
    label.y = r + (hasBar ? 11 : 2) + Math.min(3, bars.length) * 9
    label.visible = !!t.name && t.data.nameplate !== false
    label.label = 'name'
    v.box.addChild(label)
    v.box.eventMode = 'none'
    this.drawSelection(v)
  }

  /** A light source is not a creature: the GM sees a small lamp in the light's colour and a ring where its light ends. */
  private buildLight(v: TokenView) {
    const t = v.token
    const l = (t.data.light ?? {}) as { bright?: number; dim?: number; color?: string; off?: boolean }
    const col = /^#[0-9a-fA-F]{3,8}$/.test(l.color ?? '') ? new Color(l.color!).toNumber() : 0xffd27a
    const off = !!l.off || !((l.bright ?? 0) > 0 || (l.dim ?? 0) > 0)
    const s = this.scene
    if (s && !off) {
      const unit = (n: number) => (n / s.dist) * s.gridSize
      const reach = new Graphics()
      if ((l.dim ?? 0) > 0) reach.circle(0, 0, unit(Math.max(l.dim ?? 0, l.bright ?? 0))).stroke({ width: 1.5, color: col, alpha: 0.35 })
      if ((l.bright ?? 0) > 0) reach.circle(0, 0, unit(l.bright ?? 0)).stroke({ width: 1.5, color: col, alpha: 0.6 })
      reach.label = 'aura'
      v.box.addChild(reach)
    }
    const r = 13
    const lamp = new Graphics()
    if (!off) lamp.circle(0, 0, r + 6).fill({ color: col, alpha: 0.25 })
    lamp.circle(0, 0, r).fill({ color: off ? 0x55524c : col }).stroke({ width: 2.5, color: 0x1b1a17, alpha: 0.85 })
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i
      lamp.moveTo(Math.cos(a) * 5, Math.sin(a) * 5).lineTo(Math.cos(a) * 9, Math.sin(a) * 9)
    }
    lamp.stroke({ width: 2, color: 0x1b1a17, alpha: off ? 0.5 : 0.8 })
    lamp.label = 'lamp'
    v.box.addChild(lamp)
    v.box.eventMode = 'none'
    this.drawSelection(v)
  }

  private drawSelection(v: TokenView) {
    v.box.getChildByLabel('sel')?.destroy()
    v.box.getChildByLabel('turn')?.destroy()
    const r = isLightSource(v.token) ? 14 : this.px(v.token) / 2
    if (this.turnId === v.token.id) {
      const t = new Graphics().circle(0, 0, r + 9).stroke({ width: 4, color: 0x4fc3f7 }).circle(0, 0, r + 14).stroke({ width: 2, color: 0x4fc3f7, alpha: 0.5 })
      t.label = 'turn'
      v.box.addChild(t)
    }
    if (!this.selected.has(v.token.id)) return
    const g = new Graphics().circle(0, 0, r + 4).stroke({ width: 3, color: 0xffd23f })
    g.label = 'sel'
    v.box.addChild(g)
  }

  /** A roof (an overhead tile) fades away over the tokens of the person looking, so they can see what is inside. The GM's own view keeps it. */
  private updateRoofs() {
    if (!this.ready) return
    const viewers = this.gmView ? [] : [...this.tokens.values()].filter((t) => this.isViewer(t))
    for (const t of this.tiles) {
      if (t.layer !== 'overhead') continue
      const box = this.tileBoxes.get(t.id)
      if (!box) continue
      const a = (t.rotation * Math.PI) / 180, cos = Math.cos(-a), sin = Math.sin(-a)
      const under = viewers.some((v) => {
        const dx = v.x - t.x, dy = v.y - t.y
        return Math.abs(dx * cos - dy * sin) <= t.w / 2 && Math.abs(dx * sin + dy * cos) <= t.h / 2
      })
      box.alpha = under ? 0.12 : t.hidden ? 0.5 : 1
    }
  }

  private layout(v: TokenView) {
    const t = v.token
    v.box.position.set(t.x, t.y)
    queueMicrotask(() => this.updateRoofs())
    v.box.rotation = 0
    v.box.alpha = t.hidden && !isLightSource(t) ? 0.45 : 1
    // the picture turns with the token; the name stays upright
    for (const c of v.box.children) if (!['name', 'sel', 'hp', 'down', 'cond', 'turn', 'aura', 'bar'].includes(c.label)) c.rotation = (t.rotation * Math.PI) / 180
  }

  /** The token whose turn it is gets a blue ring. */
  setTurn(id: string | null) { this.poke();
    this.turnId = id
    if (this.ready) for (const v of this.views.values()) this.drawSelection(v)
  }

  setSelected(ids: string[]) { this.poke();
    this.selected = new Set(ids)
    if (this.ready) for (const v of this.views.values()) this.drawSelection(v)
  }

  /** Who is looking: the GM sees everything, a player sees what their own tokens see. */
  setViewer(me: { id: string; gm: boolean; spectator: boolean; canDoors: boolean; shared?: boolean; wallsBlock?: boolean }) { this.poke();
    this.shared = !!me.shared
    this.wallsBlock = me.wallsBlock !== false
    this.me = { id: me.id, gm: me.gm || me.spectator, canDoors: me.canDoors || me.gm }
    if (!this.ready) return
    this.fog.configure(this.scene, this.fogMode)
    this.drawWalls()
    this.refreshVision()
  }

  /** Looks at the scene as these players (by account) or these tokens would. Null goes back to the GM's own view. What they explored is not kept. */
  setPreview(spec: { users: string[]; tokens: string[] } | null) { this.poke();
    const was = !!this.preview
    this.preview = spec && (spec.users.length || spec.tokens.length) ? spec : null
    if (!this.ready) return
    this.fog.configure(this.scene, this.fogMode)
    if (this.preview) void this.fog.loadExplored(null)
    else if (was) void this.fog.loadExplored(this.explored)
    this.drawWalls()
    this.refreshVision()
  }

  /** The places that set something off, drawn for the GM only. */
  /** Falling rain or snow in front of the map. */
  private fall() {
    const w = this.host.clientWidth, h = this.host.clientHeight
    const g = this.weatherG
    g.clear()
    if (!w || !h) return
    const rain = this.weather === 'rain'
    if (!this.drops.length) this.drops = Array.from({ length: rain ? 160 : 110 }, () => ({ x: Math.random() * w, y: Math.random() * h, v: rain ? 14 + Math.random() * 8 : 1 + Math.random() * 2.2, s: 0.6 + Math.random() }))
    for (const d of this.drops) {
      if (rain) {
        g.moveTo(d.x, d.y).lineTo(d.x - 3 * d.s, d.y + 14 * d.s).stroke({ width: 1, color: 0xbcd4ff, alpha: 0.45 })
        d.x -= 3 * d.s * 0.5; d.y += d.v
      } else {
        g.circle(d.x, d.y, 1.4 * d.s).fill({ color: 0xffffff, alpha: 0.8 })
        d.y += d.v; d.x += Math.sin((d.y + d.v * 40) / 40) * 0.7
      }
      if (d.y > h + 10 || d.x < -10) { d.y = -10; d.x = Math.random() * w }
    }
  }

  /** Rain, snow or clear weather over this scene. */
  setWeather(kind: 'none' | 'rain' | 'snow') { this.poke(); if (kind !== this.weather) this.drops = []; this.weather = kind; this.weatherG.visible = kind !== 'none' && !this.perf.light; if (kind === 'none') this.weatherG.clear() }

  setTriggers(list: { x: number; y: number; radius: number; fired: boolean }[]) { this.poke(); this.triggers = list; this.drawTriggers() }

  private drawTriggers() {
    const g = this.triggerG
    g.clear()
    if (!this.ready || !this.me.gm || !this.scene) return
    const k = 1 / this.world.scale.x
    for (const t of this.triggers) g.circle(t.x, t.y, t.radius * this.scene.gridSize).fill({ color: 0xe08a2e, alpha: t.fired ? 0.05 : 0.12 }).stroke({ width: 2 * k, color: 0xe08a2e, alpha: t.fired ? 0.3 : 0.8 })
  }

  setWalls(walls: Wall[]) { this.walls = walls; if (this.ready) { this.poke(); this.fog.setWalls(walls); this.drawWalls() } }
  setLights(lights: Light[]) { this.poke(); if (this.ready) this.fog.setLights(lights) }
  setExplored(png: string | null) { this.poke(); this.explored = png; if (this.ready && !this.preview) void this.fog.loadExplored(png) }
  setWallKind(kind: Wall['kind']) { this.wallKind = kind }
  /** Walls drawn as lines one after another, or as a rectangle in one drag. */
  setWallShape(shape: 'line' | 'rect') { this.wallShape = shape }
  /** Notes pinned to the scene. A pin with a page opens it when clicked. */
  setPins(list: Pin[]) {
    this.poke()
    this.pins = list
    this.pinLayer.removeChildren().forEach((c) => c.destroy({ children: true }))
    for (const p of list) {
      const box = new Container()
      box.position.set(p.x, p.y)
      box.scale.set(1 / this.world.scale.x)
      const dot = new Graphics().circle(0, -10, 8).fill({ color: p.gmOnly ? 0xb36bff : 0xe0572e }).stroke({ width: 2, color: 0x000000, alpha: 0.7 })
      dot.poly([-5, -4, 0, 6, 5, -4]).fill({ color: p.gmOnly ? 0xb36bff : 0xe0572e })
      const t = new Text({ text: p.label, style: { fontSize: 12, fill: 0xffffff, fontFamily: 'sans-serif', fontWeight: '700', stroke: { color: 0x000000, width: 3 } } })
      t.position.set(12, -18)
      box.addChild(dot, t)
      this.pinLayer.addChild(box)
    }
  }

  private nearPin(p: Pt): Pin | null {
    const reach = 14 / this.world.scale.x
    return [...this.pins].reverse().find((x) => Math.hypot(x.x - p.x, x.y - 10 / this.world.scale.x - p.y) <= reach) ?? null
  }

  /** Areas the GM showed the players, drawn for the GM as green outlines. */
  setReveals(list: Rect[]) { this.poke(); this.reveals = list; this.fog.setReveals(list); this.drawReveals() }
  private drawReveals() {
    const g = this.revealG
    g.clear()
    if (!this.ready || !this.me.gm || this.preview) return
    const k = 1 / this.world.scale.x
    for (const r of this.reveals) g.rect(r.x, r.y, r.w, r.h).fill({ color: 0x4caf50, alpha: 0.08 }).stroke({ width: 2 * k, color: 0x4caf50, alpha: 0.7 })
  }
  setTiles(list: Tile[]) {
    this.poke()
    this.tiles = list
    if (!this.ready) return
    for (const c of [this.tileBg, this.tileOver, this.tileGm]) c.removeChildren().forEach((x) => x.destroy({ children: true }))
    this.tileBoxes.clear()
    for (const t of list) {
      const box = new Container()
      box.position.set(t.x, t.y)
      box.rotation = (t.rotation * Math.PI) / 180
      box.alpha = t.layer === 'gm' || t.hidden ? 0.5 : 1
      const sprite = new Sprite()
      sprite.anchor.set(0.5)
      box.addChild(sprite)
      loadTexture(t.image).then((tex) => {
        if (!tex || box.destroyed) return
        sprite.texture = tex
        sprite.width = t.w
        sprite.height = t.h
        if (t.flip) sprite.scale.x = -Math.abs(sprite.scale.x)
        this.poke()
      })
      ;(t.layer === 'overhead' ? this.tileOver : t.layer === 'gm' ? this.tileGm : this.tileBg).addChild(box)
      this.tileBoxes.set(t.id, box)
    }
    this.drawTileSel()
    this.updateRoofs()
  }

  setSelectedTile(id: string | null) { this.poke(); this.selectedTile = id; this.drawTileSel() }

  private drawTileSel() {
    this.tileSel.clear()
    const t = this.tiles.find((x) => x.id === this.selectedTile)
    if (!t || !this.ready) return
    this.tileSel.position.set(t.x, t.y)
    this.tileSel.rotation = (t.rotation * Math.PI) / 180
    this.tileSel.rect(-t.w / 2, -t.h / 2, t.w, t.h).stroke({ width: 3 / this.world.scale.x, color: 0xffd23f })
  }

  /** The tile under a point (only the GM works with tiles). */
  private hitTile(p: Pt): Tile | null {
    for (const t of [...this.tiles].reverse()) {
      const rot = (-t.rotation * Math.PI) / 180
      const dx = p.x - t.x, dy = p.y - t.y
      const lx = dx * Math.cos(rot) - dy * Math.sin(rot), ly = dx * Math.sin(rot) + dy * Math.cos(rot)
      if (Math.abs(lx) <= t.w / 2 && Math.abs(ly) <= t.h / 2) return t
    }
    return null
  }

  /** A spell area is a whole number of cells long, so what it covers can be counted. */
  private areaEnd(a: Pt, b: Pt): Pt {
    const s = this.scene
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (!s || len === 0) return b
    const cells = Math.max(1, Math.round(len / s.gridSize))
    return { x: a.x + ((b.x - a.x) / len) * cells * s.gridSize, y: a.y + ((b.y - a.y) / len) * cells * s.gridSize }
  }

  /** Cone, ray, burst and cube as the 5e rules draw them from the origin to the far end. */
  private area(kind: DrawKind, a: Pt, b: Pt, color: number): Container {
    const box = new Container()
    const g = new Graphics()
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    const px = -Math.sin(ang), py = Math.cos(ang)
    const s = this.scene
    if (kind === 'blast') g.circle(a.x, a.y, len)
    else if (kind === 'cone') {
      const half = Math.atan(0.5), R = len / Math.cos(half)
      g.poly([a.x, a.y, a.x + R * Math.cos(ang - half), a.y + R * Math.sin(ang - half), a.x + R * Math.cos(ang + half), a.y + R * Math.sin(ang + half)])
    } else {
      // a ray is one cell wide, a cube as wide as it is long, with the origin in the middle of one face
      const half = (kind === 'beam' ? (s?.gridSize ?? 70) : len) / 2
      g.poly([a.x + px * half, a.y + py * half, b.x + px * half, b.y + py * half, b.x - px * half, b.y - py * half, a.x - px * half, a.y - py * half])
    }
    g.fill({ color, alpha: 0.28 }).stroke({ width: 2 / this.world.scale.x, color, alpha: 0.9 })
    box.addChild(g)
    // the grid squares the area covers, as the rules count them (the middle of the square inside)
    if (s && s.grid === 'square') {
      const cells = new Graphics()
      const x0 = Math.floor((Math.min(a.x, b.x) - len) / s.gridSize), x1 = Math.ceil((Math.max(a.x, b.x) + len) / s.gridSize)
      const y0 = Math.floor((Math.min(a.y, b.y) - len) / s.gridSize), y1 = Math.ceil((Math.max(a.y, b.y) + len) / s.gridSize)
      for (let cx = x0; cx < x1; cx++) for (let cy = y0; cy < y1; cy++) {
        if (inTemplate(kind as 'cone', a, b, { x: (cx + 0.5) * s.gridSize, y: (cy + 0.5) * s.gridSize }, s.gridSize)) cells.rect(cx * s.gridSize, cy * s.gridSize, s.gridSize, s.gridSize)
      }
      cells.fill({ color, alpha: 0.22 }).stroke({ width: 1 / this.world.scale.x, color, alpha: 0.5 })
      box.addChild(cells)
    }
    if (s) {
      const label = new Text({ text: formatDistance((len / s.gridSize) * s.dist, s.unit), style: { fontSize: 14, fill: 0xffffff, fontFamily: 'sans-serif', stroke: { color: 0x000000, width: 3 } } })
      label.scale.set(1 / this.world.scale.x)
      label.position.set(b.x + 8 / this.world.scale.x, b.y - 22 / this.world.scale.x)
      box.addChild(label)
    }
    return box
  }

  setDrawStyle(style: { kind: DrawKind; color: string; width: number; fill: string }) { this.poke(); this.drawStyle = style }

  setDrawings(list: Drawing[]) { this.poke();
    this.drawings = list
    if (!this.ready) return
    this.drawLayer.removeChildren().forEach((c) => c.destroy({ children: true }))
    for (const d of list) this.drawLayer.addChild(this.shape(d.kind, d.points, d.color, d.width, d.fill, d.text, d.gmOnly ? 0.6 : 1))
  }

  /** One drawing as a picture. */
  private shape(kind: DrawKind, pts: Pt[], color: string, width: number, fill: string, text = '', alpha = 1): Container {
    const box = new Container()
    box.alpha = alpha
    const c = new Color(color).toNumber()
    if (kind === 'cone' || kind === 'beam' || kind === 'blast' || kind === 'cube') { box.addChild(this.area(kind, pts[0], pts[pts.length - 1], c)); return box }
    if (kind === 'text') {
      const t = new Text({ text, style: { fontSize: 14 + width * 3, fill: c, fontFamily: 'sans-serif', fontWeight: '700', stroke: { color: 0x000000, width: 4 } } })
      t.position.set(pts[0].x, pts[0].y)
      box.addChild(t)
      return box
    }
    const g = new Graphics()
    const a = pts[0], b = pts[pts.length - 1]
    if (kind === 'free') {
      g.moveTo(a.x, a.y)
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y)
      if (pts.length === 1) g.circle(a.x, a.y, width / 2).fill({ color: c })
    } else if (kind === 'line') g.moveTo(a.x, a.y).lineTo(b.x, b.y)
    else if (kind === 'arrow') {
      g.moveTo(a.x, a.y).lineTo(b.x, b.y)
      const ang = Math.atan2(b.y - a.y, b.x - a.x), head = 10 + width * 2
      g.moveTo(b.x, b.y).lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45)).moveTo(b.x, b.y).lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45))
    } else if (kind === 'polygon') {
      g.moveTo(a.x, a.y)
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y)
      if (pts.length > 2) g.closePath()
    }
    else if (kind === 'rect') g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    else g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2)
    if (fill && (kind === 'rect' || kind === 'ellipse' || (kind === 'polygon' && pts.length > 2))) g.fill({ color: new Color(fill.slice(0, 7)).toNumber(), alpha: fill.length === 9 ? Number.parseInt(fill.slice(7), 16) / 255 : 0.35 })
    g.stroke({ width, color: c, cap: 'round', join: 'round' })
    box.addChild(g)
    return box
  }

  /** The drawing under a point, for the eraser. */
  private nearDrawing(p: Pt): Drawing | null {
    const reach = 10 / this.world.scale.x
    const dist = (a: Pt, b: Pt) => {
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }
    for (const d of [...this.drawings].reverse()) {
      const a = d.points[0], b = d.points[d.points.length - 1]
      let near = false
      if (d.kind === 'text') near = Math.abs(p.x - a.x - 40) < 60 + reach && Math.abs(p.y - a.y - 10) < 20 + reach
      else if (d.kind === 'free') near = d.points.length === 1 ? Math.hypot(p.x - a.x, p.y - a.y) <= reach : d.points.some((q, i) => i > 0 && dist(d.points[i - 1], q) <= reach)
      else if (d.kind === 'blast') near = Math.hypot(p.x - a.x, p.y - a.y) <= Math.hypot(b.x - a.x, b.y - a.y)
      else if (d.kind === 'line' || d.kind === 'beam' || d.kind === 'cone' || d.kind === 'cube') near = dist(a, b) <= Math.max(reach, this.scene ? this.scene.gridSize / 2 : reach)
      else if (d.kind === 'rect') {
        const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)]
        near = d.fill ? p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 : [[{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }], [{ x: x1, y: y1 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x0, y: y0 }]].some(([s, e]) => dist(s, e) <= reach)
      } else {
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2 || 1, ry = Math.abs(b.y - a.y) / 2 || 1
        const k = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry)
        near = d.fill ? k <= 1 : Math.abs(k - 1) * Math.min(rx, ry) <= reach
      }
      if (near) return d
    }
    return null
  }

  /** Tokens that give their owner sight, and who is hidden by the dark. */
  private refreshVision() {
    this.updateRoofs()
    // on a slow machine the fog waits until the token is put down
    if (this.perf.fogOnDrop && this.drag?.kind === 'tokens' && this.drag.moved) { this.visionPending = true; return }
    if (!this.ready || this.gmView) {
      for (const v of this.views.values()) v.box.visible = true
      return
    }
    const mine = [...this.tokens.values()].filter((t) => this.isViewer(t))
    this.fog.setViewers(mine.map((t) => {
      const vis = (t.data.vision ?? {}) as { sight?: number | null; dark?: number }
      return { id: t.id, x: t.x, y: t.y, sight: vis.sight ?? null, dark: Math.max(vis.dark ?? 0, (vis as { blind?: number }).blind ?? 0, (vis as { true?: number }).true ?? 0) }
    }))
    window.setTimeout(() => this.applyTokenVisibility(), 40)
  }

  private applyTokenVisibility() {
    if (this.gmView) return
    // a hidden token is the GM's secret, even from the GM looking through a player's eyes
    for (const v of this.views.values()) v.box.visible = !(this.preview && v.token.hidden) && (this.isViewer(v.token) || this.fog.isVisible({ x: v.token.x, y: v.token.y }))
  }

  /** Draws the polygon so far, with its next side following the pointer. */
  private previewPolygon(to: Pt) {
    this.strokeG.removeChildren().forEach((c) => c.destroy({ children: true }))
    if (this.polyPts.length) this.strokeG.addChild(this.shape('polygon', [...this.polyPts, to], this.drawStyle.color, this.drawStyle.width, this.drawStyle.fill, '', 0.8))
  }

  /** Closes the polygon being drawn and sends it (Enter or a double click). */
  finishPolygon() {
    const pts = this.polyPts
    this.polyPts = []
    this.strokeG.removeChildren().forEach((c) => c.destroy({ children: true }))
    if (pts.length >= 3) this.hooks.onDraw({ ...this.drawStyle, points: pts })
  }

  /** Ends the wall being drawn and sends it. */
  finishWalls() { this.poke();
    const p = this.wallPoly
    this.wallPoly = []
    this.wallPreview.clear()
    if (p.length < 2) return
    this.hooks.onWallAdd(p.slice(1).map((q, i) => ({ x1: p[i].x, y1: p[i].y, x2: q.x, y2: q.y, kind: this.wallKind })))
  }

  /** The corners of a ruler that is being carried around corners (Shift). */
  private rulerBase: Pt[] = []

  private snapWall(p: Pt): Pt {
    const k = this.world.scale.x
    const reach = 12 / k
    let best: Pt | null = null, bd = reach
    for (const w of this.walls) for (const e of [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]) {
      const d = Math.hypot(e.x - p.x, e.y - p.y)
      if (d < bd) { bd = d; best = e }
    }
    if (best) return best
    const s = this.scene
    if (s && s.grid === 'square') { const h = s.gridSize / 2; return { x: Math.round(p.x / h) * h, y: Math.round(p.y / h) * h } }
    return { x: Math.round(p.x), y: Math.round(p.y) }
  }

  private nearWall(p: Pt, only?: (w: Wall) => boolean): Wall | null {
    const reach = 10 / this.world.scale.x
    let best: Wall | null = null, bd = reach
    for (const w of this.walls) {
      if (only && !only(w)) continue
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1
      const len2 = dx * dx + dy * dy
      const t = len2 ? Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / len2)) : 0
      const d = Math.hypot(p.x - (w.x1 + t * dx), p.y - (w.y1 + t * dy))
      if (d < bd) { bd = d; best = w }
    }
    return best
  }

  private drawWalls() {
    const g = this.wallG
    g.clear()
    if (!this.ready) return
    const k = 1 / this.world.scale.x
    const editing = this.tool === 'wall' || this.tool === 'erase'
    for (const w of this.walls) {
      const door = w.kind === 'door' || w.kind === 'secret'
      // players see doors (so they can use them) and nothing else
      if (!this.gmView && !door) continue
      const color = w.kind === 'wall' ? 0xf5f0e6 : w.kind === 'door' ? (w.locked ? 0xc0392b : 0xe08a2e) : w.kind === 'secret' ? 0xb36bff : w.kind === 'oneway' ? 0x5dd39e : w.kind === 'terrain' ? 0xc9a66b : 0x6cc7ff
      g.moveTo(w.x1, w.y1).lineTo(w.x2, w.y2).stroke({ width: (door ? 5 : 3) * k, color, alpha: w.open ? 0.35 : 0.95 })
      const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2
      if (w.kind === 'oneway') {
        // an arrow to the side that can see through
        const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1, nx = (w.y2 - w.y1) / len, ny = -(w.x2 - w.x1) / len, s = 9 * k
        g.moveTo(mx, my).lineTo(mx + nx * s * 1.6, my + ny * s * 1.6).stroke({ width: 2 * k, color })
        g.poly([mx + nx * s * 2.2, my + ny * s * 2.2, mx + nx * s * 1.3 - ny * s * 0.6, my + ny * s * 1.3 + nx * s * 0.6, mx + nx * s * 1.3 + ny * s * 0.6, my + ny * s * 1.3 - nx * s * 0.6]).fill({ color })
      }
      if (door && w.locked) g.roundRect(mx - 4 * k, my - 4 * k, 8 * k, 8 * k, 2 * k).fill({ color: 0xffffff }).stroke({ width: 1.5 * k, color: 0x7a1f14 })
      if (editing && this.me.gm) { g.circle(w.x1, w.y1, 4 * k).fill({ color }); g.circle(w.x2, w.y2, 4 * k).fill({ color }) }
    }
  }

  setTool(tool: Tool) { this.poke(); this.tool = tool; this.rulerBase = []; this.polyPts = []; this.strokeG.removeChildren().forEach((c) => c.destroy({ children: true })); this.wallPoly = []; this.wallPreview.clear(); this.drawWalls(); if (this.ready) this.app.canvas.style.cursor = tool === 'ruler' ? 'crosshair' : '' }

  setOthers(cursors: Record<string, Cursor>, rulers: Record<string, Ruler>) { this.poke();
    if (!this.ready) return
    this.others.removeChildren().forEach((c) => c.destroy({ children: true }))
    for (const c of Object.values(cursors)) {
      if (Date.now() - c.at > 6000) continue
      const col = this.hooks.colorOf(c.user)
      const arrow = new Graphics().poly([0, 0, 0, 18, 5, 14, 9, 22, 12, 20, 8, 12, 14, 12]).fill({ color: col }).stroke({ width: 1, color: 0x000000 })
      arrow.position.set(c.x, c.y)
      const name = new Text({ text: c.name, style: { fontSize: 12, fill: 0xffffff, fontFamily: 'sans-serif', stroke: { color: col, width: 4 } } })
      name.position.set(c.x + 14, c.y + 20)
      this.others.addChild(arrow, name)
    }
    for (const r of Object.values(rulers)) this.drawRuler(r.points, this.hooks.colorOf(r.user), this.others, r.name)
  }

  ping(p: Pt, userId: string) { this.poke();
    const g = new Graphics()
    g.position.set(p.x, p.y)
    g.label = String(this.hooks.colorOf(userId))
    this.overlay.addChild(g)
    this.pings.push({ g, born: performance.now() })
  }

  // ---------- camera ----------

  fit() { this.poke();
    const s = this.scene
    if (!s || !this.ready) return
    // the view may not have its size yet (a tab that is still opening): try again on the next frame
    if (!this.host.clientWidth || !this.host.clientHeight) { this.needFit = true; return }
    this.needFit = false
    const w = this.host.clientWidth, h = this.host.clientHeight
    const k = Math.min(w / s.width, h / s.height) * 0.95
    this.world.scale.set(k)
    this.world.position.set((w - s.width * k) / 2, (h - s.height * k) / 2)
  }

  centre(): Pt {
    return this.toWorld({ x: (this.host.clientWidth || 0) / 2, y: (this.host.clientHeight || 0) / 2 })
  }

  /** The part of the scene on screen, as a rectangle in scene coordinates. */
  getView(): { x: number; y: number; w: number; h: number } {
    const a = this.toWorld({ x: 0, y: 0 }), b = this.toWorld({ x: this.host.clientWidth || 0, y: this.host.clientHeight || 0 })
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
  }

  /** Shows this rectangle of the scene, as large as it fits. */
  setView(v: { x: number; y: number; w: number; h: number }) { this.poke();
    const W = this.host.clientWidth, H = this.host.clientHeight
    if (!this.ready || !W || !H || v.w <= 0 || v.h <= 0) return
    const k = Math.min(4, Math.max(0.05, Math.min(W / v.w, H / v.h)))
    this.world.scale.set(k)
    this.world.position.set(W / 2 - (v.x + v.w / 2) * k, H / 2 - (v.y + v.h / 2) * k)
  }

  centreOn(p: Pt) { this.poke();
    const k = this.world.scale.x
    this.world.position.set((this.host.clientWidth || 0) / 2 - p.x * k, (this.host.clientHeight || 0) / 2 - p.y * k)
  }

  zoomBy(f: number, at: Pt = { x: (this.host.clientWidth || 0) / 2, y: (this.host.clientHeight || 0) / 2 }) { this.poke();
    const before = this.toWorld(at)
    const k = Math.min(4, Math.max(0.05, this.world.scale.x * f))
    this.world.scale.set(k)
    this.world.position.set(at.x - before.x * k, at.y - before.y * k)
  }

  private toWorld(screen: Pt): Pt {
    const k = this.world.scale.x
    return { x: (screen.x - this.world.x) / k, y: (screen.y - this.world.y) / k }
  }

  private local(e: PointerEvent | WheelEvent): Pt {
    const r = this.app.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  // ---------- pointer ----------

  private hit(p: Pt): Token | null {
    const order = [...this.views.values()].sort((a, b) => b.token.z - a.token.z)
    for (const v of order) {
      const t = v.token
      if (Math.hypot(p.x - t.x, p.y - t.y) <= this.px(t) / 2 + HIT_PAD) return t
    }
    return null
  }

  private wheel = (e: WheelEvent) => {
    this.poke()
    e.preventDefault()
    this.zoomBy(Math.pow(1.0015, -e.deltaY), this.local(e))
  }

  private down = (e: PointerEvent) => {
    this.poke()
    const screen = this.local(e)
    this.app.canvas.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, screen)
    if (this.pointers.size === 2) {
      // a second finger turns the gesture into pan and zoom
      clearTimeout(this.longPress)
      this.drag = null
      const [a, b] = [...this.pointers.values()]
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: this.world.scale.x }
      return
    }
    const world = this.toWorld(screen)
    if ((e.ctrlKey || e.metaKey) && this.me.gm && !this.preview) {
      // Ctrl-click on a door locks it or unlocks it
      const door = this.nearWall(world, (w) => w.kind === 'door' || w.kind === 'secret')
      if (door) { this.hooks.onDoorLock(door.id, !door.locked); return }
    }
    if (e.altKey && e.shiftKey && this.me.gm) { this.hooks.onPing(world); this.hooks.onPull(world); return }
    if (e.altKey) return this.hooks.onPing(world)
    const pan = e.button === 1 || e.button === 2
    if (!pan && this.me.gm && this.tool === 'wall' && this.wallShape === 'rect') {
      const start = this.snapWall(world)
      this.drag = { kind: 'wallrect', start, screen, moved: false, sent: 0 }
      return
    }
    if (!pan && this.me.gm && this.tool === 'reveal') { this.drag = { kind: 'revealrect', start: world, screen, moved: false, sent: 0 }; return }
    if (!pan && this.me.gm && this.tool === 'conceal') {
      const r = [...this.reveals].reverse().find((x) => world.x >= x.x && world.x <= x.x + x.w && world.y >= x.y && world.y <= x.y + x.h)
      if (r?.id) this.hooks.onUnreveal(r.id)
      return
    }
    if (!pan && this.me.gm && this.tool === 'wall' && !this.wallPoly.length) {
      // grabbing the end of a wall moves it, and every other wall that ends at the same point moves with it
      const reach = 10 / this.world.scale.x
      let hit: Pt | null = null, bd = reach
      for (const w of this.walls) for (const e of [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]) {
        const d = Math.hypot(e.x - world.x, e.y - world.y)
        if (d < bd) { bd = d; hit = e }
      }
      if (hit) {
        const ends: { id: string; end: 1 | 2 }[] = []
        for (const w of this.walls) {
          if (Math.hypot(w.x1 - hit.x, w.y1 - hit.y) < 0.5) ends.push({ id: w.id, end: 1 })
          if (Math.hypot(w.x2 - hit.x, w.y2 - hit.y) < 0.5) ends.push({ id: w.id, end: 2 })
        }
        this.drag = { kind: 'wallend', start: hit, screen, moved: false, sent: 0, ends }
        return
      }
    }
    if (!pan && this.me.gm && this.tool === 'wall') {
      const pt = this.snapWall(world)
      const now = performance.now()
      const again = now - this.lastClick.t < 350 && Math.hypot(pt.x - this.lastClick.x, pt.y - this.lastClick.y) < 2
      this.lastClick = { t: now, x: pt.x, y: pt.y }
      if (again) { this.finishWalls(); return }
      this.wallPoly.push(pt)
      return
    }
    if (!pan && this.tool === 'erase' && this.me.gm) { const pin = this.nearPin(world); if (pin) { this.hooks.onPinDelete(pin.id); return } }
    if (!pan && this.tool === 'erase') {
      const d = this.nearDrawing(world)
      if (d) { this.hooks.onDrawErase(d.id); return }
      const w = this.me.gm ? this.nearWall(world) : null
      if (w) this.hooks.onWallErase(w.id)
      return
    }
    if (!pan && this.me.gm && this.tool === 'pin') { this.hooks.onPinPlace(world); return }
    if (!pan && this.me.gm && this.tool === 'light' && !this.hit(world)) { this.hooks.onLightPlace(world); return }
    if (!pan && this.tool === 'draw' && this.drawStyle.kind === 'polygon') {
      const now = performance.now()
      const again = now - this.lastClick.t < 350 && Math.hypot(world.x - this.lastClick.x, world.y - this.lastClick.y) < 6 / this.world.scale.x
      this.lastClick = { t: now, x: world.x, y: world.y }
      if (again) { this.finishPolygon(); return }
      this.polyPts.push(world)
      this.previewPolygon(world)
      return
    }
    if (!pan && this.tool === 'draw') {
      if (this.drawStyle.kind === 'text') { this.hooks.onText(world, () => {}); return }
      this.stroke = [world]
      this.drag = { kind: 'draw', start: world, screen, moved: false, sent: 0 }
      return
    }
    const tok = pan ? null : this.hit(world)
    if (!tok && !pan && this.tool === 'select') {
      const pin = this.nearPin(world)
      if (pin) { this.hooks.onPin(pin); return }
      // a drawing of your own (or any, for the GM) can be dragged somewhere else
      const dr = this.nearDrawing(world)
      if (dr && (this.me.gm || dr.userId === this.me.id)) { this.drag = { kind: 'drawmove', drawing: dr, start: world, screen, moved: false, sent: 0 }; return }
    }
    if (!tok && !pan && this.me.canDoors) {
      const door = this.nearWall(world, (w) => w.kind === 'door' || (w.kind === 'secret' && this.me.gm))
      if (door) { this.hooks.onDoor(door.id); return }
    }
    if (this.tool === 'ruler' && !pan) {
      // holding Shift keeps the measured part and carries on from where it ended, around corners
      const from = e.shiftKey && this.rulerBase.length ? this.rulerBase[this.rulerBase.length - 1] : this.scene ? snapPoint(world, this.scene) : world
      if (!(e.shiftKey && this.rulerBase.length)) this.rulerBase = [from]
      this.drag = { kind: 'ruler', start: from, screen, moved: false, sent: 0 }
      return
    }
    if (tok) {
      const next = new Set(this.selected)
      if (e.shiftKey) { if (next.has(tok.id)) next.delete(tok.id); else next.add(tok.id) } else if (!next.has(tok.id)) { next.clear(); next.add(tok.id) }
      this.hooks.onSelect([...next])
      this.setSelected([...next])
      const movable = [...next].map((id) => this.tokens.get(id)!).filter((t) => t && this.hooks.canMove(t))
      if (movable.length && next.has(tok.id) && this.hooks.canMove(tok)) {
        this.drag = { kind: 'tokens', start: world, screen, origins: new Map(movable.map((t) => [t.id, { x: t.x, y: t.y }])), lead: tok.id, moved: false, sent: 0 }
      }
      return
    }
    if (!tok && !pan && this.me.gm && this.tool === 'select') {
      const tile = this.hitTile(world)
      if (tile) {
        this.hooks.onTileSelect(tile.id)
        this.setSelectedTile(tile.id)
        if (!tile.locked) this.drag = { kind: 'tile', start: world, screen, origins: new Map([[tile.id, { x: tile.x, y: tile.y }]]), lead: tile.id, moved: false, sent: 0 }
        return
      }
      if (this.selectedTile) { this.hooks.onTileSelect(null); this.setSelectedTile(null) }
    }
    if (e.shiftKey && !pan) {
      this.drag = { kind: 'marquee', start: world, screen, moved: false, sent: 0 }
      return
    }
    if (!pan && this.selected.size) { this.hooks.onSelect([]); this.setSelected([]) }
    this.drag = { kind: 'pan', start: world, screen, moved: false, sent: 0 }
    // holding still on empty ground pings, for touch screens
    if (e.pointerType === 'touch') this.longPress = window.setTimeout(() => { if (this.drag && !this.drag.moved) { this.drag = null; this.hooks.onPing(world) } }, 600)
  }

  private move = (e: PointerEvent) => {
    this.poke()
    const screen = this.local(e)
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, screen)
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const k = Math.min(4, Math.max(0.05, this.pinch.scale * (dist / this.pinch.dist)))
      const before = this.toWorld(mid)
      this.world.scale.set(k)
      this.world.position.set(mid.x - before.x * k, mid.y - before.y * k)
      return
    }
    const world = this.toWorld(screen)
    const now = performance.now()
    if (this.tool === 'wall' && this.wallPoly.length) {
      const last = this.wallPoly[this.wallPoly.length - 1], to = this.snapWall(world)
      this.wallPreview.clear().moveTo(last.x, last.y).lineTo(to.x, to.y).stroke({ width: 3 / this.world.scale.x, color: 0xffd23f, alpha: 0.9 })
    }
    if (now - this.lastCursor > 60 && e.pointerType === 'mouse') { this.lastCursor = now; this.hooks.onCursor(world) }
    const d = this.drag
    if (!d) return
    if (Math.hypot(screen.x - d.screen.x, screen.y - d.screen.y) > 4) { d.moved = true; clearTimeout(this.longPress) }
    if (!d.moved) return
    switch (d.kind) {
      case 'pan':
        this.world.position.set(screen.x - d.start.x * this.world.scale.x, screen.y - d.start.y * this.world.scale.y)
        break
      case 'tokens': {
        const lead = this.tokens.get(d.lead!)!
        const o = d.origins!.get(d.lead!)!
        let target = this.scene ? snap({ x: o.x + world.x - d.start.x, y: o.y + world.y - d.start.y }, lead.size, this.scene) : { x: o.x + world.x - d.start.x, y: o.y + world.y - d.start.y }
        if (this.scene && this.wallsBlock && !(this.me.gm && (e.ctrlKey || e.metaKey))) target = this.walkTo(d, target, lead.size, now)
        const dx = target.x - o.x, dy = target.y - o.y
        d.off = { x: dx, y: dy }
        for (const [id, origin] of d.origins!) this.views.get(id)?.box.position.set(origin.x + dx, origin.y + dy)
        const path = [o, target]
        if (d.origins!.size === 1 && this.scene) {
          const left = this.hooks.moveLeft(lead)
          const cost = measure(path, this.scene).distance
          // green while the walk is within what is left, yellow up to a dash, red beyond
          const colour = left == null ? 0xffd23f : cost <= left ? 0x4caf50 : cost <= left * 2 ? 0xf1c40f : 0xe74c3c
          this.drawRuler(path, colour, null, undefined, left == null ? undefined : ` of ${formatDistance(left, this.scene.unit)} left`)
        }
        if (now - d.sent > 70) { d.sent = now; d.sentOff = d.off; this.flushMove(d, false); this.hooks.onRuler(path) }
        break
      }
      case 'ruler': {
        const path = [...this.rulerBase.slice(0, -1), d.start, this.scene ? snapPoint(world, this.scene) : world]
        this.drawRuler(path, 0xffd23f, null)
        if (now - d.sent > 70) { d.sent = now; this.hooks.onRuler(path) }
        break
      }
      case 'drawmove': {
        const dr = d.drawing!
        const off = { x: world.x - d.start.x, y: world.y - d.start.y }
        this.strokeG.removeChildren().forEach((c) => c.destroy({ children: true }))
        this.strokeG.addChild(this.shape(dr.kind, dr.points.map((p) => ({ x: p.x + off.x, y: p.y + off.y })), dr.color, dr.width, dr.fill, dr.text, 0.7))
        break
      }
      case 'wallrect':
      case 'revealrect': {
        const to = d.kind === 'wallrect' ? this.snapWall(world) : world
        const k = 1 / this.world.scale.x
        this.wallPreview.clear().rect(Math.min(d.start.x, to.x), Math.min(d.start.y, to.y), Math.abs(to.x - d.start.x), Math.abs(to.y - d.start.y)).stroke({ width: 3 * k, color: d.kind === 'wallrect' ? 0xffd23f : 0x4caf50, alpha: 0.9 })
        break
      }
      case 'wallend': {
        // snap to the grid or to another wall's end, but not to the ends being moved
        const moving = new Set(d.ends!.map((e) => e.id))
        const keep = this.walls
        this.walls = this.walls.filter((w) => !moving.has(w.id))
        const to = this.snapWall(world)
        this.walls = keep
        d.to = to
        this.walls = this.walls.map((w) => {
          const a = d.ends!.find((e) => e.id === w.id && e.end === 1), b = d.ends!.find((e) => e.id === w.id && e.end === 2)
          return a || b ? { ...w, ...(a ? { x1: to.x, y1: to.y } : {}), ...(b ? { x2: to.x, y2: to.y } : {}) } : w
        })
        this.drawWalls()
        break
      }
      case 'tile': {
        const o = d.origins!.get(d.lead!)!
        const half = this.scene ? this.scene.gridSize / 2 : 1
        const nx = Math.round((o.x + world.x - d.start.x) / half) * half, ny = Math.round((o.y + world.y - d.start.y) / half) * half
        this.tileBoxes.get(d.lead!)?.position.set(nx, ny)
        this.tileSel.position.set(nx, ny)
        break
      }
      case 'draw': {
        const last = this.stroke[this.stroke.length - 1]
        if (this.drawStyle.kind === 'free') { if (Math.hypot(world.x - last.x, world.y - last.y) > 3 / this.world.scale.x && this.stroke.length < 590) this.stroke.push(world) }
        else this.stroke = [d.start, ['cone', 'beam', 'blast', 'cube'].includes(this.drawStyle.kind) ? this.areaEnd(d.start, world) : world]
        this.strokeG.removeChildren().forEach((c) => c.destroy({ children: true }))
        this.strokeG.addChild(this.shape(this.drawStyle.kind, this.stroke, this.drawStyle.color, this.drawStyle.width, this.drawStyle.fill, '', 0.8))
        break
      }
      case 'marquee': {
        this.marquee.clear().rect(Math.min(d.start.x, world.x), Math.min(d.start.y, world.y), Math.abs(world.x - d.start.x), Math.abs(world.y - d.start.y)).fill({ color: 0xffd23f, alpha: 0.12 }).stroke({ width: 1 / this.world.scale.x, color: 0xffd23f })
        break
      }
    }
  }

  /**
   * Where the lead of a drag may go on its way to `target` without walking through a wall, and the rest of the
   * selection with it. Steps are taken from where the tokens are now, so a token can be walked around a corner;
   * the server checks each step it is sent, so the corner is sent before the token goes round it.
   */
  private walkTo(d: NonNullable<TableEngine['drag']>, target: Pt, size: number, now: number): Pt {
    const o = d.origins!.get(d.lead!)!, off = d.off ?? { x: 0, y: 0 }, sentOff = d.sentOff ?? { x: 0, y: 0 }
    const at = { x: o.x + off.x, y: o.y + off.y }
    const to = reach(at, target, size, this.walls, this.scene!)
    let nx = to.x - o.x, ny = to.y - o.y
    const moves = (from: Pt, a: Pt, b: Pt) => blockedPath({ x: from.x + a.x, y: from.y + a.y }, { x: from.x + b.x, y: from.y + b.y }, this.walls)
    if ([...d.origins!].some(([id, p]) => id !== d.lead && moves(p, off, { x: nx, y: ny }))) { nx = off.x; ny = off.y }
    if ([...d.origins!.values()].some((p) => moves(p, sentOff, { x: nx, y: ny }))) { d.sent = now; d.sentOff = off; this.flushMove(d, false) }
    return { x: o.x + nx, y: o.y + ny }
  }

  /** What a person's own last drags moved, newest last, so Ctrl+Z can put them back. */
  private undo: { id: string; x: number; y: number }[][] = []

  /** Puts the tokens of the last move back where they were. Returns false when there is nothing to undo. */
  undoMove(): boolean {
    const last = this.undo.pop()
    if (!last) return false
    const back = last.filter((m) => this.hooks.canMove(this.tokens.get(m.id)!))
    if (back.length) this.hooks.onMove(back)
    return back.length > 0
  }

  private flushMove(d: NonNullable<TableEngine['drag']>, final: boolean) {
    const moves: { id: string; x: number; y: number }[] = []
    for (const id of d.origins!.keys()) {
      const v = this.views.get(id)
      if (v) moves.push({ id, x: v.box.x, y: v.box.y })
    }
    if (moves.length) this.hooks.onMove(moves)
    if (final) for (const m of moves) { const t = this.tokens.get(m.id); if (t) this.tokens.set(m.id, { ...t, x: m.x, y: m.y }) }
  }

  private up = (e: PointerEvent) => {
    this.poke()
    this.pointers.delete(e.pointerId)
    clearTimeout(this.longPress)
    if (this.pointers.size < 2) this.pinch = null
    const d = this.drag
    if (!d) return
    if (d.kind === 'tokens' && d.moved) {
      this.undo.push([...d.origins!].map(([id, o]) => ({ id, x: o.x, y: o.y })))
      if (this.undo.length > 30) this.undo.shift()
      this.flushMove(d, true)
    }
    if (d.kind === 'ruler' && d.moved && e.shiftKey) {
      // keep what was measured on screen and wait for the next leg
      const end = this.scene ? snapPoint(this.toWorld(this.local(e)), this.scene) : this.toWorld(this.local(e))
      this.rulerBase = [...this.rulerBase, end]
    } else if (d.kind === 'tokens' || d.kind === 'ruler') { if (d.kind === 'ruler') this.rulerBase = []; this.ruleG.clear(); this.ruleLabel.visible = false; if (d.moved) this.hooks.onRuler(null) }
    if (d.kind === 'drawmove') {
      this.strokeG.removeChildren().forEach((c) => c.destroy({ children: true }))
      if (d.moved) { const w = this.toWorld(this.local(e)); this.hooks.onDrawMove(d.drawing!.id, w.x - d.start.x, w.y - d.start.y) }
    }
    if ((d.kind === 'wallrect' || d.kind === 'revealrect')) {
      this.wallPreview.clear()
      const w = this.toWorld(this.local(e))
      const to = d.kind === 'wallrect' ? this.snapWall(w) : w
      const [x0, x1, y0, y1] = [Math.min(d.start.x, to.x), Math.max(d.start.x, to.x), Math.min(d.start.y, to.y), Math.max(d.start.y, to.y)]
      if (d.moved && x1 - x0 > 4 && y1 - y0 > 4) {
        if (d.kind === 'wallrect') this.hooks.onWallAdd([{ x1: x0, y1: y0, x2: x1, y2: y0, kind: this.wallKind }, { x1: x1, y1: y0, x2: x1, y2: y1, kind: this.wallKind }, { x1: x1, y1: y1, x2: x0, y2: y1, kind: this.wallKind }, { x1: x0, y1: y1, x2: x0, y2: y0, kind: this.wallKind }])
        else this.hooks.onReveal({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
      }
    }
    // a click on the end of a wall, without dragging, starts a new wall from that point as before
    if (d.kind === 'wallend' && !d.moved) this.wallPoly.push(d.start)
    if (d.kind === 'wallend' && d.moved && d.to) {
      const to = d.to
      this.hooks.onWallMove(d.ends!.map((e) => ({ id: e.id, patch: e.end === 1 ? { x1: to.x, y1: to.y } : { x2: to.x, y2: to.y } })))
    }
    if (d.kind === 'tile' && d.moved) {
      const box = this.tileBoxes.get(d.lead!)
      if (box) { const t = this.tiles.find((x) => x.id === d.lead); if (t) { t.x = box.x; t.y = box.y }; this.hooks.onTileMove(d.lead!, box.x, box.y) }
    }
    if (d.kind === 'draw') {
      this.strokeG.removeChildren().forEach((c) => c.destroy({ children: true }))
      const pts = d.moved || this.drawStyle.kind === 'free' ? this.stroke : []
      if (pts.length) this.hooks.onDraw({ ...this.drawStyle, points: pts.length === 1 && this.drawStyle.kind !== 'free' ? [] : pts })
      this.stroke = []
    }
    if (d.kind === 'marquee') {
      const w = this.toWorld(this.local(e))
      const [x0, x1] = [Math.min(d.start.x, w.x), Math.max(d.start.x, w.x)]
      const [y0, y1] = [Math.min(d.start.y, w.y), Math.max(d.start.y, w.y)]
      const ids = [...this.tokens.values()].filter((t) => t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1).map((t) => t.id)
      this.marquee.clear()
      this.hooks.onSelect(ids)
      this.setSelected(ids)
    }
    this.drag = null
    if (this.visionPending) { this.visionPending = false; this.refreshVision() }
  }

  // ---------- drawing the overlays ----------

  private drawRuler(points: Pt[], color: number, into: Container | null, who?: string, suffix = '') {
    const scene = this.scene
    if (!scene || points.length < 2) return
    const g = into ? new Graphics() : this.ruleG
    if (!into) g.clear()
    g.moveTo(points[0].x, points[0].y)
    for (const p of points.slice(1)) g.lineTo(p.x, p.y)
    g.stroke({ width: 3 / this.world.scale.x, color, alpha: 0.9 })
    for (const p of points) g.circle(p.x, p.y, 5 / this.world.scale.x).fill({ color })
    const m = measure(points, scene)
    const text = `${who ? `${who}: ` : ''}${formatDistance(m.distance, scene.unit)}${suffix}`
    const last = points[points.length - 1]
    const label = into ? new Text({ text, style: { fontSize: 14, fill: 0xffffff, fontFamily: 'sans-serif', stroke: { color: 0x000000, width: 3 } } }) : this.ruleLabel
    label.text = text
    label.scale.set(1 / this.world.scale.x)
    label.position.set(last.x + 10 / this.world.scale.x, last.y - 24 / this.world.scale.x)
    label.visible = true
    if (into) into.addChild(g, label)
  }

  /** Keeps painting for a moment: called whenever anything on screen may have changed. */
  private poke = () => { this.activeUntil = performance.now() + 600 }

  /** Settings for a slow machine, and the numbers that show how it is doing. */
  private perf = { fogOnDrop: false, light: false }
  /** the looping video behind the map, when the map is one */
  private videoEl: HTMLVideoElement | null = null
  private visionPending = false
  private frames = 0
  private frameFrom = performance.now()
  private fps = 0
  setPerformance(p: { fogOnDrop: boolean; light: boolean }) {
    this.perf = p
    if (!this.fog) return
    this.fog.setDetail(p.light)
    this.fog.still = p.light
    if (this.videoEl) { if (p.light) this.videoEl.pause(); else void this.videoEl.play().catch(() => undefined) }
    this.weatherG.visible = !p.light && this.weather !== 'none'
    this.poke()
  }
  /** Frames drawn per second over the last second, and how long the last redraw of the fog took. */
  getStats() { return { fps: this.fps, fogMs: this.fog.lastMs } }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    this.frames++
    { const t = performance.now(); if (t - this.frameFrom >= 1000) { this.fps = Math.round((this.frames * 1000) / (t - this.frameFrom)); this.frames = 0; this.frameFrom = t } }
    if (this.needFit && this.host.clientWidth) this.fit()
    if (this.pings.length) { this.tick(); this.poke() }
    if (this.weather !== 'none' && !this.perf.light) { this.fall(); this.poke() }
    if (this.videoEl && !this.perf.light) this.poke()
    if (this.fog.animated) { this.fog.animate(performance.now()); this.poke() }
    if (performance.now() > this.activeUntil) return
    this.app.render()
  }

  private tick = () => {
    const now = performance.now()
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i]
      const t = (now - p.born) / 1600
      if (t >= 1) { p.g.destroy(); this.pings.splice(i, 1); continue }
      const k = 1 / this.world.scale.x
      p.g.clear()
      for (const phase of [0, 0.25]) {
        const u = Math.max(0, t - phase)
        if (u <= 0) continue
        p.g.circle(0, 0, (14 + 70 * u) * k).stroke({ width: 4 * k, color: Number(p.g.label), alpha: 1 - u })
      }
    }
  }
}

function snapPoint(p: Pt, scene: Scene): Pt {
  return snap(p, 1, scene)
}

/** One colour per condition name, so the same condition looks the same everywhere. */
function pipColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return new Color(`hsl(${h} 60% 42%)`).toNumber()
}
