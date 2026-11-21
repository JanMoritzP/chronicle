import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '../api'
import { useStore } from '../store'
import type { RuleSystem } from '../types'
import { resolveRules, type PackData, type Rules } from './systems'

// The system pack the open world plays by, loaded once and kept; and what the table shows because of it.

interface PackState { key: string; pack: PackData | null }
const usePackState = create<PackState>(() => ({ key: '', pack: null }))

/** Forget what was loaded: after a pack is installed, replaced or removed. */
export const invalidatePack = () => usePackState.setState({ key: '', pack: null })

/** The names, conditions, damage types and grid the open world uses: the built-in ones of its rules, changed by its pack. */
export function useRules(): Rules {
  const wsId = useStore((s) => s.wsId)
  const settings = useStore((s) => s.workspaces.find((w) => w.id === s.wsId)?.settings)
  const slug = settings?.pack ?? ''
  const system = (settings?.system ?? '5e') as RuleSystem
  const state = usePackState()
  const key = wsId && slug ? `${wsId}:${slug}` : ''
  useEffect(() => {
    if (!key) { if (state.key) usePackState.setState({ key: '', pack: null }); return }
    if (state.key === key) return
    let live = true
    api.listPacks(wsId!).then((list) => { if (live) usePackState.setState({ key, pack: list.find((p) => p.id === slug)?.pack ?? null }) }).catch(() => undefined)
    return () => { live = false }
  }, [key, state.key])
  return resolveRules(system, key && state.key === key ? state.pack : null)
}
