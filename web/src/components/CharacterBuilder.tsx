import { Check, ChevronLeft, ChevronRight, Dices, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  buildCharacter, finalScores, grantedSkills, POINT_BUDGET, POINT_COST, pointsSpent, problems, rollScores, STANDARD_ARRAY, suggestedScores,
  type Choices, type Ruleset,
} from '../lib/builder'
import { classDef, homebrewCatalog, loadHomebrew, type HomebrewOption, type RulesCategory } from '../lib/homebrew'
import { useStore } from '../store'
import { HomebrewDialog } from './Homebrew'
import { ABILITIES, abilityMod, signed, SKILLS, type Ability, type Sheet } from '../lib/sheet'
import { useRules } from '../lib/pack'
import { Select } from './Select'
import { LibraryInput } from './LibraryInput'

// Making a character step by step, for a person page. Each step shows only what has to be decided there, says what the
// choice does, and the last step shows the finished sheet's numbers before anything is written to the page.

const STEPS = ['Class', 'Species', 'Background', 'Abilities', 'Skills', 'Finish'] as const
type Method = 'standard' | 'points' | 'roll' | 'manual'
const titleCase = (s: string) => s.replace(/\b\w+/g, (w) => (w === 'of' || w === 'and' ? w : w[0].toUpperCase() + w.slice(1)))

