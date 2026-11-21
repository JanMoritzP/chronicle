// Playing a session back: from the notes the table kept (tokens put down, moved, hurt and taken away, scenes shown), where everything stood at any
// moment. Pure functions, tested without a browser.

export interface ReplayEvent { ts: number; kind: string; scene: string | null; id?: string; name?: string; x?: number; y?: number; fx?: number; fy?: number; hidden?: boolean; value?: number | null; max?: number | null }
export interface Standing { id: string; name: string; x: number; y: number; hidden: boolean; hp: number | null; hpMax: number | null }

/** Where the tokens of a scene stood after the first `upto` events. A token that was already there when the session began first appears where its first move left from. */
export function standingAt(events: ReplayEvent[], upto: number, scene: string | null): Standing[] {
  const at = new Map<string, Standing>()
  for (const e of events.slice(0, upto)) {
    if (e.scene !== scene || !e.id) continue
    if (e.kind === 'add') at.set(e.id, { id: e.id, name: e.name ?? '', x: e.x ?? 0, y: e.y ?? 0, hidden: !!e.hidden, hp: null, hpMax: null })
    else if (e.kind === 'remove') at.delete(e.id)
    else if (e.kind === 'move') {
      const cur = at.get(e.id) ?? { id: e.id, name: e.name ?? '', x: e.fx ?? e.x ?? 0, y: e.fy ?? e.y ?? 0, hidden: !!e.hidden, hp: null, hpMax: null }
      at.set(e.id, { ...cur, name: e.name ?? cur.name, x: e.x ?? cur.x, y: e.y ?? cur.y, hidden: !!e.hidden })
    } else if (e.kind === 'hp') {
      const cur = at.get(e.id) ?? { id: e.id, name: e.name ?? '', x: 0, y: 0, hidden: false, hp: null, hpMax: null }
      at.set(e.id, { ...cur, hp: e.value ?? null, hpMax: e.max ?? null })
    }
  }
  // a token that only ever had its hit points changed has no place to be drawn
  return [...at.values()].filter((t) => !(t.x === 0 && t.y === 0 && t.hp !== null && !events.some((e) => e.id === t.id && (e.kind === 'move' || e.kind === 'add'))))
}

/** The scene most of the session happened in, or the last one shown. */
export function mainScene(events: ReplayEvent[]): string | null {
  const count = new Map<string, number>()
  for (const e of events) if (e.scene && (e.kind === 'move' || e.kind === 'add')) count.set(e.scene, (count.get(e.scene) ?? 0) + 1)
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return top ?? [...events].reverse().find((e) => e.kind === 'scene')?.scene ?? null
}

/** What an event says, in words. */
export function describe(e: ReplayEvent): string {
  switch (e.kind) {
    case 'add': return `${e.name || 'A token'} is put on the map`
    case 'remove': return `${e.name || 'A token'} is taken off the map`
    case 'move': return `${e.name || 'A token'} moves`
    case 'hp': return `${e.name || 'A token'} is at ${e.value ?? '?'}${e.max ? ` of ${e.max}` : ''} hit points`
    case 'scene': return `The table moves to ${e.name || 'another scene'}`
    default: return e.kind
  }
}
