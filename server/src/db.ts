// PostgreSQL storage, in layers:
// - bronze: what was fetched (fetch log for Transitous, raw gzip payloads for Renfe GPS);
// - silver: one row per train and per stop-to-stop segment, updated as delays change, and
//   every Renfe GPS fix. Gold tables (punctuality by line, operator, day) will read silver.
// The server keeps running without a database (local development).

import pg from 'pg'
import { gzipSync } from 'node:zlib'
import type { Train } from '../../web/src/shared/model.ts'
import type { FetchLog } from './transitous.ts'
import type { LineInfo, StationDetail } from '../../web/src/shared/protocol.ts'

const SCHEMA = `
create schema if not exists bronze;
create schema if not exists silver;
create table if not exists bronze.fetch_log (
  id bigserial primary key, source text not null, fetched_at timestamptz not null default now(),
  status int, items int, bytes int, ms int, params text);
create table if not exists bronze.renfe (fetched_at timestamptz primary key, vp bytea, tu bytea);
create table if not exists silver.train (
  trip_id text primary key, name text, operator text, kind text,
  first_seen timestamptz not null default now(), last_seen timestamptz not null default now());
create table if not exists silver.segment (
  trip_id text not null, from_id text not null, to_id text, from_name text, to_name text,
  sched_dep timestamptz not null, sched_arr timestamptz, dep timestamptz, arr timestamptz, realtime boolean,
  first_seen timestamptz not null default now(), last_seen timestamptz not null default now(),
  primary key (trip_id, from_id, sched_dep));
create index if not exists segment_sched_dep on silver.segment (sched_dep);
create table if not exists silver.gps_fix (num text not null, ts timestamptz not null, lon double precision, lat double precision, primary key (num, ts));
create table if not exists silver.segment_path (
  key text primary key, path jsonb, computed_at timestamptz not null default now());
`

let pool: pg.Pool | null = null

export async function connect() {
  try {
    const p = new pg.Pool({ host: process.env.PGHOST ?? '/var/run/postgresql', database: process.env.PGDATABASE ?? 'continent', max: 4 })
    await p.query(SCHEMA)
    pool = p
    console.log('db: connected')
  } catch (e) {
    console.warn('db: unavailable, running without storage —', (e as Error).message)
  }
}

export async function logFetch(source: string, l: FetchLog) {
  if (!pool) return
  await pool.query('insert into bronze.fetch_log (source, status, items, bytes, ms, params) values ($1,$2,$3,$4,$5,$6)', [
    source, l.status, l.items, l.bytes, l.ms, l.params,
  ]).catch((e) => console.warn('db: fetch_log', e.message))
}

export async function saveTrains(trains: Map<string, Train>) {
  if (!pool) return
  const t: string[][] = [[], [], [], []]
  const s: (string | boolean | null)[][] = [[], [], [], [], [], [], [], [], [], []]
  const iso = (n: number) => (Number.isFinite(n) ? new Date(n).toISOString() : null)
  for (const tr of trains.values()) {
    if (tr.id.startsWith('renfe:')) continue
    t[0].push(tr.id); t[1].push(tr.name); t[2].push(tr.op.id); t[3].push(tr.kind)
    for (const g of tr.segs) {
      s[0].push(tr.id); s[1].push(g.from.id); s[2].push(g.to.id); s[3].push(g.from.name); s[4].push(g.to.name)
      s[5].push(iso(g.sdep)); s[6].push(iso(g.sarr)); s[7].push(iso(g.dep)); s[8].push(iso(g.arr)); s[9].push(g.rt)
    }
  }
  try {
    await pool.query(
      `insert into silver.train (trip_id, name, operator, kind)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::text[])
       on conflict (trip_id) do update set last_seen = now(), name = excluded.name`,
      t,
    )
    await pool.query(
      `insert into silver.segment (trip_id, from_id, to_id, from_name, to_name, sched_dep, sched_arr, dep, arr, realtime)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::timestamptz[], $7::timestamptz[], $8::timestamptz[], $9::timestamptz[], $10::boolean[])
       where $6 is not null
       on conflict (trip_id, from_id, sched_dep) do update
         set dep = excluded.dep, arr = excluded.arr, realtime = excluded.realtime, last_seen = now()`,
      s,
    )
  } catch (e) {
    console.warn('db: saveTrains', (e as Error).message)
  }
}

