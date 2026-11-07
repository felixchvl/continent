// Floating pieces over the map: hover card and map controls, white and outlined like the mockup.

import type { Hover } from '../map/MapView'
import type { ThemePref, Theme } from '../theme'
import { heure } from '../lib/format'
import { IconButton, Retard, Trait } from './bits'

export function Tooltip({ hover }: { hover: Hover }) {
  const { train, pos } = hover.shown
  const arrival = pos.seg?.arr
  const flip = hover.x > window.innerWidth - 320
  return (
    <div className="infobulle" style={{ left: hover.x + (flip ? -16 : 16), top: hover.y + 16, transform: flip ? 'translateX(-100%)' : undefined }}>
      <div className="infobulle-titre">
        <Trait color={train.op.color} />
        <span className="t-corps">{train.name || train.op.name}</span>
      </div>
      {pos.next && (
        <span className="t-info">
          {pos.moving ? `Vers ${pos.next.name}${arrival ? `, arrivée à ${heure(arrival, pos.next.tz)}` : ''}` : `À quai à ${pos.next.name}`}
        </span>
      )}
      <span className="t-info">
        <Retard pos={pos} /> · {pos.source === 'gps' ? 'position GPS' : 'position estimée'}
        {pos.speed ? ` · ≈ ${Math.round(pos.speed)} km/h` : ''}
      </span>
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
        <div className="groupe">
          <IconButton icon="calques" label={p.network ? 'Masquer le réseau' : 'Afficher le réseau'} active={p.network} onClick={p.onNetwork} />
          <IconButton icon="3d" label="Vue 3D : bientôt" disabled />
          <IconButton icon={p.theme === 'sombre' ? 'lune' : 'soleil'} label={themeLabel} onClick={p.onTheme}>
            {p.themePref === 'auto' && <span className="auto">A</span>}
          </IconButton>
        </div>
      </div>
      <div className="controles controles-bas">
        <div className="groupe">
          <IconButton icon="plus" label="Zoomer" onClick={() => p.onZoom(1)} />
          <IconButton icon="moins" label="Dézoomer" onClick={() => p.onZoom(-1)} />
        </div>
        <div className="groupe">
          <IconButton icon="localiser" label="Me localiser" onClick={p.onLocate} />
        </div>
      </div>
    </>
  )
}
