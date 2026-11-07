// Geometry helpers: encoded polylines, distances along a line, positions and bearings.

export type LonLat = [number, number]

export function decodePolyline(s: string, precision: number): LonLat[] {
  const f = 10 ** precision
  const out: LonLat[] = []
  let i = 0
  let lat = 0
  let lon = 0
  while (i < s.length) {
    for (let k = 0; k < 2; k++) {
      let shift = 0
      let res = 0
      let b: number
      do {
        b = s.charCodeAt(i++) - 63
        res |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const d = res & 1 ? ~(res >> 1) : res >> 1
      if (k === 0) lat += d
      else lon += d
    }
    out.push([lon / f, lat / f])
  }
  return out
}

const M_PER_DEG_LAT = 110_574
const M_PER_DEG_LON = 111_320

/** Local planar offset in metres between two points (equirectangular, fine at train scale). */
function delta(a: LonLat, b: LonLat): [number, number] {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  return [(b[0] - a[0]) * M_PER_DEG_LON * k, (b[1] - a[1]) * M_PER_DEG_LAT]
}

export function distance(a: LonLat, b: LonLat): number {
  const [dx, dy] = delta(a, b)
  return Math.hypot(dx, dy)
}

/** Compass bearing in degrees (0 = north, clockwise). */
export function bearing(a: LonLat, b: LonLat): number {
  const [dx, dy] = delta(a, b)
  return (Math.atan2(dx, dy) * 180) / Math.PI
}

export type PointOnLine = { lon: number; lat: number; bearing: number; index: number }

/** A polyline with cumulative distances, to place a train at a given distance along it. */
export class Line {
  readonly points: LonLat[]
  readonly cum: Float64Array
  readonly length: number

  constructor(points: LonLat[]) {
    this.points = points
    this.cum = new Float64Array(points.length)
    for (let i = 1; i < points.length; i++) this.cum[i] = this.cum[i - 1] + distance(points[i - 1], points[i])
    this.length = this.cum[points.length - 1] ?? 0
  }

  at(d: number): PointOnLine {
    const p = this.points
    if (p.length === 1 || this.length === 0) return { lon: p[0][0], lat: p[0][1], bearing: 0, index: 0 }
    const t = Math.max(0, Math.min(this.length, d))
    let lo = 0
    let hi = p.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (this.cum[mid] <= t) lo = mid
      else hi = mid
    }
    const segLen = this.cum[hi] - this.cum[lo]
    const r = segLen > 0 ? (t - this.cum[lo]) / segLen : 0
    return {
      lon: p[lo][0] + (p[hi][0] - p[lo][0]) * r,
      lat: p[lo][1] + (p[hi][1] - p[lo][1]) * r,
      bearing: bearing(p[lo], p[hi]),
      index: lo,
    }
  }

  /** Distance along the line of the point closest to `q`, and how far `q` is from the line (metres). */
  project(q: LonLat): { along: number; off: number } {
    let best = { along: 0, off: Infinity }
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i]
      const [bx, by] = delta(a, this.points[i + 1])
      const [qx, qy] = delta(a, q)
      const L = bx * bx + by * by
      const t = L > 0 ? Math.max(0, Math.min(1, (qx * bx + qy * by) / L)) : 0
      const off = Math.hypot(qx - t * bx, qy - t * by)
      if (off < best.off) best = { along: this.cum[i] + t * Math.sqrt(L), off }
    }
    return best
  }

  /** Points from distance a to distance b, interpolated at both ends. */
  slice(a: number, b: number): LonLat[] {
    const s = this.at(a)
    const e = this.at(b)
    const out: LonLat[] = [[s.lon, s.lat]]
    for (let i = s.index + 1; i <= e.index; i++) out.push(this.points[i])
    out.push([e.lon, e.lat])
    return out
  }
}
