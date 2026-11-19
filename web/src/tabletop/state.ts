import { create } from 'zustand'
import type { GridSpec } from './grid'

// What the browser knows about the table. The server is the only writer: this store only ever holds what it was told.

export type TableRole = 'gm' | 'player' | 'spectator'
export interface Scene extends GridSpec { id: string; name: string; sort: number; bg: string; width: number; height: number }
export interface Token {
  id: string; sceneId: string; name: string; x: number; y: number; size: number; rotation: number
  image: string; color: string; pageId: string | null; hidden: boolean; locked: boolean
  owners: string[]; z: number; data: Record<string, any>
}
export interface Settings {
  gms: string[]; playersMoveOwn: boolean; playersCreateTokens: boolean; playersEditOwnStats: boolean; playersPing: boolean; playersRuler: boolean; showCursors: boolean
}
export interface Who { id: string; username: string; role: string }
export interface Cursor { user: string; name: string; x: number; y: number; at: number }
export interface Ruler { user: string; name: string; points: { x: number; y: number }[] }
export type Conn = 'connecting' | 'open' | 'closed'
export interface Die { v: number; dropped?: boolean; extra?: boolean }
export type RollTerm = { kind: 'num'; sign: 1 | -1; value: number } | { kind: 'dice'; sign: 1 | -1; count: number; sides: number; dice: Die[]; subtotal: number; text: string }
export interface RollJson { expr: string; label: string; total: number; terms: RollTerm[]; crit: 'hit' | 'miss' | null }
export type ChatPart = { t: 'text'; text: string } | { t: 'roll'; roll: RollJson }
export interface ChatMsg { id: string; ts: number; userId: string; name: string; kind: 'say' | 'roll' | 'gmroll' | 'emote' | 'whisper'; to: string[]; parts: ChatPart[] }

export const DEFAULT_SETTINGS: Settings = { gms: [], playersMoveOwn: true, playersCreateTokens: false, playersEditOwnStats: true, playersPing: true, playersRuler: true, showCursors: true }

interface TableState {
  conn: Conn
  you: Who | null
  role: TableRole
  settings: Settings
  scenes: Scene[]
  active: string | null
  sceneId: string | null
  tokens: Token[]
  online: { id: string; username: string; role: TableRole }[]
  members: Who[]
  selected: string[]
  cursors: Record<string, Cursor>
  rulers: Record<string, Ruler>
  chat: ChatMsg[]
  unread: number
  error: string
}

export const useTable = create<TableState>(() => ({
  conn: 'closed', you: null, role: 'spectator', settings: DEFAULT_SETTINGS, scenes: [], active: null, sceneId: null, tokens: [], online: [], members: [],
  selected: [], cursors: {}, rulers: {}, chat: [], unread: 0, error: '',
}))

type Listener = (m: any) => void
const listeners = new Set<Listener>()
/** Short-lived things (pings) are not state; the scene view subscribes to them. */
export const onTableMessage = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn) } }

const set = useTable.setState
const upsert = <T extends { id: string }>(list: T[], item: T) => list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]

/** Applies one message from the server to the store. Exported so the rules can be tested without a socket. */
export function applyMessage(m: any) {
  switch (m.t) {
    case 'snapshot':
      set({
        you: m.you, role: m.you.role, settings: { ...DEFAULT_SETTINGS, ...m.settings }, scenes: m.scenes, active: m.active, sceneId: m.sceneId,
        tokens: m.tokens, online: m.online, members: m.members ?? [], chat: m.chat ?? [], unread: 0, selected: [], cursors: {}, rulers: {},
      })
      break
    case 'view': set({ sceneId: m.sceneId, tokens: m.tokens, selected: [], cursors: {}, rulers: {} }); break
    case 'scene': set((s) => ({ scenes: upsert(s.scenes, m.scene).sort((a, b) => a.sort - b.sort), ...(m.active ? { active: m.active } : {}) })); break
    case 'scene.remove': set((s) => ({ scenes: s.scenes.filter((x) => x.id !== m.id), active: m.active })); break
    case 'active': set({ active: m.id }); break
    case 'token':
      set((s) => (m.token.sceneId === s.sceneId ? { tokens: upsert(s.tokens, m.token).sort((a, b) => a.z - b.z) } : {}))
      break
    case 'token.remove': set((s) => ({ tokens: s.tokens.filter((t) => !m.ids.includes(t.id)), selected: s.selected.filter((i) => !m.ids.includes(i)) })); break
    case 'settings': set((s) => ({ settings: { ...DEFAULT_SETTINGS, ...m.settings }, ...(m.you ? { you: m.you, role: m.you.role } : {}), tokens: s.tokens })); break
    case 'online': set({ online: m.users }); break
    case 'cursor': set((s) => ({ cursors: { ...s.cursors, [m.user]: { user: m.user, name: m.name, x: m.x, y: m.y, at: Date.now() } } })); break
    case 'cursor.gone': set((s) => { const { [m.user]: _c, ...cursors } = s.cursors; const { [m.user]: _r, ...rulers } = s.rulers; return { cursors, rulers } }); break
    case 'ruler': set((s) => {
      const { [m.user]: _gone, ...rest } = s.rulers
      return { rulers: m.points ? { ...rest, [m.user]: { user: m.user, name: m.name, points: m.points } } : rest }
    }); break
    case 'chat.msg': set((s) => ({ chat: [...s.chat.slice(-299), m.msg], unread: m.msg.userId === s.you?.id ? s.unread : s.unread + 1 })); break
    case 'nack': set({ error: m.error }); break
  }
  for (const l of listeners) l(m)
}

// ---------- connection ----------

let socket: WebSocket | null = null
let wanted: string | null = null
let retry = 0
let timer: number | undefined
let opSeq = 0

function open() {
  if (!wanted) return
  set({ conn: 'connecting' })
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/table/${wanted}`
  const s = new WebSocket(url)
  socket = s
  s.onopen = () => { retry = 0; set({ conn: 'open', error: '' }) }
  s.onmessage = (e) => { try { applyMessage(JSON.parse(e.data)) } catch { /* a broken frame is dropped */ } }
  s.onclose = () => {
    if (socket !== s) return
    socket = null
    set({ conn: 'closed' })
    if (wanted) { timer = window.setTimeout(open, Math.min(8000, 400 * 2 ** retry++)) }
  }
  s.onerror = () => s.close()
}

/** Sits at the table of a world until `leaveTable` is called; reconnects by itself and starts over from a fresh snapshot. */
export function joinTable(ws: string) {
  if (wanted === ws && socket) return
  leaveTable()
  wanted = ws
  open()
}

export function leaveTable() {
  wanted = null
  clearTimeout(timer)
  const s = socket
  socket = null
  s?.close()
  set({ conn: 'closed', you: null, role: 'spectator', scenes: [], tokens: [], sceneId: null, active: null, selected: [], cursors: {}, rulers: {}, online: [], members: [], chat: [], unread: 0, error: '' })
}

/** Sends a message; an operation id comes back with a refusal so the cause can be shown. */
export function sendTable(m: Record<string, unknown>) {
  if (socket?.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify({ ...m, op: `o${++opSeq}` }))
  return true
}
