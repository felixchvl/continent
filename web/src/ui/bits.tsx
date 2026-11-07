// Small shared pieces: status and source badges, icon buttons.

import type { ReactNode } from 'react'
import type { Source, Statut } from '../data/live'
import { delayLabel } from '../lib/format'
import { Icon, type IconName } from './Icon'

export function StatusBadge({ statut, delay, rt = true }: { statut: Statut; delay: number; rt?: boolean }) {
  if (!rt) return <span className="badge badge-theorique t-label-s">Horaire théorique</span>
  return (
    <span className={`badge badge-${statut} t-label-s`}>
      <i className="pastille" />
      {delayLabel(delay)}
    </span>
  )
}

export function SourceBadge({ source }: { source: Source }) {
  return (
    <span className="badge badge-source t-label-s" title={source === 'gps' ? 'Position GPS transmise par le train' : 'Position calculée à partir des horaires et des retards'}>
      <Icon name={source === 'gps' ? 'gps' : 'estimation'} size={14} />
      {source === 'gps' ? 'GPS' : 'Estimée'}
    </span>
  )
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