export async function saveRenfe(vpText: string, tuText: string, fixes: { num: string; ts: number; lon: number; lat: number }[]) {
  if (!pool) return
  try {
    await pool.query('insert into bronze.renfe (fetched_at, vp, tu) values (now(), $1, $2) on conflict do nothing', [gzipSync(vpText), gzipSync(tuText)])
    await pool.query(
      `insert into silver.gps_fix (num, ts, lon, lat)
       select * from unnest($1::text[], $2::timestamptz[], $3::float8[], $4::float8[]) on conflict do nothing`,
      [fixes.map((f) => f.num), fixes.map((f) => new Date(f.ts).toISOString()), fixes.map((f) => f.lon), fixes.map((f) => f.lat)],
    )
  } catch (e) {
    console.warn('db: saveRenfe', (e as Error).message)
  }
}

/** Keeps bronze small: a few days of raw data is enough to replay or debug. */
export async function prune() {
  if (!pool) return
  await pool.query(`
    delete from bronze.fetch_log where fetched_at < now() - interval '7 days';
    delete from bronze.renfe where fetched_at < now() - interval '3 days';
    delete from silver.gps_fix where ts < now() - interval '60 days';`).catch((e) => console.warn('db: prune', e.message))
}

const lineCache = new Map<string, { at: number; line: LineInfo | null }>()

/**
 * The OpenStreetMap line a train is on: same reference (its name, 'RE 2' or 'RE2', its first word) and
 * running within about 2 km of where the train is. Cached an hour per name and area.
 */
export async function lineAt(trainName: string, lon: number, lat: number): Promise<LineInfo | null> {
  if (!pool || !trainName) return null
  const words = trainName.toUpperCase().split(/\s+/).filter(Boolean)
  const refs = [...new Set([words.join(''), words.slice(0, 2).join(''), words[0]])].filter((r) => r.length <= 8)
  if (!refs.length) return null
  const key = `${refs.join('|')}@${lon.toFixed(1)},${lat.toFixed(1)}`
  const hit = lineCache.get(key)
  if (hit && Date.now() - hit.at < 3_600_000) return hit.line
  let line: LineInfo | null = null
  try {
    const { rows } = await pool.query<LineInfo>(`
      select l.ref, l.name, l.colour, la.logo_file as logo, coalesce(na.name, l.network) as network, na.logo_file as "networkLogo"
      from silver.line l join silver.line_shape s on s.id = l.id
      left join silver.actor la on la.qid = l.qid
      left join silver.actor na on na.qid = split_part(l.network_qid, ';', 1)
      where upper(replace(l.ref, ' ', '')) = any($1) and l.mode <> 'railway'
        and st_dwithin(s.geom, st_setsrid(st_point($2, $3), 4326), 0.02)
      order by array_position($1, upper(replace(l.ref, ' ', ''))), st_distance(s.geom, st_setsrid(st_point($2, $3), 4326))
      limit 1`, [refs, lon, lat])
    line = rows[0] ?? null
  } catch {
    line = null // silver tables not built yet
  }
  lineCache.set(key, { at: Date.now(), line })
  if (lineCache.size > 20_000) lineCache.delete(lineCache.keys().next().value!)
  return line
}

/** A station's sheet (silver.station_info, built by pipeline/stations.ts) and the address of its
 * Wikipedia image, or null when the station is unknown. */
