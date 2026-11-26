// The spells of a character sheet are kept as text, one line per group with a label before a colon: "Cantrips (3): Fire Bolt, Light",
// "Level 1: Magic Missile, Shield", "Prepared: Bless, Cure Wounds". The text stays what people type and what imports write; these pure
// functions read it as a spellbook by spell level and change it one spell at a time.

export interface BookSpell {
  name: string
  /** 0 for a cantrip, null when neither the label nor the library says */
  level: number | null
  /** the label of its line when that is not a level ("Prepared", "Spellbook", "Domain") */
  tag?: string
  /** where it is in the text, for removing it */
  line: number
}

const LABEL = /^([^:]{0,40}):\s*(.*)$/

/** The spell level a line's label names: "Cantrips (2)" is 0, "Level 3", "3rd level" and "3rd-level spells" are 3; null for any other. */
export function labelLevel(label: string): number | null {
  if (/cantrip/i.test(label)) return 0
  const m = /\blevel\s*(\d)\b|\b(\d)(?:st|nd|rd|th)?[- ]level\b/i.exec(label)
  return m ? Number(m[1] ?? m[2]) : null
}

const split = (list: string) => list.split(/\s*[,;]\s*/).map((x) => x.trim()).filter(Boolean)

/** Every spell named in the text. `levelOf` gives the level of a spell its line does not (from the library). */
export function readSpells(text: string, levelOf: (name: string) => number | null = () => null): BookSpell[] {
  const out: BookSpell[] = []
  String(text ?? '').split('\n').forEach((raw, line) => {
    const m = LABEL.exec(raw.trim())
    const label = m ? m[1].trim() : ''
    const byLabel = m ? labelLevel(label) : null
    for (const name of split(m ? m[2] : raw)) {
      const level = byLabel ?? levelOf(name)
      out.push({ name, level, line, ...(m && byLabel == null ? { tag: label } : {}) })
    }
  })
  return out
}

const labelFor = (level: number) => (level === 0 ? 'Cantrips' : `Level ${level}`)

/**
 * The text with a spell added: to the line of its level when there is one, else on a new line put after the lines of lower levels.
 * A spell already in the text is not added twice.
 */
export function addSpell(text: string, name: string, level: number | null): string {
  const n = name.trim()
  if (!n) return text
  const lines = text ? text.split('\n') : []
  if (readSpells(text).some((s) => s.name.toLowerCase() === n.toLowerCase())) return text
  if (level == null) return [...lines, n].join('\n')
  const at = lines.findIndex((l) => { const m = LABEL.exec(l.trim()); return !!m && labelLevel(m[1]) === level })
  if (at >= 0) {
    const m = LABEL.exec(lines[at].trim())!
    lines[at] = `${m[1].trim()}: ${[...split(m[2]), n].join(', ')}`
    return lines.join('\n')
  }
  // after the last line of a lower level, else before the first line of a higher one, else at the end
  let place = lines.length
  const levels = lines.map((l) => { const m = LABEL.exec(l.trim()); return m ? labelLevel(m[1]) : null })
  const lower = levels.map((v, i) => (v != null && v < level ? i : -1)).filter((i) => i >= 0).pop()
  if (lower != null) place = lower + 1
  else { const higher = levels.findIndex((v) => v != null && v > level); if (higher >= 0) place = higher }
  lines.splice(place, 0, `${labelFor(level)}: ${n}`)
  return lines.join('\n')
}

/** The text without one spell of one line; a line left with no spells goes too. */
export function removeSpell(text: string, line: number, name: string): string {
  const lines = text.split('\n')
  if (line < 0 || line >= lines.length) return text
  const m = LABEL.exec(lines[line].trim())
  const rest = split(m ? m[2] : lines[line]).filter((x) => x.toLowerCase() !== name.trim().toLowerCase())
  if (!rest.length) lines.splice(line, 1)
  else lines[line] = m ? `${m[1].trim()}: ${rest.join(', ')}` : rest.join(', ')
  return lines.join('\n')
}

/**
 * The slot a spell of this level is cast with: the lowest level at or above it with a slot left (index into the slots, 0 is level 1),
 * or -1 when none is left. Cantrips need none.
 */
export function slotFor(slots: { total: number; used: number }[], level: number): number {
  if (level < 1) return -1
  for (let i = level - 1; i < slots.length; i++) if (slots[i] && slots[i].used < slots[i].total) return i
  return -1
}
