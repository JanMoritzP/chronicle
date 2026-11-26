import { z } from 'zod'
import type { AuthUser } from './auth.js'
import { db } from './db.js'
import { extract, extractComments, extractTodos, type DocNode } from './doc.js'
import { pageDerived, type PageRow } from './pages.js'
import { playersOf } from './players.js'

/**
 * Who may see and change which page.
 *
 * A world member has a role: GM (sees and changes everything, secrets included), editor (writes) or viewer (reads).
 * A page or a folder can carry an access rule that changes this for everyone in the world or for single people:
 * `{ everyone?: level, people?: { [userId]: level } }` with level none, view or edit. A page without a rule follows the
 * nearest folder above it that has one; with none at all, the role decides. GMs are never limited by a rule, and the
 * people who play a character always reach its page.
 *
 * Secret boxes (callouts of kind "secret") are for GMs. A secret can name people who may read it as well (`reveal`).
 * Everyone else gets the page without them: in the page itself, its search text, outline, links, todos and comments.
 */

export type Level = 'none' | 'view' | 'edit'
export type MemberRole = 'gm' | 'editor' | 'viewer'
export interface AccessRule { everyone?: Level; people?: Record<string, Level> }

const level = z.enum(['none', 'view', 'edit'])
export const ruleSchema = z.object({
  everyone: level.optional(),
  people: z.record(z.string().max(64), level).optional(),
}).refine((r) => Object.keys(r.people ?? {}).length <= 200)


export function parseRule(raw: string | null | undefined): AccessRule | null {
  if (!raw) return null
  try {
    const r = ruleSchema.safeParse(JSON.parse(raw))
    if (!r.success) return null
    return r.data.everyone || Object.keys(r.data.people ?? {}).length ? r.data : null
  } catch { return null }
}

/** A rule as it is stored: null when it says nothing, so the page follows its folder again. */
export function storedRule(rule: AccessRule | null): string | null {
  if (!rule) return null
  const people = Object.fromEntries(Object.entries(rule.people ?? {}))
  const clean: AccessRule = { ...(rule.everyone ? { everyone: rule.everyone } : {}), ...(Object.keys(people).length ? { people } : {}) }
  return clean.everyone || clean.people ? JSON.stringify(clean) : null
}

/** The role of a member who has no rule in the way. */
const baseLevel = (role: MemberRole): Level => (role === 'viewer' ? 'view' : 'edit')

function levelUnder(rule: AccessRule | null, userId: string, role: MemberRole): Level {
  if (role === 'gm') return 'edit'
  if (!rule) return baseLevel(role)
  return rule.people?.[userId] ?? rule.everyone ?? baseLevel(role)
}

interface FolderRow { id: string; parent_id: string | null; access: string | null }

/** The rule a folder hands down: its own, or the nearest one above it. */
function folderRule(folders: Map<string, FolderRow>, folderId: string | null): { rule: AccessRule | null; from: string | null } {
  const seen = new Set<string>()
  let cur = folderId
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const f = folders.get(cur)
    if (!f) break
    const rule = parseRule(f.access)
    if (rule) return { rule, from: f.id }
    cur = f.parent_id
  }
  return { rule: null, from: null }
}

function foldersOf(ws: string): Map<string, FolderRow> {
  return new Map((db.prepare('SELECT id, parent_id, access FROM folders WHERE workspace_id = ?').all(ws) as FolderRow[]).map((f) => [f.id, f]))
}

interface PageAccessRow { id: string; folder_id: string | null; access: string | null; props: string }

function pageLevel(row: PageAccessRow, folders: Map<string, FolderRow>, userId: string, role: MemberRole): Level {
  if (role === 'gm') return 'edit'
  // the people who play a character always reach its page
  if (playersOf(row.props).includes(userId)) return 'edit'
  const own = parseRule(row.access)
  return levelUnder(own ?? folderRule(folders, row.folder_id).rule, userId, role)
}

/** Everything one person may see and change in one world, worked out once per request. */
export interface WorldAccess {
  userId: string
  role: MemberRole
  gm: boolean
  /** none for a page this person does not reach, or one that is not in the world */
  level(pageId: string): Level
  sees(pageId: string | null | undefined): boolean
  /** Folders are shown when this person reaches them, or a page somewhere inside them. */
  seesFolder(folderId: string): boolean
  folderLevel(folderId: string | null): Level
  /** The rule a page or a new page in this folder would follow, as text, so two places can be compared. */
  ruleKey(folderId: string | null): string
}

