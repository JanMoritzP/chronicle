import type { Server as HttpServer } from 'node:http'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import * as Y from 'yjs'
import { worldRole } from './access.js'
import { userFromCookieHeader, type AuthUser } from './auth.js'
import { db, now } from './db.js'
import { ensureHeadingIds } from './doc.js'
import { publishWorld } from './live.js'
import { applyContent, contentHooks, pageDerived, type Author, type PageRow } from './pages.js'
import { presenceChanged } from './presence.js'
import { editTodoIn, fragmentToDoc, seedFragment } from './ydoc.js'

/**
 * Live co-editing. Each open page has one room holding the shared document (a Yjs CRDT), so everyone's keystrokes merge
 * without conflicts. The document is saved to the database a moment after typing stops, and the same save feeds the search text,
 * links, outline and history, exactly like a normal edit.
 *
 * Wire format: binary frames are the standard Yjs sync/awareness protocol; text frames are small JSON notices from the server
 * ({t:'reload'} when the page was replaced from outside).
 */
const MSG_SYNC = 0
const MSG_AWARENESS = 1
const SAVE_EVERY_MS = 1500
const CLOSE_RELOAD = 4001
const CLOSE_DENIED = 4003

interface Conn { socket: WebSocket; user: AuthUser; canWrite: boolean; clientIds: Set<number>; alive: boolean }
interface Room {
  pageId: string; wsId: string; doc: Y.Doc; awareness: awarenessProtocol.Awareness
  conns: Set<Conn>; timer?: NodeJS.Timeout
  /** Whoever changed the document last; the next save is credited to them in the page history. */
  writer: Author | null
}

const rooms = new Map<string, Room>()

