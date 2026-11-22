import { Camera, CameraOff, Mic, MicOff, PhoneOff, Phone, Video } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { joinCall, leaveCall, setCam, setMic, useCall } from '../tabletop/call'
import { useTable } from '../tabletop/state'

// Voice and video for the people at the table: join with the microphone or with the camera too, see and hear the others, mute yourself, leave.

function Tile({ stream, name, self }: { stream: MediaStream | null; name: string; self?: boolean }) {
  const el = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (el.current) el.current.srcObject = stream }, [stream])
  const hasVideo = !!stream?.getVideoTracks().length
  return (
    <div className={`tt-call-tile${hasVideo ? ' has-video' : ''}`} aria-label={self ? 'You' : name}>
      <video ref={el} autoPlay playsInline muted={self} />
      {!hasVideo && <span className="tt-call-avatar">{name.slice(0, 1).toUpperCase()}</span>}
      <small>{self ? 'You' : name}</small>
    </div>
  )
}

export function CallPanel() {
  const { joined, members, streams, local, mic, cam, error } = useCall()
  const online = useTable((s) => s.online)
  const you = useTable((s) => s.you)
  const nameOf = (id: string) => online.find((o) => o.id === id)?.username ?? 'Someone'
  const others = members.filter((m) => m.id !== you?.id)
  if (!joined) {
    return (
      <div className="tt-call" role="region" aria-label="Call">
        <button className="btn sm" onClick={() => void joinCall(false)} title="Talk with the others by voice"><Phone size={13} /> Join voice</button>
        <button className="btn sm" onClick={() => void joinCall(true)} title="Talk and be seen"><Video size={13} /> Join with video</button>
        {members.length > 0 && <small className="muted">{members.length} in the call</small>}
        {error && <small role="alert" className="tt-call-error">{error}</small>}
      </div>
    )
  }
  return (
    <div className="tt-call joined" role="region" aria-label="Call">
      <div className="tt-call-tiles">
        <Tile stream={local} name="You" self />
        {others.map((m) => <Tile key={m.id} stream={streams[m.id] ?? null} name={nameOf(m.id)} />)}
      </div>
      <div className="tt-row">
        <button className={`btn sm${mic ? '' : ' primary'}`} aria-pressed={!mic} aria-label={mic ? 'Mute the microphone' : 'Unmute the microphone'} onClick={() => setMic(!mic)}>{mic ? <Mic size={13} /> : <MicOff size={13} />}</button>
        {!!local?.getVideoTracks().length && <button className={`btn sm${cam ? '' : ' primary'}`} aria-pressed={!cam} aria-label={cam ? 'Turn the camera off' : 'Turn the camera on'} onClick={() => setCam(!cam)}>{cam ? <Camera size={13} /> : <CameraOff size={13} />}</button>}
        <button className="btn sm danger" aria-label="Leave the call" onClick={leaveCall}><PhoneOff size={13} /> Leave</button>
      </div>
    </div>
  )
}
