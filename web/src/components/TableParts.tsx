import { Heart, Link2, Shield, Swords, Unlink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { sendTable, useTable, type ChatMsg, type RollJson, type Token } from '../tabletop/state'
import { askText } from '../lib/dialog'
import { PagePicker } from './PagePicker'
import { Select } from './Select'
import { SheetCard, loadSheet, useSheet, type AttackKit } from './TableSheet'

export const CONDITIONS = ['Blinded', 'Charmed', 'Concentrating', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious']

/** Pathfinder 2e conditions. The ones with a value (Frightened 2) go up by one on each click and clear after 4. */
export const PF2E_CONDITIONS = ['Blinded', 'Clumsy', 'Concealed', 'Confused', 'Dazzled', 'Deafened', 'Doomed', 'Drained', 'Dying', 'Enfeebled', 'Fascinated', 'Fatigued', 'Fleeing', 'Frightened', 'Grabbed', 'Hidden', 'Immobilized', 'Invisible', 'Off-guard', 'Paralyzed', 'Petrified', 'Prone', 'Quickened', 'Restrained', 'Sickened', 'Slowed', 'Stunned', 'Stupefied', 'Unconscious', 'Wounded']
const VALUED = new Set(['Clumsy', 'Doomed', 'Drained', 'Dying', 'Enfeebled', 'Frightened', 'Sickened', 'Slowed', 'Stunned', 'Stupefied', 'Wounded'])
const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder']
interface Effect { id: string; name: string; rounds: number | null; ac?: number; attack?: string; save?: string; from?: string; concentration?: boolean }
const PRESETS: Record<string, Omit<Effect, 'id'>> = {
  Bless: { name: 'Bless', rounds: 10, attack: '+1d4', save: '+1d4', concentration: true },
  Bane: { name: 'Bane', rounds: 10, attack: '-1d4', save: '-1d4', concentration: true },
  'Shield of Faith': { name: 'Shield of Faith', rounds: 100, ac: 2, concentration: true },
  Haste: { name: 'Haste', rounds: 10, ac: 2, concentration: true },
}
const modsText = (e: Effect) => [e.ac ? `${e.ac > 0 ? '+' : ''}${e.ac} AC` : '', e.attack ? `${e.attack} attacks` : '', e.save ? `${e.save} saves` : ''].filter(Boolean).join(', ')

/** Spells and conditions that last a number of rounds and change armor class, attack rolls or saves. */
function Effects({ token, can }: { token: Token; can: boolean }) {
  const effects = (token.data.effects ?? []) as Effect[]
  const [name, setName] = useState('')
  const [rounds, setRounds] = useState('')
  const [ac, setAc] = useState('')
  const [preset, setPreset] = useState('')
  const caster = ((token.data.conditions ?? []) as string[]).includes('Concentrating')
  const add = (e: Omit<Effect, 'id'>) => sendTable({ t: 'effect.add', id: token.id, effect: { ...e, ...(e.concentration ? { from: token.id } : {}) } })
  if (!can && !effects.length) return null
  return (
    <div className="tt-effects">
      <div className="tt-chips" role="group" aria-label="Effects">
        {effects.map((e) => (
          <span key={e.id} className="tt-chip on" title={modsText(e)}>
            {e.name}{e.rounds != null ? ` (${e.rounds})` : ''}{modsText(e) ? ` ${modsText(e)}` : ''}
            {can && <button className="tt-x" aria-label={`End ${e.name}`} onClick={() => sendTable({ t: 'effect.remove', id: token.id, effectId: e.id })}>×</button>}
          </span>
        ))}
      </div>
      {can && (
        <div className="tt-row">
          <Select className="input tt-type" value={preset} title="Add a spell effect" onChange={(v) => { setPreset(''); if (v && PRESETS[v]) add(PRESETS[v]) }}>
            <option value="">Add a spell effect</option>
            {Object.keys(PRESETS).map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
          <input className="input" placeholder="Effect" aria-label="Spell effect" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input tt-num" inputMode="numeric" placeholder="Rounds" aria-label="Duration in rounds" value={rounds} onChange={(e) => setRounds(e.target.value.replace(/[^\d]/g, ''))} />
          <input className="input tt-num" inputMode="numeric" placeholder="AC" aria-label="Bonus to armor of the effect" value={ac} onChange={(e) => setAc(e.target.value.replace(/[^\d-]/g, ''))} />
          <button className="btn sm" disabled={!name.trim()} onClick={() => { add({ name: name.trim(), rounds: rounds ? Math.min(999, Number(rounds)) : null, ...(Number(ac) ? { ac: Math.max(-10, Math.min(10, Number(ac))) } : {}) }); setName(''); setRounds(''); setAc('') }}>Apply</button>
          {caster && <small className="muted">Spell effects end when this token stops concentrating.</small>}
        </div>
      )}
    </div>
  )
}

const baseOf = (c: string) => c.replace(/\s+\d+$/, '')

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
  const [kind, setKind] = useState('')
  const auto = useTable((s) => s.settings.automation)
  const hp = token.data.hp as { value?: number; max?: number; temp?: number } | undefined
  const ac = token.data.ac as number | undefined
  const conditions = (token.data.conditions ?? []) as string[]
  const system = useStore((s) => s.workspaces.find((w) => w.id === s.wsId)?.settings?.system ?? '5e')
  const names = system === 'pf2e' ? PF2E_CONDITIONS : CONDITIONS
  if (!can && !hp && ac == null && !conditions.length) return null
  const stat = (s: Record<string, unknown>) => sendTable({ t: 'token.stat', id: token.id, stat: s })
  const apply = (sign: 1 | -1) => {
    const n = Math.abs(parseInt(amount, 10))
    if (!n) return
    sendTable({ t: 'token.stat', id: token.id, damage: sign * n, ...(sign === 1 && auto?.damage && kind ? { type: kind } : {}) })
    setAmount('')
  }
  const current = (c: string) => conditions.find((x) => baseOf(x) === c)
  const toggle = (c: string) => {
    const have = current(c)
    const rest = conditions.filter((x) => x !== have)
    const valued = system === 'pf2e' && VALUED.has(c)
    if (!have) return stat({ conditions: [...rest, valued ? c + ' 1' : c] })
    const n = Number(/\d+$/.exec(have)?.[0] ?? 0)
    stat({ conditions: valued && n < 4 ? [...rest, c + ' ' + (n + 1)] : rest })
  }
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
              {auto?.damage && (
                <Select className="input tt-type" value={kind} onChange={setKind} title="Damage type">
                  <option value="">Any type</option>
                  {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
                </Select>
              )}
            </div>
          )}
          {can && token.pageId && (
            <div className="tt-row" role="group" aria-label="Rests and death saves">
              <button className="btn sm" onClick={async () => {
                const raw = await askText('Short rest', { label: 'Hit dice to spend', placeholder: '0', okLabel: 'Rest' })
                if (raw === null) return
                sendTable({ t: 'token.rest', id: token.id, kind: 'short', dice: Math.max(0, Math.min(40, parseInt(raw, 10) || 0)) })
              }}>Short rest</button>
              <button className="btn sm" onClick={() => sendTable({ t: 'token.rest', id: token.id, kind: 'long' })}>Long rest</button>
              {(hp?.value ?? 1) <= 0 && <button className="btn sm primary" onClick={() => sendTable({ t: 'token.deathsave', id: token.id })}>Death save</button>}
            </div>
          )}
        </div>
      )}
      <div className="tt-chips" role="group" aria-label="Conditions">
        {(can ? names : conditions.map(baseOf)).map((c) => (
          <button key={c} className={`tt-chip${current(c) ? ' on' : ''}`} disabled={!can} aria-pressed={!!current(c)} onClick={() => toggle(c)}>{current(c) ?? c}</button>
        ))}
      </div>
      <Effects token={token} can={can} />
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
    if (info.sheet) sendTable({ t: 'token.stat', id: token.id, stat: { hp: { value: info.sheet.hp.current ?? info.sheet.hp.max, max: info.sheet.hp.max, temp: info.sheet.hp.temp ?? 0 }, ac: info.sheet.ac.value, hpPrivate: info.type === 'monster' } })
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
  const { sheet, loading, reload } = useSheet(token.pageId, JSON.stringify(token.data.hp ?? null) + JSON.stringify(token.data.conditions ?? null))
  const can = useCanEdit(token)
  const auto = useTable((s) => s.settings.automation)
  const tokens = useTable((s) => s.tokens)
  const selected = useTable((s) => s.selected)
  const nameOf = token.name || 'Token'
  if (!token.pageId) return null
  if (loading) return <p className="muted tt-hint">Loading the sheet…</p>
  if (!sheet) return <p className="muted tt-hint">This page has no stat block.</p>
  const patch = (p: Record<string, unknown>) => { if (token.pageId) void api.patchPage(token.pageId, { propsPatch: { sheet: p } }).then(reload).catch(() => reload()) }
  const kit: AttackKit | undefined = auto?.attacks && can ? {
    targets: tokens.filter((t) => t.id !== token.id).map((t) => ({ id: t.id, name: t.name })),
    selected: selected.filter((id) => id !== token.id),
    send: (targets, a) => sendTable({ t: 'attack', from: token.id, targets, ...a }),
  } : undefined
  return <SheetCard sheet={sheet} roll={(expr, label) => rollText(expr, `${nameOf}: ${label}`)} onPatch={can && sheet.kind === 'character' ? patch : undefined} attack={kit} />
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
        {r.degree && <span className={`tt-degree ${r.degree.replace(' ', '-')}`}>{r.degree} vs DC {r.dc}</span>}
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

