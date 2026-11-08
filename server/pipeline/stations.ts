// The directory of stations, built after the library of actors (osm.sh, stage stations), into
// silver.station_info, one row per OpenStreetMap station:
//
// 1. Trainline's open list of European stations (github.com/trainline-eu/stations, ODbL), kept in
//    bronze.trainline_station and linked to OpenStreetMap's stations by UIC code, else by name within a
//    kilometre or so: the station's UIC code, its city, whether it is the city's main station.
// 2. The station's manager, whose logo the map shows above it: the operator OpenStreetMap gives, by
//    Wikidata id, else by name (as the app links Transitous agencies); when the library has no logo for
//    it, its parent company's (ÖBB-Infrastruktur -> ÖBB).
// 3. Its Wikipedia article (French, else English, else the first one Wikidata lists) and the article's
//    image with its credit, from Wikimedia Commons; a station without an article takes the one of a
//    station of the same name within 500 m (Paris Gare du Nord (RER) -> Paris Gare du Nord).
import pg from 'pg'
import { findByName, nameKey, nameKeys } from '../../web/src/shared/names.ts'
import { distance, type LonLat } from '../../web/src/shared/geo.ts'

const UA = 'Continent/1.0 (https://github.com/felixchvl/continent)'
const TRAINLINE = 'https://raw.githubusercontent.com/trainline-eu/stations/master/stations.csv'
const db = new pg.Pool({ host: '/var/run/postgresql', database: process.env.DB ?? 'continent', max: 2 })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a)
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

type Station = {
  id: string; kind: string; name: string | null; uic_ref: string | null; operator: string | null; operator_qid: string | null
  qid: string | null; wikipedia: string | null; lon: number; lat: number
}
type Info = {
  id: string; operator_qid: string | null; logo_qid: string | null
  trainline_id: number | null; uic: string | null; main: boolean; city: string | null
  wiki_lang: string | null; wiki_title: string | null; wiki_url: string | null; wiki_from: string | null
  photo: string | null; photo_file: string | null; photo_credit: string | null; photo_licence: string | null
}

