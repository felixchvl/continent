// Comparable keys for the names of operators, networks and stations, shared by the app and the server's
// pipeline: "DB Fernverkehr AG", "Trenitalia S.p.A.", "Wiener Linien GmbH & Co KG" -> no accents, no
// punctuation, initials joined (S.p.A. -> spa), legal forms dropped.

const LEGAL = new Set(['ag', 'gmbh', 'mbh', 'sa', 'spa', 'ltd', 'plc', 'as', 'ab', 'oy', 'oyj', 'nv', 'bv', 'srl', 'sas', 'sl', 'zrt',
  'doo', 'ad', 'kg', 'se', 'inc', 'limited', 'co', 'cie'])
// Letters NFD does not split into a base letter and an accent.
const TRANSLIT: Record<string, string> = { ı: 'i', ł: 'l', ø: 'o', đ: 'd', ð: 'd', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th' }

export function nameKey(s: string): string {
  const words = s.toLowerCase().replace(/[ıłøđðßæœþ]/g, (c) => TRANSLIT[c]).normalize('NFD').replace(/\p{M}/gu, '')
    .split(/[^a-z0-9]+/).filter(Boolean)
  const joined: string[] = []
  let initials = false // inside a run of single letters (S p A)
  for (const w of words) {
    if (w.length === 1 && initials) joined[joined.length - 1] += w
    else {
      joined.push(w)
      initials = w.length === 1
    }
  }
  return joined.filter((w) => !LEGAL.has(w)).join(' ')
}

/** The keys a name is known by: itself, and with German umlauts written oe, ae, ue (ÖBB, OEBB). */
export function nameKeys(name: string): string[] {
  const keys = [name, name.replace(/ö/gi, 'oe').replace(/ä/gi, 'ae').replace(/ü/gi, 'ue')].map(nameKey).filter(Boolean)
  return [...new Set(keys)]
}

/** Looks a name up in an index of name keys; failing the whole name, the name without its last words
 * ('Renfe Cercanias' -> Renfe, 'OEBB Personenverkehr AG Kundenservice' -> ÖBB-Personenverkehr). */
export function findByName<T>(index: Map<string, T>, name: string | undefined | null): T | undefined {
  if (!name) return undefined
  const words = nameKey(name).split(' ')
  for (let n = words.length; n >= 1; n--) {
    const k = words.slice(0, n).join(' ')
    if (k.length < 3) break
    const hit = index.get(k)
    if (hit) return hit
  }
  return undefined
}
