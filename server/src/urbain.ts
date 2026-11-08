// Metros, trams and funiculars running now, asked from Transitous one zoom-12 tile (about 10 km) at a
// time, only when someone looks at a city closely: Europe's urban vehicles are too many to collect.
// A tile is kept 30 s for every visitor, and Transitous gets at most one request a second.
import { gzipSync } from 'node:zlib'
import { Busy } from './transitous.ts'

const API = 'https://api.transitous.org/api/v6/map/trips'
const UA = 'Continent (https://github.com/felixchvl/continent)'
const URBAN: Record<string, number> = { SUBWAY: 0, TRAM: 1, FUNICULAR: 2 }
const TTL = 30_000

type Seg = {
  trips: { tripId: string; routeShortName?: string; displayName?: string }[]
  routeColor?: string; mode: string; departure: string; arrival: string; polyline: string
}

const cache = new Map<string, { at: number; body: Buffer }>()
const inFlight = new Map<string, Promise<Buffer>>()
const BURST = 10
let tokens = BURST
let refilled = Date.now()

function bbox(x: number, y: number) {
  const n = 2 ** 12
  const lon = (i: number) => (i / n) * 360 - 180
  const lat = (j: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI
  return { minLat: lat(y + 1), minLon: lon(x), maxLat: lat(y), maxLon: lon(x + 1) }
}

/**
 * Vehicles of zoom-12 tile x/y, gzipped JSON: { t, v: [[id, mode, colour, name, [[dep, arr, polyline]...]]...] }
 * (mode 0 metro, 1 tram, 2 funicular; times in ms; polylines at precision 5).
 */
export function urbanTile(x: number, y: number): Promise<Buffer> {
  const key = `${x}/${y}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.body)
  const pending = inFlight.get(key)
  if (pending) return pending
  const now = Date.now()
  tokens = Math.min(BURST, tokens + (now - refilled) / 1000)
  refilled = now
  if (tokens < 1) return Promise.reject(new Busy('busy'))
  tokens--
  const p = fetchTile(x, y).finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

async function fetchTile(x: number, y: number): Promise<Buffer> {
  const b = bbox(x, y)
  const t = Date.now()
  const params = new URLSearchParams({
    zoom: '13', min: `${b.minLat},${b.minLon}`, max: `${b.maxLat},${b.maxLon}`,
    startTime: new Date(t - 60_000).toISOString(), endTime: new Date(t + 4 * 60_000).toISOString(), precision: '5',
  })
  const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Transitous ${res.status}`)
  const segs = (await res.json()) as Seg[]
  const vehicles = new Map<string, [string, number, string, string, [number, number, string][]]>()
  for (const s of segs) {
    const mode = URBAN[s.mode]
    const trip = s.trips[0]
    if (mode === undefined || !trip) continue
    let v = vehicles.get(trip.tripId)
    if (!v) {
      const colour = /^[0-9a-f]{6}$/i.test(s.routeColor ?? '') ? `#${s.routeColor!.toLowerCase()}` : ''
      v = [trip.tripId, mode, colour, trip.routeShortName ?? trip.displayName ?? '', []]
      vehicles.set(trip.tripId, v)
    }
    v[4].push([Date.parse(s.departure), Date.parse(s.arrival), s.polyline])
  }
  for (const v of vehicles.values()) v[4].sort((a, b) => a[0] - b[0])
  const body = gzipSync(JSON.stringify({ t, v: [...vehicles.values()] }))
  cache.set(`${x}/${y}`, { at: t, body })
  if (cache.size > 400) cache.delete(cache.keys().next().value!)
  return body
}
