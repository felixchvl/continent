// The base map under the rail network: sea, lakes, rivers, borders and main roads, from a Protomaps
// extract of OpenStreetMap kept on this server (pipeline/osm.sh, stage basemap). The archive is read
// with the PMTiles library; each tile is cut down to the layers the map draws (the archive also has
// land use, buildings, places, points of interest...) and kept gzipped in memory.
import { open, stat, type FileHandle } from 'node:fs/promises'
import { gunzipSync, gzipSync } from 'node:zlib'
import { Compression, FetchSource, PMTiles, findTile, zxyToTileId, type Source } from 'pmtiles'

/** A local archive, or an http(s) URL of one (useful in development). */
const ARCHIVE = process.env.BASEMAP ?? '/var/lib/continent/basemap/europe.pmtiles'
/** The layers web/src/map/style.ts draws. */
const KEEP = new Set(['water', 'boundaries', 'roads'])
const CACHE_BYTES = 64 * 1024 * 1024

class FileSource implements Source {
  private file: FileHandle
  private key: string
  constructor(file: FileHandle, key: string) {
    this.file = file
    this.key = key
  }
  getKey() {
    return this.key
  }
  async getBytes(offset: number, length: number) {
    const buf = Buffer.alloc(length)
    const { bytesRead } = await this.file.read(buf, 0, length, offset)
    return { data: buf.buffer.slice(0, bytesRead) as ArrayBuffer }
  }
}

type Archive = { pm: PMTiles; source: Source; version: string; close(): Promise<void> }
let archive: Archive | null = null
let checking: Promise<Archive | null> | null = null
let checked = 0
const cache = new Map<string, Buffer>()
let cached = 0
const remote = /^https?:/.test(ARCHIVE)

async function openArchive(): Promise<Archive | null> {
  if (remote) {
    const source = new FetchSource(ARCHIVE)
    return { pm: new PMTiles(source), source, version: ARCHIVE, close: async () => {} }
  }
  try {
    const s = await stat(ARCHIVE)
    const file = await open(ARCHIVE)
    const version = `${s.ino}-${s.mtimeMs}`
    const source = new FileSource(file, `${ARCHIVE}#${version}`)
    return { pm: new PMTiles(source), source, version, close: () => file.close() }
  } catch {
    return null // no extract yet: the map shows the rail network on a plain ground
  }
}

/** The archive, looked at again every minute: opened once the pipeline has made it, reopened when the
 * monthly run has replaced the file. */
function current(): Promise<Archive | null> {
  if (Date.now() - checked < 60_000 || (archive && remote)) return Promise.resolve(archive)
  checking ??= (async () => {
    const s = remote ? null : await stat(ARCHIVE).catch(() => null)
    if (archive && s && `${s.ino}-${s.mtimeMs}` === archive.version) return archive
    const prev = archive
    archive = await openArchive()
    if (prev) {
      cache.clear()
      cached = 0
      void prev.close().catch(() => {})
    }
    return archive
  })().finally(() => {
    checked = Date.now()
    checking = null
  })
  return checking
}

/** The tile's bytes as stored in the archive (a leaf directory at most three levels down). */
async function rawTile(a: Archive, z: number, x: number, y: number): Promise<Uint8Array | null> {
  const header = await a.pm.getHeader()
  if (z < header.minZoom || z > header.maxZoom) return null
  const id = zxyToTileId(z, x, y)
  let offset = header.rootDirectoryOffset
  let length = header.rootDirectoryLength
  for (let depth = 0; depth <= 3; depth++) {
    const dir = await a.pm.cache.getDirectory(a.source, offset, length, header)
    const entry = findTile(dir, id)
    if (!entry) return null
    if (entry.runLength > 0) {
      const bytes = new Uint8Array((await a.source.getBytes(header.tileDataOffset + entry.offset, entry.length)).data)
      return header.tileCompression === Compression.Gzip ? gunzipSync(bytes) : bytes
    }
    offset = header.leafDirectoryOffset + entry.offset
    length = entry.length
  }
  return null
}

function varint(buf: Uint8Array, pos: number): [value: number, next: number] {
  let value = 0
  let shift = 0
  for (;;) {
    const b = buf[pos++]
    value += (b & 0x7f) * 2 ** shift
    if (b < 0x80) return [value, pos]
    shift += 7
  }
}

/** Keeps the tile's layers named in KEEP. A vector tile is a protobuf list of layers (field 3), each
 * starting with its name (field 1): the layers are copied as they are, without decoding a feature. */
export function keepLayers(tile: Uint8Array, keep: Set<string>): Buffer {
  const parts: Uint8Array[] = []
  const text = new TextDecoder()
  let pos = 0
  while (pos < tile.length) {
    const start = pos
    const [key, afterKey] = varint(tile, pos)
    if ((key & 7) !== 2) throw new Error('unexpected field in a vector tile')
    const [len, body] = varint(tile, afterKey)
    pos = body + len
    if (key >> 3 !== 3) continue
    let p = body
    while (p < pos) {
      const [k, afterK] = varint(tile, p)
      if (k >> 3 === 1 && (k & 7) === 2) {
        const [n, s] = varint(tile, afterK)
        if (keep.has(text.decode(tile.subarray(s, s + n)))) parts.push(tile.subarray(start, pos))
        break
      }
      // Skip a field that is not the name (the name comes first in practice).
      const wire = k & 7
      if (wire === 0) p = varint(tile, afterK)[1]
      else if (wire === 2) {
        const [n, s] = varint(tile, afterK)
        p = s + n
      } else if (wire === 5) p = afterK + 4
      else if (wire === 1) p = afterK + 8
      else break
    }
  }
  return Buffer.concat(parts)
}

/** The tile, gzipped, with only the layers the map draws; null when there is none (outside Europe,
 * beyond the archive's zooms, or no extract yet). */
export async function baseTile(z: number, x: number, y: number): Promise<Buffer | null> {
  if (z > 20 || x >= 2 ** z || y >= 2 ** z) return null
  const key = `${z}/${x}/${y}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key) // most recently used last
    cache.set(key, hit)
    return hit
  }
  const a = await current()
  if (!a) return null
  const raw = await rawTile(a, z, x, y)
  if (!raw) return null
  const body = gzipSync(keepLayers(raw, KEEP))
  cache.set(key, body)
  cached += body.length
  for (const [k, v] of cache) {
    if (cached <= CACHE_BYTES) break
    cache.delete(k)
    cached -= v.length
  }
  return body
}
