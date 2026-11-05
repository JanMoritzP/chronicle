import { api } from '../api'
import { useStore } from '../store'
import { alertDialog, askText } from './dialog'
import { useWorld } from './world'

/** Opens a file picker, uploads the chosen image as a (sub-)map and opens it. Tiling continues server-side. */
export function startMapUpload(parentId: string | null) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp,image/avif'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const fallback = file.name.replace(/\.[^.]+$/, '')
    const name = await askText('Name of this map', { label: 'Map name', initial: fallback, okLabel: 'Upload' })
    if (name === null) return
    const ws = useStore.getState().wsId!
    try {
      const m = await api.uploadMap(ws, file, name.trim() || fallback, parentId)
      await useWorld.getState().reloadMaps()
      useStore.getState().navigate({ type: 'map', id: m.id })
    } catch (e: any) {
      alertDialog(e.message ?? 'Upload failed')
    }
  }
  input.click()
}
