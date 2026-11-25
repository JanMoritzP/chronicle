import { db } from './db.js'

// Who plays which character. A page can name the accounts that play it (`props.players`). Those people may change that
// page's text and sheet even when the world is read-only for them, and at the table they move the tokens of that character.

/** The accounts named as players of a page, from its stored props. */
export function playersOf(props: unknown): string[] {
  const p = (typeof props === 'string' ? safeParse(props) : props) as { players?: unknown } | null
  return Array.isArray(p?.players) ? p.players.filter((x): x is string => typeof x === 'string') : []
}

const safeParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }

/** Does this account play this page? */
export function playsPage(userId: string, pageId: string): boolean {
  const row = db.prepare('SELECT props FROM pages WHERE id = ? AND deleted_at IS NULL').get(pageId) as { props: string } | undefined
  return !!row && playersOf(row.props).includes(userId)
}

/** Does this account play anything in the world: a character page, or a token it moves? */
export function playsInWorld(wsId: string, userId: string): boolean {
  const token = db.prepare(`SELECT 1 FROM tokens t WHERE t.workspace_id = ? AND json_valid(t.owners) AND EXISTS (SELECT 1 FROM json_each(t.owners) WHERE value = ?) LIMIT 1`).get(wsId, userId)
  if (token) return true
  return !!db.prepare(`SELECT 1 FROM pages p WHERE p.workspace_id = ? AND p.deleted_at IS NULL AND json_valid(p.props) AND EXISTS (SELECT 1 FROM json_each(p.props, '$.players') WHERE value = ?) LIMIT 1`).get(wsId, userId)
}

/** The accounts that may be named as players of a world's pages: its members (owners need no naming, they reach everything). */
export function memberIds(wsId: string): Set<string> {
  return new Set((db.prepare('SELECT user_id AS id FROM workspace_members WHERE workspace_id = ?').all(wsId) as { id: string }[]).map((r) => r.id))
}
