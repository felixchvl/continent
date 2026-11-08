// Continent server. One process:
// - every 3 min, collects every train in Europe from Transitous (tiled, see transitous.ts);
// - every 30 s, fetches Renfe's GPS positions and snaps them onto the Spanish trains;
// - every 5 s, computes where each train is and prepares the payloads the web app polls;
// - serves the built web app (web/dist) and the API, and stores what it sees in PostgreSQL.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { applyRenfe, buildTrains, indexRenfeStops, positionAt, type RenfeState, type RenfeTU, type RenfeVP, type Train } from '../../web/src/shared/model.ts'
import { FLAG_GPS, FLAG_MOVING, FLAG_RT, KINDS, type Meta, type TrainDetail } from '../../web/src/shared/protocol.ts'
import type { Operator } from '../../web/src/shared/operators.ts'
import { Busy, collect, tileCount, trip } from './transitous.ts'
import { urbanTile } from './urbain.ts'
import { baseTile } from './basemap.ts'
import { photo } from './photos.ts'
import { encodePolyline, isStraight, loadPaths, pathFor, segmentKey } from './snap.ts'
import { Line, decodePolyline, type LonLat } from '../../web/src/shared/geo.ts'
import * as db from './db.ts'

const PORT = Number(process.env.PORT ?? 8080)
const DIST = resolve(import.meta.dirname, process.env.DIST ?? '../../web/dist')
// Vector tiles built by pipeline/osm.sh (gzipped .pbf in z/x/y folders), one folder per set; the base
// map comes from a PMTiles archive instead (basemap.ts).
const TILES = process.env.TILES ?? '/var/lib/continent/tiles'
// Logos of the library of actors, downloaded from Wikimedia Commons by pipeline/actors.ts.
const LOGOS = process.env.LOGOS ?? '/var/lib/continent/logos'
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ---- State ----------------------------------------------------------------------------------

let trains = new Map<string, Train>()
const renfe: RenfeState = { stops: new Map(), lastFix: new Map() }
let lastRenfe: { vp: RenfeVP; tu: RenfeTU } | null = null
let order: Train[] = []
let version = 0
let metaBody: Buffer = gzipSync('{"v":0,"ops":[],"trains":[]}')
let liveBody: Buffer = gzipSync('{"t":0,"v":0,"d":[]}')
let actorsBody: Buffer = gzipSync('[]')
const health = { lastCollect: 0, collectMs: 0, segments: 0, trains: 0, running: 0, renfe: 0, errors: 0 }

// Trains seen in the last 24 hours: the only ids /api/trip forwards to Transitous.
const seen = new Map<string, number>()
let seenPruned = Date.now()

function remember(list: Train[]) {
  const now = Date.now()
  for (const t of list) seen.set(t.id, now)
  if (now - seenPruned < 3_600_000) return
  for (const [id, at] of seen) if (now - at > 86_400_000) seen.delete(id)
  seenPruned = now
}

function rebuildMeta() {
  order = [...trains.values()]
  remember(order)
  const ops: Operator[] = []
  const opIndex = new Map<string, number>()
  const rows = order.map((t) => {
    let oi = opIndex.get(t.op.id)
    if (oi === undefined) {
      oi = ops.push(t.op) - 1
      opIndex.set(t.op.id, oi)
    }
    return [t.id, t.name, oi, KINDS.indexOf(t.kind), t.color ?? '']
  })
  version++
  const meta: Meta = { v: version, ops, trains: rows as Meta['trains'] }
  metaBody = gzipSync(JSON.stringify(meta))
  health.trains = order.length
}

function rebuildLive() {
  const t = Date.now()
  const d: number[] = []
  for (let i = 0; i < order.length; i++) {
    const p = positionAt(order[i], t)
    if (!p) continue
    const flags = (p.source === 'gps' ? FLAG_GPS : 0) | (p.moving ? FLAG_MOVING : 0) | (p.rt ? FLAG_RT : 0)
    d.push(i, Math.round(p.lon * 1e5), Math.round(p.lat * 1e5), Math.round((p.bearing + 360) % 360), Math.round(p.mps * 10), Math.round(p.delay), flags)
  }
  liveBody = gzipSync(JSON.stringify({ t, v: version, d }))
  health.running = d.length / 7
}

