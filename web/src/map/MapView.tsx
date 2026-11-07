// The map: Mapbox GL draws the base map, deck.gl draws the network and the trains (interleaved,
// so city names stay above the trains). Trains are repositioned ~15 times per second from the
// timetable/real-time model, without re-rendering React.

import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { IconLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { CollisionFilterExtension, PathStyleExtension } from '@deck.gl/extensions'
import type { Layer, PickingInfo } from '@deck.gl/core'
import { LABEL_LAYER, addCityDot, applyTheme, buildStyle } from './style'
import { buildMarkerAtlas, markerSize } from './markers'
import { token, type RGBA, type Theme } from '../theme'
import { positionAt, type LiveStore, type Pos, type Statut, type Train, type TripDetails } from '../data/live'
import type { LonLat } from '../lib/geo'

export type Filters = { gv: boolean; cl: boolean; gps: boolean; estimee: boolean }
export type Shown = { train: Train; pos: Pos }
export type Network = { gv: number[][]; cl: number[][] }
export type Padding = { top: number; right: number; bottom: number; left: number }
export type MapApi = {
  zoomBy(delta: number): void
  flyTo(lon: number, lat: number, zoom?: number): void
  fit(points: LonLat[]): void
  locate(): void
}
export type Hover = { shown: Shown; x: number; y: number }

type Props = {
  store: LiveStore
  network: Network | null
  theme: Theme
  filters: Filters
  selectedId: string | null
  trip: TripDetails | null
  follow: boolean
  padding: Padding
  onHover(h: Hover | null): void
  onSelect(id: string | null): void
  onReady(api: MapApi): void
}

type Palette = Record<Statut | `${Statut}-halo` | 'contour' | 'gv' | 'cl' | 'azur' | 'azur-trait' | 'azur-teinte' | 'texte' | 'halo', RGBA>

function readPalette(): Palette {
  return {
    ok: token('etat-a-l-heure'), r1: token('etat-retard'), r2: token('etat-gros-retard'),
    'ok-halo': token('etat-a-l-heure-halo'), 'r1-halo': token('etat-retard-halo'), 'r2-halo': token('etat-gros-retard-halo'),
    contour: token('carte-terre'), gv: token('carte-reseau-gv'), cl: token('carte-reseau-classique'),
    azur: token('accent-azur'), 'azur-trait': token('accent-azur-trait'), 'azur-teinte': token('accent-azur-teinte'),
    texte: token('texte-primaire'), halo: token('effet-halo-etiquette'),
  }
}

const atlas = buildMarkerAtlas()
// deck.gl's interleaved mode reads `beforeId` to draw a layer under the city names (not in the layer prop types).
const under = { beforeId: LABEL_LAYER }
const dash = new PathStyleExtension({ dash: true })
const collision = new CollisionFilterExtension()

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const paletteRef = useRef<Palette>(readPalette())
  const networkLayers = useRef<Layer[]>([])
  const userPos = useRef<LonLat | null>(null)
  const routeCache = useRef<{ id: string; t: number; along: number } | null>(null)

  useEffect(() => {
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: container.current!,
      style: buildStyle(),
      center: [3.2, 46.2],
      zoom: window.innerWidth < 760 ? 4.3 : 4.75,
      minZoom: 2.5,
      maxZoom: 16,
      attributionControl: false,
      projection: 'mercator',
    })
    mapRef.current = map
    map.on('error', (e) => console.error('Mapbox', e.error?.message ?? e))
    if (import.meta.env.DEV) Object.assign(window, { __map: map })
    map.setPadding(propsRef.current.padding)
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 96 }), 'bottom-right')
    map.on('styleimagemissing', (e) => e.id === 'point' && addCityDot(map))

    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      pickingRadius: 6,
      onHover: (info: PickingInfo<Shown>) => {
        map.getCanvas().style.cursor = info.object ? 'pointer' : ''
        propsRef.current.onHover(info.object ? { shown: info.object, x: info.x, y: info.y } : null)
      },
      onClick: (info: PickingInfo<Shown>) => propsRef.current.onSelect(info.object ? info.object.train.id : null),
    })
    map.addControl(overlay)

    let raf = 0
    let last = 0
    const render = () => {
      const p = propsRef.current
      const pal = paletteRef.current
      const t = Date.now()
      const shown: Shown[] = []
      let selected: Shown | null = null
      for (const train of p.store.trains.values()) {
        const isSel = train.id === p.selectedId
        if (!isSel && !p.filters[train.kind]) continue
        const pos = positionAt(train, t)
        if (!pos) continue
        if (isSel) selected = { train, pos }
        else if (p.filters[pos.source]) shown.push({ train, pos })
      }
      const size = markerSize(map.getZoom())
      const top = {
        iconAtlas: atlas.url, iconMapping: atlas.mapping, billboard: false, sizeUnits: 'pixels' as const,
        sizeScale: size, getSize: 1, getPosition: (d: Shown) => [d.pos.lon, d.pos.lat] as [number, number],
        getAngle: (d: Shown) => 90 - d.pos.bearing, updateTriggers: { getPosition: t, getAngle: t },
      }
      const common = { ...top, ...under }
      const layers: Layer[] = [...networkLayers.current]

      if (p.trip && selected) {
        const line = p.trip.line
        let c = routeCache.current
        if (!c || c.id !== p.trip.id || t - c.t > 500) {
          c = { id: p.trip.id, t, along: line.project([selected.pos.lon, selected.pos.lat]).along }
          routeCache.current = c
        }
        layers.push(
          new PathLayer({
            id: 'trajet-reste', data: [line.slice(c.along, line.length)], getPath: (d: LonLat[]) => d,
            getColor: pal.azur, widthUnits: 'pixels', getWidth: 2.5, capRounded: true, jointRounded: true,
            extensions: [dash], getDashArray: [1.4, 1.8], dashJustified: true, ...under,
            updateTriggers: { getPath: c.along },
          }) as unknown as Layer,
          new PathLayer({
            id: 'trajet-fait', data: [line.slice(0, c.along)], getPath: (d: LonLat[]) => d,
            getColor: pal.azur, widthUnits: 'pixels', getWidth: 3.5, capRounded: true, jointRounded: true, ...under,
            updateTriggers: { getPath: c.along },
          }),
          new ScatterplotLayer({
            id: 'arrets', data: p.trip.stops, getPosition: (s) => [s.lon, s.lat], radiusUnits: 'pixels', getRadius: 3.5,
            stroked: true, getFillColor: pal.contour, getLineColor: pal.azur, lineWidthUnits: 'pixels', getLineWidth: 2,
          }),
          new TextLayer({
            id: 'arrets-noms',
            data: p.trip.stops.map((s, i, all) => ({ ...s, rank: i === 0 || i === all.length - 1 ? 2 : 0 })),
            getPosition: (s) => [s.lon, s.lat], getText: (s) => s.name, getSize: 12, getColor: pal.texte,
            extensions: [collision], collisionGroup: 'arrets', getCollisionPriority: (s: { rank: number }) => s.rank,
            collisionTestProps: { sizeScale: 1.3 },
            fontFamily: 'Geist Variable, sans-serif', fontWeight: 500, getTextAnchor: 'start', getAlignmentBaseline: 'center',
            getPixelOffset: [9, 0], fontSettings: { sdf: true }, outlineWidth: 3, outlineColor: pal.halo, characterSet: 'auto',
          }),
        )
      }

      const halos = shown.filter((d) => d.pos.source === 'gps')
      layers.push(
        new IconLayer<Shown>({ ...common, id: 'trains-halo', data: halos, getIcon: (d) => `${d.train.kind}-h`, getColor: (d) => pal[`${d.pos.statut}-halo`] }),
        new IconLayer<Shown>({ ...common, id: 'trains-contour', data: shown, getIcon: (d) => `${d.train.kind}-c`, getColor: pal.contour }),
        new IconLayer<Shown>({ ...common, id: 'trains', data: shown, pickable: true, getIcon: (d) => d.train.kind, getColor: (d) => pal[d.pos.statut] }),
      )
      if (selected) {
        const sel = [selected]
        layers.push(
          new ScatterplotLayer<Shown>({
            id: 'selection', data: sel, getPosition: common.getPosition, radiusUnits: 'pixels', getRadius: Math.max(13, size * 0.9),
            stroked: true, getFillColor: pal['azur-teinte'], getLineColor: pal.azur, lineWidthUnits: 'pixels', getLineWidth: 1.5,
            updateTriggers: { getPosition: t },
          }),
          new IconLayer<Shown>({ ...top, id: 'selection-contour', data: sel, getIcon: (d) => `${d.train.kind}-c`, getColor: pal.contour }),
          new IconLayer<Shown>({ ...top, id: 'selection-train', data: sel, pickable: true, getIcon: (d) => d.train.kind, getColor: (d) => pal[d.pos.statut] }),
        )
        if (p.follow) map.jumpTo({ center: [selected.pos.lon, selected.pos.lat] })
      }
      if (userPos.current) {
        layers.push(
          new ScatterplotLayer({
            id: 'moi', data: [userPos.current], getPosition: (d: LonLat) => d, radiusUnits: 'pixels', getRadius: 6,
            stroked: true, getFillColor: pal.azur, getLineColor: [255, 255, 255, 255], lineWidthUnits: 'pixels', getLineWidth: 2,
          }),
        )
      }
      overlay.setProps({ layers })
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (!propsRef.current.follow && now - last < 66) return
      last = now
      render()
    }

    map.on('load', () => {
      raf = requestAnimationFrame(tick)
      propsRef.current.onReady({
        zoomBy: (d) => map.easeTo({ zoom: map.getZoom() + d, duration: 250 }),
        flyTo: (lon, lat, zoom) => map.flyTo({ center: [lon, lat], zoom: zoom ?? Math.max(map.getZoom(), 7), duration: 1200, essential: true }),
        fit: (pts) => {
          const b = new mapboxgl.LngLatBounds()
          for (const q of pts) b.extend(q)
          map.fitBounds(b, { padding: 60, duration: 1000, maxZoom: 9 })
        },
        locate: () =>
          navigator.geolocation?.getCurrentPosition((g) => {
            userPos.current = [g.coords.longitude, g.coords.latitude]
            map.flyTo({ center: userPos.current, zoom: 9, duration: 1200 })
          }),
      })
    })

    return () => {
      cancelAnimationFrame(raf)
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Theme: recolour the base map and rebuild the cached network layers.
  useEffect(() => {
    paletteRef.current = readPalette()
    const map = mapRef.current
    if (!map) return
    if (map.isStyleLoaded()) applyTheme(map)
    else map.once('load', () => applyTheme(map))
  }, [props.theme])

  useEffect(() => {
    const pal = paletteRef.current
    const n = props.network
    networkLayers.current = n
      ? (['cl', 'gv'] as const).map(
          (k) =>
            new PathLayer<number[]>({
              id: `reseau-${k}`, data: n[k], getPath: (d) => d as unknown as [number, number][], positionFormat: 'XY',
              _pathType: 'open', getColor: pal[k], widthUnits: 'pixels', getWidth: k === 'gv' ? 1.6 : 1.1,
              widthMinPixels: 0.8, capRounded: true, jointRounded: true, ...under,
            }) as unknown as Layer,
        )
      : []
  }, [props.network, props.theme])

  useEffect(() => {
    mapRef.current?.easeTo({ padding: props.padding, duration: 300 })
  }, [props.padding.left, props.padding.right, props.padding.top, props.padding.bottom])

  return <div ref={container} className="carte" />
}
