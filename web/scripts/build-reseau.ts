// Builds public/data/reseau.json: the long-distance rail network drawn under the trains.
// Source: Transitous (MOTIS) /api/v6/map/trips, sampled over several 30-minute windows of a weekday.
// Overlapping shapes (many trips share the same tracks) are removed with a coverage grid,
// then each line is simplified (Douglas-Peucker). Run: node scripts/build-reseau.ts [YYYY-MM-DD]
import { mkdirSync, writeFileSync } from 'node:fs'

type Pt = [number, number] // [lon, lat]
type Seg = { mode: string; polyline: string }

const API = 'https://api.transitous.org/api/v6/map/trips'
const KIND: Record<string, 'gv' | 'cl'> = { HIGHSPEED_RAIL: 'gv', LONG_DISTANCE: 'cl', NIGHT_RAIL: 'cl' }
const DAY = process.argv[2] ?? nextMonday()
const WINDOWS_UTC = ['06:00', '08:30', '11:00', '14:00', '16:30', '18:30']
const CELL = 0.0025 // degrees, about 250 m
const TOLERANCE = 0.0012 // degrees, about 120 m

function nextMonday(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7))
  return d.toISOString().slice(0, 10)
}

function decode(s: string, precision: number): Pt[] {
  const f = 10 ** precision
  const out: Pt[] = []
  let i = 0, lat = 0, lon = 0
  while (i < s.length) {
    for (let k = 0; k < 2; k++) {
      let shift = 0, res = 0, b: number
      do { b = s.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
      const d = res & 1 ? ~(res >> 1) : res >> 1
      if (k === 0) lat += d; else lon += d
    }
    out.push([lon / f, lat / f])
  }
  return out
}

function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a], [bx, by] = pts[b]
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy
    let best = -1, bd = 0
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]
      const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey
      if (d > bd) { bd = d; best = i }
    }
    if (best > 0 && bd > tol * tol) { keep[best] = 1; stack.push([a, best], [best, b]) }
  }
  return pts.filter((_, i) => keep[i])
}

function densify(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step))
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n])
  }
  return out
}

async function fetchWindow(start: string): Promise<Seg[]> {
  const t0 = new Date(`${DAY}T${start}:00Z`)
  const t1 = new Date(t0.getTime() + 30 * 60_000)
  const q = new URLSearchParams({
    zoom: '5', min: '34,-11', max: '62,32', precision: '4',
    startTime: t0.toISOString(), endTime: t1.toISOString(),
  })
  const res = await fetch(`${API}?${q}`, { headers: { 'User-Agent': 'Continent (github.com/felixchvl/continent)' } })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  const segs = (await res.json()) as Seg[]
  return segs.filter((s) => KIND[s.mode])
}

const unique = new Map<string, Seg>()
for (const w of WINDOWS_UTC) {
  const segs = await fetchWindow(w)
  for (const s of segs) unique.set(s.polyline, s)
  console.log(`${DAY} ${w} UTC: ${segs.length} rail segments, ${unique.size} unique shapes`)
}

const covered = new Set<string>()
const key = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`
const isFree = (x: number, y: number) => {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL)
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (covered.has(`${cx + i},${cy + j}`)) return false
  return true
}

const out: Record<'gv' | 'cl', number[][]> = { gv: [], cl: [] }
const ordered = [...unique.values()].sort((a, b) => (KIND[a.mode] === 'gv' ? 0 : 1) - (KIND[b.mode] === 'gv' ? 0 : 1))
for (const s of ordered) {
  const pts = decode(s.polyline, 4)
  if (pts.length < 2) continue
  const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1]
  if (pts.length <= 3 && Math.hypot(x1 - x0, y1 - y0) > 0.3) continue // feed without a real shape
  const runs: Pt[][] = []
  let cur: Pt[] = []
  for (const p of densify(pts, CELL / 2)) {
    if (isFree(p[0], p[1])) cur.push(p)
    else { if (cur.length > 1) runs.push(cur); cur = [] }
  }
  if (cur.length > 1) runs.push(cur)
  for (const r of runs) {
    if (r.length < 4) continue
    for (const [x, y] of r) covered.add(key(x, y))
    const flat: number[] = []
    for (const [x, y] of simplify(r, TOLERANCE)) flat.push(Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4)
    out[KIND[s.mode]].push(flat)
  }
}

mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true })
const json = JSON.stringify({ source: 'Transitous', day: DAY, ...out })
writeFileSync(new URL('../public/data/reseau.json', import.meta.url), json)
console.log(`gv ${out.gv.length} lines, cl ${out.cl.length} lines, ${(json.length / 1e6).toFixed(2)} MB`)
