/**
 * Reads the files of a .zip in the browser. Stored and deflated entries are supported (what every exporter writes);
 * inflating uses the browser's own DecompressionStream, so no library is needed.
 */
export interface ZipFile { path: string; read: () => Promise<Uint8Array> }

const u16 = (v: DataView, o: number) => v.getUint16(o, true)
const u32 = (v: DataView, o: number) => v.getUint32(o, true)

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function readZip(blob: Blob): Promise<ZipFile[]> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // the end of central directory record sits in the last 64 KiB (after an optional comment)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('This is not a zip file, or it is damaged.')
  let count = u16(view, eocd + 10)
  let dirOffset = u32(view, eocd + 16)
  // zip64: the real numbers are in the zip64 end record
  if (dirOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20
    if (loc >= 0 && u32(view, loc) === 0x07064b50) {
      const rec = Number(view.getBigUint64(loc + 8, true))
      count = Number(view.getBigUint64(rec + 32, true))
      dirOffset = Number(view.getBigUint64(rec + 48, true))
    }
  }
  const utf8 = new TextDecoder('utf-8')
  const latin = new TextDecoder('latin1')
  const files: ZipFile[] = []
  let p = dirOffset
  for (let n = 0; n < count; n++) {
    if (u32(view, p) !== 0x02014b50) break
    const flags = u16(view, p + 8)
    const method = u16(view, p + 10)
    let size = u32(view, p + 20)
    const nameLen = u16(view, p + 28)
    const extraLen = u16(view, p + 30)
    const commentLen = u16(view, p + 32)
    let local = u32(view, p + 42)
    const nameBytes = buf.subarray(p + 46, p + 46 + nameLen)
    // bit 11: the name is UTF-8; older tools wrote code page 437, which latin1 reads well enough for file names
    const path = (flags & 0x800 ? utf8 : latin).decode(nameBytes).replace(/\\/g, '/')
    let e = p + 46 + nameLen
    const extraEnd = e + extraLen
    while (e + 4 <= extraEnd) {
      const id = u16(view, e), len = u16(view, e + 2)
      if (id === 0x0001) {
        // zip64 extra field: sizes and offset that did not fit in 32 bits, in this order
        let q = e + 4
        if (u32(view, p + 24) === 0xffffffff) q += 8
        if (size === 0xffffffff) { size = Number(view.getBigUint64(q, true)); q += 8 }
        if (local === 0xffffffff) local = Number(view.getBigUint64(q, true))
      }
      e += 4 + len
    }
    p = extraEnd + commentLen
    if (path.endsWith('/')) continue
    const at = local
    const compressed = size
    files.push({
      path,
      read: async () => {
        if (u32(view, at) !== 0x04034b50) throw new Error(`Damaged entry in the zip: ${path}`)
        const start = at + 30 + u16(view, at + 26) + u16(view, at + 28)
        const data = buf.subarray(start, start + compressed)
        if (method === 0) return data
        if (method === 8) return inflate(data)
        throw new Error(`${path} is packed in a way Chronicle can not read (method ${method}).`)
      },
    })
  }
  return files
}
