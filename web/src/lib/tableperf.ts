// How the table is drawn on this machine: options for a slow one, and whether to show the numbers. Kept in this browser only.

export interface Perf { /** lower fog detail, no weather, no moving lights */ light: boolean; /** show frames per second and the cost of the fog */ show: boolean; /** no tumbling dice when someone rolls */ noDice: boolean }
export const DEFAULT_PERF: Perf = { light: false, show: false, noDice: false }
const STORE = 'tt-perf'

export function loadPerf(raw: string | null = (() => { try { return localStorage.getItem(STORE) } catch { return null } })()): Perf {
  try {
    const v = raw ? JSON.parse(raw) : {}
    return { light: v?.light === true, show: v?.show === true, noDice: v?.noDice === true }
  } catch { return { ...DEFAULT_PERF } }
}

export function savePerf(p: Perf) {
  try { localStorage.setItem(STORE, JSON.stringify(p)) } catch { /* not kept */ }
  window.dispatchEvent(new Event('tt-perf'))
}

/** The numbers as a line of text: "58 fps, fog 3.2 ms". */
export const statsText = (s: { fps: number; fogMs: number }) => `${s.fps} fps, fog ${s.fogMs.toFixed(1)} ms`
