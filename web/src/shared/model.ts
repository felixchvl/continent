// Train model shared by the server (which computes positions for every train in Europe) and the
// web app (trip details). Pure functions only: no network access here.
// Outside Spain, positions are estimated from timetables + real-time delays, interpolated along
// the track; in Spain, Renfe's GPS positions are snapped onto the track when possible.

import { Line, bearing, decodePolyline, type LonLat } from './geo.ts'
import { RENFE, operatorOf, type Operator } from './operators.ts'

/** gv: high speed, cl: other long distance (incl. night), reg: regional and suburban. */
export type Kind = 'gv' | 'cl' | 'reg'
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
  mode: string
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

/** color: the line's official colour (GTFS route_color via Transitous), '#rrggbb', or null when it has none. */
export type Train = { id: string; name: string; num: string; kind: Kind; op: Operator; color: string | null; segs: Seg[]; gps?: Gps }

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
  /** Average speed over the current segment (km/h), only when plausible. */
  speed: number | null
  /** Speed used to move the dot between two server updates (m/s). */
  mps: number
  rt: boolean
}

export const RAIL_KIND: Record<string, Kind> = {
  HIGHSPEED_RAIL: 'gv', LONG_DISTANCE: 'cl', NIGHT_RAIL: 'cl',
  REGIONAL_FAST_RAIL: 'reg', REGIONAL_RAIL: 'reg', SUBURBAN: 'reg', RAIL: 'reg',
}

