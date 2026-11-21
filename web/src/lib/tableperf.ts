// How the table is drawn on this machine: options for a slow one, and whether to show the numbers. Kept in this browser only.

export interface Perf { /** the fog is worked out when a token is put down, not while it moves */ fogOnDrop: boolean; /** lower fog detail, no weather, no moving lights */ light: boolean; /** show frames per second and the cost of the fog */ show: boolean }
export const DEFAULT_PERF: Perf = { fogOnDrop: false, light: false, show: false }
const STORE = 'tt-perf'

export function loadPerf(raw: string | null = (() => { try { return localStorage.getItem(STORE) } catch { return null } })()): Perf {
  try {
    const v = raw ? JSON.parse(raw) : {}
    return { fogOnDrop: v?.fogOnDrop === true, light: v?.light === true, show: v?.show === true }
  } catch { return { ...DEFAULT_PERF } }
}

export function savePerf(p: Perf) {
  try { localStorage.setItem(STORE, JSON.stringify(p)) } catch { /* not kept */ }
  window.dispatchEvent(new Event('tt-perf'))
}

/** The numbers as a line of text: "58 fps, fog 3.2 ms". */
export const statsText = (s: { fps: number; fogMs: number }) => `${s.fps} fps, fog ${s.fogMs.toFixed(1)} ms`
