// Builds public/data/villes.json: the city names drawn on the map, in French, with the zoom
// at which each one appears. Source: Natural Earth 10m populated places (public domain).
// Run: node scripts/build-villes.ts
import { mkdirSync, writeFileSync } from 'node:fs'

const URL_NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson'
type Props = Record<string, string | number | null>

const res = await fetch(URL_NE)
if (!res.ok) throw new Error(`Natural Earth ${res.status}`)
const gj = (await res.json()) as { features: { properties: Props }[] }

// [lon, lat, name, minZoom, capital, priority]
const rows: [number, number, string, number, number, number][] = []
for (const { properties: p } of gj.features) {
  const lon = Number(p.LONGITUDE)
  const lat = Number(p.LATITUDE)
  if (lon < -11 || lon > 32 || lat < 34 || lat > 62) continue
  const pop = Number(p.POP_MAX) || 0
  const capital = Number(p.ADM0CAP) === 1 ? 1 : 0
  if (pop < 60_000 && !capital) continue
  const name = String(p.NAME_FR || p.NAME || '').trim()
  if (!name) continue
  // Zoom at which the label shows: capitals and big cities first.
  if (pop < 20_000) continue // micro-states' capitals would crowd the overview
  const minZoom = capital && pop > 1_000_000 ? 3 : capital && pop > 300_000 ? 4 : pop > 1_500_000 ? 4 : pop > 500_000 ? 5 : pop > 200_000 ? 6 : pop > 100_000 ? 7 : 8
  const priority = Math.round(Math.log10(pop) * 10) + capital * 10
  rows.push([Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4, name, minZoom, capital, priority])
}
rows.sort((a, b) => b[5] - a[5])

mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true })
writeFileSync(new URL('../public/data/villes.json', import.meta.url), JSON.stringify(rows))
console.log(`${rows.length} villes`, rows.slice(0, 8).map((r) => r[2]).join(', '))
