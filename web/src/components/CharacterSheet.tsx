import { useRules } from '../lib/pack'
import type { SheetSection } from '../lib/systems'
import { Heart, ImageIcon, Moon, Plus, Shield, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import {
  ABILITIES, SKILLS, abilityMod, characterLevel, initiativeBonus, longRestPatch, passivePerception, proficiency, saveBonus, signed, skillBonus, spellAttack, spellDC,
  type Ability, type Feature, type InventoryItem, type Proficiency, type Sheet,
} from '../lib/sheet'
import { attunedCount, capacityOf, carriedWeight, loadOf, MAX_ATTUNED } from '../lib/levelup'
import { LevelUpPanel } from './LevelUpPanel'
import { LibraryInput, type Picked } from './LibraryInput'
import { PersonInput } from './PersonInput'
import { backgroundPatch, speciesPatch } from '../lib/origin'
import { homebrewBackgroundPatch, homebrewSpeciesPatch } from '../lib/homebrew'
import { useStore } from '../store'
import type { LibraryRow } from '../types'
import { api } from '../api'
import { fetchLibraryEntry } from '../lib/library'
import { HomebrewDialog } from './Homebrew'
import { exportCharacter } from '../lib/importers'
import { FeatureEditor, type SheetPatch } from './SheetView'
import { Select } from './Select'
import { EntryLink, ListLinks, SheetLinksHost, SpellLinks } from './SheetLinks'
import { makeLinker, useAutoLinks } from './useAutoLinks'

// A player character: the same sheet as a creature, with what a player tracks through a game. Editable by people who can edit the page;
// everything derived (modifiers, saves, skills, spell save DC) is worked out from the level and the proficiencies.

const ABILITY_NAME: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' }
const title = (s: string) => s.replace(/\b\w+/g, (w) => (w === 'of' || w === 'and' ? w : w[0].toUpperCase() + w.slice(1)))

export function Num({ value, onChange, label, min = 0, max, width = 56, placeholder }: { value: number | undefined; onChange: (n: number) => void; label: string; min?: number; max?: number; width?: number; placeholder?: string }) {
  return (
    <input type="number" className="sv-num" aria-label={label} min={min} max={max} placeholder={placeholder} style={{ width }} value={value ?? ''}
      onChange={(e) => { if (e.target.value === '') return; const n = Math.round(Number(e.target.value)); if (Number.isFinite(n)) onChange(n) }} />
  )
}
export function Txt({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) {
  return <input className="sv-text" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
}

/** A row of small circles: the first `used` are filled. Clicking one sets how many are used. */
export function Bubbles({ total, used, onChange, label }: { total: number; used: number; onChange: (n: number) => void; label: string }) {
  return (
    <span className="cs-bubbles" role="group" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <button key={i} className={`cs-bubble${i < used ? ' on' : ''}`} aria-pressed={i < used} aria-label={`${label} ${i + 1}`} onClick={() => onChange(i + 1 === used ? i : i + 1)} />
      ))}
    </span>
  )
}

const mark = (p: Proficiency | undefined) => (p === 'e' ? '◆' : p === 'p' ? '●' : '○')
const next = (p: Proficiency | undefined): Proficiency | null => (p === undefined ? 'p' : p === 'p' ? 'e' : null)

export type RollFn = (expr: string, label: string) => void

/** The three pictures of a character: the wide banner behind the sheet, the portrait (the page thumbnail) and the token picture. */
export type PictureKey = 'banner' | 'portrait' | 'token'
export interface Pictures {
  banner?: string; portrait?: string; token?: string
  /** missing for people who may only look */
  set?: (key: PictureKey, url: string | null) => void
  pick?: () => Promise<string | null>
}
const PICTURE_LABEL: Record<PictureKey, string> = { banner: 'Banner', portrait: 'Portrait', token: 'Token' }

