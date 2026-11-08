// The library of actors of European rail: operators, brands, networks, lines, transport authorities,
// infrastructure managers, regions and cities. Run by osm.sh after silver.sql.
//
// 1. Every Wikidata id that OpenStreetMap gives for a line or a station (operator, network, the line
//    itself) is an actor; their parent organisations are added too (two levels).
// 2. Wikidata says who each one is: name (French first), kind, country, territory, parents, colour,
//    website, logo.
// 3. Logos are downloaded from Wikimedia Commons into $LOGOS (SVG when Commons has one), kept between
//    runs unless the file on Wikidata changed.
// 4. silver.actor holds the library; silver.actor_name every operator or network name written in
//    OpenStreetMap, with the actor it points to when known (to link names without ids later).
import pg from 'pg'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const UA = 'Continent/1.0 (https://github.com/felixchvl/continent)'
const LOGOS = process.env.LOGOS ?? '/var/lib/continent/logos'
const SPARQL = 'https://query.wikidata.org/sparql'
const db = new pg.Pool({ host: '/var/run/postgresql', database: process.env.DB ?? 'continent', max: 2 })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a)

type Kind = 'ligne' | 'marque' | 'autorite' | 'reseau' | 'exploitant' | 'infrastructure' | 'collectivite' | 'autre'
type Actor = {
  qid: string; name: string; name_fr: string | null; name_en: string | null; kind: Kind; kinds: Kind[]; types: string[]
  country: string | null; territory: string | null; parents: string[]; colour: string | null; website: string | null
  logo_source: string | null; logo_file: string | null
}

// What the actor's Wikidata classes say it is, matched on their French and English labels. An actor
// can be several things (CFL runs trains and manages the tracks); its main kind is the first match.
const KIND_RULES: [RegExp, Kind][] = [
  [/\b(ligne|line)\b|ligne de (métro|tram)|s-bahn line/i, 'ligne'],
  [/marque|\bbrand|train service|service ferroviaire|train category|catégorie de train|type of train/i, 'marque'],
  [/autorité organisatrice|transport authority|transit authority|verkehrsverbund|tarifverbund|organising authority|passenger transport executive|transport association|communauté tarifaire|syndicat (mixte )?de transport/i, 'autorite'],
  [/réseau|network|rapid transit|metro system|système de métro|tramway|tram system|s-bahn|commuter rail|light rail|transit system|suburban railway|funicular|\brer\b/i, 'reseau'],
  [/entreprise ferroviaire|railway company|train operating company|\boperator|exploitant|transport company|company|entreprise|société|business|enterprise|state.owned|public undertaking/i, 'exploitant'],
  [/gestionnaire d.infrastructure|infrastructure manager|railway infrastructure|infrastructure company/i, 'infrastructure'],
  [/\b(régions?|regions?)\b|state of germany|land d.allemagne|\bdépartement|\bcounty\b|\bcanton\b|\bprovince\b|\bmunicipality|\bcommunes?\b|\bcity\b|\bvilles?\b|administrative|territorial|autonomous community|voivodeship|oblast/i, 'collectivite'],
]

async function sparql<T>(query: string): Promise<T[]> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(SPARQL, {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ query }),
      signal: AbortSignal.timeout(90_000),
    })
    if (res.ok) {
      const j = (await res.json()) as { results: { bindings: Record<string, { value: string }>[] } }
      return j.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])) as T)
    }
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`Wikidata ${res.status}`)
    await sleep(Number(res.headers.get('retry-after') ?? 0) * 1000 || 5000 * (attempt + 1))
  }
}

const qidOf = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1)
const values = (qids: string[]) => qids.map((q) => `wd:${q}`).join(' ')
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

type Row = Record<'item' | 'fr' | 'en' | 'mul' | 'logo' | 'colour' | 'cc' | 'website' | 'parent' | 'type' | 'territory', string | undefined>

