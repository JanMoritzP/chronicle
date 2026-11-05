import fs from 'node:fs'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'

export interface ZipEntry {
  name: string
  /** Bytes in memory, or a file on disk that is read when its turn comes. */
  data: Buffer | { file: string }
  /** Already compressed content (images) is stored as is. */
  store?: boolean
  mtime?: number
}

const LIMIT = 0xffffffff

function dosTime(ms: number) {
  const d = new Date(ms)
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** Minimal zip writer (no zip64, so a single archive stays below 4 GB). Entries are produced one at a time to keep memory flat. */
export function zipStream(entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>): Readable {
  async function* gen() {
    const central: Buffer[] = []
    let offset = 0
    let count = 0
    for await (const e of entries) {
      let raw: Buffer
      if (Buffer.isBuffer(e.data)) raw = e.data
      else {
        try { raw = await fs.promises.readFile(e.data.file) } catch { continue }
      }
      const name = Buffer.from(e.name, 'utf8')
      const crc = zlib.crc32(raw)
      const deflated = e.store || raw.length < 64 ? null : zlib.deflateRawSync(raw)
      const useDeflate = !!deflated && deflated.length < raw.length
      const body = useDeflate ? deflated! : raw
      const { time, date } = dosTime(e.mtime ?? Date.now())
      if (offset + body.length + name.length + 200 > LIMIT) throw new Error('Archive too large (4 GB limit)')

      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(0x0800, 6) // utf-8 names
      local.writeUInt16LE(useDeflate ? 8 : 0, 8)
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(date, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(body.length, 18)
      local.writeUInt32LE(raw.length, 22)
      local.writeUInt16LE(name.length, 26)
      local.writeUInt16LE(0, 28)

      const cd = Buffer.alloc(46)
      cd.writeUInt32LE(0x02014b50, 0)
      cd.writeUInt16LE(20, 4)
      cd.writeUInt16LE(20, 6)
      cd.writeUInt16LE(0x0800, 8)
      cd.writeUInt16LE(useDeflate ? 8 : 0, 10)
      cd.writeUInt16LE(time, 12)
      cd.writeUInt16LE(date, 14)
      cd.writeUInt32LE(crc, 16)
      cd.writeUInt32LE(body.length, 20)
      cd.writeUInt32LE(raw.length, 24)
      cd.writeUInt16LE(name.length, 28)
      cd.writeUInt32LE(offset, 42)
      central.push(cd, name)

      yield local
      yield name
      yield body
      offset += 30 + name.length + body.length
      count++
    }
    const cdBuf = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(count, 8)
    end.writeUInt16LE(count, 10)
    end.writeUInt32LE(cdBuf.length, 12)
    end.writeUInt32LE(offset, 16)
    yield cdBuf
    yield end
  }
  return Readable.from(gen(), { objectMode: false })
}