// ---- Straight segments laid back on the tracks (snap.ts) ---------------------------------------

function layOnTracks(list: Iterable<Train>) {
  for (const t of list) {
    for (const s of t.segs) {
      if (!isStraight(s.line.points, s.line.length)) continue
      const path = pathFor(segmentKey(s.from.id, s.to.id), [s.from.lon, s.from.lat], [s.to.lon, s.to.lat])
      if (path) s.line = new Line(path)
    }
  }
}

/** A path just computed: the trains running on that segment now follow it. */
function pathReady(key: string, path: LonLat[]) {
  for (const t of trains.values()) {
    for (const s of t.segs) if (segmentKey(s.from.id, s.to.id) === key && isStraight(s.line.points, s.line.length)) s.line = new Line(path)
  }
}

type TripLeg = { legGeometry?: { points: string; precision?: number; length?: number }; from: Stop; to: Stop; intermediateStops?: Stop[] }
type Stop = { stopId: string; lat: number; lon: number }

/** A trip whose shape only joins its stations gets, stop to stop, the paths laid on the tracks. */
function straightenTrip(body: string): string {
  try {
    const j = JSON.parse(body) as { legs?: TripLeg[] }
    let changed = false
    for (const leg of j.legs ?? []) {
      const g = leg.legGeometry
      if (!g) continue
      const precision = g.precision ?? 6
      const stops = [leg.from, ...(leg.intermediateStops ?? []), leg.to]
      const points = decodePolyline(g.points, precision)
      const line = new Line(points)
      if (stops.length < 2 || points.length > stops.length + 2 || !isStraight(points, line.length)) continue
      const all: LonLat[] = []
      for (let i = 1; i < stops.length; i++) {
        const a: LonLat = [stops[i - 1].lon, stops[i - 1].lat]
        const b: LonLat = [stops[i].lon, stops[i].lat]
        const path = pathFor(segmentKey(stops[i - 1].stopId, stops[i].stopId), a, b) ?? [a, b]
        all.push(...(all.length ? path.slice(1) : path))
      }
      g.points = encodePolyline(all, precision)
      g.length = all.length
      changed = true
    }
    return changed ? JSON.stringify(j) : body
  } catch {
    return body
  }
}

// ---- Loops ----------------------------------------------------------------------------------

async function collectLoop() {
  const t0 = Date.now()
  try {
    const segs = await collect((l) => {
      if (l.status !== 200) health.errors++
      void db.logFetch('transitous', l)
    })
    indexRenfeStops(segs, renfe)
    const next = buildTrains(segs)
    layOnTracks(next.values())
    if (lastRenfe) applyRenfe(next, lastRenfe.vp, lastRenfe.tu, renfe)
    trains = next
    rebuildMeta()
    rebuildLive()
    health.lastCollect = Date.now()
    health.collectMs = Date.now() - t0
    health.segments = segs.length
    log(`collect: ${segs.length} segments, ${trains.size} trains, ${tileCount()} tiles, ${Math.round(health.collectMs / 1000)} s`)
    void db.saveTrains(trains)
  } catch (e) {
    health.errors++
    log('collect failed:', (e as Error).message)
  }
  setTimeout(collectLoop, Math.max(30_000, 180_000 - (Date.now() - t0)))
}

async function renfeLoop() {
  try {
    const base = 'https://gtfsrt.renfe.com'
    const [vpText, tuText] = await Promise.all([
      fetch(`${base}/vehicle_positions_LD.json`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`VP ${r.status}`)))),
      fetch(`${base}/trip_updates_LD.json`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`TU ${r.status}`)))),
    ])
    const vp = JSON.parse(vpText) as RenfeVP
    const tu = JSON.parse(tuText) as RenfeTU
    lastRenfe = { vp, tu }
    const before = trains.size
    applyRenfe(trains, vp, tu, renfe)
    if (trains.size !== before || order.length !== trains.size) rebuildMeta()
    health.renfe = vp.entity.length
    const ts = Number(vp.header.timestamp) * 1000 || Date.now()
    void db.saveRenfe(vpText, tuText, vp.entity.map(({ vehicle: v }) => ({
      num: (v.vehicle.label ?? v.vehicle.id).slice(0, 5), ts, lon: v.position.longitude, lat: v.position.latitude,
    })))
  } catch (e) {
    log('renfe failed:', (e as Error).message)
  }
}

