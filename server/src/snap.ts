// Some feeds give no shape between two stations (the French multimodal base for regional trains,
// part of Renfe Cercanías...): Transitous then draws a straight line and the train would cross fields.
// Such a segment is laid back onto the OpenStreetMap tracks: the shortest path on the tracks found in
// a corridor around the straight line, OSM's shared junction nodes making the graph. Computed once per
// pair of stations, in the background, and kept in PostgreSQL (silver.segment_path).
import { distance, type LonLat } from '../../web/src/shared/geo.ts'
import * as db from './db.ts'

const paths = new Map<string, LonLat[] | null>()
const queued = new Set<string>()
const queue: { key: string; a: LonLat; b: LonLat }[] = []
let running = false
let onReady: (key: string, path: LonLat[]) => void = () => {}

/** A polyline that only joins the stations: few points for its length. */
export function isStraight(points: LonLat[], length: number): boolean {
  return length > 2000 && (points.length <= 3 || points.length / (length / 1000) < 0.15)
}

export const segmentKey = (fromId: string, toId: string) => `${fromId}|${toId}`

export async function loadPaths(ready: (key: string, path: LonLat[]) => void) {
  onReady = ready
  for (const [k, p] of await db.loadSegmentPaths()) paths.set(k, p)
}

/** The path on the tracks for this pair of stations: known (or null when none), else asked for. */
export function pathFor(key: string, a: LonLat, b: LonLat): LonLat[] | null | undefined {
  if (paths.has(key)) return paths.get(key)
  if (!queued.has(key)) {
    queued.add(key)
    queue.push({ key, a, b })
    void run()
  }
  return undefined
}

async function run() {
  if (running) return
  running = true
  while (queue.length) {
    const job = queue.shift()!
    let path: LonLat[] | null = null
    try {
      path = await snap(job.a, job.b)
    } catch {
      path = null
    }
    paths.set(job.key, path)
    queued.delete(job.key)
    void db.saveSegmentPath(job.key, path).catch(() => {})
    if (path) onReady(job.key, path)
  }
  running = false
}

const keyOf = (p: LonLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`

async function snap(a: LonLat, b: LonLat): Promise<LonLat[] | null> {
  const straight = distance(a, b)
  // The corridor grows with the distance: real lines wander further from the straight line on long hops.
  const widthKm = Math.min(15, Math.max(3, (straight / 1000) * 0.25))
  const lines = await db.tracksNear(a, b, widthKm / 80)
  if (!lines.length) return null

  // Graph: every vertex of every track, joined to its neighbours; OSM junctions share coordinates.
  const ids = new Map<string, number>()
  const coords: LonLat[] = []
  const adj: { to: number; w: number }[][] = []
  const id = (p: LonLat) => {
    const k = keyOf(p)
    let i = ids.get(k)
    if (i === undefined) {
      i = coords.push(p) - 1
      ids.set(k, i)
      adj.push([])
    }
    return i
  }
  for (const line of lines) {
    for (let j = 1; j < line.length; j++) {
      const u = id(line[j - 1])
      const v = id(line[j])
      const w = distance(line[j - 1], line[j])
      adj[u].push({ to: v, w })
      adj[v].push({ to: u, w })
    }
  }
  const nearest = (p: LonLat) => {
    let best = -1
    let bd = 1500 // a station more than 1.5 km from any track has no usable path
    for (let i = 0; i < coords.length; i++) {
      const d = distance(p, coords[i])
      if (d < bd) [best, bd] = [i, d]
    }
    return best
  }
  const s = nearest(a)
  const t = nearest(b)
  if (s < 0 || t < 0 || s === t) return null

  // Dijkstra with a binary heap.
  const dist = new Float64Array(coords.length).fill(Infinity)
  const prev = new Int32Array(coords.length).fill(-1)
  const heap: [number, number][] = [[0, s]]
  dist[s] = 0
  const push = (item: [number, number]) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  const limit = straight * 1.8 + 3000 // longer than that, the path is not this train's
  while (heap.length) {
    const [d, u] = pop()
    if (u === t) break
    if (d > dist[u] || d > limit) continue
    for (const e of adj[u]) {
      const nd = d + e.w
      if (nd < dist[e.to]) {
        dist[e.to] = nd
        prev[e.to] = u
        push([nd, e.to])
      }
    }
  }
  if (!Number.isFinite(dist[t]) || dist[t] > limit) return null
  const out: LonLat[] = []
  for (let v = t; v !== -1; v = prev[v]) out.push(coords[v])
  out.reverse()
  return [a, ...out, b]
}

/** Polyline encoding (Google's algorithm), as Transitous sends it. */
export function encodePolyline(points: LonLat[], precision: number): string {
  const f = 10 ** precision
  let out = ''
  let plat = 0
  let plon = 0
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1
    let s = ''
    while (x >= 0x20) {
      s += String.fromCharCode((0x20 | (x & 0x1f)) + 63)
      x >>= 5
    }
    return s + String.fromCharCode(x + 63)
  }
  for (const [lon, lat] of points) {
    const ilat = Math.round(lat * f)
    const ilon = Math.round(lon * f)
    out += enc(ilat - plat) + enc(ilon - plon)
    plat = ilat
    plon = ilon
  }
  return out
}