/** GET with retries when Wikimedia or GitHub ask to slow down. */
async function get(url: string, accept = 'application/json'): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(90_000) })
    if (res.ok) return res
    if (attempt >= 5 || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} ${url.slice(0, 120)}`)
    await sleep(Number(res.headers.get('retry-after') ?? 0) * 1000 || 3000 * 2 ** attempt)
  }
}

// ---- 1. Trainline -------------------------------------------------------------------------------

type TrainlineRow = {
  id: number; name: string; uic: string | null; lat: number; lon: number; parent_id: number | null; same_as: number | null
  country: string; is_city: boolean; is_main: boolean; db_id: string | null; sncf_id: string | null
}

/** Trainline's file: semicolons, a header line, quotes around fields that need them. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ';') row.push(field), (field = '')
    else if (c === '\n') row.push(field), rows.push(row), (row = []), (field = '')
    else if (c !== '\r') field += c
  }
  if (field || row.length) row.push(field), rows.push(row)
  return rows
}

async function loadTrainline(): Promise<TrainlineRow[]> {
  const [header, ...lines] = parseCsv(await (await get(TRAINLINE, 'text/csv')).text())
  const col = (name: string) => header.indexOf(name)
  const c = { id: col('id'), name: col('name'), uic: col('uic'), lat: col('latitude'), lon: col('longitude'), parent: col('parent_station_id'),
    same: col('same_as'), country: col('country'), city: col('is_city'), main: col('is_main_station'), db: col('db_id'), sncf: col('sncf_id') }
  const num = (s: string | undefined) => (s ? Number(s) : null)
  const rows = lines
    .filter((l) => l.length >= header.length - 1 && l[c.lat] && l[c.lon])
    .map((l) => ({
      id: Number(l[c.id]), name: l[c.name], uic: l[c.uic] || null, lat: Number(l[c.lat]), lon: Number(l[c.lon]),
      parent_id: num(l[c.parent]), same_as: num(l[c.same]), country: l[c.country], is_city: l[c.city] === 't',
      is_main: l[c.main] === 't', db_id: l[c.db] || null, sncf_id: l[c.sncf] || null,
    }))
  await db.query(`drop table if exists bronze.trainline_station;
    create table bronze.trainline_station (id int primary key, name text not null, uic text, lat double precision, lon double precision,
      parent_id int, same_as int, country text, is_city boolean, is_main boolean, db_id text, sncf_id text)`)
  for (const part of chunks(rows, 5000)) {
    await db.query(`insert into bronze.trainline_station select * from jsonb_to_recordset($1::jsonb) as x(id int, name text, uic text,
      lat double precision, lon double precision, parent_id int, same_as int, country text, is_city boolean, is_main boolean, db_id text, sncf_id text)`,
      [JSON.stringify(part)])
  }
  return rows
}

/** "Paris Gare du Nord (RER)" -> "paris gare du nord": the name without what is in brackets. */
const baseKey = (name: string | null) => (name ? nameKey(name.replace(/\s*[([].*?[)\]]\s*/g, ' ')) : '')

function linkTrainline(stations: Station[], rows: TrainlineRow[], info: Map<string, Info>) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const places = rows.filter((r) => !r.is_city)
  const byUic = new Map<string, TrainlineRow>()
  for (const r of places) if (r.uic && (!byUic.has(r.uic) || r.is_main)) byUic.set(r.uic, r)
  // A grid of 0.02° cells (about 2 km) for the name match.
  const cell = (lon: number, lat: number) => `${Math.floor(lon / 0.02)}:${Math.floor(lat / 0.02)}`
  const grid = new Map<string, TrainlineRow[]>()
  for (const r of places) {
    const k = cell(r.lon, r.lat)
    grid.set(k, [...(grid.get(k) ?? []), r])
  }
  let byCode = 0
  let byName = 0
  for (const s of stations) {
    if (s.kind === 'tram') continue
    const uic = s.uic_ref?.match(/^\d{7}/)?.[0] ?? null
    let r = uic ? byUic.get(uic) : undefined
    if (r) byCode++
    else if (s.name) {
      const key = baseKey(s.name)
      let best: [TrainlineRow, number] | null = null
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const c of grid.get(`${Math.floor(s.lon / 0.02) + dx}:${Math.floor(s.lat / 0.02) + dy}`) ?? []) {
            const ck = baseKey(c.name)
            const d = distance([s.lon, s.lat], [c.lon, c.lat])
            // Same name within 1.5 km, or one name starting the other within 500 m (Lyon Part-Dieu / Lyon-Part-Dieu Gare).
            const same = ck === key ? d < 1500 : (ck.startsWith(key + ' ') || key.startsWith(ck + ' ')) && d < 500
            if (same && (!best || d < best[1])) best = [c, d]
          }
        }
      }
      if (best) (r = best[0]), byName++
    }
    if (!r) continue
    const canonical = r.same_as ? byId.get(r.same_as) ?? r : r
    const city = r.parent_id ? byId.get(r.parent_id) : undefined
    const i = info.get(s.id)!
    i.trainline_id = r.id
    i.uic = r.uic ?? uic
    i.main = r.is_main || (canonical !== r && canonical.is_main && canonical.uic === r.uic)
    i.city = city?.is_city ? city.name : null
  }
  log(`trainline: ${rows.length} places, stations linked by UIC code ${byCode}, by name ${byName}`)
}

// ---- 2. Managers --------------------------------------------------------------------------------

type ActorRow = { qid: string; name: string; name_fr: string | null; name_en: string | null; names: string[] | null; kind: string; parents: string[]; logo_file: string | null }

async function linkManagers(stations: Station[], info: Map<string, Info>) {
  const { rows: actors } = await db.query<ActorRow>(
    'select qid, name, name_fr, name_en, names, kind, parents, logo_file from silver.actor order by lines + stations desc')
  const byQid = new Map(actors.map((a) => [a.qid, a]))
  // Most present first: when two actors share a name, the one with more lines and stations wins.
  const byName = new Map<string, ActorRow>()
  const add = (n: string, a: ActorRow) => {
    for (const k of nameKeys(n)) if (!byName.has(k)) byName.set(k, a)
  }
  for (const a of actors) for (const n of [a.name, a.name_fr, a.name_en]) if (n) add(n, a)
  for (const a of actors) for (const n of a.names ?? []) add(n, a)
  const { rows: written } = await db.query<{ name: string; qid: string }>(`select name, qid from silver.actor_name where qid is not null order by stations desc`)
  for (const w of written) if (byQid.has(w.qid)) add(w.name, byQid.get(w.qid)!)

  /** The actor itself when the library has its logo, else its closest parent company that has one. */
  const withLogo = (a: ActorRow): ActorRow | null => {
    let level = [a]
    for (let depth = 0; depth < 3 && level.length; depth++) {
      const hit = level.find((x) => x.logo_file && (depth === 0 || !['collectivite', 'autre', 'ligne'].includes(x.kind)))
      if (hit) return hit
      level = level.flatMap((x) => x.parents.map((p) => byQid.get(p)).filter((p): p is ActorRow => !!p))
    }
    return null
  }
  let linked = 0
  let logos = 0
  for (const s of stations) {
    const qid = s.operator_qid?.split(';')[0].trim()
    const a = (qid ? byQid.get(qid) : undefined) ?? findByName(byName, s.operator?.split(';')[0])
    if (!a) continue
    const i = info.get(s.id)!
    i.operator_qid = a.qid
    i.logo_qid = withLogo(a)?.qid ?? null
    linked++
    if (i.logo_qid) logos++
  }
  log(`managers: ${linked} stations linked to the library, ${logos} with a logo`)
}

// ---- 3. Wikipedia -------------------------------------------------------------------------------

type Article = { lang: string; title: string }
type Page = { url: string; photo: string | null; file: string | null }

// Wikimedia projects whose site ids end in "wiki" but which are not a Wikipedia.
const NOT_WIKIPEDIA = new Set(['commonswiki', 'specieswiki', 'metawiki', 'mediawikiwiki', 'wikidatawiki', 'sourceswiki',
  'wikimaniawiki', 'outreachwiki', 'incubatorwiki', 'foundationwiki', 'wikifunctionswiki'])

/** Every Wikipedia article about each item, by language: Wikidata's API, 50 items a request (the SPARQL
 * service times out on so many sitelinks). */
async function sitelinks(qids: string[]): Promise<Map<string, Article[]>> {
  const out = new Map<string, Article[]>()
  let failed = 0
  for (const part of chunks(qids, 50)) {
    let j: { entities?: Record<string, { sitelinks?: Record<string, { site: string; title: string }> }> }
    try {
      j = (await (await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&ids=${part.join('|')}`)).json()) as typeof j
    } catch (e) {
      failed += part.length
      log(`sitelinks: ${(e as Error).message}`)
      continue
    }
    for (const [qid, e] of Object.entries(j.entities ?? {})) {
      const articles = Object.values(e.sitelinks ?? {})
        .filter((l) => l.site.endsWith('wiki') && !NOT_WIKIPEDIA.has(l.site))
        .map((l) => ({ lang: l.site.slice(0, -4).replace(/_/g, '-'), title: l.title }))
      if (articles.length) out.set(qid, articles)
    }
    await sleep(100)
  }
  if (failed) log(`sitelinks: ${failed} items could not be read`)
  return out
}

