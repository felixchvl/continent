// Client side of the live data: polls the Continent server (every train in Europe, positions
// computed server-side) and moves each dot between two updates along its current heading.

import { parseTrip, statutOf, type Kind, type Source, type Statut, type TripDetails } from '../shared/model.ts'
import { FLAG_GPS, FLAG_MOVING, FLAG_RT, KINDS, LIVE_STRIDE, type Live, type Meta, type TrainDetail } from '../shared/protocol.ts'
import type { Operator } from '../shared/operators.ts'

export type { Kind, Source, Statut, TripDetails }
export type { TripStop } from '../shared/model.ts'

export type Train = { id: string; name: string; num: string; kind: Kind; op: Operator; color: string | null }
export type Pos = {
  lon: number
  lat: number
  bearing: number
  mps: number
  speed: number | null
  delay: number
  statut: Statut
  source: Source
  moving: boolean
  rt: boolean
}
export type Shown = { train: Train; pos: Pos }

const digits = (s: string) => (s.match(/\d+/g) ?? []).join('')
const MAX_EXTRAPOLATION = 25 // seconds: beyond that, wait for the next update

export class LiveStore {
  trains: Train[] = []
  byId = new Map<string, number>()
  version = -1
  updated = 0
  error: string | null = null
  /** Latest positions, one entry per running train (struct of arrays for speed). */
  n = 0
  idx = new Int32Array(0)
  lon = new Float64Array(0)
  lat = new Float64Array(0)
  brg = new Float32Array(0)
  mps = new Float32Array(0)
  delay = new Int16Array(0)
  flags = new Uint8Array(0)
  /** Index of each train (meta order) in the arrays above, or -1 when not running. */
  rowOf = new Int32Array(0)
  private t0 = 0
  private offset = 0 // server clock - local clock
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | null = null

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  start() {
    void this.poll()
    this.timer = setInterval(() => void this.poll(), 10_000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  private async poll() {
    try {
      const live = (await (await fetch('/api/live')).json()) as Live
      if (live.v !== this.version) await this.loadMeta()
      this.apply(live)
      this.updated = Date.now()
      this.error = null
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    }
    for (const fn of this.listeners) fn()
  }

  private async loadMeta() {
    const meta = (await (await fetch('/api/meta')).json()) as Meta
    this.trains = meta.trains.map(([id, name, oi, ki, color]) => ({ id, name, num: digits(name), op: meta.ops[oi], kind: KINDS[ki], color: color || null }))
    this.byId = new Map(this.trains.map((t, i) => [t.id, i]))
    this.version = meta.v
  }

  private apply(live: Live) {
    const n = live.d.length / LIVE_STRIDE
    if (live.v !== this.version) return // meta changed again meanwhile: next poll
    if (this.idx.length < n) {
      const cap = Math.ceil(n * 1.2)
      this.idx = new Int32Array(cap); this.lon = new Float64Array(cap); this.lat = new Float64Array(cap)
      this.brg = new Float32Array(cap); this.mps = new Float32Array(cap); this.delay = new Int16Array(cap); this.flags = new Uint8Array(cap)
    }
    this.rowOf = new Int32Array(this.trains.length).fill(-1)
    const d = live.d
    for (let r = 0; r < n; r++) {
      const o = r * LIVE_STRIDE
      this.idx[r] = d[o]
      this.lon[r] = d[o + 1] / 1e5
      this.lat[r] = d[o + 2] / 1e5
      this.brg[r] = d[o + 3]
      this.mps[r] = d[o + 4] / 10
      this.delay[r] = d[o + 5]
      this.flags[r] = d[o + 6]
      this.rowOf[d[o]] = r
    }
    this.n = n
    this.t0 = live.t
    this.offset = live.t - Date.now()
  }

  /** Position of row r at local time t, moved along its heading since the server computed it. */
  project(r: number, t: number, out: Float64Array, o: number) {
    let lon = this.lon[r]
    let lat = this.lat[r]
    if (this.flags[r] & FLAG_MOVING) {
      const dt = Math.min(MAX_EXTRAPOLATION, Math.max(0, (t + this.offset - this.t0) / 1000))
      const dist = this.mps[r] * dt
      const b = (this.brg[r] * Math.PI) / 180
      lon += (dist * Math.sin(b)) / (111_320 * Math.cos((lat * Math.PI) / 180))
      lat += (dist * Math.cos(b)) / 110_574
    }
    out[o] = lon
    out[o + 1] = lat
  }

  pos(r: number, t: number): Pos {
    const xy = new Float64Array(2)
    this.project(r, t, xy, 0)
    const f = this.flags[r]
    const kmh = this.mps[r] * 3.6
    const delay = this.delay[r]
    return {
      lon: xy[0], lat: xy[1], bearing: this.brg[r], mps: this.mps[r], speed: kmh > 20 && kmh < 360 ? kmh : null,
      delay, statut: statutOf(delay), source: f & FLAG_GPS ? 'gps' : 'estimee', moving: !!(f & FLAG_MOVING), rt: !!(f & FLAG_RT),
    }
  }

  get(id: string, t = Date.now()): Shown | null {
    const i = this.byId.get(id)
    if (i === undefined) return null
    const r = this.rowOf[i] ?? -1
    return r < 0 ? null : { train: this.trains[i], pos: this.pos(r, t) }
  }

  /** Every running train with its position at time t (for counters and lists, not for drawing). */
  all(t = Date.now()): Shown[] {
    const out: Shown[] = []
    for (let r = 0; r < this.n; r++) out.push({ train: this.trains[this.idx[r]], pos: this.pos(r, t) })
    return out
  }
}

export async function fetchTrip(id: string): Promise<TripDetails> {
  const res = await fetch(`/api/trip?id=${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`serveur ${res.status}`)
  return parseTrip(await res.json(), id)
}

const details = new Map<string, { at: number; d: TrainDetail | null }>()
export async function fetchDetail(id: string): Promise<TrainDetail | null> {
  const hit = details.get(id)
  if (hit && Date.now() - hit.at < 15_000) return hit.d
  const res = await fetch(`/api/train/${encodeURIComponent(id)}`)
  const d = res.ok ? ((await res.json()) as TrainDetail) : null
  details.set(id, { at: Date.now(), d })
  return d
}
