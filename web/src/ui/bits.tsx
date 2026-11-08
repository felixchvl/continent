// Small shared pieces. No badges: status is written, and only a delay takes colour (red).

import type { ReactNode } from 'react'
import type { Pos } from '../data/live'
import type { Operator } from '../shared/operators.ts'
import type { LineInfo } from '../shared/protocol.ts'
import { actorByQid, logoUrl, useActors, type Actor } from '../data/actors'
import { Icon, type IconName } from './Icon'

export function Retard({ pos }: { pos: Pick<Pos, 'delay' | 'rt'> }) {
  if (!pos.rt) return <span className="secondaire">Horaire théorique</span>
  if (pos.delay < 1) return <span>À l'heure</span>
  return <span className="retard">+{Math.round(pos.delay)} min</span>
}

export function IconButton({ icon, label, onClick, active, disabled, children }: {
  icon: IconName; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; children?: ReactNode
}) {
  return (
    <button type="button" className={`bouton-icone${active ? ' actif' : ''}`} onClick={onClick} aria-label={label} title={label} disabled={disabled}>
      <Icon name={icon} />
      {children}
    </button>
  )
}

/** Operator mark: a short bar in the operator's colour, like the line on the timeline. */
export const Trait = ({ color }: { color: string }) => <i className="trait-compagnie" style={{ background: color }} />

/** The operator's logo (as in the mockup): the hand-picked one, else the library's; its colour swatch
 * when there is neither. */
export function LogoCompagnie({ op, height = 20 }: { op: Operator; height?: number }) {
  useActors()
  const src = op.logo ? `/logos/${op.logo}` : logoUrl(actorByQid(op.qid))
  if (!src) return <i className="pastille-compagnie" style={{ background: op.color, width: height, height }} aria-label={op.name} />
  return <img className="logo-compagnie" src={src} alt={op.name} style={{ height }} />
}

/** The logos of a train's network and line (RER + B, S-Bahn + S1), when the library has them. */
export function LogosLigne({ line, height = 20 }: { line: LineInfo | null | undefined; height?: number }) {
  if (!line || (!line.logo && !line.networkLogo)) return null
  return (
    <span className="logos-ligne">
      {line.networkLogo && <img className="logo-compagnie" src={`/logos/${line.networkLogo}`} alt={line.network ?? ''} style={{ height }} />}
      {line.logo && <img className="logo-compagnie" src={`/logos/${line.logo}`} alt={line.name ?? line.ref} style={{ height }} />}
    </span>
  )
}

/** An actor of the library (an agency, a network...) by its logo, or nothing when it has none. */
export function LogoActeur({ actor, height = 16 }: { actor: Actor | undefined; height?: number }) {
  const src = logoUrl(actor)
  return src ? <img className="logo-compagnie" src={src} alt={actor!.name} style={{ height }} /> : null
}
