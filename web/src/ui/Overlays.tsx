// Floating pieces over the map: hover card and map controls, white and outlined like the mockup.

import { useEffect, useState } from 'react'
import type { Hover } from '../map/MapView'
import type { ThemePref, Theme } from '../theme'
import { fetchDetail } from '../data/live'
import type { TrainDetail } from '../shared/protocol.ts'
import { heure } from '../lib/format'
import { IconButton, LogoCompagnie, LogosLigne, Retard } from './bits'

export function Tooltip({ hover }: { hover: Hover }) {
  const { train, pos } = hover.shown
  const [detail, setDetail] = useState<TrainDetail | null>(null)
  useEffect(() => {
    let live = true
    setDetail(null)
    const t = setTimeout(() => void fetchDetail(train.id).then((d) => live && setDetail(d)), 120)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [train.id])
  const next = detail?.next
  const flip = hover.x > window.innerWidth - 320
  return (
    <div className="infobulle" style={{ left: hover.x + (flip ? -16 : 16), top: hover.y + 16, transform: flip ? 'translateX(-100%)' : undefined }}>
      <div className="infobulle-titre">
        {(train.op.logo || train.op.qid || !detail?.line) && <LogoCompagnie op={train.op} height={16} />}
        <LogosLigne line={detail?.line} height={16} />
        <span className="t-corps">{train.name || train.op.name}</span>
      </div>
      <span className="t-info">
        {next ? (pos.moving ? `Vers ${next.name}${next.arr ? `, arrivée à ${heure(next.arr, next.tz)}` : ''}` : `À quai à ${next.name}`) : '\u00a0'}
      </span>
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
