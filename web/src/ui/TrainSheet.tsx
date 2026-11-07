// Train sheet (mockups "02 — Fiche train" on desktop, "04 — Mobile" as a bottom sheet):
// identity, times and progress, the stop timeline, and where the data comes from.

import type { Shown } from '../map/MapView'
import type { TripDetails, TripStop } from '../data/live'
import { duration, hhmm } from '../lib/format'
import { Icon } from './Icon'
import { IconButton, SourceBadge, StatusBadge } from './bits'

type Props = {
  trainId: string
  live: Shown | null
  trip: TripDetails | null
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

function Time({ stop, end, big }: { stop: TripStop; end: 'arr' | 'dep'; big?: boolean }) {
  const r = real(stop, end)
  const sc = sched(stop, end)
  const late = r !== undefined && sc !== undefined && r - sc >= 60_000
  return (
    <span className={`heure${late ? ' en-retard' : ''}`}>
      {late && <s className="t-chiffres-s tertiaire">{hhmm(sc, stop.tz)}</s>}
      <span className={big ? 't-chiffres-xl' : 't-chiffres-m'}>{hhmm(r, stop.tz)}</span>
    </span>
  )
}

export function TrainSheet(p: Props) {
  const { live, trip, now } = p
  const name = trip?.name || live?.train.name || 'Train'
  const number = trip?.number || live?.train.num || ''
  const category = trip?.category || name.replace(number, '').trim()
  const agency = trip?.agency || live?.train.op || ''
  const stops = trip?.stops ?? []
  const first = stops[0]
  const last = stops[stops.length - 1]
  const dep = first ? real(first, 'dep') : undefined
  const arr = last ? real(last, 'arr') : undefined
  const progress = dep && arr ? Math.max(0, Math.min(1, (now - dep) / (arr - dep))) : 0
  const nextIndex = stops.findIndex((s) => (real(s, 'arr') ?? 0) > now)
  const pos = live?.pos

  let left = ''
  if (pos) {
    if (!pos.moving && pos.next) left = `À quai · ${pos.next.name}`
    else left = `${!pos.rt ? 'Horaire théorique' : pos.delay >= 1 ? `Retard ${Math.round(pos.delay)} min` : "À l'heure"}${pos.speed ? ` · ≈ ${Math.round(pos.speed)} km/h` : ''}`
  } else if (dep && now < dep) left = `Départ dans ${duration(dep - now)}`
  else if (arr && now >= arr) left = 'Arrivé'

  return (
    <aside className="fiche verre" aria-label={`Fiche du train ${name}`}>
      <header className="fiche-barre">
        <button type="button" className="retour t-label-m" onClick={p.onBack}>
          <Icon name="chevron-gauche" size={16} />Europe
        </button>
        <span className="poignee" aria-hidden="true" />
        <div className="actions">
          <IconButton icon="suivre" label={p.followed ? 'Ne plus suivre' : 'Suivre ce train'} active={p.followed} onClick={p.onToggleFollowed} disabled={!trip} />
          <IconButton icon="partager" label="Copier le lien" onClick={() => void navigator.clipboard?.writeText(location.href)} />
        </div>
      </header>

      <div className="fiche-defile">
        <p className="t-maj tertiaire">{[category, agency].filter(Boolean).join(' · ')}</p>
        <div className="identite">
          <h1 className="t-titre-xl">{number || name}</h1>
          {pos && <StatusBadge statut={pos.statut} delay={pos.delay} rt={pos.rt} />}
          {pos && <SourceBadge source={pos.source} />}
        </div>
        {first && last && <p className="trajet t-titre-m">{first.name} → {last.name}</p>}

        {p.loading && <p className="t-corps-s tertiaire">Chargement du parcours…</p>}
        {p.error && <p className="t-corps-s etat-r2">Parcours indisponible ({p.error}).</p>}
        {!trip && !p.loading && p.trainId.startsWith('renfe:') && (
          <p className="t-corps-s secondaire">Position GPS transmise par Renfe. Ce train n'apparaît pas dans les horaires grandes lignes publiés : son parcours n'est pas disponible.</p>
        )}

        {first && last && (
          <section className="carte-horaires">
            <div className="extremites">
              <div>
                <span className="t-maj tertiaire">Départ</span>
                <Time stop={first} end="dep" big />
                <span className="t-corps-s secondaire">{first.name}</span>
              </div>
              <div className="droite">
                <span className="t-maj tertiaire">Arrivée</span>
                <Time stop={last} end="arr" big />
                <span className="t-corps-s secondaire">{last.name}</span>
              </div>
            </div>
            <div className="piste grande"><i style={{ width: `${progress * 100}%` }} /><b style={{ left: `${progress * 100}%` }} /></div>
            <div className="pied-horaires">
              <span className={`t-label-s ${pos?.rt ? `etat-${pos.statut}` : 'secondaire'}`}>{left}</span>
              {arr && now < arr && <span className="t-label-s">arrivée dans {duration(arr - now)}</span>}
            </div>
          </section>
        )}

        {pos && pos.moving && (
          <button type="button" className={`bouton-suivre t-label-m${p.following ? ' actif' : ''}`} onClick={p.onToggleCamera}>
            <Icon name="camera" size={16} />
            {p.following ? 'Arrêter de suivre' : 'Suivre sur la carte'}
          </button>
        )}

        {stops.length > 0 && (
          <section className="parcours">
            <div className="titre-section">
              <h2 className="t-maj tertiaire">Parcours</h2>
              <span className="t-label-s tertiaire">{stops.length} arrêts</span>
            </div>
            <ol className="frise">
              {stops.map((s, i) => {
                const state = nextIndex === -1 || i < nextIndex ? 'passe' : i === nextIndex ? 'prochain' : 'avenir'
                const detail = [i === 0 ? 'Départ' : i === stops.length - 1 ? 'Terminus' : '', s.track ? `Voie ${s.track}` : '', s.cancelled ? 'Arrêt supprimé' : '']
                  .filter(Boolean).join(' · ')
                return (
                  <li key={`${s.id}-${i}`} className={state}>
                    {state === 'prochain' && pos && (
                      <div className="position-actuelle">
                        <span className="t-chiffres-m accent">{hhmm(now)}</span>
                        <i className="point actuel" />
                        <div>
                          <span className="t-label-m">{pos.moving ? `En route vers ${s.name}` : `À quai`}</span>
                          <span className="t-corps-s tertiaire">Position {pos.source === 'gps' ? 'GPS' : 'estimée'}</span>
                        </div>
                      </div>
                    )}
                    <div className="arret">
                      <Time stop={s} end={i === 0 ? 'dep' : 'arr'} />
                      <i className="point" />
                      <div>
                        <span className={`t-label-m${s.cancelled ? ' barre' : ''}`}>{s.name}</span>
                        {detail && <span className="t-corps-s tertiaire">{detail}</span>}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        <p className="sources t-label-s tertiaire">
          {pos?.source === 'gps'
            ? 'Position GPS transmise par Renfe ; horaires via Transitous.'
            : `Position estimée sur la voie à partir des horaires${trip?.rt ? ' et des retards temps réel' : ''}${agency ? ` (${agency})` : ''}, via Transitous.`}
          {' '}Composition et matériel : non publiés par l'opérateur.
        </p>
      </div>
    </aside>
  )
}
