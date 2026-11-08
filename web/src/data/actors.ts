// The library of actors (operators, networks, transport authorities...) served by /api/actors, built
// every month on the server from OpenStreetMap and Wikidata. Loaded once; found by Wikidata id or by
// name (the name Transitous gives an agency, or any name OpenStreetMap writes for the actor).
import { useEffect, useState } from 'react'

export type Actor = {
  qid: string; name: string; name_fr: string | null; name_en: string | null; kind: string; kinds: string[] | null
  country: string | null; colour: string | null; website: string | null; logo: string | null
  lines: number; stations: number; parents: string[]; aliases: string[]
}

const byQid = new Map<string, Actor>()
const byName = new Map<string, Actor>()
let loaded: Promise<void> | null = null
const listeners = new Set<() => void>()

// "DB Fernverkehr AG", "Trenitalia S.p.A.", "Wiener Linien GmbH & Co KG" -> comparable keys: no accents,
// no punctuation, initials joined (S.p.A. -> spa), legal forms dropped.
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

export function loadActors(): Promise<void> {
  loaded ??= fetch('/api/actors')
    .then((r) => (r.ok ? (r.json() as Promise<Actor[]>) : []))
    .then((list) => {
      // Most present first: when two actors share a name, the one with more lines and stations wins.
      const add = (n: string, a: Actor) => {
        // German umlauts are also written oe, ae, ue (ÖBB, OEBB).
        for (const v of [n, n.replace(/ö/gi, 'oe').replace(/ä/gi, 'ae').replace(/ü/gi, 'ue')]) {
          const k = nameKey(v)
          if (k && !byName.has(k)) byName.set(k, a)
        }
      }
      for (const a of list) {
        byQid.set(a.qid, a)
        for (const n of [a.name, a.name_fr, a.name_en]) if (n) add(n, a)
      }
      for (const a of list) for (const n of a.aliases) add(n, a)
      for (const fn of listeners) fn()
    })
    .catch(() => {})
  return loaded
}

export const actorByQid = (qid: string | undefined | null) => (qid ? byQid.get(qid) : undefined)
/** The actor by name; failing the whole name, the name without its last words ('Renfe Cercanias' ->
 * Renfe, 'OEBB Personenverkehr AG Kundenservice' -> ÖBB-Personenverkehr). */
export function actorByName(name: string | undefined | null): Actor | undefined {
  if (!name) return undefined
  const words = nameKey(name).split(' ')
  for (let n = words.length; n >= 1; n--) {
    const k = words.slice(0, n).join(' ')
    if (k.length < 3) break
    const a = byName.get(k)
    if (a) return a
  }
  return undefined
}
export const logoUrl = (a: Actor | undefined) => (a?.logo ? `/logos/${a.logo}` : null)

/** Re-renders the component once the library has arrived. */
export function useActors() {
  const [, setV] = useState(0)
  useEffect(() => {
    const fn = () => setV((v) => v + 1)
    listeners.add(fn)
    void loadActors()
    return () => void listeners.delete(fn)
  }, [])
}
