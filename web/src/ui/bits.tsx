// Small shared pieces. No badges: status is written, and only a delay takes colour (red).

import type { ReactNode } from 'react'
import type { Pos } from '../data/live'
import type { Operator } from '../shared/operators.ts'
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

/** The operator's logo (as in the mockup); its colour swatch when there is no logo. */
export function LogoCompagnie({ op, height = 20 }: { op: Operator; height?: number }) {
  if (!op.logo) return <i className="pastille-compagnie" style={{ background: op.color, width: height, height }} aria-label={op.name} />
  return <img className="logo-compagnie" src={`/logos/${op.logo}`} alt={op.name} style={{ height }} />
}
