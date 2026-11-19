import { Heart, Link2, Shield, Swords, Unlink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { sendTable, useTable, type ChatMsg, type RollJson, type Token } from '../tabletop/state'
import { PagePicker } from './PagePicker'
import { SheetCard, loadSheet, useSheet } from './TableSheet'

export const CONDITIONS = ['Blinded', 'Charmed', 'Concentrating', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious']

export const rollText = (expr: string, label: string) => sendTable({ t: 'chat', text: `/roll ${expr} ${label}` })

/** Can this person change the hit points, armor class and conditions of the token? */
function useCanEdit(token: Token) {
  const role = useTable((s) => s.role)
  const settings = useTable((s) => s.settings)
  const you = useTable((s) => s.you)
  return role === 'gm' || (role === 'player' && settings.playersEditOwnStats && !!you && token.owners.includes(you.id))
}

const numberField = (value: number | undefined, commit: (n: number) => void, label: string, min = 0) => (
  <input className="input tt-num" type="number" min={min} aria-label={label} defaultValue={value ?? ''} key={`${label}${value}`}
    onBlur={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n) && n !== value) commit(Math.round(n)) }}
    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
)

export function TokenStats({ token }: { token: Token }) {
  const can = useCanEdit(token)
  const gm = useTable((s) => s.role === 'gm')
  const [amount, setAmount] = useState('')
  const hp = token.data.hp as { value?: number; max?: number; temp?: number } | undefined
  const ac = token.data.ac as number | undefined
  const conditions = (token.data.conditions ?? []) as string[]
  if (!can && !hp && ac == null && !conditions.length) return null
  const stat = (s: Record<string, unknown>) => sendTable({ t: 'token.stat', id: token.id, stat: s })
  const apply = (sign: 1 | -1) => {
    const n = Math.abs(parseInt(amount, 10))
    if (!n) return
    sendTable({ t: 'token.stat', id: token.id, damage: sign * n })
    setAmount('')
  }
  const toggle = (c: string) => stat({ conditions: conditions.includes(c) ? conditions.filter((x) => x !== c) : [...conditions, c] })
  const ratio = hp && hp.max ? Math.max(0, Math.min(1, (hp.value ?? 0) / hp.max)) : 0
  return (
    <div className="tt-stats">
      {(hp || can) && (
        <div className="tt-hp">
          <div className="tt-hpbar" aria-hidden><span style={{ width: `${ratio * 100}%`, background: ratio > 0.5 ? '#4caf50' : ratio > 0.25 ? '#f1c40f' : '#e74c3c' }} /></div>
          {can ? (
            <div className="tt-row tt-hpfields">
              <label><Heart size={12} /> HP{numberField(hp?.value, (n) => stat({ hp: { value: n } }), 'Hit points', -999)}</label>
              <label>Max{numberField(hp?.max, (n) => stat({ hp: { max: n } }), 'Maximum hit points')}</label>
              <label>Temp{numberField(hp?.temp, (n) => stat({ hp: { temp: n } }), 'Temporary hit points')}</label>
              <label><Shield size={12} /> AC{numberField(ac, (n) => stat({ ac: n }), 'Armor class')}</label>
            </div>
          ) : (
            <div className="tt-facts"><span><Heart size={12} /> {hp?.value ?? 0} / {hp?.max ?? 0}{hp?.temp ? ` (+${hp.temp})` : ''}</span>{ac != null && <span><Shield size={12} /> {ac}</span>}</div>
          )}
          {can && (
            <div className="tt-row">
              <input className="input tt-num" inputMode="numeric" placeholder="Amount" aria-label="Amount of damage or healing" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && apply(1)} />
              <button className="btn sm" onClick={() => apply(1)}>Damage</button>
              <button className="btn sm" onClick={() => apply(-1)}>Heal</button>
            </div>
          )}
        </div>
      )}
      <div className="tt-chips" role="group" aria-label="Conditions">
        {(can ? CONDITIONS : conditions).map((c) => (
          <button key={c} className={`tt-chip${conditions.includes(c) ? ' on' : ''}`} disabled={!can} aria-pressed={conditions.includes(c)} onClick={() => toggle(c)}>{c}</button>
        ))}
      </div>
      {gm && hp && (
        <label className="tt-check"><input type="checkbox" checked={!!token.data.hpPrivate} onChange={(e) => stat({ hpPrivate: e.target.checked })} />Hide hit points from other players</label>
      )}
    </div>
  )
}

