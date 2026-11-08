// Train sheet, after the mockup's "Déplacement" screen: the journey as a vertical line in the
// operator's colour, a dot per station, station names large, details written as sentences.

import { useEffect, useState, type CSSProperties } from 'react'
import { fetchDetail, type Shown, type TripDetails, type TripStop } from '../data/live'
import type { LineInfo } from '../shared/protocol.ts'
import { actorByName, actorByQid, useActors } from '../data/actors'
import type { Operator } from '../shared/operators.ts'
import { duree, heure, jour } from '../lib/format'
import { Icon } from './Icon'
import { IconButton, LogoActeur, LogoCompagnie, LogosLigne, Retard } from './bits'

type Props = {
  trainId: string
  live: Shown | null
  trip: TripDetails | null
  operator: Operator | null
  loading: boolean
  error: string | null
  now: number
  followed: boolean
  following: boolean
  onBack(): void
  onToggleFollowed(): void
  onToggleCamera(): void
}

const real = (s: TripStop, end: 'arr' | 'dep') => (end === 'arr' ? (s.arr ?? s.dep) : (s.dep ?? s.arr))
const sched = (s: TripStop, end: 'arr' | 'dep') => (end === 'arr' ? (s.sarr ?? s.sdep) : (s.sdep ?? s.sarr))

/** "Départ à 19h11 · voie 6", with the planned time when it differs and the delay in red. */
function Detail({ stop, end, first, last }: { stop: TripStop; end: 'arr' | 'dep'; first: boolean; last: boolean }) {
  const r = real(stop, end)
  const sc = sched(stop, end)
  const late = r !== undefined && sc !== undefined ? Math.round((r - sc) / 60_000) : 0
  const verb = first ? 'Départ' : last ? 'Arrivée' : 'Arrivée'
  return (
    <span className="t-info">
      {stop.cancelled ? <span className="retard">Arrêt supprimé</span> : <>{verb} à {heure(r, stop.tz)}</>}
      {late >= 1 && !stop.cancelled && <> <span className="retard">+{late} min</span> <span className="secondaire">(prévu {heure(sc, stop.tz)})</span></>}
      {stop.track && <> · voie {stop.track}</>}
    </span>
  )
}

