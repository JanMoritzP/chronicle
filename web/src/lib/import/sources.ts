import type { SourceFile } from './formats'
import { readZip } from './zip'

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer())

/** Files the person picked or dropped, with zips opened (and zips inside them, as Notion writes large exports). */
export async function sourcesFrom(files: { path: string; blob: Blob }[]): Promise<SourceFile[]> {
  const out: SourceFile[] = []
  const add = async (path: string, blob: Blob, depth: number) => {
    if (/\.zip$/i.test(path) && depth < 2) {
      const prefix = depth ? path.replace(/\.zip$/i, '') + '/' : ''
      for (const e of await readZip(blob)) {
        if (/\.zip$/i.test(e.path)) await add(prefix + e.path, new Blob([await e.read() as BlobPart]), depth + 1)
        else out.push({ path: prefix + e.path, read: e.read })
      }
      return
    }
    out.push({ path, read: () => bytesOf(blob) })
  }
  for (const f of files) await add(f.path.replace(/\\/g, '/').replace(/^\/+/, ''), f.blob, 0)
  return out
}

/** The files of a drop, folders included (read through the entries API, which browsers and Electron support). */
export async function droppedFiles(dt: DataTransfer): Promise<{ path: string; blob: Blob }[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e)
  if (!entries.length) return [...dt.files].map((f) => ({ path: f.name, blob: f }))
  const out: { path: string; blob: Blob }[] = []
  const walk = async (e: FileSystemEntry, prefix: string): Promise<void> => {
    if (e.isFile) {
      const file = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej))
      out.push({ path: prefix + e.name, blob: file })
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader()
      // a directory reader hands out its entries in batches until it returns none
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        for (const c of batch) await walk(c, `${prefix}${e.name}/`)
      }
    }
  }
  for (const e of entries) await walk(e, '')
  return out
}
