import { generateJSON } from '@tiptap/core'
import { api } from '../../api'
import { buildExtensions } from '../../editor/extensions'
import { useStore } from '../../store'
import { pageFinder, pictureFinder, type Plan, type Resolver, type SourceFile } from './formats'

export interface ImportOptions {
  /** a folder that holds the whole import, or null to put it at the top of the world */
  intoFolder: string | null
  /** leave out pages whose title the world already has */
  skipExisting: boolean
}
export interface ImportResult { pages: number; pictures: number; skippedExisting: number; failed: { title: string; reason: string }[] }

/** Runs a few promises at a time over a list, so a large import neither crawls nor floods the server. */
async function each<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i) }
  }))
}

/**
 * Makes the planned pages in the world. First every page is made empty, so each has an id; then the texts are
 * converted with links pointing at those ids, and pictures are uploaded the first time a page uses them.
 */
export async function runImport(ws: string, plan: Plan, opts: ImportOptions, progress: (done: number, total: number, step: string) => void): Promise<ImportResult> {
  const result: ImportResult = { pages: 0, pictures: 0, skippedExisting: 0, failed: [] }
  const existing = useStore.getState().data.pages.map((p) => ({ id: p.id, title: p.title, aliases: p.aliases }))
  const taken = new Set(existing.map((p) => p.title.trim().toLowerCase()))
  const pages = opts.skipExisting ? plan.pages.filter((p) => !taken.has(p.title.trim().toLowerCase())) : plan.pages
  result.skippedExisting = plan.pages.length - pages.length
  const total = pages.length * 2

  // folders, made once per path
  const folders = new Map<string, Promise<string | null>>()
  const top = opts.intoFolder ? api.createFolder(ws, opts.intoFolder.slice(0, 100), null).then((f) => f.id as string) : Promise.resolve(null)
  const folderFor = (path: string[]): Promise<string | null> => {
    if (!path.length) return top
    const key = path.join('/')
    let f = folders.get(key)
    if (!f) {
      f = folderFor(path.slice(0, -1)).then((parent) => api.createFolder(ws, path[path.length - 1].slice(0, 100) || 'Folder', parent).then((x) => x.id as string))
      folders.set(key, f)
    }
    return f
  }

  const ids = new Map<string, string>()
  let done = 0
  await each(pages, 4, async (p) => {
    try {
      const folderId = await folderFor(p.folder.filter((s) => s.trim()))
      const made = await api.createPage(ws, { title: p.title.slice(0, 300), folderId, tags: p.tags.slice(0, 50), imported: true })
      ids.set(p.key, made.id)
    } catch (e: any) {
      result.failed.push({ title: p.title, reason: e.message })
    }
    progress(++done, total, 'Making pages')
  })

  const findPage = pageFinder(plan.pages, ids, existing)
  const findPicture = pictureFinder(plan.pictures)
  const uploads = new Map<SourceFile, Promise<string | null>>()
  const resolver: Resolver = {
    page: (target, from) => findPage(target, from),
    picture: (ref, from) => {
      const f = findPicture(ref, from)
      if (!f) return Promise.resolve(null)
      let up = uploads.get(f)
      if (!up) {
        up = f.read().then(async (bytes) => {
          const r = await fetch(`/api/workspaces/${ws}/images?name=${encodeURIComponent(f.path.split('/').pop() ?? 'picture')}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes as BodyInit })
          if (!r.ok) return null
          result.pictures++
          return (await r.json()).url as string
        }).catch(() => null)
        uploads.set(f, up)
      }
      return up
    },
  }

  const extensions = buildExtensions({ readOnly: true })
  await each(pages.filter((p) => ids.has(p.key)), 3, async (p) => {
    try {
      const html = await p.html(resolver)
      const doc = generateJSON(html || '<p></p>', extensions)
      if (!doc.content?.length) doc.content = [{ type: 'paragraph' }]
      await api.patchPage(ids.get(p.key)!, { content: doc, imported: true, ...(p.aliases.length ? { aliases: p.aliases.slice(0, 50) } : {}) })
      result.pages++
    } catch (e: any) {
      result.failed.push({ title: p.title, reason: e.message })
    }
    progress(++done, total, 'Writing pages')
  })
  done = total
  progress(done, total, 'Done')
  await useStore.getState().refresh()
  return result
}
