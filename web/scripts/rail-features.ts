// Keeps the railway lines worth drawing from an osmium GeoJSON export, with one property:
//   c = 'gv' (highspeed=yes), 'main' (usage=main), 'branch' (everything else that carries trains).
// Dropped: tracks with a service tag (sidings, yards, spurs, crossovers) and industrial, military,
// test and heritage (tourism) lines. Run: node scripts/rail-features.ts in.geojsonseq out.geojsonseq
import { createReadStream, createWriteStream } from 'node:fs'
import { createInterface } from 'node:readline'

const [input, output] = process.argv.slice(2)
const DROP_USAGE = new Set(['industrial', 'military', 'test', 'tourism'])

const out = createWriteStream(output)
const counts: Record<string, number> = { gv: 0, main: 0, branch: 0, dropped: 0 }

for await (const raw of createInterface({ input: createReadStream(input) })) {
  const line = raw.replace(/^\x1e/, '') // RFC 8142 record separator
  if (!line) continue
  const f = JSON.parse(line) as { geometry: unknown; properties: Record<string, string> }
  const t = f.properties
  if (t.service || DROP_USAGE.has(t.usage) || t['railway:preserved'] === 'yes') {
    counts.dropped++
    continue
  }
  const c = t.highspeed === 'yes' ? 'gv' : t.usage === 'main' ? 'main' : 'branch'
  counts[c]++
  if (!out.write(JSON.stringify({ type: 'Feature', properties: { c }, geometry: f.geometry }) + '\n')) {
    await new Promise((r) => out.once('drain', r))
  }
}
out.end()
console.log(counts)
