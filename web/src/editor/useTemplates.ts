import { useMemo } from 'react'
import { useStore } from '../store'
import { resolveTemplates, type StatTemplate } from './templates'

/** Built-in stat templates plus the ones designed in this world. */
export function useTemplates(): StatTemplate[] {
  const custom = useStore((s) => s.data.statTemplates)
  return useMemo(() => resolveTemplates(custom), [custom])
}

export const currentTemplates = () => resolveTemplates(useStore.getState().data.statTemplates)
