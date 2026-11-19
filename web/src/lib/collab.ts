import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'

const MSG_SYNC = 0
const MSG_AWARENESS = 1
const CLOSE_RELOAD = 4001
const CLOSE_DENIED = 4003

export type CollabStatus = 'connecting' | 'connected' | 'offline'

/**
 * Connection to the shared document of one page. The Yjs document merges everyone's edits; this class only carries
 * updates to and from the server and keeps trying to reconnect, so typing during a dropped connection is not lost.
 */
export class CollabProvider {
  readonly doc = new Y.Doc()
  readonly awareness = new awarenessProtocol.Awareness(this.doc)
  status: CollabStatus = 'connecting'
  synced = false
  private socket: WebSocket | null = null
  private attempt = 0
  private timer: number | undefined
  private closed = false
  private onStatus = new Set<() => void>()
  private onReload = new Set<() => void>()

  constructor(private pageId: string) {
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.writeUpdate(enc, update)
      this.send(encoding.toUint8Array(enc))
    })
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === this) return
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]))
      this.send(encoding.toUint8Array(enc))
    })
    this.connect()
  }

  subscribe(h: () => void) { this.onStatus.add(h); return () => { this.onStatus.delete(h) } }
  onReloadNotice(h: () => void) { this.onReload.add(h); return () => { this.onReload.delete(h) } }

  private setStatus(status: CollabStatus) {
    if (this.status === status) return
    this.status = status
    this.onStatus.forEach((h) => h())
  }

  private send(msg: Uint8Array) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(msg)
  }

  private connect() {
    if (this.closed) return
    this.setStatus(this.synced ? 'offline' : 'connecting')
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/collab/${encodeURIComponent(this.pageId)}`
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    socket.onopen = () => {
      this.attempt = 0
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.writeSyncStep1(enc, this.doc)
      this.send(encoding.toUint8Array(enc))
      if (this.awareness.getLocalState() !== null) {
        const a = encoding.createEncoder()
        encoding.writeVarUint(a, MSG_AWARENESS)
        encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]))
        this.send(encoding.toUint8Array(a))
      }
    }
    socket.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const n = JSON.parse(e.data)
        if (n.t === 'reload') this.onReload.forEach((h) => h())
        return
      }
      const dec = decoding.createDecoder(new Uint8Array(e.data as ArrayBuffer))
      const type = decoding.readVarUint(dec)
      if (type === MSG_SYNC) {
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, MSG_SYNC)
        const step = syncProtocol.readSyncMessage(dec, enc, this.doc, this)
        if (step === syncProtocol.messageYjsSyncStep2 && !this.synced) this.synced = true
        if (step === syncProtocol.messageYjsSyncStep2) this.setStatus('connected')
        if (encoding.length(enc) > 1) this.send(encoding.toUint8Array(enc))
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), this)
      }
    }
    socket.onclose = (e) => {
      if (this.socket === socket) this.socket = null
      // other people's cursors are stale once we cannot hear them
      const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID)
      awarenessProtocol.removeAwarenessStates(this.awareness, others, this)
      if (this.closed) return
      this.setStatus(this.synced ? 'offline' : 'connecting')
      if (e.code === CLOSE_RELOAD || e.code === CLOSE_DENIED) {
        this.closed = true
        this.onReload.forEach((h) => h())
        return
      }
      this.attempt++
      this.timer = window.setTimeout(() => this.connect(), Math.min(15000, 500 * 2 ** Math.min(this.attempt, 5)))
    }
  }

  destroy() {
    this.closed = true
    clearTimeout(this.timer)
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy')
    this.socket?.close()
    this.awareness.destroy()
    this.doc.destroy()
  }
}

/** The same name always gets the same colour, so a person's cursor and avatar match everywhere. */
export function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h} 55% 38%)`
}