export function TrainSheet(p: Props) {
  const { live, trip, now } = p
  const op = p.operator
  const color = p.trip?.color ?? p.live?.train.color ?? 'var(--train-neutre)' // the line's colour, as on the map
  const name = trip?.name || live?.train.name || 'Train'
  const stops = trip?.stops ?? []
  const first = stops[0]
  const last = stops[stops.length - 1]
  const arr = last ? real(last, 'arr') : undefined
  const dep = first ? real(first, 'dep') : undefined
  const nextIndex = stops.findIndex((s) => (real(s, 'arr') ?? 0) > now)
  const pos = live?.pos
  // The line in OpenStreetMap (RER B, S1...), for its logos: asked once per train, refreshed with the sheet.
  const [line, setLine] = useState<LineInfo | null>(null)
  useEffect(() => {
    let alive = true
    setLine(null)
    void fetchDetail(p.trainId).then((d) => alive && setLine(d?.line ?? null))
    return () => void (alive = false)
  }, [p.trainId])
  // The agency Transitous names for the trip (DB Regio, TER Hauts-de-France...), with its logo from the
  // library, when it says more than the operator shown above.
  useActors()
  const exploitantActeur = actorByName(trip?.agency)
  const exploitant = trip?.agency && trip.agency !== op?.name && (!exploitantActeur || exploitantActeur.qid !== op?.qid) ? trip.agency : null

  return (
    <aside className="fiche" aria-label={`Fiche du train ${name}`} style={{ '--compagnie': color } as CSSProperties}>
      <header className="fiche-barre">
        <button type="button" className="retour t-corps" onClick={p.onBack}>
          <Icon name="chevron-gauche" size={18} />Europe
        </button>
        <div className="actions">
          <IconButton icon="suivre" label={p.followed ? 'Ne plus suivre' : 'Suivre ce train'} active={p.followed} onClick={p.onToggleFollowed} disabled={!trip} />
          <IconButton icon="partager" label="Copier le lien" onClick={() => void navigator.clipboard?.writeText(location.href)} />
        </div>
      </header>

      <div className="fiche-defile">
        <div className="voyage">
          <span className="logo-titre">
            {op ? (!line?.logo && !line?.networkLogo) || op.logo || actorByQid(op.qid)?.logo ? <LogoCompagnie op={op} height={24} /> : null : <span className="pastille-compagnie" />}
            <LogosLigne line={line} height={24} />
          </span>
          <div>
            <h1 className="t-voyage">{last ? `${name} vers ${last.name}` : name}</h1>
            <p className="t-info">{[op && op.id !== 'autre' ? op.name : trip?.agency, dep ? jour(dep) : ''].filter(Boolean).join(', ')}</p>
          </div>
        </div>

        {exploitant && (
          <p className="t-info exploitant">
            <LogoActeur actor={exploitantActeur} />
            <span>Exploité par {exploitant}</span>
          </p>
        )}

        {pos && (
          <p className="t-info etat">
            <span className="insecable"><Retard pos={pos} /></span>
            {' · '}
            <span className="insecable">{pos.source === 'gps' ? 'position GPS' : 'position estimée'}</span>
            {pos.moving && pos.speed ? <> · <span className="insecable">≈ {Math.round(pos.speed)} km/h</span></> : ''}
            {arr && now < arr ? <> · <span className="insecable">arrivée dans {duree(arr - now)}</span></> : ''}
          </p>
        )}

        {p.loading && <p className="t-info secondaire">Chargement du parcours…</p>}
        {p.error && <p className="t-info retard">Parcours indisponible ({p.error}).</p>}
        {!trip && !p.loading && p.trainId.startsWith('renfe:') && (
          <p className="t-info">Position GPS transmise par Renfe. Ce train n'apparaît pas dans les horaires grandes lignes publiés : son parcours n'est pas disponible.</p>
        )}

        {stops.length > 0 && (
          <ol className="frise">
            {stops.map((s, i) => {
              const isFirst = i === 0
              const isLast = i === stops.length - 1
              const passed = nextIndex === -1 || i < nextIndex
              const big = isFirst || isLast
              return (
                <li key={`${s.id}-${i}`} className={`${passed ? 'passe' : 'avenir'}${big ? ' terminus' : ''}`}>
                  {i === nextIndex && pos && (
                    <div className="ici">
                      <i className="point-ici" />
                      <span className="t-info-fort">{pos.moving ? `En route vers ${s.name}` : 'À quai'}</span>
                      <span className="t-info">{heure(now)} · {pos.source === 'gps' ? 'position GPS' : 'position estimée'}</span>
                    </div>
                  )}
                  <div className="arret">
                    <i className="point" />
                    <span className={big ? 't-gare' : 't-gare-s'}>{s.name}</span>
                    <Detail stop={s} end={isFirst ? 'dep' : 'arr'} first={isFirst} last={isLast} />
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        {pos && pos.moving && (
          <button type="button" className={`bouton t-corps large${p.following ? ' actif' : ''}`} onClick={p.onToggleCamera}>
            {p.following ? 'Arrêter de suivre' : 'Suivre sur la carte'}
          </button>
        )}

        <p className="t-legal secondaire">
          {pos?.source === 'gps'
            ? 'Position GPS transmise par Renfe ; horaires via Transitous.'
            : `Position estimée sur la voie à partir des horaires${trip?.rt ? ' et des retards en temps réel' : ''}, via Transitous.`}
          {' '}La composition et le matériel ne sont pas publiés par la compagnie.
        </p>
      </div>
    </aside>
  )
}