/** The article in French, else English, else the first one. */
const pick = (articles: Article[]) =>
  articles.find((a) => a.lang === 'fr') ?? articles.find((a) => a.lang === 'en') ?? [...articles].sort((a, b) => a.lang.localeCompare(b.lang))[0]

/** Up to 50 titles a request, and short enough an address (Cyrillic or Greek titles triple in length
 * once encoded: Wikipedia answers 414 beyond about 8 KB). */
function batches(titles: string[]): string[][] {
  const out: string[][] = []
  let part: string[] = []
  let length = 0
  for (const t of titles) {
    const n = encodeURIComponent(t).length + 3
    if (part.length && (part.length === 50 || length + n > 6000)) (out.push(part), (part = []), (length = 0))
    part.push(t)
    length += n
  }
  if (part.length) out.push(part)
  return out
}

/** The pages' address and image (Wikipedia gives freely licensed images only). */
async function pages(lang: string, titles: string[]): Promise<Map<string, Page>> {
  const out = new Map<string, Page>()
  for (const part of batches(titles)) {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageimages|info` +
      `&inprop=url&piprop=thumbnail|name&pithumbsize=800&titles=${encodeURIComponent(part.join('|'))}`
    let j: { query?: { normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[]; pages?: { title: string; missing?: boolean; fullurl?: string; pageimage?: string; thumbnail?: { source: string } }[] } }
    try {
      j = (await (await get(url)).json()) as typeof j
    } catch (e) {
      log(`wikipedia ${lang}: ${(e as Error).message}`)
      continue
    }
    const found = new Map((j.query?.pages ?? []).filter((p) => !p.missing && p.fullurl).map((p) => [p.title, p]))
    const follow = (t: string) => {
      for (const step of [j.query?.normalized, j.query?.redirects]) t = step?.find((x) => x.from === t)?.to ?? t
      return t
    }
    for (const t of part) {
      const p = found.get(follow(t))
      if (p) out.set(t, { url: p.fullurl!, photo: p.thumbnail?.source ?? null, file: p.pageimage ?? null })
    }
    await sleep(200)
  }
  return out
}

/** Author and licence of each image on Commons; an image that is not on Commons gets none. */
async function credits(files: string[]): Promise<Map<string, { artist: string | null; licence: string }>> {
  const out = new Map<string, { artist: string | null; licence: string }>()
  const text = (html: string | undefined) => html?.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim().slice(0, 160) || null
  for (const part of chunks(files, 50)) {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=extmetadata' +
      `&iiextmetadatafilter=Artist|LicenseShortName&titles=${encodeURIComponent(part.map((f) => `File:${f}`).join('|'))}`
    let j: { query?: { normalized?: { from: string; to: string }[]; pages?: { title: string; imageinfo?: { extmetadata?: Record<string, { value: string }> }[] }[] } }
    try {
      j = (await (await get(url)).json()) as typeof j
    } catch (e) {
      log(`commons: ${(e as Error).message}`)
      continue
    }
    const byTitle = new Map((j.query?.pages ?? []).map((p) => [p.title, p]))
    for (const f of part) {
      const asked = `File:${f}`
      const p = byTitle.get(j.query?.normalized?.find((n) => n.from === asked)?.to ?? asked)
      const m = p?.imageinfo?.[0]?.extmetadata
      const licence = text(m?.LicenseShortName?.value)
      if (licence) out.set(f, { artist: text(m?.Artist?.value), licence })
    }
    await sleep(200)
  }
  return out
}

async function linkWikipedia(stations: Station[], info: Map<string, Info>) {
  const qids = [...new Set(stations.map((s) => s.qid?.split(';')[0].trim()).filter((q): q is string => !!q && /^Q\d+$/.test(q)))]
  const links = await sitelinks(qids)
  log(`wikipedia: ${links.size} of ${qids.length} items have an article`)
  const chosen = new Map<string, Article>()
  for (const s of stations) {
    const qid = s.qid?.split(';')[0].trim()
    const articles = qid ? links.get(qid) : undefined
    const tag = s.wikipedia?.match(/^([a-z-]{2,12}):(.+)$/)
    const a = articles?.length ? pick(articles) : tag ? { lang: tag[1], title: tag[2] } : undefined
    if (a) chosen.set(s.id, a)
  }
  // Pages, by wiki.
  const byLang = new Map<string, Set<string>>()
  for (const a of chosen.values()) byLang.set(a.lang, (byLang.get(a.lang) ?? new Set()).add(a.title))
  const found = new Map<string, Page>()
  for (const [lang, titles] of byLang) for (const [t, p] of await pages(lang, [...titles])) found.set(`${lang}:${t}`, p)
  const files = [...new Set([...found.values()].map((p) => p.file).filter((f): f is string => !!f))]
  const credit = await credits(files)
  log(`wikipedia: ${found.size} pages, ${files.length} images, ${credit.size} with their credit on Commons`)
  for (const [id, a] of chosen) {
    const p = found.get(`${a.lang}:${a.title}`)
    if (!p) continue
    const i = info.get(id)!
    i.wiki_lang = a.lang
    i.wiki_title = decodeURIComponent(p.url.slice(p.url.indexOf('/wiki/') + 6)).replace(/_/g, ' ')
    i.wiki_url = p.url
    const c = p.file ? credit.get(p.file) : undefined
    if (c && p.photo) Object.assign(i, { photo: p.photo, photo_file: p.file, photo_credit: c.artist, photo_licence: c.licence })
  }
  // A station without an article takes the one of a station of the same name within 500 m.
  const withArticle = stations.filter((s) => info.get(s.id)!.wiki_url)
  const near = new Map<string, Station[]>()
  for (const s of withArticle) {
    const k = baseKey(s.name)
    if (k) near.set(k, [...(near.get(k) ?? []), s])
  }
  let inherited = 0
  for (const s of stations) {
    const i = info.get(s.id)!
    if (i.wiki_url || !s.name) continue
    const here: LonLat = [s.lon, s.lat]
    const from = near.get(baseKey(s.name))?.find((o) => distance(here, [o.lon, o.lat]) < 500)
    if (!from) continue
    const f = info.get(from.id)!
    Object.assign(i, { wiki_lang: f.wiki_lang, wiki_title: f.wiki_title, wiki_url: f.wiki_url, wiki_from: from.id,
      photo: f.photo, photo_file: f.photo_file, photo_credit: f.photo_credit, photo_licence: f.photo_licence })
    inherited++
  }
  log(`wikipedia: ${withArticle.length} stations with their article, ${inherited} with a neighbour's`)
}

// ---- Main ---------------------------------------------------------------------------------------

async function main() {
  const { rows: stations } = await db.query<Station>(`
    select s.id::text, s.kind, s.name, s.uic_ref, s.operator, s.operator_qid, s.qid, o.tags->>'wikipedia' as wikipedia,
           st_x(s.geom) as lon, st_y(s.geom) as lat
    from silver.station s join osm.station o on o.node_id = s.id`)
  const info = new Map<string, Info>(stations.map((s) => [s.id, {
    id: s.id, operator_qid: null, logo_qid: null, trainline_id: null, uic: null, main: false, city: null,
    wiki_lang: null, wiki_title: null, wiki_url: null, wiki_from: null, photo: null, photo_file: null, photo_credit: null, photo_licence: null,
  }]))
  log(`${stations.length} stations`)

  linkTrainline(stations, await loadTrainline(), info)
  await linkManagers(stations, info)
  await linkWikipedia(stations, info)

  const client = await db.connect()
  try {
    await client.query('begin')
    await client.query(`drop table if exists silver.station_info;
      create table silver.station_info (id bigint primary key, operator_qid text, logo_qid text, trainline_id int, uic text,
        main boolean not null, city text, wiki_lang text, wiki_title text, wiki_url text, wiki_from bigint,
        photo text, photo_file text, photo_credit text, photo_licence text)`)
    for (const part of chunks([...info.values()], 5000)) {
      await client.query(`insert into silver.station_info select * from jsonb_to_recordset($1::jsonb) as x(id bigint, operator_qid text,
        logo_qid text, trainline_id int, uic text, main boolean, city text, wiki_lang text, wiki_title text, wiki_url text, wiki_from bigint,
        photo text, photo_file text, photo_credit text, photo_licence text)`, [JSON.stringify(part)])
    }
    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
  const { rows } = await db.query<Record<string, number>>(`select count(*)::int as stations, count(trainline_id)::int as trainline,
    count(*) filter (where main)::int as main, count(logo_qid)::int as logos, count(wiki_url)::int as articles, count(photo)::int as photos
    from silver.station_info`)
  log(Object.entries(rows[0]).map(([k, v]) => `${k} ${v}`).join(', '))
  await db.end()
}

await main()
