import crypto from 'node:crypto'
import { db, now } from './db.js'
import { ensureHeadingIds, extract, extractTodos, statblockRefs, type DocNode } from './doc.js'
import { dataRefs, propsStatData, type Ref } from './refs.js'

export const uid = () => crypto.randomUUID()

const VERSION_GAP_MS = 5 * 60_000

export interface PageRow {
  id: string; workspace_id: string; folder_id: string | null; title: string; icon: string | null
  aliases: string; content: string; text: string; outline: string; props: string
  word_count: number; has_stats: number; source_zettel_id: string | null
  created_at: number; updated_at: number; deleted_at: number | null
}

export function resolveTarget(workspaceId: string, name: string): string | null {
  const lower = name.trim().toLowerCase()
  if (!lower) return null
  const rows = db.prepare('SELECT id, title, aliases FROM pages WHERE workspace_id = ? AND deleted_at IS NULL').all(workspaceId) as
    { id: string; title: string; aliases: string }[]
  const byTitle = rows.find((r) => r.title.trim().toLowerCase() === lower)
  if (byTitle) return byTitle.id
  for (const r of rows) {
    try {
      if ((JSON.parse(r.aliases) as string[]).some((a) => a.trim().toLowerCase() === lower)) return r.id
    } catch { /* ignore malformed aliases */ }
  }
  return null
}

/** Rebuilds the todo index of one page. Keeps created/done timestamps of todos that were already known. */
export function reindexTodos(pageId: string, workspaceId: string, doc: DocNode) {
  const old = new Map((db.prepare('SELECT todo_id, done, created_at, done_at FROM todos WHERE page_id = ?').all(pageId) as
    { todo_id: string; done: number; created_at: number; done_at: number | null }[]).map((r) => [r.todo_id, r]))
  db.prepare('DELETE FROM todos WHERE page_id = ?').run(pageId)
  const ins = db.prepare('INSERT INTO todos(page_id,todo_id,workspace_id,message,done,context,pos,created_at,done_at) VALUES(?,?,?,?,?,?,?,?,?)')
  extractTodos(doc).forEach((t, i) => {
    const o = old.get(t.id)
    const done = t.done ? 1 : 0
    ins.run(pageId, t.id, workspaceId, t.message, done, t.context, i, o?.created_at ?? now(), done ? (o?.done ? o.done_at : now()) : null)
  })
}

export function todosOf(pageId: string) {
  return db.prepare(
    `SELECT page_id AS pageId, todo_id AS id, message, done, context, created_at AS createdAt, done_at AS doneAt
     FROM todos WHERE page_id = ? ORDER BY pos`,
  ).all(pageId).map((r: any) => ({ ...r, done: !!r.done }))
}

export function portraitOf(p: PageRow, props: any = JSON.parse(p.props)): string | null {
  if (props?.portrait) return String(props.portrait)
  return extract(JSON.parse(p.content)).firstImage
}

export function linksOf(sourceId: string) {
  return db.prepare(
    'SELECT source_id AS sourceId, target_id AS targetId, target_name AS targetName, anchor, embed, lib_key AS libKey FROM links WHERE source_id = ?',
  ).all(sourceId)
}

/** What the client needs to refresh after a page was saved: the derived fields (outline, text, links...). */
export function pageDerived(id: string) {
  const p = db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as PageRow
  const todos = (db.prepare('SELECT COUNT(*) n FROM todos WHERE page_id = ? AND done = 0').get(id) as { n: number }).n
  const props = JSON.parse(p.props)
  return {
    ok: true, updatedAt: p.updated_at, outline: JSON.parse(p.outline), text: p.text.slice(0, 4000),
    wordCount: p.word_count, hasStats: !!p.has_stats, portrait: portraitOf(p, props), type: props?.type ?? null, links: linksOf(id), todos,
  }
}

/** Set by the collaboration layer: called when page content is rewritten outside a live editing session, so open editors reload. */
export const contentHooks: { replaced: (pageId: string) => void } = { replaced: () => {} }

/** Replaces a page's document from the outside (restore, bulk relink). Anyone editing it live is told to reload. */
export function replaceContent(p: PageRow, doc: DocNode, author: Author | null = null) {
  applyContent(p, doc, author)
  contentHooks.replaced(p.id)
}