export function CharacterBuilder({ ruleset, name, onCreate, onClose }: { ruleset: Ruleset; name: string; onCreate: (sheet: Sheet) => void; onClose: () => void }) {
  const rules = useRules()
  const an = rules.abilities
  const [step, setStepState] = useState(0)
  const [reached, setReached] = useState(0)
  const setStep = (i: number) => { setStepState(i); setReached((r) => Math.max(r, i)); setFilter('') }
  const [method, setMethod] = useState<Method>('standard')
  const [rolled, setRolled] = useState<number[]>([])
  const [c, setC] = useState<Choices>({
    ruleset, name, classId: '', speciesId: '', backgroundId: '',
    base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, bonus: {}, skills: [], alignment: '',
  })
  const set = (patch: Partial<Choices>) => setC((x) => ({ ...x, ...patch }))
  // homebrew classes, species and backgrounds of the world and of the libraries sit next to the rules' own
  const pages = useStore((s) => s.data.pages)
  const canMake = useStore((s) => s.user?.role !== 'viewer')
  const [homebrew, setHomebrew] = useState<HomebrewOption[]>([])
  const [making, setMaking] = useState<RulesCategory | null>(null)
  useEffect(() => { let live = true; loadHomebrew(pages).then((h) => live && setHomebrew(h)).catch(() => {}); return () => { live = false } }, [])
  const cat = useMemo(() => homebrewCatalog(ruleset, homebrew), [ruleset, homebrew])
  /** Where a choice that is not the builder's own comes from: "Homebrew · this world", "Open5e · Tome of Heroes". */
  const origin = (id: string) => {
    const h = homebrew.find((x) => x.id === id)
    if (!h) return null
    return <span className="hb-from" title={h.guessed ? 'It has no rules for the builder yet: these are worked out from its page. Set them on its page.' : undefined}>{h.kind === 'open5e' ? 'Open5e' : 'Homebrew'} · {h.from}{h.guessed ? ' · rules guessed' : ''}</span>
  }
  // the lists grow long with Open5e and homebrew; a name filter keeps them usable
  const [filter, setFilter] = useState('')
  const shown = <T extends { id: string; name: string }>(list: T[], chosen: string) => {
    const q = filter.trim().toLowerCase()
    return q ? list.filter((x) => x.id === chosen || x.name.toLowerCase().includes(q) || (homebrew.find((h) => h.id === x.id)?.from ?? '').toLowerCase().includes(q)) : list
  }
  const filterBox = (count: number, label: string) => count > 12 && (
    <input className="input cb-filter" type="search" aria-label={`Filter ${label}`} placeholder={`Filter ${count} ${label} by name or book`} value={filter} onChange={(e) => setFilter(e.target.value)} />
  )
  const cls = cat.classes.find((x) => x.id === c.classId)
  const species = cat.species.find((s) => s.id === c.speciesId)
  const bg = cat.backgrounds.find((b) => b.id === c.backgroundId)
  const granted = grantedSkills(c, cat)
  const scores = finalScores(c, cat)
  const issues = problems(c, cat)
  const preview = useMemo(() => (issues.length ? null : buildCharacter(c, cat)), [c, cat, issues.length])

  useEffect(() => { const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on) }, [onClose])

  const pickClass = (id: string) => {
    const k = cat.classes.find((x) => x.id === id)!
    // the scores follow the class until the person places them by hand
    set({ classId: id, skills: [], ...(method === 'standard' && !c.classId ? { base: suggestedScores(k) } : {}) })
  }
  const done = [!!cls, !!species, !!bg, ABILITIES.every((a) => c.base[a] >= 3) && (ruleset !== '5e-2024' || !bg?.abilities?.length || !!c.bonus.spread || (!!c.bonus.plus2 && !!c.bonus.plus1 && c.bonus.plus1 !== c.bonus.plus2)), !!cls && c.skills.length === cls.skills.count, !issues.length]
  const canNext = done[step]

  // ---- the steps ----
  const classStep = (
    <>
    {filterBox(cat.classes.length, 'classes')}
    <div className="cb-cards" role="radiogroup" aria-label="Class">
      {shown(cat.classes, c.classId).map((k) => (
        <button key={k.id} role="radio" aria-checked={c.classId === k.id} className={`cb-card${c.classId === k.id ? ' on' : ''}`} onClick={() => pickClass(k.id)}>
          <b>{k.name}</b>
          {origin(k.id)}
          <span className="muted">d{k.die} hit die · {k.primary.map((a) => an[a].name).join(' and ')}{k.spell ? ' · casts spells' : ''}</span>
          <small>{k.features[0] ? `${k.features[0].name}: ${k.features[0].text}` : 'No features yet'}</small>
        </button>
      ))}
      {canMake && <button className="cb-card hb-new" onClick={() => setMaking('class')}><Plus size={16} /><b>New class</b><small>Make a class of your own, right here.</small></button>}
    </div>
    </>
  )
  const speciesStep = (
    <>
    {filterBox(cat.species.length, 'species')}
    <div className="cb-cards" role="radiogroup" aria-label="Species">
      {shown(cat.species, c.speciesId).map((s) => (
        <button key={s.id} role="radio" aria-checked={c.speciesId === s.id} className={`cb-card${c.speciesId === s.id ? ' on' : ''}`} onClick={() => set({ speciesId: s.id, bonus: { ...c.bonus, free: [] } })}>
          <b>{s.name}</b>
          {origin(s.id)}
          <span className="muted">{s.size}, speed {s.speed} ft{s.darkvision ? `, darkvision ${s.darkvision} ft` : ''}</span>
          {s.asi && <small>{Object.entries(s.asi).map(([a, n]) => `${an[a as Ability].short} +${n}`).join(', ')}{s.freeAsi ? `, and +1 to two others` : ''}</small>}
          <small>{s.traits.map((t) => t.name).join(', ') || (s.asi ? 'Versatile: +1 to every score' : 'No traits')}</small>
        </button>
      ))}
      {canMake && <button className="cb-card hb-new" onClick={() => setMaking('species')}><Plus size={16} /><b>New species</b><small>Make a species of your own, right here.</small></button>}
    </div>
    </>
  )
  const backgroundStep = (
    <>
    {filterBox(cat.backgrounds.length, 'backgrounds')}
    <div className="cb-cards" role="radiogroup" aria-label="Background">
      {shown(cat.backgrounds, c.backgroundId).map((b) => (
        <button key={b.id} role="radio" aria-checked={c.backgroundId === b.id} className={`cb-card${c.backgroundId === b.id ? ' on' : ''}`} onClick={() => set({ backgroundId: b.id, skills: c.skills.filter((s) => !b.skills.includes(s)), bonus: { ...c.bonus, plus2: undefined, plus1: undefined } })}>
          <b>{b.name}</b>
          {origin(b.id)}
          <span className="muted">{b.skills.map(titleCase).join(' and ')}</span>
          {b.abilities && <small>Raises {b.abilities.map((a) => an[a].short).join(', ')}; feat: {b.feat}</small>}
          <small>{b.tools}</small>
        </button>
      ))}
      {canMake && <button className="cb-card hb-new" onClick={() => setMaking('background')}><Plus size={16} /><b>New background</b><small>Make a background of your own, right here.</small></button>}
    </div>
    </>
  )

  const placeArray = (a: Ability, v: number) => {
    // swapping keeps every number of the array used once
    const other = ABILITIES.find((x) => x !== a && c.base[x] === v)
    set({ base: { ...c.base, [a]: v, ...(other ? { [other]: c.base[a] } : {}) } })
  }
  const pool = method === 'roll' ? rolled : STANDARD_ARRAY
  const abilitiesStep = (
    <div className="cb-abilities">
      <div className="seg" role="group" aria-label="How to find the scores">
        {([['standard', 'Standard array'], ['points', 'Point buy'], ['roll', 'Roll 4d6'], ['manual', 'Type them']] as const).map(([m, label]) => (
          <button key={m} className={method === m ? 'on' : ''} onClick={() => {
            setMethod(m)
            if (m === 'standard') set({ base: cls ? suggestedScores(cls) : Object.fromEntries(ABILITIES.map((a, i) => [a, STANDARD_ARRAY[i]])) as Record<Ability, number> })
            if (m === 'points') set({ base: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } })
            if (m === 'roll') { const r = rollScores().sort((x, y) => y - x); setRolled(r); const order = cls ? [...new Set<Ability>([...cls.primary, 'con', 'dex', ...ABILITIES])] : [...ABILITIES]; set({ base: Object.fromEntries(order.map((a, i) => [a, r[i]])) as Record<Ability, number> }) }
          }}>{label}</button>
        ))}
      </div>
      <p className="muted cb-hint">
        {method === 'standard' && 'Six numbers, 15, 14, 13, 12, 10 and 8, each used once. They start on what your class needs most; pick a number to swap two scores.'}
        {method === 'points' && `Every score starts at 8. Spend ${POINT_BUDGET} points; higher scores cost more. ${POINT_BUDGET - pointsSpent(c.base)} left.`}
        {method === 'roll' && <>Four six-sided dice for each score, the lowest left out: {rolled.join(', ')}. <button className="btn ghost sm" onClick={() => setMethod('manual')}>Place them by hand</button></>}
        {method === 'manual' && 'Type the scores your table agreed on (3 to 20).'}
      </p>
      <div className="cb-scores">
        {ABILITIES.map((a) => {
          const bonus = scores[a] - c.base[a]
          return (
            <div key={a} className={`cb-score${cls?.primary.includes(a) ? ' key' : ''}`}>
              <b title={an[a].name}>{an[a].short}</b>
              {(method === 'standard' || method === 'roll') && (
                <Select className="input cb-pick" title={an[a].name} value={String(c.base[a])} onChange={(v) => placeArray(a, Number(v))}>
                  {[...new Set(pool)].map((v) => <option key={v} value={String(v)}>{v}</option>)}
                </Select>
              )}
              {method === 'points' && (
                <span className="cb-step">
                  <button className="btn ghost sm square" aria-label={`Lower ${an[a].name}`} disabled={c.base[a] <= 8} onClick={() => set({ base: { ...c.base, [a]: c.base[a] - 1 } })}>−</button>
                  <span aria-label={an[a].name}>{c.base[a]}</span>
                  <button className="btn ghost sm square" aria-label={`Raise ${an[a].name}`} disabled={c.base[a] >= 15 || pointsSpent({ ...c.base, [a]: c.base[a] + 1 }) > POINT_BUDGET} onClick={() => set({ base: { ...c.base, [a]: c.base[a] + 1 } })}>+</button>
                </span>
              )}
              {method === 'manual' && <input type="number" min={3} max={20} aria-label={an[a].name} value={c.base[a]} onChange={(e) => set({ base: { ...c.base, [a]: Math.max(3, Math.min(20, Number(e.target.value) || 3)) } })} />}
              <span className="cb-final">{scores[a]}{bonus ? <small> (+{bonus})</small> : null}</span>
              <span className="muted">{signed(abilityMod(scores[a]))}</span>
            </div>
          )
        })}
      </div>
      {method === 'points' && <p className="muted cb-hint">Costs: {Object.entries(POINT_COST).map(([s, n]) => `${s}: ${n}`).join(', ')}</p>}
      {ruleset === '5e-2024' && bg?.abilities && (
        <div className="cb-bonus" role="group" aria-label="What the background raises">
          <b>Your {bg.name.toLowerCase()} background raises {bg.abilities.map((a) => an[a].name).join(', ')}</b>
          <label className="tt-check"><input type="checkbox" checked={!!c.bonus.spread} onChange={(e) => set({ bonus: { ...c.bonus, spread: e.target.checked } })} />One point to each of the three</label>
          {!c.bonus.spread && (
            <div className="cb-row">
              <span>+2 to</span>{bg.abilities.map((a) => <button key={a} className={`btn sm${c.bonus.plus2 === a ? ' primary' : ''}`} onClick={() => set({ bonus: { ...c.bonus, plus2: a, plus1: c.bonus.plus1 === a ? undefined : c.bonus.plus1 } })}>{an[a].short}</button>)}
              <span>+1 to</span>{bg.abilities.map((a) => <button key={a} disabled={c.bonus.plus2 === a} className={`btn sm${c.bonus.plus1 === a ? ' primary' : ''}`} onClick={() => set({ bonus: { ...c.bonus, plus1: a } })}>{an[a].short}</button>)}
            </div>
          )}
        </div>
      )}
      {ruleset === '5e' && species?.freeAsi && (
        <div className="cb-bonus" role="group" aria-label="Two more scores">
          <b>As a {species.name.toLowerCase()}, raise two more scores by 1</b>
          <div className="cb-row">{ABILITIES.filter((a) => !species.asi?.[a]).map((a) => {
            const on = (c.bonus.free ?? []).includes(a)
            return <button key={a} className={`btn sm${on ? ' primary' : ''}`} onClick={() => set({ bonus: { ...c.bonus, free: on ? (c.bonus.free ?? []).filter((x) => x !== a) : [...(c.bonus.free ?? []), a].slice(-2) } })}>{an[a].short}</button>
          })}</div>
        </div>
      )}
    </div>
  )

  const choosable = cls ? (cls.skills.from === 'any' ? Object.keys(SKILLS) : cls.skills.from) : []
  const skillsStep = cls && (
    <div>
      <p className="muted cb-hint">As a {cls.name.toLowerCase()}, choose {cls.skills.count}. {granted.length ? `You already have ${granted.map(titleCase).join(', ')} from your ${[bg && 'background', species?.skills?.length && 'species'].filter(Boolean).join(' and ')}.` : ''}</p>
      <div className="cb-skills">
        {Object.keys(SKILLS).map((k) => {
          const has = granted.includes(k), picked = c.skills.includes(k), allowed = choosable.includes(k) && !has
          const bonus = abilityMod(scores[SKILLS[k]]) + (has || picked ? 2 : 0)
          return (
            <label key={k} className={`cb-skill${has ? ' granted' : ''}${!allowed && !has ? ' off' : ''}`}>
              <input type="checkbox" checked={has || picked} disabled={has || !allowed || (!picked && c.skills.length >= cls.skills.count)} onChange={(e) => set({ skills: e.target.checked ? [...c.skills, k] : c.skills.filter((x) => x !== k) })} />
              <span className="grow">{titleCase(k)} <small className="muted">{an[SKILLS[k]].short}</small></span>
              <b>{signed(bonus)}</b>
            </label>
          )
        })}
      </div>
    </div>
  )

  const finishStep = (
    <div className="cb-finish">
      <div className="cb-row">
        <label className="cb-field">Name<input className="input" value={c.name} placeholder="Aria Thornwood" onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="cb-field">Alignment<LibraryInput className="input" label="Alignment" categories={['alignment']} value={c.alignment ?? ''} placeholder="Neutral good" onChange={(v) => set({ alignment: v })} /></label>
      </div>
      {issues.length > 0 && <ul className="cb-issues">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
      {preview && (
        <div className="cb-summary" aria-label="The finished character">
          <h3>{preview.name}</h3>
          <p className="muted">Level 1 {species?.name.toLowerCase()} {cls?.name.toLowerCase()}, {bg?.name.toLowerCase()}</p>
          <div className="cb-stats">
            <span><b>{preview.hp.max}</b>hit points</span>
            <span><b>{preview.ac.value}</b>armor class<small>{preview.ac.note}</small></span>
            <span><b>{preview.speed.walk}</b>ft speed</span>
            <span><b>{signed(abilityMod(preview.abilities.dex))}</b>initiative</span>
            <span><b>+2</b>proficiency</span>
          </div>
          <div className="cb-stats">{ABILITIES.map((a) => <span key={a}><b>{preview.abilities[a]}</b>{an[a].short} {signed(abilityMod(preview.abilities[a]))}</span>)}</div>
          <p><b>Saves:</b> {preview.profs!.saves.map((a) => an[a].name).join(', ')}. <b>Skills:</b> {Object.keys(preview.profs!.skills).map(titleCase).join(', ')}.</p>
          <p><b>Features:</b> {preview.features.traits.map((f) => f.name).join(', ')}.</p>
          <p><b>Gear:</b> {preview.inventory!.length ? preview.inventory!.map((i) => (i.qty > 1 ? `${i.qty} ${i.name.toLowerCase()}` : i.name.toLowerCase())).join(', ') : 'none'}.</p>
          {preview.spellcasting?.ability && <p><b>Spells:</b> {an[preview.spellcasting.ability].name}; {(preview.spellcasting.slots[0]?.total ?? 0) || 'no'} first-level slots. A starting list is on the sheet to change.</p>}
        </div>
      )}
    </div>
  )

  const body = [classStep, speciesStep, backgroundStep, abilitiesStep, skillsStep, finishStep][step]
  return (
    <div className="overlay dialog-overlay" onMouseDown={onClose}>
      <div className="dialog cb" role="dialog" aria-modal="true" aria-label="Build a character" onMouseDown={(e) => e.stopPropagation()}>
        <header className="cb-head">
          <div>
            <h2>Build a character</h2>
            <span className="muted">{ruleset === '5e-2024' ? 'D&D 5e, 2024 rules' : 'D&D 5e, 2014 rules'}, level 1. Level up from the sheet afterwards.</span>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        <ol className="cb-steps">
          {STEPS.map((s, i) => (
            <li key={s}><button className={`${i === step ? 'on' : ''}${done[i] && i < reached ? ' done' : ''}`} disabled={i > 0 && !done.slice(0, i).every(Boolean)} onClick={() => setStep(i)}>
              <span className="cb-num">{done[i] && i < reached && i !== step ? <Check size={12} /> : i + 1}</span>{s}
            </button></li>
          ))}
        </ol>
        <div className="cb-body">{body}</div>
        <footer className="cb-foot">
          <span className="muted cb-sofar">{[cls?.name, species?.name, bg?.name].filter(Boolean).join(' · ') || 'Nothing chosen yet'}</span>
          {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}><ChevronLeft size={14} /> Back</button>}
          {step < STEPS.length - 1
            ? <button className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next <ChevronRight size={14} /></button>
            : <button className="btn primary" disabled={!preview} onClick={() => preview && onCreate(preview)}><Dices size={14} /> Create the character</button>}
        </footer>
        {making && <HomebrewDialog category={making} ruleset={ruleset} onClose={() => setMaking(null)} onDone={(m) => {
          const category = making
          setMaking(null)
          if (!m.rules) return
          const opt: HomebrewOption = { id: m.pageId ? `page:${m.pageId}` : `lib:${m.key}`, category, name: m.name, rules: m.rules, from: m.pageId ? 'this world' : 'a library', pageId: m.pageId, libKey: m.key }
          setHomebrew((h) => [...h, opt])
          // what was just made is chosen
          if (category === 'class') set({ classId: opt.id, skills: [], ...(method === 'standard' && !c.classId ? { base: suggestedScores(classDef(opt.id, m.name, m.rules)) } : {}) })
          if (category === 'species') set({ speciesId: opt.id, bonus: { ...c.bonus, free: [] } })
          if (category === 'background') set({ backgroundId: opt.id, bonus: { ...c.bonus, plus2: undefined, plus1: undefined } })
        }} />}
      </div>
    </div>
  )
}