/** Gives a token the name, picture, hit points and armor class of a page, and keeps the page for its sheet. */
export function LinkPage({ token }: { token: Token }) {
  const [open, setOpen] = useState(false)
  const nav = useStore.getState().navigate
  const link = async (id: string, title: string) => {
    setOpen(false)
    const info = await loadSheet(id)
    sendTable({ t: 'token.update', id: token.id, patch: { pageId: id, ...(token.name ? {} : { name: title }), ...(!token.image && info.portrait && /^\/api\/uploads\/[A-Za-z0-9-]+$/.test(info.portrait) ? { image: info.portrait } : {}) } })
    if (info.sheet) sendTable({ t: 'token.stat', id: token.id, stat: { hp: { value: info.sheet.hp.max, max: info.sheet.hp.max }, ac: info.sheet.ac.value, hpPrivate: info.type === 'monster' } })
  }
  return (
    <div className="tt-link">
      <div className="tt-row">
        <button className="btn sm" onClick={() => setOpen(!open)}><Link2 size={13} /> {token.pageId ? 'Change page' : 'Link a page'}</button>
        {token.pageId && <button className="btn sm" onClick={() => nav({ type: 'page', id: token.pageId! }, { newTab: true })}>Open page</button>}
        {token.pageId && <button className="btn sm" title="Unlink the page" aria-label="Unlink the page" onClick={() => sendTable({ t: 'token.update', id: token.id, patch: { pageId: null } })}><Unlink size={13} /></button>}
      </div>
      {open && <PagePicker autoFocus placeholder="Find a monster or character…" onPick={(p) => link(p.id, p.title)} />}
    </div>
  )
}

export function TokenSheet({ token }: { token: Token }) {
  const { sheet, loading } = useSheet(token.pageId)
  const nameOf = token.name || 'Token'
  if (!token.pageId) return null
  if (loading) return <p className="muted tt-hint">Loading the sheet…</p>
  if (!sheet) return <p className="muted tt-hint">This page has no stat block.</p>
  return <SheetCard sheet={sheet} roll={(expr, label) => rollText(expr, `${nameOf}: ${label}`)} />
}

// ---------- chat ----------

function RollView({ r }: { r: RollJson }) {
  return (
    <span className={`tt-rollout${r.crit ? ` ${r.crit}` : ''}`}>
      {r.label && <small className="tt-rolllabel">{r.label}</small>}
      <span className="tt-rollbody">
        <span className="muted tt-expr">{r.expr}</span>
        <span className="tt-dice">
          {r.terms.map((t, i) => t.kind === 'num'
            ? <span key={i}>{t.sign < 0 ? '-' : '+'}{t.value}</span>
            : <span key={i}>{t.sign < 0 ? '-' : ''}[{t.dice.map((d, j) => <span key={j} className={`${d.dropped ? 'dropped' : ''}${d.extra ? ' extra' : ''}${t.sides === 20 && d.v === 20 ? ' nat' : ''}${t.sides === 20 && d.v === 1 ? ' one' : ''}`}>{d.v}{j < t.dice.length - 1 ? ', ' : ''}</span>)}]</span>)}
        </span>
        <b className="tt-total" aria-label={`Total ${r.total}`}>{r.total}</b>
      </span>
    </span>
  )
}

const KIND_LABEL: Record<ChatMsg['kind'], string> = { say: '', roll: '', emote: '', whisper: 'whispers', gmroll: 'rolls privately' }

