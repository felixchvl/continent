// Operators: display name, identity colour, Wikidata id and hand-picked logo (public/logos; else the
// library's logo). Shared by the web app and the server. The operator is derived from the
// Transitous feed of the trip: exact for operator
// feeds (SNCF, Renfe, Trenitalia…), the main national operator for national aggregators
// (DELFI in Germany, National Rail in Great Britain, OpenOV in the Netherlands…).

/** qid: the operator's Wikidata id, which links it to the library of actors (server/pipeline/actors.ts). */
export type Operator = { id: string; name: string; color: string; qid?: string; logo?: string }

const LIST: [prefix: string, id: string, name: string, color: string, qid: string, logo?: string][] = [
  ['fr-horaires-sncf', 'sncf', 'SNCF', '#930C38', 'Q13646', 'sncf.svg'],
  ['fr-eurostar', 'eurostar', 'Eurostar', '#116BFE', 'Q5413836', 'eurostar.svg'],
  ['fr-reseau-urbain-et-interurbain-dile-de-france', 'idfm', 'Île-de-France Mobilités', '#3C1A6E', 'Q1747944', 'idfm.svg'],
  ['es-RENFE', 'renfe', 'Renfe', '#8A1C76', 'Q2476154', 'renfe.svg'],
  ['es-Ouigo', 'ouigo', 'Ouigo', '#0096D6', 'Q97172588', 'ouigo.svg'],
  ['es-iryo', 'iryo', 'Iryo', '#D7282F', 'Q104884461', 'iryo.png'],
  ['es-Ferrocarriles-de-la-Generalitat', 'fgc', 'FGC', '#F28E1C', 'Q83819', 'fgc.svg'],
  ['es-Euskotren', 'euskotren', 'Euskotren', '#C8102E', 'Q3061020', 'euskotren.svg'],
  ['it-trenitalia', 'trenitalia', 'Trenitalia', '#00824A', 'Q286650', 'trenitalia.svg'],
  ['it-italo', 'italo', 'Italo', '#9E1B32', 'Q580786', 'italo.svg'],
  ['it-Lombardia-Trenord', 'trenord', 'Trenord', '#00A650', 'Q1324935', 'trenord.svg'],
  ['de-', 'db', 'DB', '#EC0016', 'Q9322', 'db.svg'],
  ['at-', 'obb', 'ÖBB', '#C3002F', 'Q83822', 'obb.svg'],
  ['ch-', 'sbb', 'CFF', '#EB0000', 'Q83835', 'sbb.svg'],
  ['pl-', 'pkp', 'PKP Intercity', '#1D3A8A', 'Q590406', 'pkp.svg'],
  ['gb-', 'nr', 'National Rail', '#2B2B7A', 'Q26334', 'nr.svg'],
  ['dk-', 'dsb', 'DSB', '#C8102E', 'Q83824', 'dsb.svg'],
  ['hu-', 'mav', 'MÁV', '#1E4B8F', 'Q1180332'],
  ['cz-', 'cd', 'ČD', '#00589F', 'Q304944', 'cd.svg'],
  ['nl-', 'ns', 'NS', '#003082', 'Q23076', 'ns.svg'],
  ['se-', 'sj', 'SJ', '#2D2D2D', 'Q8301325', 'sj.svg'],
  ['sk-', 'zssk', 'ZSSK', '#E30613', 'Q393557', 'zssk.svg'],
  ['no-', 'vy', 'Vy', '#00866E', 'Q83825'],
  ['fi-', 'vr', 'VR', '#5EA324', 'Q913248', 'vr.svg'],
  ['be-', 'sncb', 'SNCB', '#0069B4', 'Q524255', 'sncb.svg'],
  ['lu-', 'cfl', 'CFL', '#E2001A', 'Q525359', 'cfl.svg'],
  ['pt-', 'cp', 'CP', '#00A859', 'Q81123', 'cp.svg'],
  ['eu-european-sleeper', 'sleeper', 'European Sleeper', '#1A1F3D', 'Q112134716', 'sleeper.svg'],
  ['ua-', 'uz', 'Ukrzaliznytsia', '#005BBB', 'Q923337', 'uz.svg'],
  ['ro-', 'cfr', 'CFR Călători', '#1F4E9C', 'Q856252'],
  ['bg-', 'bdz', 'BDŽ', '#00843D', 'Q610143', 'bdz.svg'],
  ['rs-', 'srbijavoz', 'Srbijavoz', '#0D4C92', 'Q25459717'],
  ['me-', 'zpcg', 'ŽPCG', '#A6192E', 'Q17099309'],
  ['hr-', 'hzpp', 'HŽPP', '#1F3F8F', 'Q124357728'],
  ['si-', 'sz', 'SŽ', '#00539F', 'Q766616', 'sz.svg'],
  ['gr-', 'hellenic', 'Hellenic Train', '#5B2C83', 'Q7832852', 'hellenic.svg'],
  ['ma-oncf', 'oncf', 'ONCF', '#E87722', 'Q1815809', 'oncf.png'],
  ['tr-', 'tcdd', 'TCDD', '#C8102E', 'Q28220824', 'tcdd.png'],
]

export const OTHER: Operator = { id: 'autre', name: 'Autres', color: '#8A8A8A' }
export const RENFE: Operator = { id: 'renfe', name: 'Renfe', color: '#8A1C76', qid: 'Q2476154', logo: 'renfe.svg' }

/** Wikidata ids of the operators above: the library of actors always includes them. */
export const OPERATOR_QIDS = LIST.map((o) => o[4])

const cache = new Map<string, Operator>()

export function operatorOf(tripId: string): Operator {
  const feed = tripId.split('_')[2] ?? ''
  let op = cache.get(feed)
  if (!op) {
    const f = feed.toLowerCase()
    const hit = LIST.find(([p]) => f.startsWith(p.toLowerCase()))
    op = hit ? { id: hit[1], name: hit[2], color: hit[3], qid: hit[4], logo: hit[5] } : OTHER
    cache.set(feed, op)
  }
  return op
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
