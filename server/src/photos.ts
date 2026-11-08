// Station photos: the image of the station's Wikipedia article (a thumbnail on upload.wikimedia.org,
// freely licensed, chosen by pipeline/stations.ts), fetched once and kept on disk, so that visitors'
// browsers only talk to this server. New images are fetched at most 2 a second after a burst of 20.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Busy } from './transitous.ts'

const PHOTOS = process.env.PHOTOS ?? '/var/lib/continent/photos'
const UA = 'Continent/1.0 (https://github.com/felixchvl/continent)'
const TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }
const MAX_BYTES = 4_000_000

let tokens = 20
let refilled = Date.now()
const pending = new Map<string, Promise<Buffer>>()

async function download(source: string, file: string): Promise<Buffer> {
  const now = Date.now()
  tokens = Math.min(20, tokens + ((now - refilled) / 1000) * 2)
  refilled = now
  if (tokens < 1) throw new Busy()
  tokens--
  const res = await fetch(source, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Wikimedia ${res.status}`)
  const body = Buffer.from(await res.arrayBuffer())
  if (body.length > MAX_BYTES) throw new Error('image too large')
  await mkdir(PHOTOS, { recursive: true })
  await writeFile(file, body)
  return body
}

/** The image at this upload.wikimedia.org address, from the disk when it was fetched before. */
export async function photo(source: string): Promise<{ body: Buffer; type: string }> {
  const url = new URL(source)
  if (url.protocol !== 'https:' || url.hostname !== 'upload.wikimedia.org') throw new Error('not a Wikimedia image')
  const ext = (url.pathname.match(/\.([a-z]+)$/i)?.[1] ?? '').toLowerCase()
  const type = TYPES[ext]
  if (!type) throw new Error('unsupported image type')
  const file = join(PHOTOS, `${createHash('sha1').update(source).digest('hex').slice(0, 24)}.${ext}`)
  try {
    return { body: await readFile(file), type }
  } catch {
    let p = pending.get(file)
    if (!p) {
      p = download(source, file).finally(() => pending.delete(file))
      pending.set(file, p)
    }
    return { body: await p, type }
  }
}
