// Europe view panel, in the manner of the mockup's "Home menu": a plain white sheet, big
// numbers with their unit underneath, hairlines, outlined buttons, and the operators listed
// by their colour.

import { useEffect, useRef } from 'react'
import type { Filters } from '../map/MapView'
import type { Shown } from '../data/live'
import type { Operator } from '../shared/operators.ts'
import { compte, heure, nombre } from '../lib/format'
import { Icon, Logo } from './Icon'
import { LogoCompagnie, Retard } from './bits'
import type { FollowedTrain } from '../useFollowed'

export type Stats = {
  total: number; ok: number; r1: number; r2: number; gps: number; gv: number; cl: number; reg: number; estimee: number
  ops: { op: Operator; n: number }[]
}

type Props = {
  clock: number
  status: 'live' | 'stale' | 'offline' | 'loading'
  stats: Stats
  filters: Filters
  onFilters(f: Filters): void
  query: string
  onQuery(q: string): void
  results: Shown[]
  onPick(id: string): void
  followed: { f: FollowedTrain; live: Shown | null }[]
}

export function Panel(p: Props) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const s = p.stats
  const pct = s.total ? Math.round((s.ok / s.total) * 100) : 0
  const f = p.filters
  const toggle = (k: 'gv' | 'cl' | 'reg' | 'gps' | 'estimee') => p.onFilters({ ...f, [k]: !f[k] })
  const bouton = (k: 'gv' | 'cl' | 'reg' | 'gps' | 'estimee', label: string) => (
    <button type="button" className={`bouton t-corps${f[k] ? ' actif' : ''}`} onClick={() => toggle(k)} aria-pressed={f[k]}>
      {label}
    </button>
  )
  const statusText =
    p.status === 'offline' ? 'Hors ligne' : p.status === 'loading' ? 'Connexion…' : p.status === 'stale' ? `Données de ${heure(p.clock)}` : `En direct, ${heure(p.clock)}`

  return (
    <aside className="panneau">
      <header className="tete">
        <div className="marque">
          <Logo size={24} />
          <span className="t-voyage">Continent</span>
        </div>
        <span className={`t-info direct direct-${p.status}`}>{statusText}</span>
      </header>

      <label className="recherche">
        <Icon name="recherche" size={18} />
        <input ref={input} className="t-corps" placeholder="Rechercher un train" value={p.query} onChange={(e) => p.onQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') p.onQuery(''); if (e.key === 'Enter' && p.results[0]) p.onPick(p.results[0].train.id) }} />
        {p.query && <button type="button" className="effacer" aria-label="Effacer" onClick={() => p.onQuery('')}><Icon name="fermer" size={16} /></button>}
      </label>

      {p.query ? (
        <ul className="liste">
          {p.results.length === 0 && <li className="t-info secondaire vide">Aucun train en circulation ne correspond.</li>}
          {p.results.map(({ train, pos }) => (
            <li key={train.id}>
              <button type="button" className="ligne" onClick={() => p.onPick(train.id)}>
                <span className="logo-case"><LogoCompagnie op={train.op} height={18} /></span>
                <span className="ligne-texte">
                  <span className="t-gare-s">{train.name || train.op.name}</span>
                  <span className="t-info">{train.op.name} · <Retard pos={pos} /></span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <section className="chiffres">
            <div><span className="t-nombre">{nombre(s.total)}</span><span className="t-unite">trains en circulation</span></div>
            <div><span className="t-nombre">{pct}&nbsp;%</span><span className="t-unite">à l'heure</span></div>
            <div><span className="t-nombre">{nombre(s.gps)}</span><span className="t-unite">positions GPS</span></div>
          </section>
          <p className="t-info">
            {nombre(s.r1 + s.r2)} trains en retard, dont <span className={s.r2 ? 'retard' : ''}>{nombre(s.r2)} de plus d'un quart d'heure</span>.
          </p>

          <section>
            <h2 className="t-info-fort">Afficher</h2>
            <div className="boutons">
              {bouton('gv', 'Grande vitesse')}
              {bouton('cl', 'Grandes lignes')}
              {bouton('reg', 'Régional')}
            </div>
            <div className="boutons">
              {bouton('gps', 'Positions GPS')}
              {bouton('estimee', 'Positions estimées')}
            </div>
          </section>

          <section>
            <div className="titre">
              <h2 className="t-info-fort">Compagnies</h2>
              {f.op && <button type="button" className="t-info lien" onClick={() => p.onFilters({ ...f, op: null })}>Toutes</button>}
            </div>
            <ul className="liste">
              {s.ops.slice(0, 9).map(({ op, n }) => (
                <li key={op.id}>
                  <button type="button" className={`ligne${f.op && f.op !== op.id ? ' attenue' : ''}`} aria-pressed={f.op === op.id}
                    onClick={() => p.onFilters({ ...f, op: f.op === op.id ? null : op.id })}>
                    <span className="logo-case"><LogoCompagnie op={op} /></span>
                    <span className="t-gare-s ligne-texte">{op.name}</span>
                    <span className="t-numero">{nombre(n)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="t-info-fort">Trains suivis</h2>
            {p.followed.length === 0 ? (
              <p className="t-info secondaire">Ouvrez la fiche d'un train et touchez l'étoile pour le retrouver ici.</p>
            ) : (
              <ul className="liste">
                {p.followed.map(({ f: t, live }) => {
                  const avant = p.clock < t.dep
                  const c = compte(avant ? t.dep - p.clock : t.arr - p.clock)
                  const fini = p.clock >= t.arr
                  return (
                    <li key={t.id}>
                      <button type="button" className="ligne suivi" onClick={() => p.onPick(t.id)}>
                        <span className="compte">
                          <span className="t-nombre">{fini ? '✓' : c.n}</span>
                          <span className="t-unite">{fini ? 'arrivé' : c.unite}</span>
                        </span>
                        <span className="ligne-texte">
                          <span className="t-corps">{t.name}</span>
                          <span className="t-info">{t.from} → {t.to}</span>
                          <span className="t-info">
                            {avant ? `Départ à ${heure(t.dep, t.tzFrom)}` : fini ? `Arrivé à ${heure(t.arr, t.tzTo)}` : `Arrivée à ${heure(t.arr, t.tzTo)}`}
                            {live && !fini && <> · <Retard pos={live.pos} /></>}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <footer className="pied t-legal secondaire">
        Tous les trains d'Europe, grandes lignes et régionaux ; la couleur du point est celle de sa ligne, grise quand la ligne n'en a pas. Positions GPS en Espagne (Renfe) ; ailleurs, positions estimées à partir des
        horaires et des retards en temps réel, via Transitous. Fond © Mapbox © OpenStreetMap.
      </footer>
    </aside>
  )
}
