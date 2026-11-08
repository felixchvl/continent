// Station sheet, opened by clicking a station on the map: the image of its Wikipedia article (relayed by
// the server, with its author and licence) and the link to the article, the station's manager with its
// logo, and what Trainline's open data says of it (its city, whether it is the main station, its UIC code).
import type { StationDetail } from '../shared/protocol.ts'
import { Icon } from './Icon'
import { IconButton } from './bits'

const KIND: Record<string, string> = {
  station: 'Gare', halt: 'Halte', metro: 'Station de métro', light_rail: 'Station de métro léger',
  tram: 'Arrêt de tramway', funicular: 'Station de funiculaire',
}
const languages = new Intl.DisplayNames(['fr'], { type: 'language' })
const language = (code: string) => {
  try {
    return languages.of(code) ?? code
  } catch {
    return code
  }
}

type Props = { id: string; station: StationDetail | null; error: boolean; onBack(): void }

export function StationSheet({ id, station: d, error, onBack }: Props) {
  const name = d?.name ?? 'Gare'
  const what = d ? (d.main && d.city ? `Gare principale de ${d.city}` : [KIND[d.kind] ?? 'Gare', d.city].filter(Boolean).join(' · ')) : ''
  return (
    <aside className="fiche" aria-label={`Fiche de ${name}`}>
      <header className="fiche-barre">
        <button type="button" className="retour t-corps" onClick={onBack}>
          <Icon name="chevron-gauche" size={18} />Europe
        </button>
        <div className="actions">
          <IconButton icon="partager" label="Copier le lien" onClick={() => void navigator.clipboard?.writeText(location.href)} />
        </div>
      </header>

      <div className="fiche-defile">
        {!d && <p className="t-corps secondaire">{error ? 'Cette gare est introuvable.' : 'Chargement…'}</p>}
        {d?.photo && (
          <figure className="gare-photo">
            <img src={`/api/gare/${id}/photo`} alt={`${name}, image de l’article Wikipédia`} />
            <figcaption className="t-legal secondaire">
              <a className="lien" href={`https://commons.wikimedia.org/wiki/File:${encodeURIComponent(d.photo.file)}`} target="_blank" rel="noreferrer">
                {[d.photo.credit, d.photo.licence].filter(Boolean).join(', ')}
              </a>
              , via Wikimedia Commons
            </figcaption>
          </figure>
        )}
        {d && (
          <>
            <div className="voyage">
              {d.manager?.logo && (
                <span className="logo-titre">
                  <img className="logo-compagnie" src={`/logos/${d.manager.logo}`} alt={d.manager.name} style={{ height: 28 }} />
                </span>
              )}
              <div>
                <h1 className="t-voyage">{name}</h1>
                <p className="t-info">{what}</p>
              </div>
            </div>
            <div className="gare-details t-info">
              {d.manager && <p>Gérée par {d.manager.name}.</p>}
              {d.uic && <p>Code UIC {d.uic}.</p>}
            </div>
            {d.wiki && (
              <a className="lien t-corps gare-wiki" href={d.wiki.url} target="_blank" rel="noreferrer">
                Lire l’article sur Wikipédia{d.wiki.lang !== 'fr' ? ` (en ${language(d.wiki.lang)})` : ''}
              </a>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
