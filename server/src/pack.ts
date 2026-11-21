import { z } from 'zod'

// A system pack: what a rules system adds to the table, in one file people can share. It builds on one of the engines the app has (the 2014 or
// 2024 rules of 5e, or Pathfinder 2e), which keep deciding how rolls, difficulty and the sheets work, and changes what is shown and offered:
// the names of the abilities, the conditions, the damage types, how initiative is rolled, the grid, and content that comes with it
// (roll tables, card decks, macros). Pure: parsing and exporting, tested without a server.

export const PACK_FORMAT = 'chronicle-system'
const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
const word = z.string().trim().min(1).max(30)

export const packSchema = z.object({
  format: z.literal(PACK_FORMAT),
  v: z.literal(1),
  /** a short name for the pack in the world: letters, digits and dashes */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
  name: z.string().trim().min(1).max(60),
  version: z.string().trim().max(20).optional(),
  author: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  /** the engine the pack builds on */
  base: z.enum(['5e', '5e-2024', 'pf2e']),
  abilities: z.object(Object.fromEntries(ABILITY_KEYS.map((k) => [k, z.object({ name: word, short: z.string().trim().min(1).max(5) }).optional()])) as Record<(typeof ABILITY_KEYS)[number], z.ZodOptional<z.ZodObject<{ name: z.ZodString; short: z.ZodString }>>>).strict().optional(),
  conditions: z.array(word).max(60).optional(),
  damageTypes: z.array(word).max(40).optional(),
  /** how a token without a sheet rolls initiative, as dice: 1d20, 1d10, 2d6 */
  initiative: z.string().regex(/^\d{0,2}d\d{1,3}([+-]\d{1,3})?$/i).optional(),
  grid: z.object({ unit: z.string().trim().min(1).max(8), dist: z.number().min(0.1).max(1000), type: z.enum(['square', 'hex-row', 'hex-col', 'none']) }).optional(),
  content: z.object({
    rollTables: z.array(z.object({ name: z.string().trim().min(1).max(60), entries: z.string().max(20000), secret: z.boolean().optional() })).max(30).optional(),
    decks: z.array(z.object({ name: z.string().trim().min(1).max(60), cards: z.string().max(20000) })).max(20).optional(),
    macros: z.array(z.object({ name: z.string().trim().min(1).max(60), text: z.string().min(1).max(2000) })).max(30).optional(),
  }).strict().optional(),
}).strict()
export type Pack = z.infer<typeof packSchema>

/** The pack in a file, or an error sentence for the person importing it. Unknown fields are refused so a mistake in a name does not pass silently. */
export function parsePack(raw: unknown): { pack: Pack } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'That is not a system pack.' }
  if ((raw as { format?: unknown }).format !== PACK_FORMAT) return { error: 'That file is not a Chronicle system pack.' }
  const r = packSchema.safeParse(raw)
  if (r.success) return { pack: r.data }
  const issue = r.error.issues[0]
  return { error: `The pack is not valid: ${issue.path.join('.') || 'the file'} ${issue.message.toLowerCase()}.` }
}

/** How many things of each kind a pack brings with it. */
export const contentCounts = (p: Pack) => ({ rollTables: p.content?.rollTables?.length ?? 0, decks: p.content?.decks?.length ?? 0, macros: p.content?.macros?.length ?? 0 })

/** The damage types a pack names, lower case (resistance is matched against these), or null to use the engine's own list. */
export const packDamageTypes = (p: Pack | null | undefined): string[] | null => (p?.damageTypes?.length ? p.damageTypes.map((t) => t.toLowerCase()) : null)
