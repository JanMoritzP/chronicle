import { api } from '../api'
import type { Person } from '../types'

const cache = new Map<string, { at: number; people: Promise<Person[]> }>()

/** Everyone who can open the world, for the @ menu. Kept for a minute so typing @ does not ask the server every time. */
export function worldPeople(wsId: string): Promise<Person[]> {
  const hit = cache.get(wsId)
  if (hit && Date.now() - hit.at < 60_000) return hit.people
  const people = api.people(wsId).catch(() => { cache.delete(wsId); return [] as Person[] })
  cache.set(wsId, { at: Date.now(), people })
  return people
}