// ---- HTTP -----------------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
}

function send(res: ServerResponse, status: number, body: Buffer | string, type: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': type, ...extra })
  res.end(body)
}

function sendGzipJson(req: IncomingMessage, res: ServerResponse, gz: Buffer) {
  // Every browser accepts gzip; the payloads are kept compressed in memory. They change every 5 s at
  // most, so a CDN in front (Cloudflare) can serve one copy to every visitor for that long.
  void req
  send(res, 200, gz, 'application/json', { 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=5' })
}

function detail(id: string): TrainDetail | null {
  const t = trains.get(id)
  if (!t) return null
  const p = positionAt(t, Date.now())
  if (!p) return null
  return {
    id: t.id, name: t.name, speed: p.speed, delay: p.delay, rt: p.rt, source: p.source, moving: p.moving,
    next: p.next ? { name: p.next.name, arr: p.moving && p.seg ? p.seg.arr : null, tz: p.next.tz } : null,
  }
}

/** Thrown for a request that cannot be read (malformed address or encoding): answered 400. */
class BadRequest extends Error {}

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    throw new BadRequest('bad encoding')
  }
}

async function serveStatic(res: ServerResponse, path: string) {
  const rel = normalize(decode(path)).replace(/^(\.\.[/\\])+/, '')
  let file = join(DIST, rel)
  try {
    if (!(await stat(file)).isFile()) throw new Error('dir')
  } catch {
    file = join(DIST, 'index.html') // single-page app
  }
  try {
    const body = await readFile(file)
    const hashed = /\/assets\//.test(file)
    send(res, 200, body, MIME[extname(file)] ?? 'application/octet-stream', { 'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' })
  } catch {
    send(res, 404, 'Not found', 'text/plain')
  }
}

const LOGO_PATH = /^\/logos\/(Q\d{1,12}\.(svg|png|jpg))$/
const LOGO_TYPE: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg' }

/** A logo from Commons. SVGs come from elsewhere: no script may run even if one is opened directly. */
async function serveLogo(res: ServerResponse, m: RegExpMatchArray) {
  try {
    const body = await readFile(join(LOGOS, m[1]))
    send(res, 200, body, LOGO_TYPE[m[2]], {
      'Cache-Control': 'public, max-age=86400',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      'X-Content-Type-Options': 'nosniff',
    })
  } catch {
    send(res, 404, 'Not found', 'text/plain')
  }
}

async function loadActors() {
  actorsBody = gzipSync(JSON.stringify(await db.actors()))
}

const TILE_PATH = /^\/tiles\/([a-z]+)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.pbf$/

/** A vector tile, already gzipped on disk; a tile with nothing in it answers 204, which maps read as empty.
 * Cached 10 minutes only: the tiles are rebuilt and copied without a new version of the web app. */
