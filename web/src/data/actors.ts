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
export function nameKey(s: string): string {
  const words = s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
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
      for (const a of list) {
        byQid.set(a.qid, a)
        for (const n of [a.name, a.name_fr, a.name_en]) if (n && !byName.has(nameKey(n))) byName.set(nameKey(n), a)
      }
      for (const a of list) for (const n of a.aliases) if (!byName.has(nameKey(n))) byName.set(nameKey(n), a)
      for (const fn of listeners) fn()
    })
    .catch(() => {})
  return loaded
}

export const actorByQid = (qid: string | undefined | null) => (qid ? byQid.get(qid) : undefined)
export const actorByName = (name: string | undefined | null) => (name ? byName.get(nameKey(name)) : undefined)
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
