import type { Geometry, MapItem, Pt } from '../types'

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const pathLength = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0)
const lerp = (a: number, b: number, f: number) => a + (b - a) * f
const lerpPt = (a: Pt, b: Pt, f: number): Pt => [lerp(a[0], b[0], f), lerp(a[1], b[1], f)]

export function formatMeters(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  const km = m / 1000
  return `${km >= 100 ? Math.round(km) : km < 10 ? km.toFixed(2) : km.toFixed(1)} km`
}

export function formatDistance(px: number, scale: number | null): string {
  return scale ? formatMeters(px * scale) : `${Math.round(px)} px`
}

export const isPoint = (g: Geometry): g is Pt => typeof g[0] === 'number'

function lerpGeometry(a: Geometry, b: Geometry, f: number): Geometry {
  if (isPoint(a) && isPoint(b)) return lerpPt(a, b, f)
  if (!isPoint(a) && !isPoint(b) && a.length === b.length) return a.map((p, i) => lerpPt(p, b[i], f))
  return a
}

export const sortedKeyframes = (item: MapItem) => [...item.keyframes].sort((a, b) => a.t - b.t)

/** Where (and whether) a map item exists at time T. T = null means "ignore time". */
export function itemStateAt(item: MapItem, T: number | null): { visible: boolean; geometry: Geometry } {
  if (item.timeMode !== 'timed' || T === null) return { visible: true, geometry: item.geometry }
  const kfs = sortedKeyframes(item)
  let idx = -1
  for (let i = 0; i < kfs.length; i++) if (kfs[i].t <= T) idx = i
  if (idx < 0) return { visible: false, geometry: item.geometry }
  const cur = kfs[idx]
  if (cur.hidden || !cur.geometry) return { visible: false, geometry: item.geometry }
  const next = kfs[idx + 1]
  if (item.style.glide && next && !next.hidden && next.geometry && next.t > cur.t) {
    return { visible: true, geometry: lerpGeometry(cur.geometry, next.geometry, (T - cur.t) / (next.t - cur.t)) }
  }
  return { visible: true, geometry: cur.geometry }
}

export interface JourneyTimes { arr: number[]; dep: number[] }

/**
 * Fills in arrival/departure times for every vertex. Vertices with a known time are anchors; the ones between two
 * anchors are spread along the distance between them.
 */
export function journeyTimes(geom: Pt[], wps: { arrive: number | null; depart: number | null }[]): JourneyTimes | null {
  const n = geom.length
  const anchors: number[] = []
  const arr: (number | null)[] = []
  const dep: (number | null)[] = []
  for (let i = 0; i < n; i++) {
    const w = wps[i] ?? { arrive: null, depart: null }
    const a = w.arrive ?? w.depart
    const d = w.depart ?? w.arrive
    arr.push(a); dep.push(d)
    if (a !== null) anchors.push(i)
  }
  if (!anchors.length) return null
  const outA: number[] = new Array(n)
  const outD: number[] = new Array(n)
  for (const i of anchors) { outA[i] = arr[i]!; outD[i] = dep[i]! }
  for (let i = 0; i < anchors[0]; i++) { outA[i] = outD[i] = outA[anchors[0]] }
  const last = anchors[anchors.length - 1]
  for (let i = last + 1; i < n; i++) { outA[i] = outD[i] = outD[last] }
  for (let k = 0; k < anchors.length - 1; k++) {
    const a = anchors[k], b = anchors[k + 1]
    const total = pathLength(geom.slice(a, b + 1)) || 1
    let run = 0
    for (let i = a + 1; i < b; i++) {
      run += dist(geom[i - 1], geom[i])
      const t = lerp(outD[a], outA[b], run / total)
      outA[i] = outD[i] = t
    }
  }
  for (let i = 1; i < n; i++) if (outA[i] < outD[i - 1]) outA[i] = outD[i - 1]
  for (let i = 0; i < n; i++) if (outD[i] < outA[i]) outD[i] = outA[i]
  return { arr: outA, dep: outD }
}

export interface JourneyPosition { pos: Pt; travelled: Pt[]; started: boolean; finished: boolean }

export function journeyAt(geom: Pt[], times: JourneyTimes, T: number): JourneyPosition {
  const { arr, dep } = times
  const n = geom.length
  if (T < dep[0]) return { pos: geom[0], travelled: [geom[0]], started: false, finished: false }
  if (T >= arr[n - 1]) return { pos: geom[n - 1], travelled: geom, started: true, finished: true }
  for (let i = 0; i < n - 1; i++) {
    if (T >= arr[i] && T <= dep[i]) return { pos: geom[i], travelled: geom.slice(0, i + 1), started: true, finished: false }
    if (T > dep[i] && T < arr[i + 1]) {
      const f = (T - dep[i]) / (arr[i + 1] - dep[i])
      const pos = lerpPt(geom[i], geom[i + 1], f)
      return { pos, travelled: [...geom.slice(0, i + 1), pos], started: true, finished: false }
    }
  }
  return { pos: geom[n - 1], travelled: geom, started: true, finished: true }
}

/** Every time something on this item changes (used for next/previous-change buttons and scrubber ticks). */
export function itemTimes(item: MapItem): number[] {
  if (item.timeMode === 'timed') return item.keyframes.map((k) => k.t)
  if (item.timeMode === 'journey' && item.journey) {
    return item.journey.waypoints.flatMap((w) => [w.arrive, w.depart]).filter((t): t is number => t !== null)
  }
  return []
}

export function niceNumber(x: number): number {
  const pow = 10 ** Math.floor(Math.log10(x))
  const f = x / pow
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * pow
}