async function serveTile(res: ServerResponse, m: RegExpMatchArray) {
  const [, set, z, x, y] = m
  if (set === 'base') {
    // The base map changes once a month: a day in caches.
    const body = await baseTile(Number(z), Number(x), Number(y))
    if (body) return send(res, 200, body, 'application/x-protobuf', { 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=86400' })
    res.writeHead(204, { 'Cache-Control': 'public, max-age=3600' })
    return res.end()
  }
  try {
    const body = await readFile(join(TILES, set, z, x, `${y}.pbf`))
    send(res, 200, body, 'application/x-protobuf', { 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=600' })
  } catch {
    res.writeHead(204, { 'Cache-Control': 'public, max-age=600' })
    res.end()
  }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  let url: URL
  try {
    url = new URL(req.url ?? '/', 'http://localhost')
  } catch {
    throw new BadRequest('bad url') // e.g. "//"
  }
  if (url.pathname === '/api/meta') return sendGzipJson(req, res, metaBody)
  if (url.pathname === '/api/live') return sendGzipJson(req, res, liveBody)
  if (url.pathname === '/api/health') return send(res, 200, JSON.stringify({ ...health, version, tiles: tileCount() }), 'application/json')
  if (url.pathname.startsWith('/api/train/')) {
    const id = decode(url.pathname.slice('/api/train/'.length))
    const d = detail(id)
    if (!d) return send(res, 404, '{}', 'application/json')
    const p = positionAt(trains.get(id)!, Date.now())
    d.line = p ? await db.lineAt(d.name, p.lon, p.lat) : null
    return send(res, 200, JSON.stringify(d), 'application/json', { 'Cache-Control': 'public, max-age=10' })
  }
  if (url.pathname === '/api/trip') {
    // Only trains this server has seen: the endpoint is not a relay to Transitous.
    const id = url.searchParams.get('id')
    if (!id || id.length > 200) return send(res, 400, '{}', 'application/json')
    if (!seen.has(id)) return send(res, 404, '{}', 'application/json')
    return send(res, 200, straightenTrip(await trip(id)), 'application/json', { 'Cache-Control': 'public, max-age=30' })
  }
  const urban = url.pathname.match(/^\/api\/urbain\/12\/(\d{1,4})\/(\d{1,4})$/)
  if (urban) {
    const [x, y] = [Number(urban[1]), Number(urban[2])]
    if (x >= 4096 || y >= 4096) return send(res, 400, '{}', 'application/json')
    return send(res, 200, await urbanTile(x, y), 'application/json', { 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=20' })
  }
  if (url.pathname === '/api/actors') {
    return send(res, 200, actorsBody, 'application/json', { 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=3600' })
  }
  const gare = url.pathname.match(/^\/api\/gare\/(\d{1,15})(\/photo)?$/)
  if (gare) {
    // A station's sheet, or the image of its Wikipedia article, relayed and kept by this server.
    const st = await db.station(gare[1])
    if (!st) return send(res, 404, '{}', 'application/json')
    if (!gare[2]) return send(res, 200, JSON.stringify(st.detail), 'application/json', { 'Cache-Control': 'public, max-age=3600' })
    if (!st.photoUrl) return send(res, 404, 'Not found', 'text/plain')
    const p = await photo(st.photoUrl)
    return send(res, 200, p.body, p.type, {
      'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
    })
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, '{}', 'application/json')
  const logo = url.pathname.match(LOGO_PATH)
  if (logo) return serveLogo(res, logo)
  const tile = url.pathname.match(TILE_PATH)
  if (tile) return serveTile(res, tile)
  if (url.pathname.startsWith('/tiles/')) return send(res, 404, 'Not found', 'text/plain')
  return serveStatic(res, url.pathname)
}

const server = createServer((req, res) => {
  handle(req, res).catch((e: unknown) => {
    if (res.headersSent) return void res.destroy()
    if (e instanceof BadRequest) return send(res, 400, '{}', 'application/json')
    if (e instanceof Busy) return send(res, 429, '{}', 'application/json', { 'Retry-After': '5' })
    log('request failed:', req.url, (e as Error).message)
    send(res, 502, '{}', 'application/json')
  })
})

// Last line of defence: a stray rejection is logged instead of taking the collector down.
process.on('unhandledRejection', (e) => log('unhandled rejection:', e))

await db.connect()
await loadPaths(pathReady).catch(() => {}) // before the first collection: known paths are not computed again
server.listen(PORT, () => log(`listening on :${PORT}, web app from ${DIST}`))
void renfeLoop().then(collectLoop)
setInterval(renfeLoop, 30_000)
setInterval(rebuildLive, 5_000)
setInterval(() => void db.prune(), 3_600_000)
// The library changes once a month (pipeline/osm.sh): reloading it every hour is plenty.
void loadActors()
setInterval(() => void loadActors(), 3_600_000)
