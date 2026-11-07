// The map: Mapbox GL draws the quiet base map; deck.gl draws the network, the trains in their
// operator's colour, the selected route and the city names in Halyard. Trains are repositioned
// ~15 times per second from the timetable/real-time model, without re-rendering React.

import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { IconLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Layer, PickingInfo } from '@deck.gl/core'
import { applyTheme, buildStyle } from './style'
import { buildMarkerAtlas, markerSize } from './markers'
import { token, type RGBA, type Theme } from '../theme'
import { positionAt, type LiveStore, type Pos, type Train, type TripDetails, type TripStop } from '../data/live'
import { hexToRgb } from '../data/operators'
import type { LonLat } from '../lib/geo'

export type Filters = { gv: boolean; cl: boolean; gps: boolean; estimee: boolean; op: string | null }
export type Shown = { train: Train; pos: Pos }
export type Network = { gv: number[][]; cl: number[][] }
/** [lon, lat, name, minZoom, capital, priority] — see scripts/build-villes.ts */
export type City = [number, number, string, number, number, number]
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
  cities: City[]
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

type Palette = Record<'terre' | 'gv' | 'cl' | 'texte' | 'halo' | 'accent' | 'fond', RGBA>

const readPalette = (): Palette => ({
  terre: token('carte-terre'), gv: token('carte-reseau-gv'), cl: token('carte-reseau-classique'),
  texte: token('carte-ville'), halo: token('carte-halo'), accent: token('accent'), fond: token('fond'),
})