export async function station(id: string): Promise<{ detail: StationDetail; photoUrl: string | null } | null> {
  if (!pool) return null
  try {
    const { rows } = await pool.query(`
      select s.id::text, s.kind, s.name, st_x(s.geom) as lon, st_y(s.geom) as lat, i.uic, coalesce(i.main, false) as main, i.city,
             m.qid as manager_qid, m.name as manager, l.logo_file as manager_logo,
             i.wiki_lang, i.wiki_title, i.wiki_url, i.photo, i.photo_file, i.photo_credit, i.photo_licence
      from silver.station s
      left join silver.station_info i on i.id = s.id
      left join silver.actor m on m.qid = i.operator_qid
      left join silver.actor l on l.qid = i.logo_qid
      where s.id = $1`, [id])
    const r = rows[0]
    if (!r) return null
    return {
      photoUrl: r.photo,
      detail: {
        id: r.id, kind: r.kind, name: r.name, lon: r.lon, lat: r.lat, uic: r.uic, main: r.main, city: r.city,
        manager: r.manager_qid ? { qid: r.manager_qid, name: r.manager, logo: r.manager_logo } : null,
        wiki: r.wiki_url ? { lang: r.wiki_lang, title: r.wiki_title, url: r.wiki_url } : null,
        photo: r.photo ? { credit: r.photo_credit, licence: r.photo_licence, file: r.photo_file } : null,
      },
    }
  } catch {
    return null // silver tables not built yet
  }
}

/** The library of actors (silver.actor, built by pipeline/actors.ts), most present first, with the names
 * OpenStreetMap writes for each (aliases); [] before the first run. */
export async function actors(): Promise<unknown[]> {
  if (!pool) return []
  try {
    const { rows } = await pool.query(`
      select a.qid, a.name, a.name_fr, a.name_en, a.kind, a.kinds, a.country, a.colour, a.website, a.logo_file as logo,
             a.lines, a.stations, a.parents,
             coalesce((select array_agg(n.name order by n.lines + n.stations desc) from silver.actor_name n where n.qid = a.qid), '{}')
               || case when a.kind <> 'ligne' then coalesce(a.names, '{}') else '{}' end as aliases -- lines' names in 50 languages are no use here
      from silver.actor a order by a.lines + a.stations desc, a.name`)
    return rows
  } catch {
    return [] // table not built yet
  }
}

/**
 * Every rail track (OpenStreetMap, osm.way) within `width` degrees of the straight line a-b, service
 * tracks included: the platform tracks of big stations are often tagged as such, and without them
 * the network breaks apart at the stations.
 */
export async function tracksNear(a: [number, number], b: [number, number], width: number): Promise<[number, number][][]> {
  if (!pool) return []
  const { rows } = await pool.query<{ g: string }>(`
    with l as (select st_setsrid(st_makeline(st_point($1, $2), st_point($3, $4)), 4326) as g)
    select st_asgeojson(t.geom, 6) as g from osm.way t, l
    where t.railway in ('rail', 'narrow_gauge', 'light_rail') and t.geom && st_expand(l.g, $5) and st_dwithin(t.geom, l.g, $5)`,
    [a[0], a[1], b[0], b[1], width])
  return rows.map((r) => (JSON.parse(r.g) as { coordinates: [number, number][] }).coordinates)
}

/** Paths computed for straight segments (null: none found), kept across restarts. */
export async function loadSegmentPaths(): Promise<Map<string, [number, number][] | null>> {
  const out = new Map<string, [number, number][] | null>()
  if (!pool) return out
  const { rows } = await pool.query<{ key: string; path: [number, number][] | null }>(
    `select key, path from silver.segment_path where computed_at > now() - interval '35 days'`)
  for (const r of rows) out.set(r.key, r.path)
  return out
}

export async function saveSegmentPath(key: string, path: [number, number][] | null) {
  if (!pool) return
  await pool.query(
    `insert into silver.segment_path (key, path) values ($1, $2) on conflict (key) do update set path = excluded.path, computed_at = now()`,
    [key, path ? JSON.stringify(path) : null])
}
