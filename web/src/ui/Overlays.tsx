// Floating pieces over the map: hover tooltip and map controls.

import type { Hover } from '../map/MapView'
import type { ThemePref, Theme } from '../theme'
import { hhmm } from '../lib/format'
import { IconButton, SourceBadge, StatusBadge } from './bits'

export function Tooltip({ hover }: { hover: Hover }) {
  const { train, pos } = hover.shown
  const arrival = pos.seg?.arr
  const flip = hover.x > window.innerWidth - 320
  return (
    <div className="infobulle verre" style={{ left: hover.x + (flip ? -16 : 16), top: hover.y + 16, transform: flip ? 'translateX(-100%)' : undefined }}>
      <div className="ligne1">
        <span className="t-label-m">{train.name || train.op}</span>
        <StatusBadge statut={pos.statut} delay={pos.delay} rt={pos.rt} />
      </div>
      {pos.next && (
        <span className="t-corps-s secondaire">
          {pos.moving ? 'Prochain arrêt' : 'À quai'} · {pos.next.name}
          {pos.moving && arrival ? ` ${hhmm(arrival, pos.next.tz)}` : ''}
        </span>
      )}
      <div className="ligne3">
        <SourceBadge source={pos.source} />
        {pos.speed && <span className="t-chiffres-s secondaire">≈ {Math.round(pos.speed)} km/h</span>}
        <span className="t-label-s accent">Cliquer pour la fiche</span>
      </div>
    </div>
  )
}

type ControlsProps = {
  themePref: ThemePref
  theme: Theme
  onTheme(): void
  network: boolean
  onNetwork(): void
  onZoom(d: number): void
  onLocate(): void
}

export function MapControls(p: ControlsProps) {
  const themeLabel = `Thème : ${p.themePref === 'auto' ? `automatique (${p.theme})` : p.themePref} — changer`
  return (
    <>
      <div className="controles controles-haut">
        <div className="groupe verre">
          <IconButton icon="calques" label={p.network ? 'Masquer le réseau' : 'Afficher le réseau'} active={p.network} onClick={p.onNetwork} />
          <IconButton icon="3d" label="Vue 3D : bientôt" disabled />
          <IconButton icon={p.theme === 'sombre' ? 'lune' : 'soleil'} label={themeLabel} onClick={p.onTheme}>
            {p.themePref === 'auto' && <span className="auto t-label-s">A</span>}
          </IconButton>
        </div>
      </div>
      <div className="controles controles-bas">
        <div className="groupe verre">
          <IconButton icon="plus" label="Zoomer" onClick={() => p.onZoom(1)} />
          <IconButton icon="moins" label="Dézoomer" onClick={() => p.onZoom(-1)} />
        </div>
        <div className="groupe verre">
          <IconButton icon="localiser" label="Me localiser" onClick={p.onLocate} />
        </div>
      </div>
    </>
  )
}