export function worldAccess(user: AuthUser, ws: string, role: MemberRole): WorldAccess {
  const gm = role === 'gm'
  const folders = foldersOf(ws)
  const pages = gm ? new Map<string, PageAccessRow>() : new Map((db.prepare('SELECT id, folder_id, access, props FROM pages WHERE workspace_id = ?').all(ws) as PageAccessRow[]).map((p) => [p.id, p]))
  const levels = new Map<string, Level>()
  const level = (id: string): Level => {
    if (gm) return 'edit'
    const hit = levels.get(id)
    if (hit) return hit
    const row = pages.get(id)
    const l = row ? pageLevel(row, folders, user.id, role) : 'none'
    levels.set(id, l)
    return l
  }
  const folderLevel = (folderId: string | null) => levelUnder(folderRule(folders, folderId).rule, user.id, role)
  let shownFolders: Set<string> | null = null
  const seesFolder = (folderId: string) => {
    if (gm) return true
    if (!shownFolders) {
      shownFolders = new Set()
      const mark = (id: string | null) => { const seen = new Set<string>(); while (id && !seen.has(id)) { seen.add(id); shownFolders!.add(id); id = folders.get(id)?.parent_id ?? null } }
      for (const f of folders.values()) if (folderLevel(f.id) !== 'none') mark(f.id)
      for (const p of pages.values()) if (p.folder_id && level(p.id) !== 'none') mark(p.folder_id)
    }
    return shownFolders.has(folderId)
  }
  return {
    userId: user.id, role, gm, level, folderLevel, seesFolder,
    sees: (id) => !id || level(id) !== 'none',
    ruleKey: (folderId) => JSON.stringify(folderRule(folders, folderId).rule),
  }
}

/** The level of one person on one page, without loading the whole world. */
export function levelOnPage(user: AuthUser, pageId: string, role: MemberRole): Level {
  if (role === 'gm') return 'edit'
  const row = db.prepare('SELECT id, folder_id, access, props, workspace_id FROM pages WHERE id = ?').get(pageId) as (PageAccessRow & { workspace_id: string }) | undefined
  if (!row) return 'none'
  return pageLevel(row, foldersOf(row.workspace_id), user.id, role)
}

/** What a GM is shown about where a page's rule comes from. */
export function ruleInfo(pageId: string) {
  const row = db.prepare('SELECT folder_id, access, workspace_id FROM pages WHERE id = ?').get(pageId) as { folder_id: string | null; access: string | null; workspace_id: string } | undefined
  if (!row) return null
  const inherited = folderRule(foldersOf(row.workspace_id), row.folder_id)
  return { rule: parseRule(row.access), inherited: inherited.rule, inheritedFrom: inherited.from }
}

// ---------- secrets ----------

export const isSecret = (n: DocNode) => n.type === 'callout' && n.attrs?.kind === 'secret'

/** Can this person read this secret box? */
export function readsSecret(n: DocNode, userId: string, gm: boolean): boolean {
  if (gm) return true
  const reveal = n.attrs?.reveal
  return Array.isArray(reveal) && reveal.includes(userId)
}

/** Cheap test on stored text before a document is parsed: no secret box, nothing to hide. */
export const mayHoldSecret = (content: string) => content.includes('"secret"')

/** True when the document holds a secret this person may not read. */
export function hidesSecretFrom(doc: DocNode, userId: string, gm: boolean): boolean {
  if (gm) return false
  const walk = (n: DocNode): boolean => (isSecret(n) && !readsSecret(n, userId, gm)) || (n.content ?? []).some(walk)
  return walk(doc)
}

/** The document without the secrets this person may not read. An emptied container keeps a blank paragraph so the document stays valid. */
export function withoutSecrets(doc: DocNode, userId: string, gm: boolean): DocNode {
  if (gm) return doc
  const walk = (n: DocNode): DocNode[] => {
    if (isSecret(n) && !readsSecret(n, userId, gm)) return []
    if (!n.content) return [n]
    const content = n.content.flatMap(walk)
    if (!content.length && n.content.length) return n.type === 'doc' || n.type === 'paragraph' || n.type === 'heading' ? [{ ...n, content: n.type === 'doc' ? [{ type: 'paragraph' }] : undefined }] : [{ ...n, content: [{ type: 'paragraph' }] }]
    return [{ ...n, content }]
  }
  return walk(doc)[0] ?? { type: 'doc', content: [{ type: 'paragraph' }] }
}