async function describe(qids: string[]): Promise<Map<string, Omit<Actor, 'kind' | 'kinds' | 'logo_file'>>> {
  const out = new Map<string, Omit<Actor, 'kind' | 'kinds' | 'logo_file'>>()
  for (const part of chunks(qids, 250)) {
    const rows = await sparql<Row>(`SELECT ?item ?fr ?en ?mul ?logo ?colour ?cc ?website ?parent ?type ?territory WHERE {
      VALUES ?item { ${values(part)} }
      OPTIONAL { ?item rdfs:label ?fr FILTER(LANG(?fr) = "fr") }
      OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
      OPTIONAL { ?item rdfs:label ?mul FILTER(LANG(?mul) = "mul") }
      OPTIONAL { ?item wdt:P154 ?logo }
      OPTIONAL { ?item wdt:P465 ?colour }
      OPTIONAL { ?item wdt:P17/wdt:P297 ?cc }
      OPTIONAL { ?item wdt:P856 ?website }
      OPTIONAL { ?item wdt:P749 ?parent }
      OPTIONAL { ?item wdt:P31 ?type }
      OPTIONAL { ?item wdt:P131 ?territory }
    }`)
    for (const r of rows) {
      const qid = qidOf(r.item!)
      let a = out.get(qid)
      if (!a) {
        a = { qid, name: '', name_fr: null, name_en: null, types: [], country: null, territory: null, parents: [], colour: null, website: null, logo_source: null }
        out.set(qid, a)
      }
      a.name_fr ??= r.fr ?? null
      a.name_en ??= r.en ?? null
      a.name ||= r.fr ?? r.mul ?? r.en ?? ''
      a.logo_source ??= r.logo ?? null
      a.colour ??= r.colour && /^[0-9a-f]{6}$/i.test(r.colour) ? `#${r.colour.toLowerCase()}` : null
      a.country ??= r.cc ?? null
      a.website ??= r.website ?? null
      a.territory ??= r.territory ? qidOf(r.territory) : null
      if (r.parent && !a.parents.includes(qidOf(r.parent))) a.parents.push(qidOf(r.parent))
      if (r.type && !a.types.includes(qidOf(r.type))) a.types.push(qidOf(r.type))
    }
    log(`wikidata: ${out.size} actors described`)
    await sleep(1000)
  }
  return out
}

async function typeLabels(qids: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  for (const part of chunks(qids, 400)) {
    const rows = await sparql<{ item: string; fr?: string; en?: string }>(`SELECT ?item ?fr ?en WHERE {
      VALUES ?item { ${values(part)} }
      OPTIONAL { ?item rdfs:label ?fr FILTER(LANG(?fr) = "fr") }
      OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
    }`)
    for (const r of rows) labels.set(qidOf(r.item), [r.fr, r.en].filter(Boolean).join(' / '))
    await sleep(1000)
  }
  return labels
}

function kindsOf(types: string[], labels: Map<string, string>): Kind[] {
  const text = types.map((t) => labels.get(t) ?? '').join(' | ')
  const kinds = KIND_RULES.filter(([re]) => re.test(text)).map(([, k]) => k)
  return kinds.length ? kinds : ['autre']
}

const statuses = new Map<string, number>()
const count = (k: string) => statuses.set(k, (statuses.get(k) ?? 0) + 1)

/**
 * Downloads a logo from Commons unless the same file is already on disk; returns the local file name.
 * Wikimedia throttles bursts (429): wait as long as it asks, or longer each time, then try again.
 */