// ---------- combat ----------

export function CombatPanel() {
  const combat = useTable((s) => s.combat)
  const role = useTable((s) => s.role)
  const you = useTable((s) => s.you)
  const tokens = useTable((s) => s.tokens)
  const selected = useTable((s) => s.selected)
  const gm = role === 'gm'
  const tokenOf = (id: string | null) => tokens.find((t) => t.id === id)
  const turnToken = tokenOf(combat.list.find((x) => x.id === combat.turn)?.tokenId ?? null)
  const myTurn = !!turnToken && !!you && turnToken.owners.includes(you.id)
  const control = (action: 'start' | 'next' | 'prev' | 'end' | 'clear') => sendTable({ t: 'combat.control', action })
  const onList = new Set(combat.list.map((x) => x.tokenId))
  const addable = (gm ? tokens : []).filter((t) => !onList.has(t.id))
  const addSelected = addable.filter((t) => selected.includes(t.id))
  return (
    <div className="tt-form">
      <b><Swords size={13} /> {combat.active ? `Round ${combat.round}` : 'Order of play'}</b>
      {gm && (
        <div className="tt-row">
          {!combat.active
            ? <button className="btn sm primary" disabled={!combat.list.some((x) => x.init !== null)} onClick={() => control('start')}>Start combat</button>
            : <><button className="btn sm" onClick={() => control('prev')}>Previous</button><button className="btn sm primary" onClick={() => control('next')}>Next turn</button><button className="btn sm danger" onClick={() => control('end')}>End combat</button></>}
        </div>
      )}
      {!gm && combat.active && myTurn && <button className="btn sm primary" onClick={() => control('next')}>End my turn</button>}
      {gm && (
        <div className="tt-row">
          <button className="btn sm" disabled={!addSelected.length} onClick={() => sendTable({ t: 'combat.add', tokenIds: addSelected.map((t) => t.id) })}>Add selected ({addSelected.length})</button>
          <button className="btn sm" disabled={!addable.length} onClick={() => sendTable({ t: 'combat.add', tokenIds: addable.map((t) => t.id) })}>Add all ({addable.length})</button>
          <button className="btn sm" disabled={!combat.list.some((x) => x.init === null)} title="Roll for everyone without an initiative, using the Dexterity bonus on their sheet" onClick={() => sendTable({ t: 'combat.roll' })}>Roll initiative</button>
        </div>
      )}
      {combat.list.length === 0 && <p className="muted tt-hint">{gm ? 'Select tokens on the map and add them, or add everyone on the scene.' : 'No combat has started.'}</p>}
      <ol className="tt-order" aria-label="Order of play">
        {combat.list.map((x) => {
          const t = tokenOf(x.tokenId)
          const mine = !!t && !!you && t.owners.includes(you.id)
          const hp = t?.data.hp as { value?: number; max?: number } | undefined
          return (
            <li key={x.id} className={`${combat.turn === x.id && combat.active ? 'turn' : ''}${x.done ? ' done' : ''}`} aria-current={combat.turn === x.id && combat.active ? 'step' : undefined}>
              {gm || mine
                ? <input className="input tt-init" type="number" aria-label={`Initiative of ${x.name}`} defaultValue={x.init ?? ''} key={`${x.id}${x.init}`}
                    onBlur={(e) => { const raw = e.target.value.trim(); const n = raw === '' ? null : Math.round(Number(raw)); if (n === null ? x.init !== null : Number.isFinite(n) && n !== x.init) sendTable({ t: 'combat.init', id: x.id, value: n }) }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                : <span className="tt-init">{x.init ?? '–'}</span>}
              <span className="grow ellipsis">{x.name}{x.hidden ? ' (hidden)' : ''}{hp && hp.max ? <small className="muted"> {hp.value}/{hp.max}</small> : null}</span>
              {gm && (
                <span className="tt-row-actions">
                  <button className="btn ghost sm" title={x.done ? 'Back in the fight' : 'Out of the fight'} aria-label={x.done ? 'Back in the fight' : 'Out of the fight'} onClick={() => sendTable({ t: 'combat.flag', id: x.id, done: !x.done })}>{x.done ? '↺' : '✕'}</button>
                  <button className="btn ghost sm" title={x.hidden ? 'Show to players' : 'Hide from players'} aria-label={x.hidden ? 'Show to players' : 'Hide from players'} onClick={() => sendTable({ t: 'combat.flag', id: x.id, hidden: !x.hidden })}>{x.hidden ? 'Show' : 'Hide'}</button>
                  <button className="btn ghost sm" title="Remove from the order" aria-label="Remove from the order" onClick={() => sendTable({ t: 'combat.remove', ids: [x.id] })}>–</button>
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {gm && combat.list.length > 0 && !combat.active && <button className="btn sm danger" onClick={() => control('clear')}>Clear the list</button>}
    </div>
  )
}
