// Live trains: Transitous (MOTIS) for the whole of Europe, Renfe GPS for Spain.
// Outside Spain, positions are estimated from timetables + real-time delays, interpolated along the track.

import { Line, bearing, decodePolyline, type LonLat } from '../lib/geo'

export type Kind = 'gv' | 'cl'
export type Statut = 'ok' | 'r1' | 'r2'
export type Source = 'gps' | 'estimee'

export type Stop = { id: string; name: string; lon: number; lat: number; tz?: string }

export type Seg = {
  from: Stop
  to: Stop
  dep: number
  arr: number
  sdep: number
  sarr: number
  rt: boolean
  line: Line
  dist: number
}

export type Gps = {
  lon: number
  lat: number
  t: number
  bearing: number | null
  next: Stop | null
  delay: number | null
  anchor?: { seg: number; along: number }
}

export type Train = { id: string; name: string; num: string; kind: Kind; op: string; segs: Seg[]; gps?: Gps }

export type Pos = {
  lon: number
  lat: number
  bearing: number
  seg: Seg | null
  next: Stop | null
  moving: boolean
  delay: number
  statut: Statut
  source: Source
  speed: number | null
  rt: boolean
}

export const TRANSITOUS = 'https://api.transitous.org/api'
const KIND: Record<string, Kind> = { HIGHSPEED_RAIL: 'gv', LONG_DISTANCE: 'cl', NIGHT_RAIL: 'cl' }
const OPERATORS: [string, string][] = [
  ['fr-horaires-sncf', 'SNCF'], ['fr-eurostar', 'Eurostar'], ['es-RENFE', 'Renfe'], ['es-Ouigo', 'Ouigo'],
  ['es-iryo', 'Iryo'], ['it-trenitalia', 'Trenitalia'], ['it-italo', 'Italo'], ['de-', 'DB'], ['at-', 'ÖBB'],
  ['ch-', 'CFF'], ['pl-PKP', 'PKP Intercity'], ['pl-', 'PKP'], ['gb-', 'National Rail'], ['dk-', 'DSB'],
  ['hu-', 'MÁV'], ['cz-', 'ČD'], ['nl-', 'NS'], ['se-', 'SJ'], ['sk-', 'ZSSK'], ['no-', 'Vy'], ['fi-', 'VR'],
  ['be-', 'SNCB'], ['lu-', 'CFL'], ['pt-', 'CP'], ['eu-european-sleeper', 'European Sleeper'],
]

