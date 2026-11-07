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
import { collect, tileCount, trip } from './transitous.ts'
import * as db from './db.ts'

const PORT = Number(process.env.PORT ?? 8080)
const DIST = resolve(import.meta.dirname, process.env.DIST ?? '../../web/dist')
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ---- State ----------------------------------------------------------------------------------

let trains = new Map<string, Train>()
const renfe: RenfeState = { stops: new Map(), lastFix: new Map() }
let lastRenfe: { vp: RenfeVP; tu: RenfeTU } | null = null
let order: Train[] = []
let version = 0
let metaBody: Buffer = gzipSync('{"v":0,"ops":[],"trains":[]}')
let liveBody: Buffer = gzipSync('{"t":0,"v":0,"d":[]}')
const health = { lastCollect: 0, collectMs: 0, segments: 0, trains: 0, running: 0, renfe: 0, errors: 0 }

function rebuildMeta() {
  order = [...trains.values()]
  const ops: Operator[] = []
  const opIndex = new Map<string, number>()
  const rows = order.map((t) => {
    let oi = opIndex.get(t.op.id)
    if (oi === undefined) {
      oi = ops.push(t.op) - 1
      opIndex.set(t.op.id, oi)
    }
    return [t.id, t.name, oi, KINDS.indexOf(t.kind)]
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
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
}

function send(res: ServerResponse, status: number, body: Buffer | string, type: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': type, ...extra })
  res.end(body)
}

function sendGzipJson(req: IncomingMessage, res: ServerResponse, gz: Buffer) {
  // Every browser accepts gzip; the payloads are kept compressed in memory.
  void req
  send(res, 200, gz, 'application/json', { 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store' })
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

async function serveStatic(res: ServerResponse, path: string) {
  const rel = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '')
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  try {
    if (url.pathname === '/api/meta') return sendGzipJson(req, res, metaBody)
    if (url.pathname === '/api/live') return sendGzipJson(req, res, liveBody)
    if (url.pathname === '/api/health') return send(res, 200, JSON.stringify({ ...health, version, tiles: tileCount() }), 'application/json')
    if (url.pathname.startsWith('/api/train/')) {
      const d = detail(decodeURIComponent(url.pathname.slice('/api/train/'.length)))
      return d ? send(res, 200, JSON.stringify(d), 'application/json') : send(res, 404, '{}', 'application/json')
    }
    if (url.pathname === '/api/trip') {
      const id = url.searchParams.get('id')
      if (!id) return send(res, 400, '{}', 'application/json')
      return send(res, 200, await trip(id), 'application/json', { 'Cache-Control': 'max-age=30' })
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, '{}', 'application/json')
    return serveStatic(res, url.pathname)
  } catch (e) {
    send(res, 502, JSON.stringify({ error: (e as Error).message }), 'application/json')
  }
})

await db.connect()
server.listen(PORT, () => log(`listening on :${PORT}, web app from ${DIST}`))
void renfeLoop().then(collectLoop)
setInterval(renfeLoop, 30_000)
setInterval(rebuildLive, 5_000)
setInterval(() => void db.prune(), 3_600_000)
