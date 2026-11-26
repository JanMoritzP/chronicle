import { useStore } from '../store'
import type { AccessLevel, AccessRule, Folder, Member, WorldRole } from '../types'

/** What this person is in the open world. An old cached bootstrap has no role; the world list then says it. */
export function useWorldRole(): WorldRole {
  return useStore((s) => s.data.role ?? s.workspaces.find((w) => w.id === s.wsId)?.role ?? (s.user?.role === 'viewer' ? 'viewer' : 'editor'))
}
export const useIsGm = () => useWorldRole() === 'gm'

/** The same, outside React. */
export function worldRoleNow(): WorldRole {
  const s = useStore.getState()
  return s.data.role ?? s.workspaces.find((w) => w.id === s.wsId)?.role ?? (s.user?.role === 'viewer' ? 'viewer' : 'editor')
}

/** The rule a folder hands down: its own, or the nearest one above it (GMs get the rules in the bootstrap). */
export function folderRule(folders: Folder[], folderId: string | null): { rule: AccessRule | null; from: Folder | null } {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const seen = new Set<string>()
  let cur = folderId
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const f = byId.get(cur)
    if (!f) break
    if (hasRule(f.access)) return { rule: f.access!, from: f }
    cur = f.parentId
  }
  return { rule: null, from: null }
}

export const hasRule = (r: AccessRule | null | undefined): r is AccessRule => !!r && (!!r.everyone || Object.keys(r.people ?? {}).length > 0)

export const LEVEL_LABEL: Record<AccessLevel, string> = { edit: 'Can change', view: 'Can read', none: 'Hidden' }

/** A few words on what a rule does, for menus and the page's details. */
export function ruleSummary(rule: AccessRule | null | undefined, members: { id: string; username: string }[] = []): string {
  if (!hasRule(rule)) return 'Everyone by their role'
  const name = (id: string) => members.find((m) => m.id === id)?.username ?? 'someone'
  const people = Object.entries(rule.people ?? {})
  const base = rule.everyone === 'none' ? 'Only GMs' : rule.everyone === 'view' ? 'Everyone can read' : rule.everyone === 'edit' ? 'Everyone can change' : 'Everyone by their role'
  if (!people.length) return base
  const plus = people.filter(([, l]) => l !== 'none').map(([id]) => name(id))
  const minus = people.filter(([, l]) => l === 'none').map(([id]) => name(id))
  return [base, plus.length ? `and ${plus.join(', ')}` : '', minus.length ? `, hidden from ${minus.join(', ')}` : ''].filter(Boolean).join(' ').replace(' ,', ',')
}

export const roleLabel = (m: Pick<Member, 'role'>) => (m.role === 'owner' ? 'Owner' : m.role === 'gm' ? 'GM' : m.role === 'editor' ? 'Player who writes' : 'Player who reads')
