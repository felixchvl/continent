// The library of actors (operators, networks, transport authorities...) served by /api/actors, built
// every month on the server from OpenStreetMap and Wikidata. Loaded once; found by Wikidata id or by
// name (the name Transitous gives an agency, or any name OpenStreetMap writes for the actor).
import { useEffect, useState } from 'react'
import { findByName, nameKeys } from '../shared/names.ts'

export { nameKey } from '../shared/names.ts'

export type Actor = {
  qid: string; name: string; name_fr: string | null; name_en: string | null; kind: string; kinds: string[] | null
  country: string | null; colour: string | null; website: string | null; logo: string | null
  lines: number; stations: number; parents: string[]; aliases: string[]
}

let list: Actor[] = []
const byQid = new Map<string, Actor>()
const byName = new Map<string, Actor>()
let loaded: Promise<void> | null = null
const listeners = new Set<() => void>()

export function loadActors(): Promise<void> {
  loaded ??= fetch('/api/actors')
    .then((r) => (r.ok ? (r.json() as Promise<Actor[]>) : []))
    .then((actors) => {
      list = actors
      // Most present first: when two actors share a name, the one with more lines and stations wins.
      const add = (n: string, a: Actor) => {
        for (const k of nameKeys(n)) if (!byName.has(k)) byName.set(k, a)
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

/** Every actor, most present first. */
export const allActors = () => list
export const actorByQid = (qid: string | undefined | null) => (qid ? byQid.get(qid) : undefined)
/** The actor by name; failing the whole name, the name without its last words ('Renfe Cercanias' ->
 * Renfe, 'OEBB Personenverkehr AG Kundenservice' -> ÖBB-Personenverkehr). */
export const actorByName = (name: string | undefined | null) => findByName(byName, name)
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