export interface PageLike { id: string; content: string; text: string; outline: string; props: string }

/**
 * A page as this person may read it: its document and everything derived from it. Null when nothing has to be hidden,
 * so the stored values can be used as they are.
 */
export function readerView(p: PageLike, userId: string, gm: boolean) {
  if (gm || !mayHoldSecret(p.content)) return null
  const doc = JSON.parse(p.content) as DocNode
  if (!hidesSecretFrom(doc, userId, gm)) return null
  const visible = withoutSecrets(doc, userId, gm)
  const ex = extract(visible)
  return {
    doc: visible,
    text: ex.text,
    outline: ex.outline,
    wordCount: ex.wordCount,
    hasStats: ex.hasStats,
    firstImage: ex.firstImage,
    /** links that are still in the text once the secrets are gone, keyed the way linkKey keys a link row */
    links: new Set(ex.links.map((l) => linkKey(l.targetName, l.anchor, l.embed, l.libKey))),
    todos: new Set(extractTodos(visible).map((t) => t.id)),
    comments: new Set(extractComments(visible).map((c) => c.id)),
  }
}

export const linkKey = (name: string, anchor: string | null, embed: boolean | number, libKey: string | null) => `${name.toLowerCase()}\u0000${anchor ?? ''}\u0000${embed ? 1 : 0}\u0000${libKey ?? ''}`


/** Link rows of a page as this person may see them: none into pages they do not reach, none that only sit in a secret kept from them. */
export function visibleLinks<T extends { targetId: string | null; targetName: string; anchor: string | null; embed: number | boolean; libKey: string | null }>(rows: T[], a: { sees: (id: string | null | undefined) => boolean }, view: ReturnType<typeof readerView>): T[] {
  return rows.filter((l) => a.sees(l.targetId) && (!view || view.links.has(linkKey(l.targetName, l.anchor, l.embed, l.libKey))))
}

/** What pageDerived says about a page, as this person may see it; null when they do not reach the page. */
export function derivedFor(pageId: string, user: AuthUser, role: MemberRole, a?: WorldAccess) {
  const p = db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId) as PageRow | undefined
  if (!p) return null
  const d = pageDerived(pageId)
  if (role === 'gm') return d
  const access = a ?? worldAccess(user, p.workspace_id, role)
  if (!access.sees(pageId)) return null
  const view = readerView(p, user.id, false)
  const links = visibleLinks(d.links as LinkRow[], access, view)
  if (!view) return { ...d, links }
  const props = JSON.parse(p.props)
  const todos = (db.prepare('SELECT todo_id AS id FROM todos WHERE page_id = ? AND done = 0').all(pageId) as { id: string }[]).filter((t) => view.todos.has(t.id)).length
  return { ...d, links, todos, outline: view.outline, text: view.text.slice(0, 4000), wordCount: view.wordCount, hasStats: view.hasStats, portrait: props?.portrait ? String(props.portrait) : view.firstImage }
}

export interface LinkRow { sourceId: string; targetId: string | null; targetName: string; anchor: string | null; embed: number; libKey: string | null }

/** For lists of todos and comments across a world: keeps those on pages this person reaches and outside the secrets kept from them. */
export function itemFilter(a: WorldAccess) {
  const views = new Map<string, ReturnType<typeof readerView>>()
  return (pageId: string, id: string, kind: 'todos' | 'comments') => {
    if (a.gm) return true
    if (!a.sees(pageId)) return false
    if (!views.has(pageId)) {
      const p = db.prepare('SELECT id, content, text, outline, props FROM pages WHERE id = ?').get(pageId) as PageLike | undefined
      views.set(pageId, p ? readerView(p, a.userId, false) : null)
    }
    const v = views.get(pageId)
    return !v || v[kind].has(id)
  }
}

/** A secret written by someone who is not a GM names them, so it does not lock them out of their own page. Mutates and returns the doc. */
export function revealToWriter(doc: DocNode, userId: string): DocNode {
  const walk = (n: DocNode) => {
    if (isSecret(n)) {
      const reveal = Array.isArray(n.attrs?.reveal) ? n.attrs!.reveal as string[] : []
      if (!reveal.includes(userId)) n.attrs = { ...n.attrs, reveal: [...reveal, userId] }
    }
    for (const c of n.content ?? []) walk(c)
  }
  walk(doc)
  return doc
}
