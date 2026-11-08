// The library of actors as a page of logos: every operator, network, transport authority,
// infrastructure manager, brand, line and region the server found in OpenStreetMap and Wikidata.
// A grid drawn with hairlines, one logo per cell, grouped by kind; a cell opens the actor's details.
import { useEffect, useMemo, useState } from 'react'
import { allActors, actorByQid, logoUrl, nameKey, useActors, type Actor } from '../data/actors'
import { nombre } from '../lib/format'
import { Icon } from './Icon'

const KINDS: [kind: string, title: string][] = [
  ['exploitant', 'Exploitants'],
  ['reseau', 'Réseaux'],
  ['autorite', 'Autorités organisatrices'],
  ['infrastructure', 'Gestionnaires d’infrastructure'],
  ['marque', 'Marques et services'],
  ['ligne', 'Lignes'],
  ['collectivite', 'Collectivités'],
  ['autre', 'Autres'],
]
const KIND_ONE: Record<string, string> = {
  exploitant: 'Exploitant', reseau: 'Réseau', autorite: 'Autorité organisatrice', infrastructure: 'Gestionnaire d’infrastructure',
  marque: 'Marque ou service', ligne: 'Ligne', collectivite: 'Collectivité', autre: 'Autre',
}
const countries = new Intl.DisplayNames(['fr'], { type: 'region' })
const country = (cc: string | null) => {
  try {
    return cc ? countries.of(cc) ?? cc : null
  } catch {
    return cc
  }
}

function presence(a: Actor): string {
  const parts = []
  if (a.lines) parts.push(`${nombre(a.lines)} ligne${a.lines > 1 ? 's' : ''}`)
  if (a.stations) parts.push(`${nombre(a.stations)} gare${a.stations > 1 ? 's' : ''}`)
  return parts.join(', ')
}

export function Bibliotheque({ onClose }: { onClose(): void }) {
  useActors()
  const actors = allActors()
  const [kind, setKind] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false) // also the actors without a logo
  const [open, setOpen] = useState<Actor | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (open ? setOpen(null) : onClose())
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const shown = useMemo(() => {
    const q = nameKey(query)
    return actors.filter((a) => (all || a.logo) && (!kind || a.kind === kind) && (!q || [a.name, a.name_fr, a.name_en, ...a.aliases].some((n) => n && nameKey(n).includes(q))))
  }, [actors, kind, query, all])
  const withLogo = actors.filter((a) => a.logo).length
  const groups = KINDS.map(([k, title]) => ({ k, title, list: shown.filter((a) => a.kind === k) })).filter((g) => g.list.length)

  return (
    <section className="bibliotheque" aria-label="Bibliothèque des acteurs">
      <header className="biblio-tete">
        <div>
          <h1 className="t-titre">Bibliothèque</h1>
          <p className="t-corps secondaire">
            {actors.length
              ? `${nombre(actors.length)} acteurs du rail européen, dont ${nombre(withLogo)} avec leur logo. Tirés d’OpenStreetMap et de Wikidata, mis à jour chaque mois.`
              : 'Chargement…'}
          </p>
        </div>
        <button type="button" className="bouton-icone" aria-label="Fermer la bibliothèque" onClick={onClose}>
          <Icon name="fermer" />
        </button>
      </header>

      <div className="biblio-outils">
        <label className="recherche">
          <Icon name="recherche" size={18} />
          <input className="t-corps" placeholder="Rechercher un acteur" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="boutons">
          <button type="button" className={`bouton t-corps${kind === null ? ' actif' : ''}`} onClick={() => setKind(null)}>Tous</button>
          {KINDS.filter(([k]) => actors.some((a) => a.kind === k)).map(([k, title]) => (
            <button key={k} type="button" className={`bouton t-corps${kind === k ? ' actif' : ''}`} onClick={() => setKind(kind === k ? null : k)}>{title}</button>
          ))}
          <button type="button" className={`bouton t-corps${all ? ' actif' : ''}`} onClick={() => setAll((v) => !v)} aria-pressed={all}>Sans logo aussi</button>
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.k} className="biblio-groupe">
          <h2 className="titre"><span className="t-info-fort">{g.title}</span><span className="t-info secondaire">{nombre(g.list.length)}</span></h2>
          <ul className="biblio-grille">
            {g.list.map((a) => (
              <li key={a.qid}>
                <button type="button" className={`biblio-carte${open?.qid === a.qid ? ' ouverte' : ''}`} onClick={() => setOpen(a)}>
                  <span className="biblio-logo">
                    {a.logo ? <img src={logoUrl(a)!} alt="" loading="lazy" decoding="async" /> : <i className="pastille-compagnie" style={{ background: a.colour ?? 'var(--desactive)' }} />}
                  </span>
                  <span className="t-info biblio-nom">{a.name}</span>
                  <span className="t-legal secondaire">{[country(a.country), presence(a)].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {actors.length > 0 && groups.length === 0 && <p className="t-corps secondaire">Aucun acteur ne correspond.</p>}

      {open && <Detail actor={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </section>
  )
}

function Detail({ actor: a, onClose, onOpen }: { actor: Actor; onClose(): void; onOpen(a: Actor): void }) {
  const parents = a.parents.map((q) => actorByQid(q)).filter((p): p is Actor => !!p)
  const children = allActors().filter((c) => c.parents.includes(a.qid)).slice(0, 24)
  const kinds = (a.kinds ?? [a.kind]).map((k) => KIND_ONE[k] ?? k)
  return (
    <aside className="biblio-detail" aria-label={a.name}>
      <button type="button" className="bouton-icone biblio-fermer" aria-label="Fermer" onClick={onClose}><Icon name="fermer" /></button>
      {a.logo && <span className="biblio-detail-logo"><img src={logoUrl(a)!} alt="" /></span>}
      <h2 className="t-voyage">{a.name}</h2>
      <p className="t-info">{[kinds.join(', '), country(a.country)].filter(Boolean).join(' · ')}</p>
      {presence(a) && <p className="t-info secondaire">{presence(a)} dans OpenStreetMap.</p>}
      {a.colour && <p className="t-info"><i className="pastille-compagnie" style={{ background: a.colour, width: 12, height: 12 }} /> Couleur {a.colour}</p>}
      {parents.length > 0 && (
        <p className="t-info">
          Fait partie de{' '}
          {parents.map((p, i) => (
            <span key={p.qid}>{i > 0 && ', '}<button type="button" className="lien" onClick={() => onOpen(p)}>{p.name}</button></span>
          ))}
          .
        </p>
      )}
      {children.length > 0 && (
        <div className="biblio-enfants">
          <span className="t-info-fort">Filiales et membres</span>
          {children.map((c) => (
            <button key={c.qid} type="button" className="lien t-info" onClick={() => onOpen(c)}>{c.name}</button>
          ))}
        </div>
      )}
      <p className="t-info">
        {a.website && <><a className="lien" href={a.website} target="_blank" rel="noreferrer">Site</a>{' · '}</>}
        <a className="lien" href={`https://www.wikidata.org/wiki/${a.qid}`} target="_blank" rel="noreferrer">Wikidata {a.qid}</a>
      </p>
    </aside>
  )
}