export const statutOf = (delay: number): Statut => (delay >= 15 ? 'r2' : delay >= 5 ? 'r1' : 'ok')
export const ms = (s: string | undefined) => (s ? Date.parse(s) : NaN)
const titleCase = (n: string) => n.toLowerCase().replace(/(^|[\s\-.'’/(])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
export function cleanName(n: string): string {
  const s = n.replace(/\s+Hall\s.*$/i, '').replace(/\s*\(.*\)$/, '').trim()
  return /\p{Ll}/u.test(s) ? s : titleCase(s) // some feeds publish station names in capitals
}
export const digits = (s: string) => (s.match(/\d+/g) ?? []).join('')

/** '#rrggbb' from a GTFS route_color, or null when absent or white (the GTFS default, i.e. no colour). */
export function lineColor(c: string | undefined | null): string | null {
  const h = (c ?? '').replace(/^#/, '').toLowerCase()
  return /^[0-9a-f]{6}$/.test(h) && h !== 'ffffff' ? `#${h}` : null
}

// ---- Transitous segments -> trains ------------------------------------------------------------

export type ApiStop = { name: string; stopId: string; lat: number; lon: number; tz?: string }
export type ApiSeg = {
  trips: { tripId: string; displayName?: string; routeShortName?: string }[]
  routeColor?: string
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

export const toStop = (s: ApiStop): Stop => ({ id: s.stopId, name: cleanName(s.name), lon: s.lon, lat: s.lat, tz: s.tz })

export function buildTrains(segs: Iterable<ApiSeg>, precision = 4): Map<string, Train> {
  const trains = new Map<string, Train>()
  for (const s of segs) {
    const kind = RAIL_KIND[s.mode]
    const trip = s.trips[0]
    if (!kind || !trip) continue
    let t = trains.get(trip.tripId)
    if (!t) {
      const name = trip.displayName ?? ''
      t = { id: trip.tripId, name, num: digits(name), kind, op: operatorOf(trip.tripId), color: null, segs: [] }
      trains.set(t.id, t)
    }
    t.color ??= lineColor(s.routeColor)
    const sdep = ms(s.scheduledDeparture)
    if (t.segs.some((x) => x.from.id === s.from.stopId && x.sdep === sdep)) continue
    t.segs.push({
      from: toStop(s.from), to: toStop(s.to),
      dep: ms(s.departure), arr: ms(s.arrival), sdep, sarr: ms(s.scheduledArrival),
      rt: s.realTime, line: new Line(decodePolyline(s.polyline, precision)), mode: s.mode,
    })
  }
  for (const t of trains.values()) t.segs.sort((a, b) => a.dep - b.dep)
  return trains
}

const delayOf = (s: Seg, end: 'dep' | 'arr') => Math.max(0, ((end === 'arr' ? s.arr - s.sarr : s.dep - s.sdep) || 0) / 60_000)
const mpsOf = (s: Seg) => (s.arr > s.dep ? s.line.length / ((s.arr - s.dep) / 1000) : 0)
function speedOf(s: Seg): number | null {
  if (s.line.points.length < 4) return null
  const v = mpsOf(s) * 3.6
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
    const moving = along < seg.line.length
    return { lon: p.lon, lat: p.lat, bearing: p.bearing, seg, next: seg.to, moving, delay, statut: statutOf(delay), source: 'gps', speed: speedOf(seg), mps: moving ? v * 1000 : 0, rt: true }
  }
  if (g) {
    const delay = g.delay ?? 0
    return { lon: g.lon, lat: g.lat, bearing: g.bearing ?? 90, seg: null, next: g.next, moving: true, delay, statut: statutOf(delay), source: 'gps', speed: null, mps: 0, rt: true }
  }
  const segs = tr.segs
  if (!segs.length) return null
  const first = segs[0]
  const last = segs[segs.length - 1]
  const atStop = (stop: Stop, s: Seg, endOfLine: boolean, delay: number): Pos => {
    const b = s.line.at(endOfLine ? s.line.length : 0).bearing
    return { lon: stop.lon, lat: stop.lat, bearing: b, seg: s, next: stop, moving: false, delay, statut: statutOf(delay), source: 'estimee', speed: null, mps: 0, rt: s.rt }
  }
  if (t < first.dep) return first.dep - t > 3 * 60_000 ? null : atStop(first.from, first, false, delayOf(first, 'dep'))
  if (t >= last.arr) return t - last.arr > 90_000 ? null : atStop(last.to, last, true, delayOf(last, 'arr'))
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (t >= s.dep && t < s.arr) {
      const p = s.line.at(((t - s.dep) / (s.arr - s.dep)) * s.line.length)
      const delay = delayOf(s, 'arr')
      return { lon: p.lon, lat: p.lat, bearing: p.bearing, seg: s, next: s.to, moving: true, delay, statut: statutOf(delay), source: 'estimee', speed: speedOf(s), mps: mpsOf(s), rt: s.rt }
    }
    const n = segs[i + 1]
    if (n && t >= s.arr && t < n.dep) return atStop(s.to, s, true, delayOf(n, 'dep'))
  }
  return null
}

// ---- Renfe GPS (Spain) ------------------------------------------------------------------------

export type RenfeVP = {
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
export type RenfeTU = { entity: { tripUpdate: { trip: { tripId: string }; delay?: number } }[] }

/** What survives between two GPS updates: Renfe stop codes and each vehicle's last fixes. */
export type RenfeState = { stops: Map<string, Stop>; lastFix: Map<string, { at: LonLat; prev: LonLat | null }> }

export function indexRenfeStops(segs: Iterable<ApiSeg>, state: RenfeState) {
  for (const s of segs) for (const st of [s.from, s.to]) if (st.stopId.includes('RENFE')) state.stops.set(st.stopId.split('_').pop()!, toStop(st))
}

/** Attaches Renfe GPS fixes to the matching trains (by train number); unmatched vehicles become trains of their own. */
export function applyRenfe(trains: Map<string, Train>, vp: RenfeVP, tu: RenfeTU, state: RenfeState) {
  for (const [id, t] of trains) {
    if (id.startsWith('renfe:')) trains.delete(id)
    else delete t.gps
  }
  const byNum = new Map<string, Train>()
  for (const t of trains.values()) if (t.op.id === 'renfe' && t.num) byNum.set(t.num.padStart(5, '0'), t)
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
    const fix = state.lastFix.get(num)
    const moved = fix && (fix.at[0] !== lon || fix.at[1] !== lat)
    const prev = moved ? fix.at : (fix?.prev ?? null)
    state.lastFix.set(num, { at: [lon, lat], prev })
    const next = v.stopId ? (state.stops.get(v.stopId) ?? null) : null
    const b = v.position.bearing ?? (prev ? bearing(prev, [lon, lat]) : next ? bearing([lon, lat], [next.lon, next.lat]) : null)
    const gps: Gps = { lon, lat, t: ts, bearing: b, next, delay: delays.get(num) ?? delays.get(v.trip.tripId.slice(0, 5)) ?? null }
    const train = byNum.get(num)
    if (train) {
      let best: { seg: number; along: number; off: number } | null = null
      for (let i = 0; i < train.segs.length; i++) {
        const p = train.segs[i].line.project([lon, lat])
        if (!best || p.off < best.off) best = { seg: i, along: p.along, off: p.off }
      }
      if (best && best.off < 3000) gps.anchor = { seg: best.seg, along: best.along }
      train.gps = gps
    } else {
      const id = `renfe:${num}`
      trains.set(id, { id, name: `Renfe ${Number(num)}`, num: String(Number(num)), kind: 'cl', op: RENFE, color: null, segs: [], gps })
    }
  }
}

// ---- Trip details (Transitous /api/v5/trip) ---------------------------------------------------

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

export type TripDetails = { id: string; name: string; number: string; category: string; agency: string; color: string | null; stops: TripStop[]; line: Line; rt: boolean }

type ApiTripStop = ApiStop & {
  arrival?: string; scheduledArrival?: string; departure?: string; scheduledDeparture?: string; track?: string; cancelled?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseTrip(j: any, id: string): TripDetails {
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
    color: lineColor(leg.routeColor),
    stops,
    line: new Line(decodePolyline(leg.legGeometry.points, leg.legGeometry.precision ?? 6)),
    rt: !!leg.realTime,
  }
}