function saveState(room: Room) {
  db.prepare(
    `INSERT INTO page_docs(page_id,state,updated_at) VALUES(?,?,?)
     ON CONFLICT(page_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  ).run(room.pageId, Buffer.from(Y.encodeStateAsUpdate(room.doc)), now())
}

function openRoom(pageId: string): Room | null {
  const existing = rooms.get(pageId)
  if (existing) return existing
  const page = db.prepare('SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL').get(pageId) as PageRow | undefined
  if (!page) return null
  const doc = new Y.Doc()
  const saved = db.prepare('SELECT state FROM page_docs WHERE page_id = ?').get(pageId) as { state: Buffer } | undefined
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalState(null)
  const room: Room = { pageId, wsId: page.workspace_id, doc, awareness, conns: new Set(), writer: null }
  if (saved) Y.applyUpdate(doc, new Uint8Array(saved.state))
  else {
    seedFragment(doc, ensureHeadingIds(JSON.parse(page.content)))
    saveState(room)
  }

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeUpdate(enc, update)
    const msg = encoding.toUint8Array(enc)
    for (const c of room.conns) if (c !== origin) send(c, msg)
    if (!room.timer) room.timer = setTimeout(() => persist(room), SAVE_EVERY_MS)
  })
  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin && typeof origin === 'object' && 'clientIds' in origin) {
      const c = origin as Conn
      added.forEach((id) => c.clientIds.add(id))
      removed.forEach((id) => c.clientIds.delete(id))
    }
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_AWARENESS)
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]))
    const msg = encoding.toUint8Array(enc)
    for (const c of room.conns) send(c, msg)
  })
  rooms.set(pageId, room)
  return room
}

function send(c: Conn, msg: Uint8Array | string) {
  if (c.socket.readyState !== WebSocket.OPEN) return
  c.socket.send(msg, (err) => { if (err) c.socket.terminate() })
}

/** Writes the shared document to the page row and its derived data, then tells everyone what the page now looks like. */
function persist(room: Room) {
  clearTimeout(room.timer)
  room.timer = undefined
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(room.pageId) as PageRow | undefined
  if (!page) return
  saveState(room)
  const doc = fragmentToDoc(room.doc)
  if (!doc.content?.length || JSON.stringify(doc) === page.content) return
  applyContent(page, doc, room.writer)
  room.writer = null
  const derived = pageDerived(room.pageId)
  publishWorld(room.wsId, { k: 'page-saved', id: room.pageId, ...derived })
}

function disposeRoom(room: Room) {
  clearTimeout(room.timer)
  room.awareness.destroy()
  room.doc.destroy()
  rooms.delete(room.pageId)
}

function leave(room: Room, c: Conn) {
  // a room that was dropped or disposed already saved (or deliberately discarded) its document
  if (rooms.get(room.pageId) !== room) return
  room.conns.delete(c)
  presenceChanged()
  awarenessProtocol.removeAwarenessStates(room.awareness, [...c.clientIds], null)
  if (!room.conns.size) { persist(room); disposeRoom(room) }
}

function onMessage(room: Room, c: Conn, data: Uint8Array) {
  const dec = decoding.createDecoder(data)
  const type = decoding.readVarUint(dec)
  if (type === MSG_SYNC) {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    const step = decoding.readVarUint(dec)
    if (step === syncProtocol.messageYjsSyncStep1) syncProtocol.readSyncStep1(dec, enc, room.doc)
    // viewers follow along but cannot change the page
    else if (c.canWrite && step === syncProtocol.messageYjsSyncStep2) syncProtocol.readSyncStep2(dec, room.doc, c)
    else if (c.canWrite && step === syncProtocol.messageYjsUpdate) syncProtocol.readUpdate(dec, room.doc, c)
    if (c.canWrite && step !== syncProtocol.messageYjsSyncStep1 && room.timer) room.writer = { id: c.user.id, username: c.user.username }
    if (encoding.length(enc) > 1) send(c, encoding.toUint8Array(enc))
  } else if (type === MSG_AWARENESS) {
    awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), c)
  }
}

function connect(socket: WebSocket, room: Room, user: AuthUser, canWrite: boolean) {
  const c: Conn = { socket, user, canWrite, clientIds: new Set(), alive: true }
  room.conns.add(c)
  presenceChanged()
  socket.on('message', (raw: RawData, isBinary: boolean) => {
    if (!isBinary) return
    try { onMessage(room, c, new Uint8Array(raw as Buffer)) } catch { socket.close(1003, 'bad message') }
  })
  socket.on('pong', () => { c.alive = true })
  socket.on('close', () => leave(room, c))
  socket.on('error', () => socket.terminate())

  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, MSG_SYNC)
  syncProtocol.writeSyncStep1(enc, room.doc)
  send(c, encoding.toUint8Array(enc))
  const states = room.awareness.getStates()
  if (states.size) {
    const a = encoding.createEncoder()
    encoding.writeVarUint(a, MSG_AWARENESS)
    encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]))
    send(c, encoding.toUint8Array(a))
  }
}

function refuse(socket: import('node:stream').Duplex, status: string) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

export function attachCollab(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })
  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0]
    const m = /^\/api\/collab\/([^/]+)$/.exec(path)
    if (!m) return refuse(socket, '404 Not Found')
    // same origin only: a page on another site must not be able to open an editing session with the visitor's cookie
    const origin = req.headers.origin
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) return refuse(socket, '403 Forbidden') } catch { return refuse(socket, '403 Forbidden') }
    }
    const user = userFromCookieHeader(req.headers.cookie)
    if (!user) return refuse(socket, '401 Unauthorized')
    const owner = db.prepare('SELECT workspace_id AS w FROM pages WHERE id = ? AND deleted_at IS NULL').get(m[1]) as { w: string } | undefined
    const role = owner ? worldRole(user, owner.w) : null
    if (!owner || !role) return refuse(socket, '404 Not Found')
    wss.handleUpgrade(req, socket, head, (ws) => {
      const room = openRoom(m[1])
      if (!room) return ws.close(CLOSE_DENIED)
      connect(ws, room, user, role === 'editor')
    })
  })

  const beat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const c of room.conns) {
        if (!c.alive) { c.socket.terminate(); continue }
        c.alive = false
        c.socket.ping()
      }
    }
  }, 30_000)
  beat.unref()
}

function dropRoom(room: Room, save: boolean) {
  if (save) persist(room)
  clearTimeout(room.timer)
  for (const c of [...room.conns]) {
    room.conns.delete(c)
    send(c, JSON.stringify({ t: 'reload' }))
    c.socket.close(CLOSE_RELOAD, 'page replaced')
  }
  presenceChanged()
  disposeRoom(room)
}

contentHooks.replaced = (pageId) => {
  const room = rooms.get(pageId)
  if (room) dropRoom(room, false)
  db.prepare('DELETE FROM page_docs WHERE page_id = ?').run(pageId)
}

/**
 * Edits a todo marker inside the live document, if the page has one, so a change made in the Todos tab reaches open editors
 * as a normal edit. Returns null when the page has no live document (the caller then edits the stored JSON instead).
 */
export function editTodoLive(pageId: string, todoId: string, change: Record<string, any> | null, author: Author | null = null, type = 'todo'): 'ok' | 'missing' | null {
  const has = rooms.has(pageId) || db.prepare('SELECT 1 FROM page_docs WHERE page_id = ?').get(pageId)
  if (!has) return null
  const room = openRoom(pageId)
  if (!room) return null
  const hit = editTodoIn(room.doc, todoId, change, type)
  if (hit) { room.writer = author; persist(room) }
  if (!room.conns.size) disposeRoom(room)
  return hit ? 'ok' : 'missing'
}

/** After access changed: drop editing sessions of people who lost the world, and make people who became viewers read-only. */
export function revalidateCollab(changedUsers?: string[]) {
  for (const room of rooms.values()) {
    for (const c of [...room.conns]) {
      if (changedUsers && !changedUsers.includes(c.user.id)) continue
      const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(c.user.id) as AuthUser | undefined
      const role = user ? worldRole(user, room.wsId) : null
      if (!user || !role) { c.socket.close(CLOSE_DENIED, 'no access'); continue }
      c.user = user
      c.canWrite = role === 'editor'
    }
  }
  presenceChanged()
}

/** Who is editing right now, for the admin dashboard. */
export function editorsSnapshot() {
  return [...rooms.values()].flatMap((r) => [...r.conns].map((c) => ({ userId: c.user.id, username: c.user.username, pageId: r.pageId, worldId: r.wsId, canWrite: c.canWrite })))
}

/** On shutdown: save everything that is still pending. */
export function closeAllCollab() {
  for (const room of [...rooms.values()]) {
    persist(room)
    for (const c of room.conns) c.socket.close(1001, 'server stopping')
    disposeRoom(room)
  }
}

/** After a backup was restored the stored documents are different: forget every live document and make editors reload. */
export function resetCollab() {
  for (const room of [...rooms.values()]) dropRoom(room, false)
}
