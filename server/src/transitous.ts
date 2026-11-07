// Collects every train running in Europe from Transitous (MOTIS) /api/v6/map/trips.
// At zoom 7 the API returns all rail services, regional included (zoom 9+ adds metros, trams
// and buses). A large area at that zoom answers 422 "too many trips", so Europe is cut into
// tiles that split in four whenever Transitous refuses one; the split is kept for later cycles.

import { RAIL_KIND, type ApiSeg } from '../../web/src/shared/model.ts'

const API = 'https://api.transitous.org/api/v6/map/trips'
const UA = 'Continent (https://github.com/felixchvl/continent)'
const MAX_DEPTH = 5

type Tile = { minLat: number; minLon: number; maxLat: number; maxLon: number; depth: number }
export type FetchLog = { status: number; items: number; bytes: number; ms: number; params: string }

function initialTiles(): Tile[] {
  const tiles: Tile[] = []
  const lats = [34, 43, 50, 62]
  const lons = [-11, 0, 10, 20, 32]
  for (let i = 0; i < lats.length - 1; i++)
    for (let j = 0; j < lons.length - 1; j++) tiles.push({ minLat: lats[i], maxLat: lats[i + 1], minLon: lons[j], maxLon: lons[j + 1], depth: 0 })
  return tiles
}

function split(t: Tile): Tile[] {
  const mLat = (t.minLat + t.maxLat) / 2
  const mLon = (t.minLon + t.maxLon) / 2
  const d = t.depth + 1
  return [
    { minLat: t.minLat, maxLat: mLat, minLon: t.minLon, maxLon: mLon, depth: d },
    { minLat: t.minLat, maxLat: mLat, minLon: mLon, maxLon: t.maxLon, depth: d },
    { minLat: mLat, maxLat: t.maxLat, minLon: t.minLon, maxLon: mLon, depth: d },
    { minLat: mLat, maxLat: t.maxLat, minLon: mLon, maxLon: t.maxLon, depth: d },
  ]
}

const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let leaves = initialTiles()
let leavesSince = Date.now()

/** One full pass over Europe: rail segments active between now-1 min and now+9 min. */
export async function collect(log: (l: FetchLog) => void): Promise<ApiSeg[]> {
  if (Date.now() - leavesSince > 6 * 3_600_000) {
    leaves = initialTiles() // let the tiling follow the day's traffic
    leavesSince = Date.now()
  }
  const now = Date.now()
  const start = iso(now - 60_000)
  const end = iso(now + 9 * 60_000)
  const queue = [...leaves]
  const done: Tile[] = []
  const out: ApiSeg[] = []
  while (queue.length) {
    const t = queue.shift()!
    const params = `zoom=7&min=${t.minLat},${t.minLon}&max=${t.maxLat},${t.maxLon}&startTime=${start}&endTime=${end}&precision=4`
    const t0 = Date.now()
    try {
      const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': UA } })
      const text = await res.text()
      if (res.status === 422 && t.depth < MAX_DEPTH) {
        log({ status: 422, items: 0, bytes: text.length, ms: Date.now() - t0, params })
        queue.unshift(...split(t))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const segs = (JSON.parse(text) as ApiSeg[]).filter((s) => RAIL_KIND[s.mode])
      log({ status: res.status, items: segs.length, bytes: text.length, ms: Date.now() - t0, params })
      out.push(...segs)
      done.push(t)
    } catch (e) {
      log({ status: 0, items: 0, bytes: 0, ms: Date.now() - t0, params: `${params} ${(e as Error).message}` })
      done.push(t)
    }
    await sleep(250) // be gentle with a volunteer-run service
  }
  leaves = done
  return out
}

export const tileCount = () => leaves.length

const tripCache = new Map<string, { at: number; body: string }>()

/** Trip details (stops, times, geometry), cached for a minute. */
export async function trip(id: string): Promise<string> {
  const hit = tripCache.get(id)
  if (hit && Date.now() - hit.at < 60_000) return hit.body
  const res = await fetch(`https://api.transitous.org/api/v5/trip?tripId=${encodeURIComponent(id)}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Transitous ${res.status}`)
  const body = await res.text()
  tripCache.set(id, { at: Date.now(), body })
  if (tripCache.size > 500) tripCache.delete(tripCache.keys().next().value!)
  return body
}