const FONT = 'Halyard, halyard-display, Helvetica Neue, Helvetica, Arial, sans-serif'
const atlas = buildMarkerAtlas()
const measureCtx = document.createElement('canvas').getContext('2d')!
const widths = new Map<string, number>()
function textWidth(text: string, weight: number, size: number) {
  const k = `${weight}|${size}|${text}`
  let w = widths.get(k)
  if (w === undefined) {
    measureCtx.font = `${weight} ${size}px ${FONT}`
    widths.set(k, (w = measureCtx.measureText(text).width))
  }
  return w
}
const rgbCache = new Map<string, [number, number, number]>()
const rgb = (hex: string) => {
  let c = rgbCache.get(hex)
  if (!c) rgbCache.set(hex, (c = hexToRgb(hex)))
  return c
}

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const paletteRef = useRef<Palette>(readPalette())
  const staticLayers = useRef<{ network: Layer[]; key: string; cities: Layer[] }>({ network: [], key: '', cities: [] })
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

    const overlay = new MapboxOverlay({
      interleaved: false, // deck.gl on its own canvas above the map: city names are deck.gl layers too
      layers: [],
      pickingRadius: 6,
      onHover: (info: PickingInfo<Shown>) => {
        map.getCanvas().style.cursor = info.object ? 'pointer' : ''
        propsRef.current.onHover(info.object ? { shown: info.object, x: info.x, y: info.y } : null)
      },
      onClick: (info: PickingInfo<Shown>) => propsRef.current.onSelect(info.object ? info.object.train.id : null),
    })
    map.addControl(overlay)

    // City names: placed greedily by priority so that no two labels overlap. In Web Mercator the
    // placement only depends on the zoom, so it is recomputed per quarter zoom level (and theme).
    const cityLayers = (zoom: number, pal: Palette, reserved: [number, number, number, number][], tripKey: string): Layer[] => {
      const key = `${Math.floor(zoom * 4)}-${propsRef.current.theme}-${propsRef.current.cities.length}-${tripKey}`
      const cache = staticLayers.current
      if (cache.key === key) return cache.cities
      const boxes = [...reserved]
      const placed: City[] = []
      for (const c of propsRef.current.cities) {
        if (c[3] > zoom + 0.25) continue
        const size = c[4] ? 13.5 : 12
        const w = textWidth(c[2], c[4] ? 500 : 400, size) + 10
        const h = size + 8
        const { x, y } = map.project([c[0], c[1]])
        const b: [number, number, number, number] = [x - w / 2, y - h / 2, x + w / 2, y + h / 2]
        if (boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue
        boxes.push(b)
        placed.push(c)
      }
      const base = {
        getPosition: (c: City) => [c[0], c[1]] as [number, number], getText: (c: City) => c[2],
        getColor: pal.texte, fontFamily: FONT, fontSettings: { sdf: true, buffer: 6 }, outlineWidth: 4, outlineColor: pal.halo,
        characterSet: 'auto' as const, getTextAnchor: 'middle' as const, getAlignmentBaseline: 'center' as const,
      }
      cache.cities = [
        new TextLayer<City>({ ...base, id: 'villes', data: placed.filter((c) => !c[4]), getSize: 12, fontWeight: 400 }),
        new TextLayer<City>({ ...base, id: 'capitales', data: placed.filter((c) => c[4]), getSize: 13.5, fontWeight: 500 }),
      ]
      cache.key = key
      return cache.cities
    }

    const stopCache = { key: '', list: [] as TripStop[], boxes: [] as [number, number, number, number][] }
    const stopLabels = (stops: TripStop[], zoom: number) => {
      const key = `${stops[0]?.id}-${stops.length}-${Math.floor(zoom * 4)}`
      if (stopCache.key === key) return stopCache.list
      const order = stops.map((s, i) => ({ s, rank: i === 0 || i === stops.length - 1 ? 1 : 0 })).sort((a, b) => b.rank - a.rank)
      const boxes: [number, number, number, number][] = []
      const out: TripStop[] = []
      for (const { s } of order) {
        const { x, y } = map.project([s.lon, s.lat])
        const b: [number, number, number, number] = [x - 6, y - 10, x + 14 + textWidth(s.name, 350, 13), y + 10]
        if (boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue
        boxes.push(b)
        out.push(s)
      }
      // Every stop dot also keeps city names away, even when its own name is hidden.
      for (const s of stops) {
        const { x, y } = map.project([s.lon, s.lat])
        boxes.push([x - 6, y - 6, x + 6, y + 6])
      }
      stopCache.key = key
      stopCache.list = out
      stopCache.boxes = boxes
      return out
    }

    let raf = 0
    let last = 0
    const render = () => {
      const p = propsRef.current
      const pal = paletteRef.current
      const f = p.filters
      const t = Date.now()
      const shown: Shown[] = []
      let selected: Shown | null = null
      for (const train of p.store.trains.values()) {
        const isSel = train.id === p.selectedId
        if (!isSel && (!f[train.kind] || (f.op && train.op.id !== f.op))) continue
        const pos = positionAt(train, t)
        if (!pos) continue
        if (isSel) selected = { train, pos }
        else if (f[pos.source]) shown.push({ train, pos })
      }
      if (import.meta.env.DEV) Object.assign(window, { __shown: shown })
      const zoom = map.getZoom()
      const size = markerSize(zoom)
      const marker = {
        iconAtlas: atlas.url, iconMapping: atlas.mapping, billboard: false, sizeUnits: 'pixels' as const,
        sizeScale: size, getSize: 1, getPosition: (d: Shown) => [d.pos.lon, d.pos.lat] as [number, number],
        getAngle: (d: Shown) => 90 - d.pos.bearing, updateTriggers: { getPosition: t, getAngle: t },
      }
      const layers: Layer[] = [...staticLayers.current.network]
      let stopNames: Layer | null = null

      if (p.trip && selected) {
        const line = p.trip.line
        const color = rgb(selected.train.op.color)
        let c = routeCache.current
        if (!c || c.id !== p.trip.id || t - c.t > 500) {
          c = { id: p.trip.id, t, along: line.project([selected.pos.lon, selected.pos.lat]).along }
          routeCache.current = c
        }
        layers.push(
          new PathLayer({
            id: 'trajet-reste', data: [line.slice(c.along, line.length)], getPath: (d: LonLat[]) => d,
            getColor: [...color, 90], widthUnits: 'pixels', getWidth: 3, capRounded: true, jointRounded: true,
            updateTriggers: { getPath: c.along },
          }),
          new PathLayer({
            id: 'trajet-fait', data: [line.slice(0, c.along)], getPath: (d: LonLat[]) => d,
            getColor: color, widthUnits: 'pixels', getWidth: 3, capRounded: true, jointRounded: true,
            updateTriggers: { getPath: c.along },
          }),
          new ScatterplotLayer({
            id: 'arrets', data: p.trip.stops, getPosition: (s) => [s.lon, s.lat], radiusUnits: 'pixels', getRadius: 4.5,
            stroked: true, getFillColor: color, getLineColor: pal.terre, lineWidthUnits: 'pixels', getLineWidth: 1.5,
          }),
        )
        stopNames = new TextLayer({
            id: 'arrets-noms', data: stopLabels(p.trip.stops, zoom), getPosition: (s) => [s.lon, s.lat], getText: (s) => s.name,
            getSize: 13, getColor: pal.texte, fontFamily: FONT, fontWeight: 350, getTextAnchor: 'start',
            getAlignmentBaseline: 'center', getPixelOffset: [10, 0], fontSettings: { sdf: true, buffer: 6 }, outlineWidth: 4,
            outlineColor: pal.halo, characterSet: 'auto',
          })
      }

      layers.push(
        new IconLayer<Shown>({
          ...marker, id: 'trains-gps', data: shown.filter((d) => d.pos.source === 'gps'), getIcon: (d) => `${d.train.kind}-h`,
          getColor: (d) => [...rgb(d.train.op.color), 110],
        }),
        new IconLayer<Shown>({ ...marker, id: 'trains-contour', data: shown, getIcon: (d) => `${d.train.kind}-c`, getColor: pal.terre }),
        new IconLayer<Shown>({ ...marker, id: 'trains', data: shown, pickable: true, getIcon: (d) => d.train.kind, getColor: (d) => rgb(d.train.op.color) }),
      )
      if (selected) {
        const sel = [selected]
        layers.push(
          new ScatterplotLayer<Shown>({
            id: 'selection', data: sel, getPosition: marker.getPosition, radiusUnits: 'pixels', getRadius: Math.max(14, size * 0.95),
            stroked: true, filled: false, getLineColor: pal.texte, lineWidthUnits: 'pixels', getLineWidth: 1.5,
            updateTriggers: { getPosition: t },
          }),
          new IconLayer<Shown>({ ...marker, id: 'selection-contour', data: sel, getIcon: (d) => `${d.train.kind}-c`, getColor: pal.terre }),
          new IconLayer<Shown>({ ...marker, id: 'selection-train', data: sel, pickable: true, getIcon: (d) => d.train.kind, getColor: (d) => rgb(d.train.op.color) }),
        )
        if (p.follow) map.jumpTo({ center: [selected.pos.lon, selected.pos.lat] })
      }
      if (stopNames) layers.push(stopNames) // names above the trains, like the city names
      const withTrip = p.trip && selected
      layers.push(...cityLayers(zoom, pal, withTrip ? stopCache.boxes : [], withTrip ? stopCache.key : ''))
      if (userPos.current) {
        layers.push(
          new ScatterplotLayer({
            id: 'moi', data: [userPos.current], getPosition: (d: LonLat) => d, radiusUnits: 'pixels', getRadius: 6,
            stroked: true, getFillColor: pal.accent, getLineColor: pal.fond, lineWidthUnits: 'pixels', getLineWidth: 2,
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

  // Theme: recolour the base map; cached layers are rebuilt with the new palette.
  useEffect(() => {
    paletteRef.current = readPalette()
    staticLayers.current.key = ''
    const map = mapRef.current
    if (!map) return
    if (map.isStyleLoaded()) applyTheme(map)
    else map.once('load', () => applyTheme(map))
  }, [props.theme])

  useEffect(() => {
    const pal = paletteRef.current
    const n = props.network
    staticLayers.current.network = n
      ? (['cl', 'gv'] as const).map(
          (k) =>
            new PathLayer<number[]>({
              id: `reseau-${k}`, data: n[k], getPath: (d) => d as unknown as [number, number][], positionFormat: 'XY',
              _pathType: 'open', getColor: pal[k], widthUnits: 'pixels', getWidth: k === 'gv' ? 1.4 : 1,
              widthMinPixels: 0.7, capRounded: true, jointRounded: true,
            }) as unknown as Layer,
        )
      : []
  }, [props.network, props.theme])

  useEffect(() => {
    mapRef.current?.easeTo({ padding: props.padding, duration: 300 })
  }, [props.padding.left, props.padding.right, props.padding.top, props.padding.bottom])

  return <div ref={container} className="carte" />
}