async function fetchLogo(qid: string, source: string, previous: { source: string | null; file: string | null } | undefined) {
  const file = decodeURIComponent(source.slice(source.lastIndexOf('/') + 1))
  const lower = file.toLowerCase()
  const ext = lower.endsWith('.svg') ? '.svg' : lower.endsWith('.png') ? '.png' : /\.jpe?g$/.test(lower) ? '.jpg' : null
  if (!ext) return (count('format'), null)
  const local = `${qid}${ext}`
  if (previous?.source === source) {
    try {
      await access(join(LOGOS, local))
      return (count('kept'), local)
    } catch { /* not on disk yet */ }
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`, {
      headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 429 || res.status >= 500) {
      await sleep(Number(res.headers.get('retry-after') ?? 0) * 1000 || 2000 * 2 ** attempt)
      continue
    }
    if (!res.ok) return (count(String(res.status)), null)
    const body = Buffer.from(await res.arrayBuffer())
    if (body.length > 3_000_000) return (count('too big'), null)
    await writeFile(join(LOGOS, local), body)
    await sleep(500) // be gentle with Wikimedia
    return (count('downloaded'), local)
  }
  return (count('throttled'), null)
}

// Logos are fetched for the actors that matter most first: organisations before lines, the most present first.
const KIND_ORDER: Kind[] = ['exploitant', 'reseau', 'autorite', 'infrastructure', 'marque', 'collectivite', 'autre', 'ligne']

async function main() {
  await mkdir(LOGOS, { recursive: true })
  await db.query(`
    create table if not exists silver.actor (
      qid text primary key, name text not null, name_fr text, name_en text, kind text not null, types text[] not null,
      country text, territory text, parents text[] not null, colour text, website text,
      logo_source text, logo_file text, lines int not null default 0, stations int not null default 0, updated timestamptz not null default now());
    alter table silver.actor add column if not exists kinds text[];
    create table if not exists silver.actor_name (
      name text not null, role text not null, qid text, lines int not null, stations int not null, primary key (name, role));`)

  // 1. Every id OpenStreetMap gives, with how many lines and stations point to it.
  const { rows: seeds } = await db.query<{ qid: string; lines: number; stations: number }>(`
    with ids as (
      select unnest(string_to_array(operator_qid, ';')) as qid, 1 as l, 0 as s from silver.line
      union all select unnest(string_to_array(network_qid, ';')), 1, 0 from silver.line
      union all select unnest(string_to_array(qid, ';')), 1, 0 from silver.line where mode <> 'railway'
      union all select unnest(string_to_array(operator_qid, ';')), 0, 1 from silver.station
      union all select unnest(string_to_array(network_qid, ';')), 0, 1 from silver.station)
    select trim(qid) as qid, sum(l)::int as lines, sum(s)::int as stations from ids
    where trim(qid) ~ '^Q[0-9]+$' group by 1`)
  const counts = new Map(seeds.map((s) => [s.qid, s]))
  log(`${seeds.length} ids from OpenStreetMap`)

  // 2. Describe them, then their parents (two levels).
  const actors = await describe([...counts.keys()])
  for (let level = 0; level < 2; level++) {
    const parents = [...new Set([...actors.values()].flatMap((a) => a.parents))].filter((q) => !actors.has(q))
    if (!parents.length) break
    for (const [q, a] of await describe(parents)) actors.set(q, a)
  }
  const labels = await typeLabels([...new Set([...actors.values()].flatMap((a) => a.types))])

  // 3. Logos.
  const { rows: before } = await db.query<{ qid: string; logo_source: string | null; logo_file: string | null }>('select qid, logo_source, logo_file from silver.actor')
  const previous = new Map(before.map((r) => [r.qid, { source: r.logo_source, file: r.logo_file }]))
  const weight = (q: string) => (counts.get(q)?.lines ?? 0) + (counts.get(q)?.stations ?? 0)
  const done: Actor[] = [...actors.values()]
    .filter((a) => a.name) // no label at all: a deleted or merged item
    .map((a) => {
      const kinds = kindsOf(a.types, labels)
      return { ...a, kind: kinds[0], kinds, logo_file: null as string | null }
    })
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || weight(b.qid) - weight(a.qid))
  for (const a of done) {
    if (!a.logo_source) continue
    try {
      a.logo_file = await fetchLogo(a.qid, a.logo_source, previous.get(a.qid))
    } catch (e) {
      count('error')
      log(`logo ${a.qid}: ${(e as Error).message}`)
    }
  }
  log(`${done.length} actors; logos: ${[...statuses].map(([k, n]) => `${k} ${n}`).join(', ')}`)

  // 4. Write the library in one transaction.
  const client = await db.connect()
  try {
    await client.query('begin')
    await client.query('truncate silver.actor, silver.actor_name')
    for (const part of chunks(done, 500)) {
      await client.query(
        `insert into silver.actor (qid, name, name_fr, name_en, kind, kinds, types, country, territory, parents, colour, website, logo_source, logo_file, lines, stations)
         select * from jsonb_to_recordset($1::jsonb) as x(qid text, name text, name_fr text, name_en text, kind text, kinds text[], types text[], country text,
           territory text, parents text[], colour text, website text, logo_source text, logo_file text, lines int, stations int)`,
        [JSON.stringify(part.map((a) => ({ ...a, lines: counts.get(a.qid)?.lines ?? 0, stations: counts.get(a.qid)?.stations ?? 0 })))],
      )
    }
    await client.query(`
      insert into silver.actor_name (name, role, qid, lines, stations)
      select name, role, (array_agg(qid order by n desc) filter (where qid is not null))[1], sum(l)::int, sum(s)::int from (
        select operator as name, 'operator' as role, split_part(operator_qid, ';', 1) as qid, 1 as l, 0 as s, 1 as n from silver.line where operator is not null
        union all select network, 'network', split_part(network_qid, ';', 1), 1, 0, 1 from silver.line where network is not null
        union all select operator, 'operator', split_part(operator_qid, ';', 1), 0, 1, 1 from silver.station where operator is not null
        union all select network, 'network', split_part(network_qid, ';', 1), 0, 1, 1 from silver.station where network is not null
      ) x group by name, role`)
    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
  const { rows } = await db.query<{ kind: string; n: number; logos: number }>(
    'select kind, count(*)::int as n, count(logo_file)::int as logos from silver.actor group by 1 order by 2 desc')
  log(rows.map((r) => `${r.kind} ${r.n} (${r.logos} logos)`).join(', '))
  await db.end()
}

await main()
