import { Heart, Moon, Plus, Shield, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  ABILITIES, PF_SKILLS, RANK_NAMES, patchSheetLocal, pfAc, pfClassDc, pfDerived, pfLore, pfPerception, pfRestPatch, pfSave, pfSkill, pfSpellAttack, pfSpellDc, pfStrike,
  multipleAttack, signed, type Ability, type InventoryItem, type Pf2eChar, type Pf2eStrike, type Rank, type Sheet,
} from '../lib/sheet'
import { Bubbles, Num, Txt } from './CharacterSheet'
import { FeatureList } from './Pf2eSheet'
import { Select } from './Select'
import type { SheetPatch } from './SheetView'

// A Pathfinder 2e player character. Everything that follows from level, ranks and modifiers is worked out here and written back
// with each edit (perception, saves, armor class), so the table and the initiative never disagree with the sheet.

const ABILITY_NAME: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' }
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())
const RANK_LETTER = ['U', 'T', 'E', 'M', 'L'] as const
const nextRank = (r: Rank): Rank => ((r + 1) % 5) as Rank

export type RollFn = (expr: string, label: string) => void

function RankButton({ rank, onChange, label, disabled }: { rank: Rank; onChange: (r: Rank) => void; label: string; disabled?: boolean }) {
  return <button className={`pc-rank r${rank}`} disabled={disabled} aria-label={`${label}: ${RANK_NAMES[rank]}`} title={`${RANK_NAMES[rank]}. Click to change.`} onClick={() => onChange(nextRank(rank))}>{RANK_LETTER[rank]}</button>
}

