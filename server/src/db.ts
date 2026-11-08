// PostgreSQL storage, in layers:
// - bronze: what was fetched (fetch log for Transitous, raw gzip payloads for Renfe GPS);
// - silver: one row per train and per stop-to-stop segment, updated as delays change, and
//   every Renfe GPS fix. Gold tables (punctuality by line, operator, day) will read silver.
// The server keeps running without a database (local development).

import pg from 'pg'
import { gzipSync } from 'node:zlib'
import type { Train } from '../../web/src/shared/model.ts'
import type { FetchLog } from './transitous.ts'

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

/** The library of actors (silver.actor, built by pipeline/actors.ts), most present first; [] before the first run. */
export async function actors(): Promise<unknown[]> {
  if (!pool) return []
  try {
    const { rows } = await pool.query(`
      select qid, name, kind, kinds, country, colour, website, logo_file as logo, lines, stations, parents
      from silver.actor order by lines + stations desc, name`)
    return rows
  } catch {
    return [] // table not built yet
  }
}
