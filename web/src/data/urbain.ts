// Metros, trams and funiculars, only when the map is close enough to a city (zoom 12 and more):
// the server hands them out per zoom-12 tile (/api/urbain/12/x/y), refreshed every 30 s while the
// tile is in view. Each vehicle moves along its segment between departure and arrival.
import { decodePolyline, Line } from '../shared/geo.ts'

export const URBAN_MIN_ZOOM = 12
const REFRESH = 30_000
const FORGET = 120_000
const MAX_TILES = 20

export type UrbanVehicle = { id: string; mode: number; color: string | null; name: string; segs: { dep: number; arr: number; line: Line }[] }
type Payload = { t: number; v: [string, number, string, string, [number, number, string][]][] }
type Bounds = { west: number; south: number; east: number; north: number }

export class UrbanStore {
  private tiles = new Map<string, { at: number; seen: number; vehicles: UrbanVehicle[] }>()
  private pending = new Set<string>()
  vehicles: UrbanVehicle[] = []
  version = 0

  /** Fetches the tiles in view that are missing or stale; forgets those long out of view. */
  update(bounds: Bounds, zoom: number) {
    const now = Date.now()
    if (zoom < URBAN_MIN_ZOOM) return
    const n = 2 ** 12
    const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n)
    const ty = (lat: number) => {
      const r = (lat * Math.PI) / 180
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
    }
    const keys: string[] = []
    for (let x = tx(bounds.west); x <= tx(bounds.east); x++)
      for (let y = ty(bounds.north); y <= ty(bounds.south); y++) keys.push(`${x}/${y}`)
    for (const k of keys.slice(0, MAX_TILES)) {
      const tile = this.tiles.get(k)
      if (tile) tile.seen = now
      if ((!tile || now - tile.at > REFRESH) && !this.pending.has(k)) void this.load(k)
    }
    let dropped = false
    for (const [k, tile] of this.tiles) if (now - tile.seen > FORGET) (this.tiles.delete(k), (dropped = true))
    if (dropped) this.merge()
  }

  private async load(key: string) {
    this.pending.add(key)
    try {
      const res = await fetch(`/api/urbain/12/${key}`)
      if (!res.ok) return // busy or failed: the next update tries again
      const p = (await res.json()) as Payload
      const vehicles = p.v.map(([id, mode, color, name, segs]) => ({
        id, mode, color: color || null, name,
        segs: segs.map(([dep, arr, poly]) => ({ dep, arr, line: new Line(decodePolyline(poly, 5)) })),
      }))
      const prev = this.tiles.get(key)
      this.tiles.set(key, { at: Date.now(), seen: prev?.seen ?? Date.now(), vehicles })
      this.merge()
    } finally {
      this.pending.delete(key)
    }
  }

  /** A vehicle can appear in two neighbouring tiles: keep one. */
  private merge() {
    const byId = new Map<string, UrbanVehicle>()
    for (const tile of this.tiles.values()) for (const v of tile.vehicles) if (!byId.has(v.id)) byId.set(v.id, v)
    this.vehicles = [...byId.values()]
    this.version++
  }

  /** Where vehicle v is at time t, or null when it is not running then. */
  static position(v: UrbanVehicle, t: number): [number, number] | null {
    const segs = v.segs
    if (!segs.length || t < segs[0].dep - 60_000 || t > segs[segs.length - 1].arr + 60_000) return null
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      if (t < s.dep) {
        const at = i ? segs[i - 1].line.at(segs[i - 1].line.length) : s.line.at(0) // waiting at the stop
        return [at.lon, at.lat]
      }
      if (t <= s.arr) {
        const f = s.arr > s.dep ? (t - s.dep) / (s.arr - s.dep) : 1
        const at = s.line.at(f * s.line.length)
        return [at.lon, at.lat]
      }
    }
    const end = segs[segs.length - 1].line
    const at = end.at(end.length)
    return [at.lon, at.lat]
  }
}
