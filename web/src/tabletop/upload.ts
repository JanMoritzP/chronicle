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