export function Pf2eCharacterSheet({ sheet, set, roll }: { sheet: Sheet; set?: (patch: SheetPatch) => void; roll?: RollFn }) {
  const p = sheet.pf2e!
  const c = p.char!
  const edit = !!set
  const [adding, setAdding] = useState('')
  const level = p.level
  const bonus = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n)}`
  const check = (n: number, label: string) => roll?.(`1d20${bonus(n)}`, label)
  /** One edit, plus the numbers that follow from it. */
  const act = (patch: SheetPatch) => {
    if (!set) return
    const next = patchSheetLocal(sheet, patch)
    set({ ...patch, ...pfDerived(next) })
  }
  const setChar = (patch: Partial<Pf2eChar>) => act({ 'pf2e.char': { ...c, ...patch } })
  const cur = sheet.hp.current ?? sheet.hp.max
  const ratio = sheet.hp.max ? Math.max(0, Math.min(1, cur / sheet.hp.max)) : 0
  const slots = sheet.spellcasting?.slots ?? []
  const items = sheet.inventory ?? []
  const setItems = (list: InventoryItem[]) => act({ inventory: list })
  const setStrike = (i: number, patch: Partial<Pf2eStrike>) => setChar({ strikes: c.strikes.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const spellDc = pfSpellDc(sheet), spellAtk = pfSpellAttack(sheet), classDc = pfClassDc(sheet)

  return (
    <div className="cs pc" aria-label="Pathfinder character sheet">
      <header className="cs-head">
        {edit ? <input className="cs-name" aria-label="Character name" placeholder="Character name" value={sheet.name} onChange={(e) => act({ name: e.target.value })} /> : <h2 className="cs-name">{sheet.name || 'Unnamed'}</h2>}
        <div className="cs-line">
          {edit ? (
            <>
              <Txt value={c.ancestry} label="Ancestry" placeholder="Ancestry" onChange={(v) => setChar({ ancestry: v })} />
              <Txt value={c.heritage} label="Heritage" placeholder="Heritage" onChange={(v) => setChar({ heritage: v })} />
              <Txt value={c.background} label="Background" placeholder="Background" onChange={(v) => setChar({ background: v })} />
              <Txt value={c.className} label="Class" placeholder="Class" onChange={(v) => setChar({ className: v })} />
            </>
          ) : <span className="muted">{[c.ancestry, c.heritage, c.background, c.className].filter(Boolean).join(' · ')}</span>}
        </div>
        <div className="cs-line cs-facts">
          <label className="sv-mini">Level<Num label="Level" value={level} min={1} max={20} width={52} onChange={(n) => act({ 'pf2e.level': Math.min(20, Math.max(1, n)) })} /></label>
          <label className="sv-mini">XP<Num label="Experience points" value={sheet.xp} width={72} onChange={(n) => act({ xp: n })} /></label>
          <span className="sv-mini">Hero points <Bubbles label="Hero points" total={3} used={c.heroPoints} onChange={(n) => edit && setChar({ heroPoints: n })} /></span>
          {edit && <button className="btn sm" title="Constitution times level hit points, and spells back" onClick={() => act(pfRestPatch(sheet))}><Moon size={12} /> Rest</button>}
        </div>
      </header>

      <section className="cs-combat" aria-label="Defences">
        <div className="cs-box"><Shield size={14} /><b>Armor class</b><span className="cs-big" aria-label="Armor class">{pfAc(sheet)}</span></div>
        <div className="cs-box"><b>Armor</b>
          {edit ? (
            <span className="cs-hpfields">
              <Txt value={c.armor.name} label="Armor name" placeholder="Leather" onChange={(v) => setChar({ armor: { ...c.armor, name: v } })} />
              <label className="sv-mini">bonus<Num label="Armor bonus" value={c.armor.bonus} max={20} width={44} onChange={(n) => setChar({ armor: { ...c.armor, bonus: n } })} /></label>
              <label className="sv-mini">Dex cap<Num label="Dexterity cap" value={c.armor.dexCap ?? undefined} max={10} width={44} onChange={(n) => setChar({ armor: { ...c.armor, dexCap: n } })} /></label>
              <label className="sv-mini">other<Num label="Other armor class bonus" value={c.acExtra} min={-10} max={20} width={44} onChange={(n) => setChar({ acExtra: n })} /></label>
              <span className="sv-mini">proficiency <RankButton rank={c.ranks.armor} label="Armor proficiency" onChange={(r) => setChar({ ranks: { ...c.ranks, armor: r } })} /></span>
            </span>
          ) : <span>{c.armor.name || 'None'} (+{c.armor.bonus})</span>}
        </div>
        <div className="cs-box cs-hp">
          <Heart size={14} /><b>Hit points</b>
          <div className="tt-hpbar" aria-hidden><span style={{ width: `${ratio * 100}%`, background: ratio > 0.5 ? '#4caf50' : ratio > 0.25 ? '#f1c40f' : '#e74c3c' }} /></div>
          {edit ? (
            <span className="cs-hpfields">
              <Num label="Current hit points" value={cur} min={-999} width={56} onChange={(n) => act({ 'hp.current': Math.min(n, sheet.hp.max) })} />/
              <Num label="Maximum hit points" value={sheet.hp.max} width={56} onChange={(n) => act({ 'hp.max': n })} />
              <label className="sv-mini">temp<Num label="Temporary hit points" value={sheet.hp.temp ?? 0} width={48} onChange={(n) => act({ 'hp.temp': n })} /></label>
            </span>
          ) : <span>{cur} / {sheet.hp.max}{sheet.hp.temp ? ` (+${sheet.hp.temp})` : ''}</span>}
          <span className="cs-ds">Dying <Bubbles label="Dying" total={4} used={c.dying} onChange={(n) => edit && setChar({ dying: n })} /></span>
          <span className="cs-ds">Wounded <Bubbles label="Wounded" total={3} used={c.wounded} onChange={(n) => edit && setChar({ wounded: n })} /></span>
        </div>
        <div className="cs-box"><b>Speed</b>{edit ? <Num label="Speed" value={sheet.speed.walk} width={60} onChange={(n) => act({ 'speed.walk': n })} /> : <span>{sheet.speed.walk ?? 0} ft.</span>}</div>
        <div className="cs-box" role="group" aria-label="Perception"><b>Perception</b><span><button className="cs-save" disabled={!roll} aria-label={`Perception ${signed(pfPerception(sheet))}`} onClick={() => check(pfPerception(sheet), 'Perception')}>{signed(pfPerception(sheet))}</button> <RankButton rank={c.ranks.perception} label="Perception proficiency" disabled={!edit} onChange={(r) => setChar({ ranks: { ...c.ranks, perception: r } })} /></span></div>
        {(['fort', 'ref', 'will'] as const).map((k) => (
          <div key={k} className="cs-box" role="group" aria-label={k === 'fort' ? 'Fortitude' : k === 'ref' ? 'Reflex' : 'Will'}>
            <b>{k === 'fort' ? 'Fortitude' : k === 'ref' ? 'Reflex' : 'Will'}</b>
            <span><button className="cs-save" disabled={!roll} onClick={() => check(pfSave(sheet, k), `${k === 'fort' ? 'Fortitude' : k === 'ref' ? 'Reflex' : 'Will'} save`)}>{signed(pfSave(sheet, k))}</button> <RankButton rank={c.ranks[k]} label={`${k} proficiency`} disabled={!edit} onChange={(r) => setChar({ ranks: { ...c.ranks, [k]: r } })} /></span>
          </div>
        ))}
      </section>

      <section className="cs-abilities" aria-label="Ability modifiers">
        {ABILITIES.map((a) => (
          <div key={a} className="cs-ability"><b>{a.toUpperCase()}</b>
            {edit ? <Num label={`${ABILITY_NAME[a]} modifier`} value={p.mods[a]} min={-5} max={10} width={52} onChange={(n) => act({ [`pf2e.mods.${a}`]: n })} /> : <span className="cs-mod">{signed(p.mods[a])}</span>}
            {edit && <span className="cs-mod">{signed(p.mods[a])}</span>}
            {c.keyAbility === a && <small className="muted">key</small>}
          </div>
        ))}
        {edit && (
          <div className="cs-ability"><b>Key</b>
            <Select className="input" style={{ width: 'auto' }} value={c.keyAbility} onChange={(v) => setChar({ keyAbility: v as Ability | '' })}>
              <option value="">None</option>{ABILITIES.map((a) => <option key={a} value={a}>{ABILITY_NAME[a]}</option>)}
            </Select>
          </div>
        )}
      </section>
      {classDc != null && <div className="cs-line"><span><b>Class DC</b> {classDc}</span>{edit && <span className="sv-mini">proficiency <RankButton rank={c.ranks.classDc} label="Class DC proficiency" onChange={(r) => setChar({ ranks: { ...c.ranks, classDc: r } })} /></span>}</div>}

      <section className="cs-skills" aria-label="Skills">
        <h4>Skills <small className="muted">{edit ? 'click the letter to change the rank: untrained, trained, expert, master, legendary' : ''}</small></h4>
        <div className="cs-skillgrid">
          {Object.keys(PF_SKILLS).map((k) => (
            <div key={k} className="cs-skill">
              <RankButton rank={c.ranks.skills[k] ?? 0} label={`${title(k)} proficiency`} disabled={!edit} onChange={(r) => { const skills = { ...c.ranks.skills }; if (r) skills[k] = r; else delete skills[k]; setChar({ ranks: { ...c.ranks, skills } }) }} />
              <button className="cs-skill-roll" disabled={!roll} aria-label={`${title(k)} ${signed(pfSkill(sheet, k))}`} onClick={() => check(pfSkill(sheet, k), `${title(k)} check`)}><span className="grow">{title(k)} <small className="muted">{PF_SKILLS[k].toUpperCase()}</small></span><b>{signed(pfSkill(sheet, k))}</b></button>
            </div>
          ))}
          {c.lores.map((l, i) => (
            <div key={`l${i}`} className="cs-skill">
              <RankButton rank={l.rank} label={`${l.name || 'Lore'} proficiency`} disabled={!edit} onChange={(r) => setChar({ lores: c.lores.map((x, j) => (j === i ? { ...x, rank: r } : x)) })} />
              {edit ? <Txt value={l.name} label={`Lore ${i + 1}`} placeholder="Lore" onChange={(v) => setChar({ lores: c.lores.map((x, j) => (j === i ? { ...x, name: v } : x)) })} /> : <span className="grow">{l.name} Lore</span>}
              <b>{signed(pfLore(sheet, l.rank))}</b>
              {edit && <button className="icon-btn" aria-label={`Remove lore ${i + 1}`} onClick={() => setChar({ lores: c.lores.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>}
            </div>
          ))}
        </div>
        {edit && c.lores.length < 20 && <button className="btn sm" onClick={() => setChar({ lores: [...c.lores, { name: '', rank: 1 }] })}><Plus size={12} /> Lore</button>}
      </section>

      <section className="cs-features" aria-label="Strikes">
        <h4>Strikes</h4>
        {c.strikes.map((s, i) => (
          <div key={i} className="pc-strike">
            {edit ? (
              <div className="sv-feature-head">
                <Txt value={s.name} label={`Strike ${i + 1}`} placeholder="Longsword" onChange={(v) => setStrike(i, { name: v })} />
                <Select className="input" style={{ width: 'auto' }} value={s.ability} onChange={(v) => setStrike(i, { ability: v as 'str' | 'dex' })}><option value="str">Strength</option><option value="dex">Dexterity</option></Select>
                <RankButton rank={s.rank} label={`${s.name || 'Strike'} proficiency`} onChange={(r) => setStrike(i, { rank: r })} />
                <label className="sv-mini">item<Num label={`${s.name || 'Strike'} item bonus`} value={s.item} max={10} width={44} onChange={(n) => setStrike(i, { item: n })} /></label>
                <Txt value={s.damage} label={`${s.name || 'Strike'} damage`} placeholder="1d8+4 slashing" onChange={(v) => setStrike(i, { damage: v })} />
                <label className="sv-mini"><input type="checkbox" checked={s.agile} onChange={(e) => setStrike(i, { agile: e.target.checked })} />agile</label>
                <button className="icon-btn" aria-label={`Remove ${s.name || 'strike'}`} onClick={() => setChar({ strikes: c.strikes.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
              </div>
            ) : null}
            <div className="tt-chips" role="group" aria-label={`${s.name || 'Strike'} attacks`}>
              <b>{s.name || 'Strike'}</b>
              {multipleAttack(pfStrike(sheet, s), s.agile).map((n, j) => <button key={j} className="tt-roll" disabled={!roll} onClick={() => check(n, `${s.name}, attack${j ? ` ${j + 1}` : ''}`)}>{signed(n)}</button>)}
              {s.damage && <span className="muted">{s.damage}</span>}
            </div>
          </div>
        ))}
        {edit && <button className="btn sm" onClick={() => setChar({ strikes: [...c.strikes, { name: '', ability: 'str', rank: 1, item: 0, damage: '', agile: false, note: '' }] })}><Plus size={12} /> Strike</button>}
      </section>

      <section className="cs-spells" aria-label="Spellcasting">
        <h4>Spellcasting</h4>
        <div className="cs-line">
          {edit ? (
            <>
              <Txt value={c.tradition} label="Tradition" placeholder="Tradition" onChange={(v) => setChar({ tradition: v })} />
              <label className="sv-mini">Ability
                <Select className="input" style={{ width: 'auto' }} value={c.spellAbility} onChange={(v) => setChar({ spellAbility: v as Ability | '' })}><option value="">None</option>{ABILITIES.map((a) => <option key={a} value={a}>{ABILITY_NAME[a]}</option>)}</Select>
              </label>
              <span className="sv-mini">proficiency <RankButton rank={c.ranks.spell} label="Spell proficiency" onChange={(r) => setChar({ ranks: { ...c.ranks, spell: r } })} /></span>
            </>
          ) : c.tradition ? <span className="muted">{title(c.tradition)}</span> : null}
          {spellDc != null && <><span><b>Spell DC</b> {spellDc}</span><button className="cs-roll" disabled={!roll} onClick={() => check(spellAtk!, 'Spell attack')}>Attack {signed(spellAtk!)}</button></>}
          <span className="sv-mini">Focus <Bubbles label="Focus points" total={c.focus.max} used={c.focus.max - c.focus.current} onChange={(n) => edit && setChar({ focus: { ...c.focus, current: c.focus.max - n } })} />
            {edit && <Num label="Focus points maximum" value={c.focus.max} max={3} width={44} onChange={(n) => setChar({ focus: { max: n, current: Math.min(c.focus.current, n) } })} />}</span>
        </div>
        {(c.spellAbility || slots.length > 0) && (
          <div className="cs-slots">
            {Array.from({ length: 10 }, (_, i) => slots[i] ?? { total: 0, used: 0 }).map((sl, i) => (edit || sl.total > 0) && (
              <div key={i} className="cs-slot"><b>Rank {i + 1}</b>
                <Bubbles label={`Rank ${i + 1} spell slots used`} total={sl.total} used={sl.used} onChange={(n) => edit && act({ 'spellcasting.slots': Array.from({ length: Math.max(slots.length, i + 1) }, (_, j) => (j === i ? { ...sl, used: n } : slots[j] ?? { total: 0, used: 0 })) })} />
                {edit && <Num label={`Rank ${i + 1} spell slots`} value={sl.total} max={20} width={44} onChange={(n) => act({ 'spellcasting.slots': Array.from({ length: Math.max(slots.length, i + 1) }, (_, j) => (j === i ? { total: n, used: Math.min(sl.used, n) } : slots[j] ?? { total: 0, used: 0 })) })} />}
              </div>
            ))}
          </div>
        )}
        {edit ? <textarea className="sv-area" aria-label="Spells" rows={3} placeholder="Cantrips and spells in your repertoire or spellbook" value={sheet.spells ?? ''} onChange={(e) => act({ spells: e.target.value })} />
          : sheet.spells ? <p className="cs-notes">{sheet.spells}</p> : null}
      </section>

      <section className="cs-features" aria-label="Feats and abilities">
        <h4>Feats and abilities</h4>
        {edit ? <FeatureList group="traits" list={sheet.features.traits} set={(list) => act({ 'features.traits': list })} />
          : sheet.features.traits.map((f, i) => <p key={i}><b><i>{f.name}.</i></b> {f.text}</p>)}
        <h4>Actions</h4>
        {edit ? <FeatureList group="actions" list={sheet.features.actions} set={(list) => act({ 'features.actions': list })} />
          : sheet.features.actions.map((f, i) => <p key={i}><b><i>{f.name}.</i></b> {f.text}</p>)}
      </section>

      <section className="cs-gear" aria-label="Equipment">
        <h4>Equipment</h4>
        <ul className="cs-items">
          {items.map((it, i) => (
            <li key={i}>
              {edit ? (
                <>
                  <input type="checkbox" aria-label={`${it.name || 'Item'} worn or held`} title="Worn or held" checked={it.equipped} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, equipped: e.target.checked } : x)))} />
                  <Num label={`Quantity of ${it.name || 'item'}`} value={it.qty} width={52} onChange={(n) => setItems(items.map((x, j) => (j === i ? { ...x, qty: n } : x)))} />
                  <Txt value={it.name} label={`Item ${i + 1}`} placeholder="Item" onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
                  <Txt value={it.note} label={`Bulk or note on ${it.name || 'item'}`} placeholder="Bulk" onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, note: v } : x)))} />
                  <button className="icon-btn" aria-label={`Remove ${it.name || 'item'}`} onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
                </>
              ) : <span>{it.qty > 1 ? `${it.qty} × ` : ''}{it.name}{it.equipped ? ' (worn)' : ''}{it.note ? <small className="muted"> {it.note}</small> : null}</span>}
            </li>
          ))}
        </ul>
        {edit && (
          <div className="cs-line">
            <input className="sv-text" aria-label="New item" placeholder="Add an item" value={adding} onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && adding.trim()) { setItems([...items, { name: adding.trim(), qty: 1, equipped: false, note: '' }]); setAdding('') } }} />
            <button className="btn sm" onClick={() => { if (adding.trim()) { setItems([...items, { name: adding.trim(), qty: 1, equipped: false, note: '' }]); setAdding('') } }}><Plus size={12} /> Add</button>
          </div>
        )}
        <div className="cs-line cs-money">
          {(['pp', 'gp', 'sp', 'cp'] as const).map((k) => (
            <label key={k} className="sv-mini">{k}{edit ? <Num label={`${k.toUpperCase()} coins`} value={sheet.currency?.[k] ?? 0} width={64} onChange={(n) => act({ [`currency.${k}`]: n })} /> : <b>{sheet.currency?.[k] ?? 0}</b>}</label>
          ))}
        </div>
      </section>
    </div>
  )
}
