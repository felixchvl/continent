// Operators: display name and identity colour (the only colour on the map, as in the mockup).

export type Operator = { id: string; name: string; color: string }

const LIST: [prefix: string, id: string, name: string, color: string][] = [
  ['fr-horaires-sncf', 'sncf', 'SNCF', '#930C38'],
  ['fr-eurostar', 'eurostar', 'Eurostar', '#116BFE'],
  ['es-RENFE', 'renfe', 'Renfe', '#8A1C76'],
  ['es-Ouigo', 'ouigo', 'Ouigo España', '#0096D6'],
  ['es-iryo', 'iryo', 'Iryo', '#D7282F'],
  ['it-trenitalia', 'trenitalia', 'Trenitalia', '#00824A'],
  ['it-italo', 'italo', 'Italo', '#9E1B32'],
  ['de-', 'db', 'DB', '#EC0016'],
  ['at-', 'obb', 'ÖBB', '#C3002F'],
  ['ch-', 'sbb', 'CFF', '#EB0000'],
  ['pl-PKP', 'pkp', 'PKP Intercity', '#1D3A8A'],
  ['pl-', 'pkp', 'PKP Intercity', '#1D3A8A'],
  ['gb-', 'nr', 'National Rail', '#2B2B7A'],
  ['dk-', 'dsb', 'DSB', '#C8102E'],
  ['hu-', 'mav', 'MÁV', '#1E4B8F'],
  ['cz-', 'cd', 'ČD', '#00589F'],
  ['nl-', 'ns', 'NS', '#003082'],
  ['se-', 'sj', 'SJ', '#2D2D2D'],
  ['sk-', 'zssk', 'ZSSK', '#E30613'],
  ['no-', 'vy', 'Vy', '#00866E'],
  ['fi-', 'vr', 'VR', '#5EA324'],
  ['be-', 'sncb', 'SNCB', '#0069B4'],
  ['lu-', 'cfl', 'CFL', '#E2001A'],
  ['pt-', 'cp', 'CP', '#00A859'],
  ['eu-european-sleeper', 'sleeper', 'European Sleeper', '#1A1F3D'],
  ['ua-', 'uz', 'Ukrzaliznytsia', '#005BBB'],
  ['ro-', 'cfr', 'CFR Călători', '#1F4E9C'],
  ['bg-', 'bdz', 'BDŽ', '#00843D'],
  ['rs-', 'srbijavoz', 'Srbijavoz', '#0D4C92'],
  ['me-', 'zpcg', 'ŽPCG', '#A6192E'],
  ['hr-', 'hzpp', 'HŽPP', '#1F3F8F'],
  ['si-', 'sz', 'SŽ', '#00539F'],
  ['gr-', 'hellenic', 'Hellenic Train', '#5B2C83'],
  ['ma-oncf', 'oncf', 'ONCF', '#E87722'],
  ['tr-', 'tcdd', 'TCDD', '#C8102E'],
]

const OTHER: Operator = { id: 'autre', name: 'Autres', color: '#8A8A8A' }

export function operatorOf(tripId: string): Operator {
  const feed = (tripId.split('_')[2] ?? '').toLowerCase()
  const hit = LIST.find(([p]) => feed.startsWith(p.toLowerCase()))
  return hit ? { id: hit[1], name: hit[2], color: hit[3] } : OTHER
}

export const RENFE: Operator = { id: 'renfe', name: 'Renfe', color: '#8A1C76' }

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
