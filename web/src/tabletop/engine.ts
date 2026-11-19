import { Application, Color, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import { FogLayer, type Light, type Wall } from './fog'
import { formatDistance, hexCentres, hexCorners, measure, snap, tokenPixels, type Pt } from './grid'
import type { Cursor, Ruler, Scene, Token } from './state'

// The picture of a scene: background, grid, tokens, rulers, pings and other people's cursors, drawn with WebGL.
// The engine knows nothing about the network. It reports what the person did through hooks and shows what it is told.

export interface Hooks {
  canMove(t: Token): boolean
  onMove(moves: { id: string; x: number; y: number }[]): void
  onSelect(ids: string[]): void
  onPing(p: Pt): void
  onCursor(p: Pt): void
  onRuler(points: Pt[] | null): void
  onWallAdd(walls: { x1: number; y1: number; x2: number; y2: number; kind: Wall['kind'] }[]): void
  onWallErase(id: string): void
  onDoor(id: string): void
  onExplored(png: string): void
  colorOf(userId: string): number
}
export type Tool = 'select' | 'ruler' | 'wall' | 'erase'

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
  private wallPreview = new Graphics()
  private walls: Wall[] = []
  private wallKind: Wall['kind'] = 'wall'
  private wallPoly: Pt[] = []
  private lastClick = { t: 0, x: 0, y: 0 }
  private fog!: FogLayer
  private turnId: string | null = null
  private me = { id: '', gm: true, canDoors: false }
  private drag: null | { kind: 'pan' | 'tokens' | 'ruler' | 'marquee'; start: Pt; screen: Pt; origins?: Map<string, Pt>; lead?: string; moved: boolean; sent: number } = null
  private pointers = new Map<number, Pt>()
  private pinch: null | { dist: number; scale: number } = null
  private longPress: number | undefined
  private lastCursor = 0

  constructor(private host: HTMLElement, private hooks: Hooks) {}

  async init() {
    const bg = getComputedStyle(this.host).getPropertyValue('--bg-side').trim() || '#17181b'
    await this.app.init({ resizeTo: this.host, background: new Color(bg).toNumber(), antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 })
    if (this.gone) { this.app.destroy(true, { children: true }); return }
    this.ready = true
    this.host.appendChild(this.app.canvas)
    this.app.canvas.style.touchAction = 'none'
    this.fog = new FogLayer(this.app)
    this.fog.onExplored = (png) => this.hooks.onExplored(png)
    this.world.addChild(this.bg, this.gridG, this.tokenLayer, this.fog.view, this.wallG, this.others, this.ruleG, this.ruleLabel, this.overlay, this.wallPreview, this.marquee)
    this.ruleLabel.visible = false
    this.app.stage.addChild(this.world)
    const c = this.app.canvas
    c.addEventListener('pointerdown', this.down)
    c.addEventListener('pointermove', this.move)
    c.addEventListener('pointerup', this.up)
    c.addEventListener('pointercancel', this.up)
    c.addEventListener('wheel', this.wheel, { passive: false })
    c.addEventListener('contextmenu', (e) => e.preventDefault())
    this.app.ticker.add(this.tick)
    if (this.scene) this.setScene(this.scene)
    this.drawWalls()
    this.setTokens([...this.tokens.values()])
  }

  destroy() {
    this.gone = true
    clearTimeout(this.longPress)
    if (!this.ready) return
    this.app.ticker.remove(this.tick)
    this.fog.destroy()
    this.app.destroy(true, { children: true })
  }

  // ---------- what to show ----------

  setScene(scene: Scene | null) {
    const changed = this.scene?.id !== scene?.id || this.scene?.bg !== scene?.bg
    this.scene = scene
    if (!this.ready) return
    this.drawGrid()
    if (changed) this.drawBackground()
    if (scene && this.fitted !== scene.id) { this.fitted = scene.id; this.fit() }
    for (const v of this.views.values()) this.layout(v)
    this.fog.configure(scene, !this.me.gm)
    this.refreshVision()
  }

  private async drawBackground() {
    const scene = this.scene
    this.bg.removeChildren().forEach((c) => c.destroy())
    if (!scene) return
    const base = new Graphics().rect(0, 0, scene.width, scene.height).fill({ color: 0x20222a })
    this.bg.addChild(base)
    if (!scene.bg) return
    const tex = await loadTexture(scene.bg)
    if (!tex || this.scene?.id !== scene.id || this.scene.bg !== scene.bg || this.gone) return
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
    const paint = () => { g.stroke({ width: 1, color: 0x000000, alpha: 0.35, pixelLine: true }) }
    if (s.grid === 'square') {
      for (let x = 0; x <= w; x += s.gridSize) g.moveTo(x, 0).lineTo(x, h)
      for (let y = 0; y <= h; y += s.gridSize) g.moveTo(0, y).lineTo(w, y)
      paint()
      for (let x = 0; x <= w; x += s.gridSize) g.moveTo(x, 0).lineTo(x, h)
      for (let y = 0; y <= h; y += s.gridSize) g.moveTo(0, y).lineTo(w, y)
      g.stroke({ width: 1, color: 0xffffff, alpha: 0.28, pixelLine: true })
      return
    }
    const centres = hexCentres(w, h, s)
    for (const pass of [{ width: 1, color: 0x000000, alpha: 0.35, pixelLine: true }, { width: 1, color: 0xffffff, alpha: 0.28, pixelLine: true }]) {
      for (const c of centres) {
        const pts = hexCorners(c, s)
        g.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < 6; i++) g.lineTo(pts[i].x, pts[i].y)
        g.closePath()
      }
      g.stroke(pass)
    }
  }

  setTokens(list: Token[]) {
    this.tokens = new Map(list.map((t) => [t.id, t]))
    if (!this.ready) return
    for (const [id, v] of this.views) if (!this.tokens.has(id)) { v.box.destroy({ children: true }); this.views.delete(id) }
    for (const t of list) this.upsert(t)
    this.sortLayer()
    this.refreshVision()
  }

  upsert(t: Token) {
    this.tokens.set(t.id, t)
    if (!this.ready) return
    const key = [t.image, t.color, t.name, t.size, t.hidden, t.locked, JSON.stringify(t.data.hp ?? null), (t.data.conditions ?? []).join(',')].join('|')
    let v = this.views.get(t.id)
    if (!v || v.key !== key) {
      v?.box.destroy({ children: true })
      v = { box: new Container(), token: t, key }
      this.views.set(t.id, v)
      this.tokenLayer.addChild(v.box)
      this.build(v)
    }
    v.token = t
    if (!this.me.gm && this.tokens.size) this.refreshVision()
    // a token the person is dragging is theirs to place; the server's older position must not pull it back
    if (!(this.drag?.kind === 'tokens' && this.drag.origins?.has(t.id))) this.layout(v)
  }

  private sortLayer() {
    const order = [...this.views.values()].sort((a, b) => a.token.z - b.token.z)
    order.forEach((v, i) => this.tokenLayer.setChildIndex(v.box, i))
  }

  private px(t: Token) { return this.scene ? tokenPixels(t.size, this.scene) : 70 * t.size }

  private build(v: TokenView) {
    const t = v.token
    const d = this.px(t)
    const r = d / 2
    const ring = new Graphics().circle(0, 0, r).fill({ color: new Color(t.color || '#6b7280').toNumber() }).stroke({ width: 3, color: 0x000000, alpha: 0.55 })
    v.box.addChild(ring)
    if (!t.image) {
      const initial = new Text({ text: (t.name || '?').trim().slice(0, 2).toUpperCase(), style: { fontSize: Math.max(12, r * 0.8), fill: 0xffffff, fontFamily: 'sans-serif', fontWeight: '700' } })
      initial.anchor.set(0.5)
      v.box.addChild(initial)
    } else {
      loadTexture(t.image).then((tex) => {
        if (!tex || v.box.destroyed) return
        const sprite = new Sprite(tex)
        sprite.anchor.set(0.5)
        const scale = d / Math.min(tex.width, tex.height)
        sprite.scale.set(scale)
        const mask = new Graphics().circle(0, 0, r - 1.5).fill({ color: 0xffffff })
        v.box.addChild(mask, sprite)
        sprite.mask = mask
        v.box.addChild(new Graphics().circle(0, 0, r).stroke({ width: 3, color: 0x000000, alpha: 0.55 }))
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
    label.y = r + (hasBar ? 11 : 2)
    label.visible = !!t.name
    label.label = 'name'
    v.box.addChild(label)
    v.box.eventMode = 'none'
    this.drawSelection(v)
  }

  private drawSelection(v: TokenView) {
    v.box.getChildByLabel('sel')?.destroy()
    v.box.getChildByLabel('turn')?.destroy()
    const r = this.px(v.token) / 2
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

  private layout(v: TokenView) {
    const t = v.token
    v.box.position.set(t.x, t.y)
    v.box.rotation = 0
    v.box.alpha = t.hidden ? 0.45 : 1
    // the picture turns with the token; the name stays upright
    for (const c of v.box.children) if (!['name', 'sel', 'hp', 'down', 'cond', 'turn'].includes(c.label)) c.rotation = (t.rotation * Math.PI) / 180
  }

  /** The token whose turn it is gets a blue ring. */
  setTurn(id: string | null) {
    this.turnId = id
    if (this.ready) for (const v of this.views.values()) this.drawSelection(v)
  }

  setSelected(ids: string[]) {
    this.selected = new Set(ids)
    if (this.ready) for (const v of this.views.values()) this.drawSelection(v)
  }

  /** Who is looking: the GM sees everything, a player sees what their own tokens see. */
  setViewer(me: { id: string; gm: boolean; spectator: boolean; canDoors: boolean }) {
    this.me = { id: me.id, gm: me.gm || me.spectator, canDoors: me.canDoors || me.gm }
    if (!this.ready) return
    this.fog.configure(this.scene, !this.me.gm)
    this.drawWalls()
    this.refreshVision()
  }

  setWalls(walls: Wall[]) { this.walls = walls; if (this.ready) { this.fog.setWalls(walls); this.drawWalls() } }
  setLights(lights: Light[]) { if (this.ready) this.fog.setLights(lights) }
  setExplored(png: string | null) { if (this.ready) void this.fog.loadExplored(png) }
  setWallKind(kind: Wall['kind']) { this.wallKind = kind }

  /** Tokens that give their owner sight, and who is hidden by the dark. */
  private refreshVision() {
    if (!this.ready || this.me.gm) {
      for (const v of this.views.values()) v.box.visible = true
      return
    }
    const mine = [...this.tokens.values()].filter((t) => t.owners.includes(this.me.id))
    this.fog.setViewers(mine.map((t) => {
      const vis = (t.data.vision ?? {}) as { sight?: number | null; dark?: number }
      return { id: t.id, x: t.x, y: t.y, sight: vis.sight ?? null, dark: vis.dark ?? 0 }
    }))
    window.setTimeout(() => this.applyTokenVisibility(), 40)
  }

  private applyTokenVisibility() {
    if (this.me.gm) return
    for (const v of this.views.values()) v.box.visible = v.token.owners.includes(this.me.id) || this.fog.isVisible({ x: v.token.x, y: v.token.y })
  }

  /** Ends the wall being drawn and sends it. */
  finishWalls() {
    const p = this.wallPoly
    this.wallPoly = []
    this.wallPreview.clear()
    if (p.length < 2) return
    this.hooks.onWallAdd(p.slice(1).map((q, i) => ({ x1: p[i].x, y1: p[i].y, x2: q.x, y2: q.y, kind: this.wallKind })))
  }

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
      if (!this.me.gm && !door) continue
      const color = w.kind === 'wall' ? 0xf5f0e6 : w.kind === 'door' ? 0xe08a2e : w.kind === 'secret' ? 0xb36bff : 0x6cc7ff
      g.moveTo(w.x1, w.y1).lineTo(w.x2, w.y2).stroke({ width: (door ? 5 : 3) * k, color, alpha: w.open ? 0.35 : 0.95 })
      if (editing && this.me.gm) { g.circle(w.x1, w.y1, 4 * k).fill({ color }); g.circle(w.x2, w.y2, 4 * k).fill({ color }) }
    }
  }

  setTool(tool: Tool) { this.tool = tool; this.wallPoly = []; this.wallPreview.clear(); this.drawWalls(); if (this.ready) this.app.canvas.style.cursor = tool === 'ruler' ? 'crosshair' : '' }

  setOthers(cursors: Record<string, Cursor>, rulers: Record<string, Ruler>) {
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

  ping(p: Pt, userId: string) {
    const g = new Graphics()
    g.position.set(p.x, p.y)
    g.label = String(this.hooks.colorOf(userId))
    this.overlay.addChild(g)
    this.pings.push({ g, born: performance.now() })
  }

  // ---------- camera ----------

  fit() {
    const s = this.scene
    if (!s || !this.ready) return
    const w = this.host.clientWidth || 800, h = this.host.clientHeight || 600
    const k = Math.min(w / s.width, h / s.height) * 0.95
    this.world.scale.set(k)
    this.world.position.set((w - s.width * k) / 2, (h - s.height * k) / 2)
  }

  centre(): Pt {
    return this.toWorld({ x: (this.host.clientWidth || 0) / 2, y: (this.host.clientHeight || 0) / 2 })
  }

  centreOn(p: Pt) {
    const k = this.world.scale.x
    this.world.position.set((this.host.clientWidth || 0) / 2 - p.x * k, (this.host.clientHeight || 0) / 2 - p.y * k)
  }

  zoomBy(f: number, at: Pt = { x: (this.host.clientWidth || 0) / 2, y: (this.host.clientHeight || 0) / 2 }) {
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
    e.preventDefault()
    this.zoomBy(Math.pow(1.0015, -e.deltaY), this.local(e))
  }

  private down = (e: PointerEvent) => {
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
    if (e.altKey) return this.hooks.onPing(world)
    const pan = e.button === 1 || e.button === 2
    if (!pan && this.me.gm && this.tool === 'wall') {
      const pt = this.snapWall(world)
      const now = performance.now()
      const again = now - this.lastClick.t < 350 && Math.hypot(pt.x - this.lastClick.x, pt.y - this.lastClick.y) < 2
      this.lastClick = { t: now, x: pt.x, y: pt.y }
      if (again) { this.finishWalls(); return }
      this.wallPoly.push(pt)
      return
    }
    if (!pan && this.me.gm && this.tool === 'erase') {
      const w = this.nearWall(world)
      if (w) this.hooks.onWallErase(w.id)
      return
    }
    const tok = pan ? null : this.hit(world)
    if (!tok && !pan && this.me.canDoors) {
      const door = this.nearWall(world, (w) => w.kind === 'door' || (w.kind === 'secret' && this.me.gm))
      if (door) { this.hooks.onDoor(door.id); return }
    }
    if (this.tool === 'ruler' && !pan) {
      this.drag = { kind: 'ruler', start: world, screen, moved: false, sent: 0 }
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
        const target = this.scene ? snap({ x: o.x + world.x - d.start.x, y: o.y + world.y - d.start.y }, lead.size, this.scene) : { x: o.x + world.x - d.start.x, y: o.y + world.y - d.start.y }
        const dx = target.x - o.x, dy = target.y - o.y
        for (const [id, origin] of d.origins!) this.views.get(id)?.box.position.set(origin.x + dx, origin.y + dy)
        const path = [o, target]
        if (d.origins!.size === 1 && this.scene) this.drawRuler(path, 0xffd23f, null)
        if (now - d.sent > 70) { d.sent = now; this.flushMove(d, false); this.hooks.onRuler(path) }
        break
      }
      case 'ruler': {
        const path = [d.start, this.scene ? snapPoint(world, this.scene) : world]
        this.drawRuler(path, 0xffd23f, null)
        if (now - d.sent > 70) { d.sent = now; this.hooks.onRuler(path) }
        break
      }
      case 'marquee': {
        this.marquee.clear().rect(Math.min(d.start.x, world.x), Math.min(d.start.y, world.y), Math.abs(world.x - d.start.x), Math.abs(world.y - d.start.y)).fill({ color: 0xffd23f, alpha: 0.12 }).stroke({ width: 1 / this.world.scale.x, color: 0xffd23f })
        break
      }
    }
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
    this.pointers.delete(e.pointerId)
    clearTimeout(this.longPress)
    if (this.pointers.size < 2) this.pinch = null
    const d = this.drag
    if (!d) return
    if (d.kind === 'tokens' && d.moved) this.flushMove(d, true)
    if (d.kind === 'tokens' || d.kind === 'ruler') { this.ruleG.clear(); this.ruleLabel.visible = false; if (d.moved) this.hooks.onRuler(null) }
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
  }

  // ---------- drawing the overlays ----------

  private drawRuler(points: Pt[], color: number, into: Container | null, who?: string) {
    const scene = this.scene
    if (!scene || points.length < 2) return
    const g = into ? new Graphics() : this.ruleG
    if (!into) g.clear()
    g.moveTo(points[0].x, points[0].y)
    for (const p of points.slice(1)) g.lineTo(p.x, p.y)
    g.stroke({ width: 3 / this.world.scale.x, color, alpha: 0.9 })
    for (const p of points) g.circle(p.x, p.y, 5 / this.world.scale.x).fill({ color })
    const m = measure(points, scene)
    const text = `${who ? `${who}: ` : ''}${formatDistance(m.distance, scene.unit)}`
    const last = points[points.length - 1]
    const label = into ? new Text({ text, style: { fontSize: 14, fill: 0xffffff, fontFamily: 'sans-serif', stroke: { color: 0x000000, width: 3 } } }) : this.ruleLabel
    label.text = text
    label.scale.set(1 / this.world.scale.x)
    label.position.set(last.x + 10 / this.world.scale.x, last.y - 24 / this.world.scale.x)
    label.visible = true
    if (into) into.addChild(g, label)
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
