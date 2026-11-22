import { alertDialog } from '../lib/dialog'

/** Sends an image to the world's uploads and returns its address, or null after telling the person why not. */
export async function uploadImage(ws: string, file: File): Promise<string | null> {
  const fd = new FormData()
  fd.append('file', file)
  try {
    const r = await fetch(`/api/workspaces/${ws}/uploads`, { method: 'POST', body: fd })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) { await alertDialog(data.error ?? 'The image could not be uploaded. Try a PNG, JPEG or WebP under 25 MB.'); return null }
    return data.url as string
  } catch {
    await alertDialog('The image could not be uploaded. Is the server running?')
    return null
  }
}

/** A picture or a looping video for the map. */
export function pickBackground(): Promise<File | null> {
  return new Promise((resolve) => {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif,video/webm,video/mp4'
    el.onchange = () => resolve(el.files?.[0] ?? null)
    el.oncancel = () => resolve(null)
    el.click()
  })
}

/** How big a video is, in pixels, read from the file itself. */
export function videoSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => { resolve(v.videoWidth && v.videoHeight ? { width: v.videoWidth, height: v.videoHeight } : null); URL.revokeObjectURL(url) }
    v.onerror = () => { resolve(null); URL.revokeObjectURL(url) }
    v.src = url
  })
}

export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif'
    el.onchange = () => resolve(el.files?.[0] ?? null)
    el.oncancel = () => resolve(null)
    el.click()
  })
}

/** Sends a sound file to the world's uploads and returns its address, or null after telling the person why not. */
export async function uploadSound(ws: string, file: File): Promise<string | null> {
  const fd = new FormData()
  fd.append('file', file)
  try {
    const r = await fetch(`/api/workspaces/${ws}/uploads`, { method: 'POST', body: fd })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) { await alertDialog(data.error ?? 'The sound could not be uploaded. Try an MP3, OGG or WAV file under 25 MB.'); return null }
    return data.url as string
  } catch {
    await alertDialog('The sound could not be uploaded. Is the server running?')
    return null
  }
}

export function pickSound(): Promise<File | null> {
  return new Promise((resolve) => {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = 'audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,audio/aac,.mp3,.ogg,.wav,.m4a'
    el.onchange = () => resolve(el.files?.[0] ?? null)
    el.oncancel = () => resolve(null)
    el.click()
  })
}