/** Writes a changed document back to a page the same way an editor save does (index, statistics, history). */
export function applyContent(p: PageRow, doc: DocNode, author: Author | null = null) {
  ensureHeadingIds(doc)
  db.transaction(() => {
    ensureBaseline(p.id)
    const ex = reindexLinks(p.id, p.workspace_id, doc)
    recordActivity(p.id, p.workspace_id, ex.wordCount - p.word_count)
    db.prepare('UPDATE pages SET content=?, text=?, outline=?, word_count=?, has_stats=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(doc), ex.text, JSON.stringify(ex.outline), ex.wordCount, ex.hasStats ? 1 : 0, now(), p.id)
    recordRevision(p.id, author)
  })()
}

export type FieldRef = Ref

/** Entries of linked fields in a page's data (class, species, spells...), also inside stat block slots. Plain-text entries carry no link and are left out. */
export function fieldRefs(props: any): FieldRef[] {
  const out: FieldRef[] = []
  for (const d of propsStatData(props)) out.push(...dataRefs(d))
  for (const v of Object.values(props?.data ?? {})) {
    if (!Array.isArray(v)) continue
    for (const r of v) {
      if (r && typeof r === 'object' && typeof r.name === 'string' && (typeof r.libKey === 'string' || typeof r.pageId === 'string')) {
        out.push({ name: r.name, ...(typeof r.libKey === 'string' ? { libKey: r.libKey } : {}), ...(typeof r.pageId === 'string' ? { pageId: r.pageId } : {}) })
      }
    }
  }
  return out
}

/** Rebuilds the link index of a page: links in its text plus links in its linked fields. Pass props when they are being changed in the same save. */
export function reindexLinks(pageId: string, workspaceId: string, doc: DocNode, props?: any) {
  // every path that stores page content calls this, so the todo index is refreshed here too
  reindexTodos(pageId, workspaceId, doc)
  const ex = extract(doc)
  db.prepare('DELETE FROM links WHERE source_id = ?').run(pageId)
  const ins = db.prepare('INSERT INTO links(source_id,target_id,target_name,anchor,embed,lib_key) VALUES(?,?,?,?,?,?)')
  for (const l of ex.links) {
    if (l.libKey) { ins.run(pageId, null, l.targetName, null, 0, l.libKey); continue }
    let target = l.targetId
    if (target) {
      const ok = db.prepare('SELECT 1 FROM pages WHERE id = ? AND workspace_id = ?').get(target, workspaceId)
      if (!ok) target = null
    }
    if (!target) target = resolveTarget(workspaceId, l.targetName)
    ins.run(pageId, target, l.targetName, l.anchor, l.embed ? 1 : 0, null)
  }
  if (props === undefined) {
    const row = db.prepare('SELECT props FROM pages WHERE id = ?').get(pageId) as { props: string } | undefined
    try { props = row ? JSON.parse(row.props) : {} } catch { props = {} }
  }
  for (const r of [...fieldRefs(props), ...statblockRefs(doc)]) {
    if (r.libKey) ins.run(pageId, null, r.name, null, 0, r.libKey)
    else if (r.pageId && db.prepare('SELECT 1 FROM pages WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(r.pageId, workspaceId)) ins.run(pageId, r.pageId, r.name, null, 0, null)
  }
  return ex
}

/** Link rows whose name now matches this page (e.g. after creating/renaming a page) */
export function relinkByName(workspaceId: string, pageId: string, title: string, aliases: string[]) {
  const names = [title, ...aliases].map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (!names.length) return
  const upd = db.prepare(
    `UPDATE links SET target_id = ? WHERE target_id IS NULL AND lib_key IS NULL AND lower(trim(target_name)) = ?
     AND source_id IN (SELECT id FROM pages WHERE workspace_id = ?)`,
  )
  for (const n of names) upd.run(pageId, n, workspaceId)
}

export const today = () => (db.prepare("SELECT strftime('%Y-%m-%d', ? / 1000, 'unixepoch', 'localtime') d").get(now()) as { d: string }).d

/**
 * Daily writing activity per page, used for session statistics.
 * `written` only counts growth (typing, not deleting); `net` is the signed change.
 */
export function recordActivity(pageId: string, workspaceId: string, wordDelta: number, created = false) {
  if (!wordDelta && !created) return
  db.prepare(
    `INSERT INTO page_activity(page_id, workspace_id, day, written, net, created) VALUES(?,?,?,?,?,?)
     ON CONFLICT(page_id, day) DO UPDATE SET written = written + excluded.written, net = net + excluded.net, created = MAX(created, excluded.created)`,
  ).run(pageId, workspaceId, today(), Math.max(0, wordDelta), wordDelta, created ? 1 : 0)
}

export interface Author { id: string; username: string }

interface RevisionState { title: string; content: string; props: string; meta: string; wordCount: number; updatedAt: number }

/** Everything a restore brings back besides the text: special-page fields, portrait, icon, aliases and tags. Folder is left alone on purpose. */
function stateOf(pageId: string): RevisionState | null {
  const p = db.prepare('SELECT title, content, props, aliases, icon, word_count, updated_at FROM pages WHERE id = ?').get(pageId) as
    { title: string; content: string; props: string; aliases: string; icon: string | null; word_count: number; updated_at: number } | undefined
  if (!p) return null
  const tags = (db.prepare('SELECT tag FROM page_tags WHERE page_id = ? ORDER BY tag').all(pageId) as { tag: string }[]).map((t) => t.tag)
  return {
    title: p.title, content: p.content, props: p.props, wordCount: p.word_count, updatedAt: p.updated_at,
    meta: JSON.stringify({ icon: p.icon, aliases: JSON.parse(p.aliases), tags }),
  }
}

function insertRevision(pageId: string, s: RevisionState, author: Author | null, createdAt: number, reason: string | null = null, restoredFrom: number | null = null) {
  db.prepare(
    `INSERT INTO page_versions(id,page_id,title,content,word_count,created_at,author_id,author_name,props,meta,reason,restored_from)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(uid(), pageId, s.title, s.content, s.wordCount, createdAt, author?.id ?? null, author?.username ?? null, s.props, s.meta, reason, restoredFrom)
}

/** Call before the first change to a page that has no history yet, so its starting state can be restored too. */
export function ensureBaseline(pageId: string) {
  if (db.prepare('SELECT 1 FROM page_versions WHERE page_id = ? LIMIT 1').get(pageId)) return
  const s = stateOf(pageId)
  if (s) insertRevision(pageId, s, null, s.updatedAt)
}

/**
 * Call after every change to a page. Keeps the page as it is now in its history: one entry per author per editing burst
 * (edits by the same person within VERSION_GAP_MS of the burst's start fold into one), so a restore point exists for every edit
 * without storing every keystroke. A reason ('restore') always makes its own entry.
 */
export function recordRevision(pageId: string, author: Author | null, opts: { reason?: string; restoredFrom?: number } = {}) {
  const s = stateOf(pageId)
  if (!s) return
  const last = db.prepare('SELECT * FROM page_versions WHERE page_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(pageId) as
    { id: string; author_id: string | null; created_at: number; reason: string | null; title: string; content: string; props: string | null; meta: string | null } | undefined
  if (!opts.reason && last && last.title === s.title && last.content === s.content && last.props === s.props && last.meta === s.meta) return
  const t = now()
  // legacy rows (no props) are never rewritten: they only hold text
  const fold = !opts.reason && last && last.reason === null && last.props !== null && last.author_id === (author?.id ?? null) && t - last.created_at < VERSION_GAP_MS
  if (fold) {
    db.prepare('UPDATE page_versions SET title=?, content=?, word_count=?, props=?, meta=? WHERE id=?').run(s.title, s.content, s.wordCount, s.props, s.meta, last.id)
  } else {
    insertRevision(pageId, s, author, t, opts.reason ?? null, opts.restoredFrom ?? null)
  }
}

export function setTags(pageId: string, tags: string[]) {
  const clean = [...new Set(tags.map((t) => t.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-')).filter(Boolean))]
  db.prepare('DELETE FROM page_tags WHERE page_id = ?').run(pageId)
  const ins = db.prepare('INSERT INTO page_tags(page_id,tag) VALUES(?,?)')
  for (const t of clean) ins.run(pageId, t)
  return clean
}

export function pageSummary(r: PageRow) {
  const tags = (db.prepare('SELECT tag FROM page_tags WHERE page_id = ?').all(r.id) as { tag: string }[]).map((t) => t.tag)
  return {
    id: r.id, workspaceId: r.workspace_id, folderId: r.folder_id, title: r.title, icon: r.icon,
    aliases: JSON.parse(r.aliases) as string[], tags, wordCount: r.word_count,
    createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
  }
}