export const statutOf = (delay: number): Statut => (delay >= 15 ? 'r2' : delay >= 5 ? 'r1' : 'ok')
const ms = (s: string | undefined) => (s ? Date.parse(s) : NaN)
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
const titleCase = (n: string) => n.toLowerCase().replace(/(^|[\s\-.'’/(])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
export function cleanName(n: string): string {
  const s = n.replace(/\s+Hall\s.*$/i, '').replace(/\s*\(.*\)$/, '').trim()
  return /\p{Ll}/u.test(s) ? s : titleCase(s) // some feeds publish station names in capitals
}
const digits = (s: string) => (s.match(/\d+/g) ?? []).join('')

function operatorOf(tripId: string): string {
  const feed = tripId.split('_')[2] ?? ''
  return OPERATORS.find(([p]) => feed.toLowerCase().startsWith(p.toLowerCase()))?.[1] ?? ''
}

type ApiStop = { name: string; stopId: string; lat: number; lon: number; tz?: string }
type ApiSeg = {
  trips: { tripId: string; displayName?: string }[]
  mode: string
  distance: number
  from: ApiStop
  to: ApiStop
  departure: string
  arrival: string
  scheduledDeparture: string
  scheduledArrival: string
  realTime: boolean
  polyline: string
}

const toStop = (s: ApiStop): Stop => ({ id: s.stopId, name: cleanName(s.name), lon: s.lon, lat: s.lat, tz: s.tz })

async function fetchSegments(now: number): Promise<ApiSeg[]> {
  const q = new URLSearchParams({
    zoom: '5', min: '34,-11', max: '62,32', precision: '4',
    startTime: iso(now - 2 * 60_000), endTime: iso(now + 14 * 60_000),
  })
  const res = await fetch(`${TRANSITOUS}/v6/map/trips?${q}`)
  if (!res.ok) throw new Error(`Transitous ${res.status}`)
  return res.json()
}

function buildTrains(segs: ApiSeg[]): Map<string, Train> {
  const trains = new Map<string, Train>()
  for (const s of segs) {
    const kind = KIND[s.mode]
    const trip = s.trips[0]
    if (!kind || !trip) continue
    let t = trains.get(trip.tripId)
    if (!t) {
      const name = trip.displayName ?? ''
      t = { id: trip.tripId, name, num: digits(name), kind, op: operatorOf(trip.tripId), segs: [] }
      trains.set(t.id, t)
    }
    if (t.segs.some((x) => x.from.id === s.from.stopId && x.sdep === ms(s.scheduledDeparture))) continue
    t.segs.push({
      from: toStop(s.from), to: toStop(s.to),
      dep: ms(s.departure), arr: ms(s.arrival), sdep: ms(s.scheduledDeparture), sarr: ms(s.scheduledArrival),
      rt: s.realTime, line: new Line(decodePolyline(s.polyline, 4)), dist: s.distance,
    })
  }
  for (const t of trains.values()) t.segs.sort((a, b) => a.dep - b.dep)
  return trains
}

const delayOf = (s: Seg, end: 'dep' | 'arr') => Math.max(0, ((end === 'arr' ? s.arr - s.sarr : s.dep - s.sdep) || 0) / 60_000)
/** Average speed over the current stop-to-stop segment, from the drawn track (km/h). */
function speedOf(s: Seg): number | null {
  if (s.arr <= s.dep || s.line.points.length < 4) return null
  const v = s.line.length / 1000 / ((s.arr - s.dep) / 3_600_000)
  return v > 20 && v < 360 ? v : null
}

/** Where the train is at time t (ms), or null if it is not running then. */
export function positionAt(tr: Train, t: number): Pos | null {
  const g = tr.gps
  if (g?.anchor) {
    const seg = tr.segs[g.anchor.seg]
    const v = seg.line.length / Math.max(60_000, seg.sarr - seg.sdep) // timetable speed, metres per ms
    const along = Math.min(seg.line.length, g.anchor.along + v * Math.max(0, t - g.t))
    const p = seg.line.at(along)
    const delay = g.delay ?? delayOf(seg, 'arr')
    return { lon: p.lon, lat: p.lat, bearing: p.bearing, seg, next: seg.to, moving: along < seg.line.length, delay, statut: statutOf(delay), source: 'gps', speed: speedOf(seg), rt: true }
  }
  if (g) {
    const delay = g.delay ?? 0
    return { lon: g.lon, lat: g.lat, bearing: g.bearing ?? 90, seg: null, next: g.next, moving: true, delay, statut: statutOf(delay), source: 'gps', speed: null, rt: true }
  }
  const segs = tr.segs
  if (!segs.length) return null
  const first = segs[0]
  const last = segs[segs.length - 1]
  const atStop = (stop: Stop, s: Seg, endOfLine: boolean, delay: number): Pos => {
    const b = s.line.at(endOfLine ? s.line.length : 0).bearing
    return { lon: stop.lon, lat: stop.lat, bearing: b, seg: s, next: stop, moving: false, delay, statut: statutOf(delay), source: 'estimee', speed: null, rt: s.rt }
  }
  if (t < first.dep) return first.dep - t > 3 * 60_000 ? null : atStop(first.from, first, false, delayOf(first, 'dep'))
  if (t >= last.arr) return t - last.arr > 90_000 ? null : atStop(last.to, last, true, delayOf(last, 'arr'))
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (t >= s.dep && t < s.arr) {
      const p = s.line.at(((t - s.dep) / (s.arr - s.dep)) * s.line.length)
      const delay = delayOf(s, 'arr')
      return { lon: p.lon, lat: p.lat, bearing: p.bearing, seg: s, next: s.to, moving: true, delay, statut: statutOf(delay), source: 'estimee', speed: speedOf(s), rt: s.rt }
    }
    const n = segs[i + 1]
    if (n && t >= s.arr && t < n.dep) return atStop(s.to, s, true, delayOf(n, 'dep'))
  }
  return null
}

// ---- Renfe GPS (Spain) -------------------------------------------------------------------

type RenfeVP = {
  header: { timestamp: string }
  entity: {
    vehicle: {
      trip: { tripId: string }
      position: { latitude: number; longitude: number; bearing?: number }
      stopId?: string
      vehicle: { id: string; label?: string }
    }
  }[]
}
type RenfeTU = { entity: { tripUpdate: { trip: { tripId: string }; delay?: number } }[] }

async function fetchRenfe(): Promise<{ vp: RenfeVP; tu: RenfeTU } | null> {
  try {
    const [vp, tu] = await Promise.all([
      fetch('/renfe/vehicle_positions_LD.json').then((r) => (r.ok ? r.json() : null)),
      fetch('/renfe/trip_updates_LD.json').then((r) => (r.ok ? r.json() : null)),
    ])
    return vp && tu ? { vp, tu } : null
  } catch {
    return null
  }
}

// ---- Store -----------------------------------------------------------------------------------

export class LiveStore {
  trains = new Map<string, Train>()
  updated = 0
  error: string | null = null
  private renfeStops = new Map<string, Stop>()
  private lastFix = new Map<string, { at: LonLat; prev: LonLat | null }>()
  private lastRenfe: { vp: RenfeVP; tu: RenfeTU } | null = null
  private listeners = new Set<() => void>()
  private timers: ReturnType<typeof setInterval>[] = []

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  start() {
    void this.refresh()
    this.timers.push(setInterval(() => void this.refresh(), 120_000))
    this.timers.push(setInterval(() => void this.refreshGps(), 30_000))
  }

  stop() {
    this.timers.forEach(clearInterval)
    this.timers = []
  }

  async refresh() {
    try {
      const segs = await fetchSegments(Date.now())
      this.trains = buildTrains(segs)
      for (const s of segs) {
        for (const st of [s.from, s.to]) if (st.stopId.includes('RENFE')) this.renfeStops.set(st.stopId.split('_').pop()!, toStop(st))
      }
      this.updated = Date.now()
      this.error = null
      if (this.lastRenfe) this.applyGps(this.lastRenfe)
      void this.refreshGps()
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    }
    this.emit()
  }

  async refreshGps() {
    const g = await fetchRenfe()
    if (!g) return
    this.lastRenfe = g
    this.applyGps(g)
    this.emit()
  }

  private applyGps({ vp, tu }: { vp: RenfeVP; tu: RenfeTU }) {
    for (const [id, t] of this.trains) {
      if (id.startsWith('renfe:')) this.trains.delete(id)
      else delete t.gps
    }
    const byNum = new Map<string, Train>()
    for (const t of this.trains.values()) if (t.op === 'Renfe' && t.num) byNum.set(t.num.padStart(5, '0'), t)
    const delays = new Map(tu.entity.map((e) => [e.tripUpdate.trip.tripId.slice(0, 5), (e.tripUpdate.delay ?? 0) / 60]))
    const ts = Number(vp.header.timestamp) * 1000 || Date.now()
    const seen = new Set<string>()
    for (const { vehicle: v } of vp.entity) {
      const lon = v.position.longitude
      const lat = v.position.latitude
      const cell = `${Math.round(lat * 500)},${Math.round(lon * 500)}`
      if (seen.has(cell)) continue // coupled units report the same position
      seen.add(cell)
      const num = (v.vehicle.label ?? v.vehicle.id).slice(0, 5)
      const fix = this.lastFix.get(num)
      const moved = fix && (fix.at[0] !== lon || fix.at[1] !== lat)
      const prev = moved ? fix.at : (fix?.prev ?? null)
      this.lastFix.set(num, { at: [lon, lat], prev })
      const next = v.stopId ? (this.renfeStops.get(v.stopId) ?? null) : null
      const b = v.position.bearing ?? (prev ? bearing(prev, [lon, lat]) : next ? bearing([lon, lat], [next.lon, next.lat]) : null)
      const gps: Gps = { lon, lat, t: ts, bearing: b, next, delay: delays.get(num) ?? delays.get(v.trip.tripId.slice(0, 5)) ?? null }
      const train = byNum.get(num)
      if (train) {
        let best: { seg: number; along: number; off: number } | null = null
        train.segs.forEach((s, i) => {
          const p = s.line.project([lon, lat])
          if (!best || p.off < best.off) best = { seg: i, along: p.along, off: p.off }
        })
        const b2 = best as { seg: number; along: number; off: number } | null
        if (b2 && b2.off < 3000) gps.anchor = { seg: b2.seg, along: b2.along }
        train.gps = gps
      } else {
        const id = `renfe:${num}`
        this.trains.set(id, { id, name: `Renfe ${Number(num)}`, num: String(Number(num)), kind: 'cl', op: 'Renfe', segs: [], gps })
      }
    }
  }
}

// ---- Trip details ------------------------------------------------------------------------------

export type TripStop = {
  id: string
  name: string
  lon: number
  lat: number
  tz?: string
  arr?: number
  sarr?: number
  dep?: number
  sdep?: number
  track?: string
  cancelled?: boolean
}

export type TripDetails = { id: string; name: string; number: string; category: string; agency: string; stops: TripStop[]; line: Line; rt: boolean }

type ApiTripStop = ApiStop & {
  arrival?: string; scheduledArrival?: string; departure?: string; scheduledDeparture?: string; track?: string; cancelled?: boolean
}

export async function fetchTrip(id: string): Promise<TripDetails> {
  const res = await fetch(`${TRANSITOUS}/v5/trip?tripId=${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`Transitous ${res.status}`)
  const j = await res.json()
  const leg = j.legs.find((l: { tripId: string }) => l.tripId === id) ?? j.legs[0]
  const raw: ApiTripStop[] = [leg.from, ...(leg.intermediateStops ?? []), leg.to]
  const stops = raw.map((s) => ({
    id: s.stopId, name: cleanName(s.name), lon: s.lon, lat: s.lat, tz: s.tz,
    arr: ms(s.arrival) || undefined, sarr: ms(s.scheduledArrival) || undefined,
    dep: ms(s.departure) || undefined, sdep: ms(s.scheduledDeparture) || undefined,
    track: s.track, cancelled: s.cancelled,
  }))
  const name: string = leg.displayName ?? ''
  const number: string = leg.tripShortName || digits(name)
  return {
    id, name, number,
    category: name.replace(number, '').trim(),
    agency: leg.agencyName ?? '',
    stops,
    line: new Line(decodePolyline(leg.legGeometry.points, leg.legGeometry.precision ?? 6)),
    rt: !!leg.realTime,
  }
}
