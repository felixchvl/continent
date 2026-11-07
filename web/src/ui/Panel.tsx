// Left panel of the Europe view (mockup "01 — Carte Europe"): live counters, filters,
// search, followed trains, legend and sources.

import { useEffect, useRef } from 'react'
import type { Filters, Shown } from '../map/MapView'
import { hhmm, nombre } from '../lib/format'
import { Icon, Logo } from './Icon'
import { StatusBadge } from './bits'
import type { FollowedTrain } from '../useFollowed'

export type Stats = { total: number; ok: number; r1: number; r2: number; gps: number; gv: number; cl: number; estimee: number }

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
  const toggle = (k: keyof Filters) => p.onFilters({ ...p.filters, [k]: !p.filters[k] })
  const chip = (k: keyof Filters, label: string, n: number) => (
    <button type="button" className={`puce${p.filters[k] ? ' active' : ''}`} onClick={() => toggle(k)} aria-pressed={p.filters[k]}>
      <span className="t-label-m">{label}</span>
      <span className="t-chiffres-s">{nombre(n)}</span>
    </button>
  )

  return (
    <aside className="panneau verre">
      <header className="panneau-tete">
        <div className="logo">
          <Logo />
          <span className="t-titre-l">Continent</span>
        </div>
        <span className={`direct t-label-s direct-${p.status}`}>
          <i className="pastille" />
          {p.status === 'offline' ? 'Hors ligne' : p.status === 'loading' ? 'Connexion…' : p.status === 'stale' ? `Données de ${hhmm(p.clock)}` : `En direct · ${hhmm(p.clock)}`}
        </span>
      </header>

      <div className="recherche">
        <Icon name="recherche" />
        <input ref={input} className="t-corps-m" placeholder="Train, numéro…" value={p.query} onChange={(e) => p.onQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') p.onQuery(''); if (e.key === 'Enter' && p.results[0]) p.onPick(p.results[0].train.id) }} />
        {p.query ? (
          <button type="button" className="effacer" aria-label="Effacer" onClick={() => p.onQuery('')}><Icon name="fermer" size={16} /></button>
        ) : (
          <kbd className="t-chiffres-s">⌘K</kbd>
        )}
      </div>

      {p.query ? (
        <ul className="resultats">
          {p.results.length === 0 && <li className="vide t-corps-s">Aucun train en circulation ne correspond.</li>}
          {p.results.map(({ train, pos }) => (
            <li key={train.id}>
              <button type="button" onClick={() => p.onPick(train.id)}>
                <span className="t-label-m">{train.name || train.op}</span>
                <span className="t-corps-s secondaire">{pos.next ? `vers ${pos.next.name}` : train.op}</span>
                <StatusBadge statut={pos.statut} delay={pos.delay} rt={pos.rt} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <section className="stats">
            <div><span className="t-stat">{nombre(s.total)}</span><span className="t-label-s tertiaire">en circulation</span></div>
            <div><span className="t-stat etat-ok">{pct}&nbsp;%</span><span className="t-label-s tertiaire">à l'heure</span></div>
            <div><span className="t-stat accent">{nombre(s.gps)}</span><span className="t-label-s tertiaire">positions GPS</span></div>
          </section>
          <div className="barre-ponctualite" aria-hidden="true">
            <i className="ok" style={{ flex: s.ok }} />
            <i className="r1" style={{ flex: s.r1 }} />
            <i className="r2" style={{ flex: s.r2 }} />
          </div>
          <div className="legende-retards t-label-s">
            <span><i className="pastille ok" />À l'heure {nombre(s.ok)}</span>
            <span><i className="pastille r1" />Retard {nombre(s.r1)}</span>
            <span><i className="pastille r2" />+15 min {nombre(s.r2)}</span>
          </div>

          <h2 className="t-maj tertiaire">Afficher</h2>
          <div className="puces">
            {chip('gv', 'Grande vitesse', s.gv)}
            {chip('cl', 'Classique', s.cl)}
            <button type="button" className="puce" disabled title="Trains régionaux : bientôt">
              <span className="t-label-m">Régional</span><span className="t-chiffres-s">–</span>
            </button>
            {chip('gps', 'GPS', s.gps)}
            {chip('estimee', 'Estimées', s.estimee)}
          </div>

          <div className="titre-section">
            <h2 className="t-maj tertiaire">Trains suivis</h2>
          </div>
          {p.followed.length === 0 ? (
            <p className="t-corps-s tertiaire aide">Ouvrez la fiche d'un train et touchez l'étoile pour le suivre ici.</p>
          ) : (
            <ul className="suivis">
              {p.followed.map(({ f, live }) => {
                const prog = Math.max(0, Math.min(1, (p.clock - f.dep) / (f.arr - f.dep)))
                return (
                  <li key={f.id}>
                    <button type="button" className="carte-suivi" onClick={() => p.onPick(f.id)}>
                      <span className="ligne1">
                        <span className="t-label-m">{f.name}</span>
                        {live ? <StatusBadge statut={live.pos.statut} delay={live.pos.delay} rt={live.pos.rt} /> : <span className="t-label-s tertiaire">{p.clock < f.dep ? 'Pas encore parti' : 'Terminé'}</span>}
                      </span>
                      <span className="t-corps-s secondaire">{f.from} → {f.to}</span>
                      <span className="progression">
                        <span className="t-chiffres-s tertiaire">{hhmm(f.dep, f.tzFrom)}</span>
                        <span className="piste"><i style={{ width: `${prog * 100}%` }} /></span>
                        <span className="t-chiffres-s">{hhmm(f.arr, f.tzTo)}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      <footer className="panneau-pied">
        <div className="legende t-label-s secondaire">
          <span><i className="mini gv" />Grande vitesse</span>
          <span><i className="mini cl" />Classique</span>
          <span><i className="mini gps" />Position GPS</span>
        </div>
        <p className="t-label-s tertiaire">
          Positions GPS : Renfe. Ailleurs, positions estimées à partir des horaires et retards temps réel (SNCF, DB, CFF,
          Trenitalia… via Transitous). Fond © Mapbox © OpenStreetMap.
        </p>
      </footer>
    </aside>
  )
}