function PictureSlots({ pictures }: { pictures: Pictures }) {
  const choose = async (k: PictureKey) => { const url = await pictures.pick?.(); if (url) pictures.set?.(k, url) }
  return (
    <div className="cs-pics" role="group" aria-label="Pictures">
      {(['banner', 'portrait', 'token'] as const).map((k) => (
        <span key={k} className={`cs-pic${k === 'banner' ? ' wide' : ''}`}>
          <button className="cs-pic-main" title={pictures[k] ? `Change the ${PICTURE_LABEL[k].toLowerCase()}` : `Add a ${PICTURE_LABEL[k].toLowerCase()}`} onClick={() => void choose(k)}>
            {pictures[k] ? <img src={pictures[k]} alt="" /> : <span className="cs-pic-empty"><ImageIcon size={13} /></span>}{PICTURE_LABEL[k]}
          </button>
          {pictures[k] && <button className="icon-btn" aria-label={`Remove the ${PICTURE_LABEL[k].toLowerCase()}`} title="Remove" onClick={() => pictures.set?.(k, null)}><X size={11} /></button>}
        </span>
      ))}
    </div>
  )
}

export function CharacterSheet({ sheet, set, roll, pictures }: { sheet: Sheet; set?: (patch: SheetPatch) => void; roll?: RollFn; pictures?: Pictures }) {
  const rules = useRules()
  // where each section goes, and which are left out, as the system pack says
  const place = (id: SheetSection) => ({ style: { order: rules.sheetLayout.order[id], ...(rules.sheetLayout.hidden.has(id) ? { display: 'none' } : {}) } as React.CSSProperties })
  const an = rules.abilities
  // people who may change the sheet see it as a sheet to play from; the form opens with Edit sheet (a new, empty sheet opens as a form)
  const canSet = !!set
  const [editing, setEditing] = useState(() => !(sheet.classes ?? []).some((c) => c.name.trim()))
  const edit = canSet && editing
  const pb = proficiency(sheet)
  const level = characterLevel(sheet)
  const classes = sheet.classes ?? []
  const profs = sheet.profs ?? { saves: [], skills: {} }
  const slots = sheet.spellcasting?.slots ?? []
  const items = sheet.inventory ?? []
  const cur = sheet.hp.current ?? sheet.hp.max
  const ratio = sheet.hp.max ? Math.max(0, Math.min(1, cur / sheet.hp.max)) : 0
  const [adding, setAdding] = useState('')
  const [addingSpell, setAddingSpell] = useState('')
  const [levelling, setLevelling] = useState(false)
  const act = (patch: SheetPatch) => set?.(patch)
  const bonus = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n)}`
  const check = (n: number, label: string) => roll?.(`1d20${bonus(n)}`, label)
  const setItems = (list: InventoryItem[]) => act({ inventory: list })
  const features = (g: 'traits' | 'actions'): Feature[] => sheet.features[g]
  // a new species or background made right here, from the sheet
  const canMake = useStore((s) => s.user?.role !== 'viewer')
  const [making, setMaking] = useState<{ kind: 'species' | 'background'; name: string } | null>(null)
  /** A species or background chosen from the suggestions fills in what it gives (speed, senses, skills, traits); a page of the world gives its rules or the entry it was imported from. */
  const pickOrigin = async (kind: 'species' | 'background', p: Picked) => {
    let e = p.entry
    if (!e && p.pageId) {
      const page = await api.getPage(p.pageId).catch(() => null)
      const rules = page?.props?.rules
      if (rules) { act(kind === 'species' ? homebrewSpeciesPatch(sheet, p.name, rules) : homebrewBackgroundPatch(sheet, p.name, rules)); return }
      const key = page?.props?.library
      if (typeof key === 'string') e = await fetchLibraryEntry(key).catch(() => undefined)
    }
    if (!e) act({ [kind]: p.name })
    else if (e.homebrew && e.data?.rules) act(kind === 'species' ? homebrewSpeciesPatch(sheet, p.name, e.data.rules) : homebrewBackgroundPatch(sheet, p.name, e.data.rules))
    else act(kind === 'species' ? speciesPatch(sheet, e.data, p.name) : backgroundPatch(sheet, e.data, p.name))
  }
  const isSubclass = (r: LibraryRow) => r[4].startsWith('Subclass of')
  const subclassOf = (cls: string) => (r: LibraryRow) => isSubclass(r) && (!cls.trim() || r[4].toLowerCase() === `subclass of ${cls.trim().toLowerCase()}`)
  const addItem = (p: Picked) => {
    const w = Number(p.entry?.data?.weight)
    setItems([...items, { name: p.name, qty: 1, equipped: false, note: p.entry?.data?.requires_attunement ? 'requires attunement' : '', ...(w > 0 ? { weight: w } : {}) }])
  }

  // in the text of a feature, the names of spells, conditions and other entries link to them
  const autoLinks = useAutoLinks()
  const featureText = (text: string) => { const lk = makeLinker(autoLinks); return lk ? lk(text, false) : text }
  const who = [
    sheet.species && <EntryLink key="s" name={sheet.species} categories={['species']} />,
    sheet.background && <EntryLink key="b" name={sheet.background} categories={['background']} />,
    sheet.alignment && <EntryLink key="a" name={sheet.alignment} categories={['alignment']} />, sheet.player && `played by ${sheet.player}`,
  ].filter(Boolean)

  return (
    <SheetLinksHost ruleset={sheet.ruleset}>
    <div className={`cs${pictures?.banner ? ' has-banner' : ''}`} aria-label="Character sheet">
      {pictures?.banner && <div className="cs-banner" aria-hidden style={{ backgroundImage: `url("${pictures.banner}")` }} />}
      <header className="cs-head">
        <div className="cs-top">
          {pictures?.portrait && <img className="cs-portrait" src={pictures.portrait} alt={`Portrait of ${sheet.name || 'the character'}`} />}
          <div className="cs-who">
        {edit ? <input className="cs-name" aria-label="Character name" placeholder="Character name" value={sheet.name} onChange={(e) => act({ name: e.target.value })} /> : <h2 className="cs-name">{sheet.name || 'Unnamed'}</h2>}
        <div className="cs-line">
          {edit ? (
            <>
              <PersonInput value={sheet.player ?? ''} label="Player" placeholder="Player" onChange={(v) => act({ player: v })} />
              <LibraryInput value={sheet.species ?? ''} label="Species" placeholder="Species" categories={['species']} onChange={(v) => act({ species: v })}
                onPick={(p) => void pickOrigin('species', p)} onMake={canMake ? (n) => setMaking({ kind: 'species', name: n }) : undefined} />
              <LibraryInput value={sheet.background ?? ''} label="Background" placeholder="Background" categories={['background']} onChange={(v) => act({ background: v })}
                onPick={(p) => void pickOrigin('background', p)} onMake={canMake ? (n) => setMaking({ kind: 'background', name: n }) : undefined} />
              <LibraryInput value={sheet.alignment} label="Alignment" placeholder="Alignment" categories={['alignment']} onChange={(v) => act({ alignment: v })} />
            </>
          ) : <span className="muted">{who.map((w, i) => <span key={i}>{i > 0 && ' · '}{w}</span>)}</span>}
        </div>
          </div>
        </div>
        {making && <HomebrewDialog category={making.kind} initialName={making.name} ruleset={sheet.ruleset === '5e-2024' ? '5e-2024' : '5e'} onClose={() => setMaking(null)} onDone={(m) => {
          setMaking(null)
          if (m.rules) act(making.kind === 'species' ? homebrewSpeciesPatch(sheet, m.name, m.rules) : homebrewBackgroundPatch(sheet, m.name, m.rules))
          else act({ [making.kind]: m.name })
        }} />}
        <div className="cs-classes">
          {classes.map((c, i) => (
            <span key={i} className="cs-class">
              {edit ? (
                <>
                  <LibraryInput value={c.name} label={`Class ${i + 1}`} placeholder="Class" categories={['class']} filter={(r) => !isSubclass(r)} onChange={(v) => act({ classes: classes.map((x, j) => (j === i ? { ...x, name: v } : x)) })} />
                  <Num value={c.level} label={`Level of ${c.name || `class ${i + 1}`}`} min={0} max={20} width={48} onChange={(n) => act({ classes: classes.map((x, j) => (j === i ? { ...x, level: Math.min(20, n) } : x)) })} />
                  <LibraryInput value={c.subclass ?? ''} label={`Subclass ${i + 1}`} placeholder="Subclass" categories={['class']} filter={subclassOf(c.name)} onChange={(v) => act({ classes: classes.map((x, j) => (j === i ? { ...x, subclass: v } : x)) })} />
                  {classes.length > 1 && <button className="icon-btn" aria-label={`Remove class ${i + 1}`} onClick={() => act({ classes: classes.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>}
                </>
              ) : <span><EntryLink name={c.name} categories={['class']} /> {c.level}{c.subclass ? <> (<EntryLink name={c.subclass} categories={['class']} />)</> : ''}</span>}
            </span>
          ))}
          {edit && classes.length < 6 && <button className="btn sm" onClick={() => act({ classes: [...classes, { name: '', level: 1 }] })}><Plus size={12} /> Class</button>}
        </div>
        <div className="cs-line cs-facts">
          <span className="cs-pill"><b>Level</b> {level}</span><span className="cs-pill"><b>Proficiency</b> {signed(pb)}</span>
          <label className="cs-pill cs-insp"><input type="checkbox" disabled={!canSet} checked={!!sheet.inspiration} onChange={(e) => act({ inspiration: e.target.checked })} />{sheet.ruleset === '5e-2024' ? 'Heroic Inspiration' : 'Inspiration'}</label>
          <label className="cs-pill">XP{canSet ? <Num label="Experience points" value={sheet.xp} width={70} onChange={(n) => act({ xp: n })} /> : <span>{sheet.xp ?? 0}</span>}</label>
        </div>
        <div className="cs-tools">
          {canSet && <button className={`btn sm${editing ? ' primary' : ''}`} aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit sheet'}</button>}
          {canSet && <button className="btn sm" onClick={() => setLevelling((v) => !v)}>Level up</button>}
          {canSet && <button className="btn sm" title="Full hit points, every spell slot back, half the hit dice back" onClick={() => act(longRestPatch(sheet))}><Moon size={12} /> Long rest</button>}
          <span className="grow" />
          {edit && pictures?.set && <PictureSlots pictures={pictures} />}
          <button className="btn ghost sm" title="Save this character as a file to share or keep" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(exportCharacter(sheet), null, 2)], { type: 'application/json' })); a.download = `${(sheet.name || 'character').replace(/[^\w\- ]+/g, '').trim() || 'character'}.chronicle-character.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000) }}>Export this character</button>
        </div>
      </header>

      {canSet && levelling && <LevelUpPanel sheet={sheet} set={act} onClose={() => setLevelling(false)} />}

      <section className="cs-combat" aria-label="Combat" {...place('combat')}>
        <div className="cs-box"><Shield size={14} /><b>Armor class</b>{edit ? <Num label="Armor class" value={sheet.ac.value} max={99} onChange={(n) => act({ 'ac.value': n })} /> : <span>{sheet.ac.value}</span>}</div>
        <button className="cs-box cs-roll" disabled={!roll} title="Roll initiative" onClick={() => check(initiativeBonus(sheet), 'Initiative')}><b>Initiative</b><span>{signed(initiativeBonus(sheet))}</span></button>
        <div className="cs-box"><b>Speed</b>{edit ? <Num label="Walking speed" value={sheet.speed.walk} width={56} onChange={(n) => act({ 'speed.walk': n })} /> : <span>{sheet.speed.walk ?? 0} ft.</span>}</div>
        <div className="cs-box cs-hp">
          <Heart size={14} /><b>Hit points</b>
          <div className="tt-hpbar" aria-hidden><span style={{ width: `${ratio * 100}%`, background: ratio > 0.5 ? '#4caf50' : ratio > 0.25 ? '#f1c40f' : '#e74c3c' }} /></div>
          {canSet ? (
            <span className="cs-hpfields">
              <Num label="Current hit points" value={cur} min={-999} width={56} onChange={(n) => act({ 'hp.current': Math.min(n, sheet.hp.max) })} />/
              {edit ? <Num label="Maximum hit points" value={sheet.hp.max} width={56} onChange={(n) => act({ 'hp.max': n })} /> : <span className="cs-hpmax">{sheet.hp.max}</span>}
              <label className="sv-mini">temp<Num label="Temporary hit points" value={sheet.hp.temp ?? 0} width={48} onChange={(n) => act({ 'hp.temp': n })} /></label>
            </span>
          ) : <span>{cur} / {sheet.hp.max}{sheet.hp.temp ? ` (+${sheet.hp.temp})` : ''}</span>}
        </div>
        <div className="cs-box"><b>Hit dice</b>
          {(sheet.hitDice ?? []).map((d, i) => (
            <span key={i} className="cs-hd">d{d.sides}
              <Bubbles label={`d${d.sides} hit dice used`} total={d.total} used={d.used} onChange={(n) => canSet && act({ hitDice: (sheet.hitDice ?? []).map((x, j) => (j === i ? { ...x, used: n } : x)) })} />
              {edit && <><Num label={`d${d.sides} hit dice total`} value={d.total} max={40} width={44} onChange={(n) => act({ hitDice: (sheet.hitDice ?? []).map((x, j) => (j === i ? { ...x, total: n, used: Math.min(x.used, n) } : x)) })} />
                <button className="icon-btn" aria-label={`Remove d${d.sides} hit dice`} onClick={() => act({ hitDice: (sheet.hitDice ?? []).filter((_, j) => j !== i) })}><Trash2 size={11} /></button></>}
            </span>
          ))}
          {edit && <span className="cs-add">{[6, 8, 10, 12].map((s) => <button key={s} className="btn sm" onClick={() => act({ hitDice: [...(sheet.hitDice ?? []), { sides: s, total: Math.max(1, level), used: 0 }] })}>+d{s}</button>)}</span>}
        </div>
        <div className="cs-box"><b>Death saves</b>
          <span className="cs-ds">Successes <Bubbles label="Death save successes" total={3} used={sheet.deathSaves?.ok ?? 0} onChange={(n) => canSet && act({ deathSaves: { ok: n, fail: sheet.deathSaves?.fail ?? 0 } })} /></span>
          <span className="cs-ds">Failures <Bubbles label="Death save failures" total={3} used={sheet.deathSaves?.fail ?? 0} onChange={(n) => canSet && act({ deathSaves: { ok: sheet.deathSaves?.ok ?? 0, fail: n } })} /></span>
        </div>
      </section>

      <section className="cs-abilities" aria-label="Abilities" {...place('abilities')}>
        {ABILITIES.map((a) => (
          <div key={a} className="cs-ability">
            <button className="cs-roll" disabled={!roll} title={`Roll ${an[a].name} check`} onClick={() => check(abilityMod(sheet.abilities[a]), `${an[a].short} check`)}><b>{an[a].short}</b><span className="cs-mod">{signed(abilityMod(sheet.abilities[a]))}</span></button>
            {edit ? <Num label={an[a].name} value={sheet.abilities[a]} max={30} width={52} onChange={(n) => act({ [`abilities.${a}`]: n })} /> : <span className="muted">{sheet.abilities[a]}</span>}
            <button className="cs-save" disabled={!edit && !roll} aria-pressed={profs.saves.includes(a)} aria-label={`${an[a].name} saving throw ${signed(saveBonus(sheet, a))}${profs.saves.includes(a) ? ', proficient' : ''}`}
              title={edit ? 'Click to toggle proficiency; the bonus rolls from the sheet' : 'Roll the saving throw'}
              onClick={(e) => { if (edit && !e.shiftKey) act({ profs: { ...profs, saves: profs.saves.includes(a) ? profs.saves.filter((x) => x !== a) : [...profs.saves, a] } }); else check(saveBonus(sheet, a), `${an[a].short} save`) }}>
              {profs.saves.includes(a) ? '●' : '○'} Save {signed(saveBonus(sheet, a))}
            </button>
          </div>
        ))}
      </section>

      <section className="cs-skills" aria-label="Skills" {...place('skills')}>
        <h4>Skills <small className="muted">{edit ? 'click the mark to cycle none, proficient, expertise; Shift-click rolls' : ''}</small></h4>
        <div className="cs-skillgrid">
          {Object.keys(SKILLS).map((k) => (
            <button key={k} className="cs-skill" aria-label={`${title(k)} ${signed(skillBonus(sheet, k))}${profs.skills[k] === 'e' ? ', expertise' : profs.skills[k] === 'p' ? ', proficient' : ''}`}
              onClick={(e) => { if (edit && !e.shiftKey) { const n = next(profs.skills[k]); const skills = { ...profs.skills }; if (n) skills[k] = n; else delete skills[k]; act({ profs: { ...profs, skills } }) } else check(skillBonus(sheet, k), `${title(k)} check`) }}>
              <span className="cs-mark">{mark(profs.skills[k])}</span><span className="grow">{title(k)} <small className="muted">{SKILLS[k].toUpperCase()}</small></span><b>{signed(skillBonus(sheet, k))}</b>
            </button>
          ))}
        </div>
        <div className="cs-line"><span><b>Passive Perception</b> {passivePerception(sheet)}</span></div>
        {edit
          ? <label className="sv-block"><b>Other proficiencies and languages</b><Txt value={profs.tools ?? ''} label="Other proficiencies" placeholder="Thieves' tools, Common, Elvish" onChange={(v) => act({ profs: { ...profs, tools: v } })} /></label>
          : profs.tools ? <div className="cs-line"><b>Proficiencies</b> <span><ListLinks text={profs.tools} categories={['language', 'item', 'skill', 'weaponproperty']} /></span></div> : null}
      </section>

      {(edit || !!sheet.spellcasting?.ability || slots.some((x) => x.total > 0) || !!sheet.spells?.trim()) && <section className="cs-spells" aria-label="Spellcasting" {...place('spells')}>
        <h4>Spellcasting</h4>
        <div className="cs-line">
          {edit ? (
            <label className="sv-mini">Ability
              <Select className="input" style={{ width: 'auto' }} value={sheet.spellcasting?.ability ?? ''} onChange={(v) => act({ spellcasting: { ability: v as Ability | '', slots } })}>
                <option value="">None</option>{ABILITIES.map((a) => <option key={a} value={a}>{an[a].name}</option>)}
              </Select>
            </label>
          ) : sheet.spellcasting?.ability ? <span><b>Ability</b> {an[sheet.spellcasting.ability].name}</span> : null}
          {spellDC(sheet) != null && <><span><b>Save DC</b> {spellDC(sheet)}</span><button className="cs-roll" disabled={!roll} onClick={() => check(spellAttack(sheet)!, 'Spell attack')}>Attack {signed(spellAttack(sheet)!)}</button></>}
        </div>
        {(sheet.spellcasting?.ability || slots.length > 0) && (
          <div className="cs-slots">
            {Array.from({ length: 9 }, (_, i) => slots[i] ?? { total: 0, used: 0 }).map((sl, i) => (edit || sl.total > 0) && (
              <div key={i} className="cs-slot"><b>Level {i + 1}</b>
                <Bubbles label={`Level ${i + 1} slots used`} total={sl.total} used={sl.used} onChange={(n) => canSet && act({ 'spellcasting.slots': Array.from({ length: Math.max(slots.length, i + 1) }, (_, j) => (j === i ? { ...sl, used: n } : slots[j] ?? { total: 0, used: 0 })) })} />
                {edit && <Num label={`Level ${i + 1} slots`} value={sl.total} max={20} width={44} onChange={(n) => act({ 'spellcasting.slots': Array.from({ length: Math.max(slots.length, i + 1) }, (_, j) => (j === i ? { total: n, used: Math.min(sl.used, n) } : slots[j] ?? { total: 0, used: 0 })) })} />}
              </div>
            ))}
          </div>
        )}
        {edit && <LibraryInput value={addingSpell} onChange={setAddingSpell} label="Add a spell" placeholder="Add a spell: Fire Bolt, Shield" categories={['spell']} onAdd={(p) => {
          const lv = Number(p.entry?.data?.level ?? p.entry?.data?.level_int ?? NaN)
          act({ spells: `${sheet.spells ? `${sheet.spells}\n` : ''}${lv > 0 ? `Level ${lv}: ` : lv === 0 ? 'Cantrip: ' : ''}${p.name}` })
        }} />}
        {edit ? <textarea className="sv-area" aria-label="Spells" rows={3} placeholder="Cantrips and spells known or prepared" value={sheet.spells ?? ''} onChange={(e) => act({ spells: e.target.value })} />
          : sheet.spells ? <p className="cs-notes"><SpellLinks text={sheet.spells} /></p> : null}
      </section>}

      <section className="cs-features" aria-label="Features and attacks" {...place('features')}>
        <h4>Attacks and spells</h4>
        {edit ? <FeatureEditor group="actions" categories={['item', 'magicitem', 'spell']} list={features('actions')} set={(list) => act({ 'features.actions': list })} />
          : features('actions').map((f, i) => <p key={i}><b><i><EntryLink name={f.name} categories={['spell', 'item', 'magicitem']} />.</i></b> {featureText(f.text)}</p>)}
        <h4>Features and traits</h4>
        {edit ? <FeatureEditor group="traits" categories={['feat', 'rule', 'condition', 'spell']} list={features('traits')} set={(list) => act({ 'features.traits': list })} />
          : features('traits').map((f, i) => <p key={i}><b><i><EntryLink name={f.name} categories={['feat', 'rule', 'condition', 'spell']} />.</i></b> {featureText(f.text)}</p>)}
      </section>

      {rules.sheetFields.length > 0 && (
        <section className="cs-extra" aria-label={`Extras of ${rules.name}`} {...place('extra')}>
          <h4>{rules.name}</h4>
          <div className="cs-line">
            {rules.sheetFields.map((f) => {
              const v = sheet.custom?.[f.id]
              return (
                <label key={f.id} className="sv-mini">{f.label}
                  {f.kind === 'check' ? <input type="checkbox" aria-label={f.label} disabled={!edit} checked={v === true} onChange={(e) => act({ [`custom.${f.id}`]: e.target.checked })} />
                    : f.kind === 'number' ? (edit ? <Num label={f.label} value={typeof v === 'number' ? v : 0} min={-9999} max={99999} width={64} onChange={(n) => act({ [`custom.${f.id}`]: n })} /> : <b>{typeof v === 'number' ? v : 0}</b>)
                    : (edit ? <Txt value={typeof v === 'string' ? v : ''} label={f.label} placeholder={f.label} onChange={(t) => act({ [`custom.${f.id}`]: t })} /> : <b>{typeof v === 'string' ? v : ''}</b>)}
                </label>
              )
            })}
          </div>
        </section>
      )}
      <section className="cs-gear" aria-label="Equipment" {...place('gear')}>
        <h4>Equipment</h4>
        <ul className="cs-items">
          {items.map((it, i) => (
            <li key={i}>
              {edit ? (
                <>
                  <input type="checkbox" aria-label={`${it.name || 'Item'} equipped`} title="Equipped" checked={it.equipped} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, equipped: e.target.checked } : x)))} />
                  <Num label={`Quantity of ${it.name || 'item'}`} value={it.qty} width={52} onChange={(n) => setItems(items.map((x, j) => (j === i ? { ...x, qty: n } : x)))} />
                  <LibraryInput value={it.name} label={`Item ${i + 1}`} placeholder="Item" categories={['item', 'magicitem']} onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, name: v } : x)))}
                    onPick={(p) => { const w = Number(p.entry?.data?.weight); setItems(items.map((x, j) => (j === i ? { ...x, name: p.name, ...(x.weight == null && w > 0 ? { weight: w } : {}), ...(!x.note && p.entry?.data?.requires_attunement ? { note: 'requires attunement' } : {}) } : x))) }} />
                  <Txt value={it.note} label={`Note on ${it.name || 'item'}`} placeholder="Note" onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, note: v } : x)))} />
                  <input type="number" className="sv-num" min={0} step="any" aria-label={`Weight of ${it.name || 'item'} in pounds`} title="Pounds, each" placeholder="lb" style={{ width: 56 }} value={it.weight ?? ''} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, weight: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) } : x)))} />
                  <label className="sv-mini" title="Charges: spent, and in all"><Num label={`Charges of ${it.name || 'item'}`} value={it.charges?.max ?? 0} width={44} onChange={(n) => setItems(items.map((x, j) => (j === i ? { ...x, charges: n > 0 ? { used: Math.min(x.charges?.used ?? 0, n), max: n } : undefined } : x)))} />charges</label>
                  {it.charges && it.charges.max > 0 && <Bubbles label={`${it.name || 'Item'} charge`} total={it.charges.max} used={it.charges.used} onChange={(n) => setItems(items.map((x, j) => (j === i ? { ...x, charges: { max: x.charges!.max, used: n } } : x)))} />}
                  <label className="sv-mini" title="Armor class this item adds while equipped"><Num label={`Armor class bonus of ${it.name || 'item'}`} value={it.acBonus ?? 0} min={-5} max={10} width={44} onChange={(n) => setItems(items.map((x, j) => (j === i ? { ...x, acBonus: n || undefined } : x)))} />AC</label>
                  <Txt value={it.in ?? ''} label={`Kept in, for ${it.name || 'item'}`} placeholder="In (bag)" onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, in: v || undefined } : x)))} />
                  <label className="sv-mini" title="What is kept in it weighs nothing, as in a bag of holding"><input type="checkbox" aria-label={`${it.name || 'Item'} holds weightlessly`} checked={!!it.weightless} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, weightless: e.target.checked || undefined } : x)))} />Holds</label>
                  <label className="sv-mini" title="Added to every saving throw while equipped"><Num label={`Saving throw bonus of ${it.name || 'item'}`} value={it.saveBonus ?? 0} min={-5} max={10} width={44} onChange={(n) => setItems(items.map((x, j) => (j === i ? { ...x, saveBonus: n || undefined } : x)))} />Saves</label>
                  <label className="sv-mini" title="Added to the spell attack and the spell save DC while equipped"><Num label={`Spell bonus of ${it.name || 'item'}`} value={it.spellBonus ?? 0} min={-5} max={10} width={44} onChange={(n) => setItems(items.map((x, j) => (j === i ? { ...x, spellBonus: n || undefined } : x)))} />Spells</label>
                  <label className="sv-mini" title="Attuned"><input type="checkbox" aria-label={`${it.name || 'Item'} attuned`} checked={!!it.attuned} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, attuned: e.target.checked } : x)))} />Attuned</label>
                  <button className="icon-btn" aria-label={`Remove ${it.name || 'item'}`} onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
                </>
              )   : <span>{it.qty > 1 ? `${it.qty} × ` : ''}<EntryLink name={it.name} categories={['magicitem', 'item']} />{it.in ? ` (in ${it.in})` : ''}{it.equipped ? ' (equipped)' : ''}{it.attuned ? ' (attuned)' : ''}{it.charges ? <small className="muted"> {it.charges.max - it.charges.used}/{it.charges.max} charges</small> : null}{it.weight ? <small className="muted"> {it.weight} lb</small> : null}{it.note ? <small className="muted"> {it.note}</small> : null}</span>}
            </li>
          ))}
        </ul>
        {items.length > 0 && (() => {
          const w = carriedWeight(items), load = loadOf(w, sheet.abilities.str), n = attunedCount(items)
          return (
            <>
            {items.some((i) => i.equipped && i.acBonus) && <p className="cs-load" aria-label="Armor class from items">Equipped items add {items.filter((i) => i.equipped).reduce((n, i) => n + (i.acBonus ?? 0), 0)} to armor class, for {sheet.ac.value + items.filter((i) => i.equipped).reduce((n, i) => n + (i.acBonus ?? 0), 0)} in all.</p>}
            <p className={`cs-load${load === 'light' && n <= MAX_ATTUNED ? '' : ' warn'}`} aria-label="Load">
              Carrying {w} of {capacityOf(sheet.abilities.str)} lb ({load}). Attuned to {n} of {MAX_ATTUNED}{n > MAX_ATTUNED ? ', more than a character can be' : ''}.
            </p>
            </>
          )
        })()}
        {edit && (
          <div className="cs-line">
            <LibraryInput value={adding} onChange={setAdding} label="New item" placeholder="Add an item: Longsword, Rope" categories={['item', 'magicitem']} onAdd={addItem} />
            <button className="btn sm" onClick={() => { if (adding.trim()) { addItem({ name: adding.trim() }); setAdding('') } }}><Plus size={12} /> Add</button>
          </div>
        )}
        <div className="cs-line cs-money">
          {(['pp', 'gp', 'ep', 'sp', 'cp'] as const).map((c) => (
            <label key={c} className="sv-mini">{c}{edit
              ? <Num label={`${c.toUpperCase()} coins`} value={sheet.currency?.[c] ?? 0} width={64} onChange={(n) => act({ [`currency.${c}`]: n })} />
              : <b>{sheet.currency?.[c] ?? 0}</b>}</label>
          ))}
        </div>
      </section>
    </div>
    </SheetLinksHost>
  )
}
