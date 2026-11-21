import { SKILLS, type Feature, type Proficiency, type Sheet } from './sheet'

// A species or a background from the library (the 2024 rules have both with their traits and benefits) put on a character sheet:
// the name, the speed and size, the traits as features, the skills and tools, and the feat a background gives. Pure: returns a sheet patch.

const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n)
const plain = (t: unknown) => clip(t, 1800).replace(/\*\*?([^*]+)\*\*?/g, '$1')

export function speciesPatch(sheet: Sheet, data: any, name: string): Record<string, unknown> {
  const patch: Record<string, unknown> = { species: clip(name, 80) }
  const traits: any[] = Array.isArray(data?.traits) ? data.traits : []
  const speed = /(\d+)/.exec(String(traits.find((t) => t.type === 'SPEED')?.desc ?? ''))
  if (speed) patch['speed.walk'] = Math.min(1000, Number(speed[1]))
  const size = /^(tiny|small|medium|large|huge|gargantuan)/i.exec(String(traits.find((t) => t.type === 'SIZE')?.desc ?? '').trim())
  if (size) patch.size = size[1][0].toUpperCase() + size[1].slice(1).toLowerCase()
  const have = new Set((sheet.features?.traits ?? []).map((f) => f.name.toLowerCase()))
  const added: Feature[] = traits.filter((t) => t.type !== 'SPEED' && t.type !== 'SIZE' && t.name && !have.has(String(t.name).toLowerCase())).slice(0, 20).map((t) => ({ name: clip(t.name, 200), text: plain(t.desc) }))
  if (added.length) patch['features.traits'] = [...(sheet.features?.traits ?? []), ...added]
  return patch
}

export function backgroundPatch(sheet: Sheet, data: any, name: string): Record<string, unknown> {
  const patch: Record<string, unknown> = { background: clip(name, 80) }
  const benefits: any[] = Array.isArray(data?.benefits) ? data.benefits : []
  const of = (type: string) => benefits.find((b) => b.type === type)
  const skills = { ...(sheet.profs?.skills ?? {}) } as Record<string, Proficiency>
  for (const s of String(of('skill_proficiency')?.desc ?? '').toLowerCase().split(/,|\band\b/).map((x) => x.trim())) if (s in SKILLS && !skills[s]) skills[s] = 'p'
  if (Object.keys(skills).length) patch['profs.skills'] = skills
  const tool = clip(of('tool_proficiency')?.desc, 120)
  if (tool) { const had = sheet.profs?.tools ?? ''; if (!had.toLowerCase().includes(tool.toLowerCase())) patch['profs.tools'] = had ? `${had}, ${tool}` : tool }
  const traits = [...(sheet.features?.traits ?? [])]
  const feat = clip(of('feat')?.desc, 120)
  if (feat && !traits.some((f) => f.name.toLowerCase() === feat.toLowerCase())) traits.push({ name: feat, text: `A feat from the ${clip(name, 40)} background.` })
  const abilities = clip(of('ability_score')?.desc, 120)
  if (abilities && !traits.some((f) => f.name === `${name} ability scores`)) traits.push({ name: `${clip(name, 40)} ability scores`, text: `The background raises ${abilities}: add 2 to one and 1 to another, or 1 to each of three.` })
  if (traits.length !== (sheet.features?.traits ?? []).length) patch['features.traits'] = traits
  return patch
}
