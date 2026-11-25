import { alertDialog } from '../lib/dialog'
import { onTableMessage, sendTable, useTable, type Scene } from './state'
import { uploadImage } from './upload'
import { buildUvtt, parseUvtt } from './uvtt'

// Bringing a Universal VTT map into the table and taking a scene out as one.

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = accept
    el.onchange = () => resolve(el.files?.[0] ?? null)
    el.oncancel = () => resolve(null)
    el.click()
  })
}

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

/** Makes a new scene from a .dd2vtt or .uvtt file: the picture, the grid, the walls, the doors and a hidden light for each light. */
export async function importUvtt(wsId: string) {
  const file = await pickFile('.dd2vtt,.uvtt,.json,application/json')
  if (!file) return
  let json: unknown
  try { json = JSON.parse(await file.text()) } catch { await alertDialog('That file could not be read as a Universal VTT map.'); return }
  const map = parseUvtt(json, file.name)
  if ('error' in map) { await alertDialog(map.error); return }
  let bg = ''
  if (map.image) {
    const ext = map.image.mime === 'image/png' ? 'png' : map.image.mime === 'image/webp' ? 'webp' : 'jpg'
    const url = await uploadImage(wsId, new File([bytesOf(map.image.base64)], `${map.name}.${ext}`, { type: map.image.mime }))
    if (!url) return
    bg = url
  }
  const name = map.name.slice(0, 120)
  const made = new Promise<string | null>((resolve) => {
    const off = onTableMessage((m) => { if (m.t === 'scene' && m.scene.name === name && m.scene.width === map.width) { off(); resolve(m.scene.id) } })
    setTimeout(() => { off(); resolve(null) }, 8000)
  })
  sendTable({ t: 'scene.create', name, patch: { bg, width: map.width, height: map.height, grid: 'square', gridSize: map.gridSize, dist: 5, unit: 'ft', diagonal: '5-10-5' } })
  const id = await made
  if (!id) { await alertDialog('The scene could not be made. Try again.'); return }
  for (let i = 0; i < map.walls.length; i += 200) sendTable({ t: 'wall.add', sceneId: id, walls: map.walls.slice(i, i + 200) })
  for (const l of map.lights) sendTable({ t: 'token.add', sceneId: id, token: { name: 'Light', hidden: true, x: l.x, y: l.y, data: { lightSource: true, light: { bright: l.bright, dim: l.dim, ...(l.color ? { color: l.color } : {}) } } } })
  sendTable({ t: 'view', sceneId: id })
}

/** Saves the scene as a Universal VTT file: its map picture, walls, doors and lights. */
export async function exportUvtt(scene: Scene) {
  if (!scene.bg) { await alertDialog('This scene has no map image to put in the file. Set one first.'); return }
  try {
    const blob = await (await fetch(scene.bg)).blob()
    const b64: string = await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
      r.onerror = () => reject(r.error)
      r.readAsDataURL(blob)
    })
    const st = useTable.getState()
    const file = buildUvtt(scene, st.walls, st.lights, b64)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }))
    a.download = `${scene.name.replace(/[^\w\- ]+/g, '').trim() || 'scene'}.dd2vtt`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  } catch { await alertDialog('The map file could not be made.') }
}