function Message({ m, you, names }: { m: ChatMsg; you: string | undefined; names: Map<string, string> }) {
  const parts = m.parts.map((p, i) => (p.t === 'text' ? <span key={i}>{p.text}</span> : <RollView key={i} r={p.roll} />))
  const to = m.kind === 'whisper' ? (m.to.includes(you ?? '') ? 'you' : m.to.map((id) => names.get(id) ?? 'someone').join(', ')) : ''
  return (
    <li className={`tt-msg ${m.kind}`}>
      {m.kind === 'emote' ? <span className="tt-emote"><b>{m.name}</b> {parts}</span> : (
        <>
          <b className="tt-from">{m.name}</b>{KIND_LABEL[m.kind] && <small className="muted"> {KIND_LABEL[m.kind]}{to ? ` ${to}` : ''}</small>}
          <div className="tt-text">{parts}</div>
        </>
      )}
    </li>
  )
}

export function ChatPanel() {
  const chat = useTable((s) => s.chat)
  const you = useTable((s) => s.you)
  const members = useTable((s) => s.members)
  const role = useTable((s) => s.role)
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const names = new Map(members.map((u) => [u.id, u.username]))
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [chat.length])
  useEffect(() => { useTable.setState({ unread: 0 }) }, [chat.length])
  const send = () => {
    if (!text.trim()) return
    sendTable({ t: 'chat', text })
    setText('')
  }
  return (
    <div className="tt-chat">
      <ul className="tt-messages" aria-label="Chat" aria-live="polite">
        {chat.length === 0 && <li className="muted tt-hint">Nothing said yet. Type a message, or /roll 1d20+5. Use /w name to whisper and /gmroll to roll for the GM only.</li>}
        {chat.map((m) => <Message key={m.id} m={m} you={you?.id} names={names} />)}
        <div ref={end} />
      </ul>
      {role !== 'spectator' && (
        <div className="tt-dicebar" role="group" aria-label="Quick dice">
          {[4, 6, 8, 10, 12, 20, 100].map((d) => <button key={d} className="btn sm" onClick={() => sendTable({ t: 'chat', text: `/roll 1d${d}` })}>d{d}</button>)}
        </div>
      )}
      <div className="tt-compose">
        <input className="input" value={text} placeholder={role === 'spectator' ? 'Say something' : 'Say something or /roll 1d20+5'} aria-label="Chat message" maxLength={600} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button className="btn sm primary" onClick={send}><Swords size={13} /> Send</button>
      </div>
    </div>
  )
}


/** What a token sees and the light it gives off, in the scene's units. Blank sight means as far as the walls allow. */
export function SightLight({ token }: { token: Token }) {
  const unit = useTable((s) => s.scenes.find((x) => x.id === s.sceneId)?.unit ?? 'ft')
  const vision = (token.data.vision ?? {}) as { sight?: number | null; dark?: number }
  const light = (token.data.light ?? {}) as { bright?: number; dim?: number; color?: string }
  const save = (key: 'vision' | 'light', value: Record<string, unknown>) => {
    const data = { ...token.data, [key]: value }
    if (key === 'light' && !(value.bright || value.dim)) delete data.light
    sendTable({ t: 'token.update', id: token.id, patch: { data } })
  }
  const field = (label: string, value: number | null | undefined, commit: (n: number | null) => void, blank = false) => (
    <label>{label}
      <input className="input tt-num" type="number" min={0} aria-label={label} defaultValue={value ?? ''} key={`${label}${value}`}
        onBlur={(e) => { const raw = e.target.value.trim(); const n = raw === '' ? null : Number(raw); if (n === null ? blank && value != null : Number.isFinite(n) && n >= 0 && n !== value) commit(n) }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </label>
  )
  return (
    <div className="tt-sightlight">
      <b>Sight and light ({unit})</b>
      <div className="tt-row">
        {field('Sees up to', vision.sight, (n) => save('vision', { ...vision, sight: n }), true)}
        {field('Darkvision', vision.dark ?? 0, (n) => save('vision', { ...vision, dark: n ?? 0 }))}
      </div>
      <div className="tt-row">
        {field('Bright light', light.bright ?? 0, (n) => save('light', { ...light, bright: n ?? 0 }))}
        {field('Dim light', light.dim ?? 0, (n) => save('light', { ...light, dim: n ?? 0 }))}
      </div>
    </div>
  )
}
