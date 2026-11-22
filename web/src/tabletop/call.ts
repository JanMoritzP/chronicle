import { create } from 'zustand'

// Voice and video at the table, between the browsers themselves (WebRTC, one connection to each other person in the call). The server only says
// who is in the call and passes their connection messages on: the sound and the picture never go through it. Up to eight people.

export interface CallMember { id: string; video: boolean }
interface CallState {
  /** this person is in the call */
  joined: boolean
  members: CallMember[]
  /** what the others send, by account */
  streams: Record<string, MediaStream>
  local: MediaStream | null
  mic: boolean
  cam: boolean
  error: string
}
export const useCall = create<CallState>(() => ({ joined: false, members: [], streams: {}, local: null, mic: true, cam: true, error: '' }))

type Send = (m: Record<string, unknown>) => void
let send: Send = () => {}
let me = ''
let ice: RTCIceServer[] = []
const peers = new Map<string, { pc: RTCPeerConnection; pending: RTCIceCandidateInit[]; ready: boolean }>()

/** Wires the call to the table's connection (called once, by the table's state). */
export function bindCall(sender: Send) { send = sender }
export const setCallIdentity = (id: string) => { me = id }

function drop(id: string) {
  const p = peers.get(id)
  if (p) { p.pc.close(); peers.delete(id) }
  useCall.setState((s) => { const { [id]: _gone, ...rest } = s.streams; return { streams: rest } })
}

function peerFor(id: string): { pc: RTCPeerConnection; pending: RTCIceCandidateInit[]; ready: boolean } {
  const have = peers.get(id)
  if (have) return have
  const pc = new RTCPeerConnection({ iceServers: ice })
  const p = { pc, pending: [] as RTCIceCandidateInit[], ready: false }
  peers.set(id, p)
  for (const t of useCall.getState().local?.getTracks() ?? []) pc.addTrack(t, useCall.getState().local!)
  pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'rtc', to: id, data: { kind: 'ice', candidate: e.candidate.toJSON() } }) }
  pc.ontrack = (e) => { const [stream] = e.streams; if (stream) useCall.setState((s) => ({ streams: { ...s.streams, [id]: stream } })) }
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { if (peers.get(id)?.pc === pc) drop(id) } }
  return p
}

/** The people in the call changed: connect to the new ones (the one whose account id sorts first makes the offer), let go of those who left. */
export function handleCall(members: CallMember[], servers: RTCIceServer[]) {
  ice = servers
  useCall.setState({ members })
  const st = useCall.getState()
  if (!st.joined) return
  const ids = new Set(members.map((m) => m.id))
  for (const id of [...peers.keys()]) if (!ids.has(id)) drop(id)
  for (const m of members) {
    if (m.id === me || peers.has(m.id)) continue
    const p = peerFor(m.id)
    if (me < m.id) void offer(m.id, p.pc)
  }
}

async function offer(id: string, pc: RTCPeerConnection) {
  try {
    await pc.setLocalDescription(await pc.createOffer())
    send({ t: 'rtc', to: id, data: { kind: 'offer', sdp: pc.localDescription!.sdp } })
  } catch { drop(id) }
}

export async function handleRtc(from: string, data: { kind: 'offer' | 'answer' | 'ice'; sdp?: string; candidate?: RTCIceCandidateInit }) {
  if (!useCall.getState().joined) return
  const p = peerFor(from)
  const flush = async () => { p.ready = true; for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => undefined) }
  try {
    if (data.kind === 'offer' && data.sdp) {
      await p.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
      await flush()
      await p.pc.setLocalDescription(await p.pc.createAnswer())
      send({ t: 'rtc', to: from, data: { kind: 'answer', sdp: p.pc.localDescription!.sdp } })
    } else if (data.kind === 'answer' && data.sdp) {
      await p.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
      await flush()
    } else if (data.kind === 'ice' && data.candidate) {
      if (p.ready) await p.pc.addIceCandidate(data.candidate).catch(() => undefined)
      else p.pending.push(data.candidate)
    }
  } catch { drop(from) }
}

/** Asks for the microphone (and the camera) and joins the call. */
export async function joinCall(video: boolean) {
  if (useCall.getState().joined) return
  if (!navigator.mediaDevices?.getUserMedia) { useCall.setState({ error: 'This browser cannot use a microphone here. Voice needs a secure page (https or localhost).' }); return }
  try {
    const local = await navigator.mediaDevices.getUserMedia({ audio: true, video })
    useCall.setState({ local, joined: true, mic: true, cam: video, error: '' })
    send({ t: 'call.join', video })
  } catch {
    useCall.setState({ error: video ? 'The microphone or the camera could not be used. Allow them for this page and try again.' : 'The microphone could not be used. Allow it for this page and try again.' })
  }
}

export function leaveCall() {
  const st = useCall.getState()
  for (const id of [...peers.keys()]) drop(id)
  st.local?.getTracks().forEach((t) => t.stop())
  if (st.joined) send({ t: 'call.leave' })
  useCall.setState({ joined: false, local: null, streams: {}, error: '' })
}

export function setMic(on: boolean) { useCall.getState().local?.getAudioTracks().forEach((t) => { t.enabled = on }); useCall.setState({ mic: on }) }
export function setCam(on: boolean) { useCall.getState().local?.getVideoTracks().forEach((t) => { t.enabled = on }); useCall.setState({ cam: on }) }
