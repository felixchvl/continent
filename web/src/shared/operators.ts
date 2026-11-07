// Operators: display name, identity colour and logo (public/logos). Shared by the web app and
// the server. The operator is derived from the Transitous feed of the trip: exact for operator
// feeds (SNCF, Renfe, Trenitalia…), the main national operator for national aggregators
// (DELFI in Germany, National Rail in Great Britain, OpenOV in the Netherlands…).

export type Operator = { id: string; name: string; color: string; logo?: string }

const LIST: [prefix: string, id: string, name: string, color: string, logo?: string][] = [
  ['fr-horaires-sncf', 'sncf', 'SNCF', '#930C38', 'sncf.svg'],
  ['fr-eurostar', 'eurostar', 'Eurostar', '#116BFE', 'eurostar.svg'],
  ['fr-reseau-urbain-et-interurbain-dile-de-france', 'idfm', 'Île-de-France Mobilités', '#3C1A6E'],
  ['es-RENFE', 'renfe', 'Renfe', '#8A1C76', 'renfe.svg'],
  ['es-Ouigo', 'ouigo', 'Ouigo', '#0096D6', 'ouigo.svg'],
  ['es-iryo', 'iryo', 'Iryo', '#D7282F', 'iryo.png'],
  ['es-Ferrocarriles-de-la-Generalitat', 'fgc', 'FGC', '#F28E1C', 'fgc.svg'],
  ['es-Euskotren', 'euskotren', 'Euskotren', '#C8102E', 'euskotren.svg'],
  ['it-trenitalia', 'trenitalia', 'Trenitalia', '#00824A', 'trenitalia.svg'],
  ['it-italo', 'italo', 'Italo', '#9E1B32', 'italo.svg'],
  ['it-Lombardia-Trenord', 'trenord', 'Trenord', '#00A650', 'trenord.svg'],
  ['de-', 'db', 'DB', '#EC0016', 'db.svg'],
  ['at-', 'obb', 'ÖBB', '#C3002F', 'obb.svg'],
  ['ch-', 'sbb', 'CFF', '#EB0000', 'sbb.svg'],
  ['pl-', 'pkp', 'PKP Intercity', '#1D3A8A', 'pkp.svg'],
  ['gb-', 'nr', 'National Rail', '#2B2B7A', 'nr.svg'],
  ['dk-', 'dsb', 'DSB', '#C8102E', 'dsb.svg'],
  ['hu-', 'mav', 'MÁV', '#1E4B8F'],
  ['cz-', 'cd', 'ČD', '#00589F', 'cd.svg'],
  ['nl-', 'ns', 'NS', '#003082', 'ns.svg'],
  ['se-', 'sj', 'SJ', '#2D2D2D', 'sj.svg'],
  ['sk-', 'zssk', 'ZSSK', '#E30613', 'zssk.svg'],
  ['no-', 'vy', 'Vy', '#00866E'],
  ['fi-', 'vr', 'VR', '#5EA324', 'vr.svg'],
  ['be-', 'sncb', 'SNCB', '#0069B4', 'sncb.svg'],
  ['lu-', 'cfl', 'CFL', '#E2001A', 'cfl.svg'],
  ['pt-', 'cp', 'CP', '#00A859', 'cp.svg'],
  ['eu-european-sleeper', 'sleeper', 'European Sleeper', '#1A1F3D', 'sleeper.svg'],
  ['ua-', 'uz', 'Ukrzaliznytsia', '#005BBB', 'uz.svg'],
  ['ro-', 'cfr', 'CFR Călători', '#1F4E9C'],
  ['bg-', 'bdz', 'BDŽ', '#00843D', 'bdz.svg'],
  ['rs-', 'srbijavoz', 'Srbijavoz', '#0D4C92'],
  ['me-', 'zpcg', 'ŽPCG', '#A6192E'],
  ['hr-', 'hzpp', 'HŽPP', '#1F3F8F'],
  ['si-', 'sz', 'SŽ', '#00539F', 'sz.svg'],
  ['gr-', 'hellenic', 'Hellenic Train', '#5B2C83', 'hellenic.svg'],
  ['ma-oncf', 'oncf', 'ONCF', '#E87722', 'oncf.png'],
  ['tr-', 'tcdd', 'TCDD', '#C8102E', 'tcdd.png'],
]

export const OTHER: Operator = { id: 'autre', name: 'Autres', color: '#8A8A8A' }
export const RENFE: Operator = { id: 'renfe', name: 'Renfe', color: '#8A1C76', logo: 'renfe.svg' }

const cache = new Map<string, Operator>()

export function operatorOf(tripId: string): Operator {
  const feed = tripId.split('_')[2] ?? ''
  let op = cache.get(feed)
  if (!op) {
    const f = feed.toLowerCase()
    const hit = LIST.find(([p]) => f.startsWith(p.toLowerCase()))
    op = hit ? { id: hit[1], name: hit[2], color: hit[3], logo: hit[4] } : OTHER
    cache.set(feed, op)
  }
  return op
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
