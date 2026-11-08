// The map: Mapbox GL draws the quiet base map and the rail network (OpenStreetMap tiles); deck.gl
// draws every train in Europe as a dot in its operator's colour, the selected route and the city
// names in Halyard.
// Dots are moved ~15 times per second between two server updates, without re-rendering React.

import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Layer, PickingInfo } from '@deck.gl/core'
import { applyTheme, buildStyle, setNetworkVisible } from './style'
import { token, type RGBA, type Theme } from '../theme'
import { FLAG_GPS } from '../shared/protocol.ts'
import { hexToRgb } from '../shared/operators.ts'
import type { LiveStore, Shown, TripDetails, TripStop } from '../data/live'
import { URBAN_MIN_ZOOM, UrbanStore, type UrbanVehicle } from '../data/urbain'
import type { LonLat } from '../shared/geo.ts'

export type Filters = { gv: boolean; cl: boolean; reg: boolean; gps: boolean; estimee: boolean; op: string | null }
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
  network: boolean
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

type Palette = Record<'terre' | 'texte' | 'halo' | 'accent' | 'fond' | 'neutre', RGBA>
type Box = [number, number, number, number]

const readPalette = (): Palette => ({
  terre: token('carte-terre'), neutre: token('train-neutre'),
  texte: token('carte-ville'), halo: token('carte-halo'), accent: token('accent'), fond: token('fond'),
})

const FONT = 'Halyard, halyard-display, Helvetica Neue, Helvetica, Arial, sans-serif'
/** Dot radius (px at radiusScale 1): high speed above long distance above regional. */
const RADIUS = { gv: 3.8, cl: 3.3, reg: 2.6 }
const DRAW_ORDER = { reg: 0, cl: 1, gv: 2 }
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
/** Web Mercator pixels at this zoom: label boxes computed at different moments stay comparable. */
const world = (lon: number, lat: number, zoom: number): [number, number] => {
  const k = 512 * 2 ** zoom
  const r = (lat * Math.PI) / 180
  return [((lon + 180) / 360) * k, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * k]
}
const overlaps = (b: Box, boxes: Box[]) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])

function radiusScale(zoom: number) {
  const stops: [number, number][] = [[3, 0.75], [5, 1], [7, 1.3], [9, 1.7], [12, 2.4], [15, 3]]
  if (zoom <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const [z1, s1] = stops[i]
    const [z0, s0] = stops[i - 1]
    if (zoom <= z1) return s0 + ((zoom - z0) / (z1 - z0)) * (s1 - s0)
  }
  return stops[stops.length - 1][1]
}

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const paletteRef = useRef<Palette>(readPalette())
  const staticLayers = useRef<{ key: string; cities: Layer[]; placedCities: City[] }>({ key: '', cities: [], placedCities: [] })
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
      hash: true, // #zoom/lat/lon: a view can be shared and survives a reload
    })
    mapRef.current = map
    map.on('error', (e) => console.error('Mapbox', e.error?.message ?? e))
    if (import.meta.env.DEV) Object.assign(window, { __map: map, __store: propsRef.current.store })
    map.setPadding(propsRef.current.padding)
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 96 }), 'bottom-right')

    // Station logos (Q123.svg, from the library of actors) are loaded the first time a station shows
    // one, drawn on a small white plate so that they read on the dark theme too.
    map.on('styleimagemissing', (e: { id: string }) => {
      const id = e.id
      if (!/^Q\d+\.(svg|png|jpg)$/.test(id) || map.hasImage(id)) return
      map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) }) // placeholder while it loads
      const img = new Image()
      img.onload = () => {
        const h = 28, pad = 6
        const w = Math.min(120, Math.max(h, Math.round((h * (img.naturalWidth || 1)) / (img.naturalHeight || 1))))
        const canvas = Object.assign(document.createElement('canvas'), { width: w + pad * 2, height: h + pad * 2 })
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.roundRect(0, 0, canvas.width, canvas.height, 8)
        ctx.fill()
        ctx.drawImage(img, pad, pad, w, h)
        if (map.hasImage(id)) map.removeImage(id)
        map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 })
      }
      img.src = `/logos/${id}`
    })

    // Visible trains: rebuilt when new data arrives or a filter changes, not on every frame.
    const vis = { key: '', n: 0, rows: new Int32Array(0), colors: new Uint8Array(0), radii: new Float32Array(0), gps: [] as number[] }
    const buf = [new Float32Array(0), new Float32Array(0)]
    let flip = 0
    const scratch = new Float64Array(2)

    // Metros and trams, fetched per zoom-12 tile when the map is close enough to a city.
    const urban = new UrbanStore()
    const updateUrban = () => {
      const b = map.getBounds()
      if (b) urban.update({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, map.getZoom())
    }
    map.on('moveend', updateUrban)
    const urbanTimer = setInterval(updateUrban, 10_000)

    const shownAt = (k: number): Shown => {
      const s = propsRef.current.store
      const r = vis.rows[k]
      return { train: s.trains[s.idx[r]], pos: s.pos(r, Date.now()) }
    }

    const overlay = new MapboxOverlay({
      interleaved: false, // deck.gl on its own canvas above the map: city names are deck.gl layers too
      layers: [],
      pickingRadius: 6,
      onHover: (info: PickingInfo) => {
        const hit = info.layer?.id === 'trains' && info.index >= 0
        map.getCanvas().style.cursor = hit ? 'pointer' : ''
        propsRef.current.onHover(hit ? { shown: shownAt(info.index), x: info.x, y: info.y } : null)
      },
      onClick: (info: PickingInfo) => {
        if (info.layer?.id === 'trains' && info.index >= 0) propsRef.current.onSelect(shownAt(info.index).train.id)
        else if (info.layer?.id !== 'selection-train') propsRef.current.onSelect(null)
      },
    })
    map.addControl(overlay)

    const rebuildVisible = () => {
      const { store: s, filters: f } = propsRef.current
      const rows: number[] = []
      for (let r = 0; r < s.n; r++) {
        const t = s.trains[s.idx[r]]
        if (!t || !f[t.kind] || (f.op && t.op.id !== f.op)) continue
        if (!f[s.flags[r] & FLAG_GPS ? 'gps' : 'estimee']) continue
        rows.push(r)
      }
      rows.sort((a, b) => DRAW_ORDER[s.trains[s.idx[a]].kind] - DRAW_ORDER[s.trains[s.idx[b]].kind])
      const n = rows.length
      vis.rows = Int32Array.from(rows)
      vis.colors = new Uint8Array(n * 4)
      vis.radii = new Float32Array(n)
      vis.gps = []
      for (let k = 0; k < n; k++) {
        const t = s.trains[s.idx[rows[k]]]
        const [r, g, b] = t.color ? rgb(t.color) : paletteRef.current.neutre
        vis.colors.set([r, g, b, 255], k * 4)
        vis.radii[k] = RADIUS[t.kind]
        if (s.flags[rows[k]] & FLAG_GPS) vis.gps.push(k)
      }
      vis.n = n
      buf[0] = new Float32Array(n * 2)
      buf[1] = new Float32Array(n * 2)
    }

    // City names: placed greedily by priority so that no two labels overlap (and none covers a
    // station of the selected train). In Web Mercator the result only depends on the zoom.
    const cityLayers = (zoom: number, pal: Palette, reserved: Box[], tripKey: string): Layer[] => {
      const key = `${Math.floor(zoom * 4)}-${propsRef.current.theme}-${propsRef.current.cities.length}-${tripKey}`
      const cache = staticLayers.current
      if (cache.key === key) return cache.cities
      const boxes = [...reserved]
      const placed: typeof propsRef.current.cities = []
      for (const c of propsRef.current.cities) {
        if (c[3] > zoom + 0.25) continue
        const size = c[4] ? 13.5 : 12
        const w = textWidth(c[2], c[4] ? 500 : 400, size) + 10
        const h = size + 8
        const { x, y } = map.project([c[0], c[1]])
        const b: Box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2]
        if (overlaps(b, boxes)) continue
        boxes.push(b)
        placed.push(c)
      }
      cache.placedCities = placed
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

    // Station names (from the station tiles), from zoom 10: big stations first, then halts, then metro
    // and tram stops; placed when the map stops moving, never over a city name or another station.
    type StationLabel = { name: string; lon: number; lat: number; kind: string }
    const STATION_ZOOM: Record<string, number> = { station: 10, halt: 11.5, metro: 13, light_rail: 13, tram: 14, funicular: 13 }
    const STATION_RANK: Record<string, number> = { station: 0, halt: 1, metro: 2, light_rail: 2, funicular: 3, tram: 4 }
    let stationNames: StationLabel[] = []
    const placeStations = () => {
      const zoom = map.getZoom()
      if (zoom < 10 || !propsRef.current.network) {
        stationNames = []
        return
      }
      const bounds = map.getBounds()
      const seen = new Set<string>()
      const candidates: StationLabel[] = []
      for (const f of map.querySourceFeatures('urbain', { sourceLayer: 'gares' })) {
        const kind = String(f.properties?.k ?? 'station')
        const name = String(f.properties?.n ?? '')
        if (!name || zoom < (STATION_ZOOM[kind] ?? 14) || f.geometry.type !== 'Point') continue
        const [lon, lat] = f.geometry.coordinates as [number, number]
        if (bounds && !bounds.contains([lon, lat])) continue
        const id = `${name}|${lon.toFixed(2)}|${lat.toFixed(2)}`
        if (seen.has(id)) continue
        seen.add(id)
        candidates.push({ name, lon, lat, kind })
      }
      candidates.sort((a, b) => (STATION_RANK[a.kind] ?? 5) - (STATION_RANK[b.kind] ?? 5))
      const z = Math.floor(zoom * 4) / 4
      const boxes: Box[] = staticLayers.current.placedCities.map((c) => {
        const [x, y] = world(c[0], c[1], z)
        const w = textWidth(c[2], c[4] ? 500 : 400, c[4] ? 13.5 : 12) + 10
        return [x - w / 2, y - 12, x + w / 2, y + 12] as Box
      })
      const out: StationLabel[] = []
      for (const st of candidates) {
        const [x, y] = world(st.lon, st.lat, z)
        const b: Box = [x - 5, y - 8, x + 12 + textWidth(st.name, 350, 11.5), y + 8]
        if (overlaps(b, boxes)) continue
        boxes.push(b)
        out.push(st)
        if (out.length >= 250) break
      }
      stationNames = out
    }
    map.on('idle', placeStations)

    const stopCache = { key: '', list: [] as TripStop[], boxes: [] as Box[] }
    const stopLabels = (stops: TripStop[], zoom: number) => {
      const key = `${stops[0]?.id}-${stops.length}-${Math.floor(zoom * 4)}`
      if (stopCache.key === key) return stopCache.list
      const order = stops.map((s, i) => ({ s, rank: i === 0 || i === stops.length - 1 ? 1 : 0 })).sort((a, b) => b.rank - a.rank)
      const boxes: Box[] = []
      const out: TripStop[] = []
      for (const { s } of order) {
        const { x, y } = map.project([s.lon, s.lat])
        const b: Box = [x - 6, y - 10, x + 14 + textWidth(s.name, 350, 13), y + 10]
        if (overlaps(b, boxes)) continue
        boxes.push(b)
        out.push(s)
      }
      for (const s of stops) {
        const { x, y } = map.project([s.lon, s.lat])
        boxes.push([x - 6, y - 6, x + 6, y + 6]) // every stop dot keeps city names away
      }
      Object.assign(stopCache, { key, list: out, boxes })
      return out
    }

    let raf = 0
    let last = 0
    const render = () => {
      const p = propsRef.current
      const s = p.store
      const pal = paletteRef.current
      const f = p.filters
      const t = Date.now()
      const key = `${s.updated}-${s.version}-${f.gv}${f.cl}${f.reg}${f.gps}${f.estimee}-${f.op}-${propsRef.current.theme}`
      if (vis.key !== key) {
        rebuildVisible()
        vis.key = key
      }
      const positions = buf[(flip ^= 1)]
      for (let k = 0; k < vis.n; k++) {
        s.project(vis.rows[k], t, scratch, 0)
        positions[k * 2] = scratch[0]
        positions[k * 2 + 1] = scratch[1]
      }
      const zoom = map.getZoom()
      const scale = radiusScale(zoom)
      const selected = p.selectedId ? s.get(p.selectedId, t) : null
      const layers: Layer[] = []
      let stopNames: Layer | null = null

      if (p.trip && selected) {
        const line = p.trip.line
        const lc = p.trip.color ?? selected.train.color
        const color = lc ? rgb(lc) : pal.neutre.slice(0, 3) as [number, number, number]
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
          new ScatterplotLayer<TripStop>({
            id: 'arrets', data: p.trip.stops, getPosition: (st) => [st.lon, st.lat], radiusUnits: 'pixels', getRadius: 4.5,
            stroked: true, getFillColor: color, getLineColor: pal.terre, lineWidthUnits: 'pixels', getLineWidth: 1.5,
          }),
        )
        stopNames = new TextLayer<TripStop>({
          id: 'arrets-noms', data: stopLabels(p.trip.stops, zoom), getPosition: (st) => [st.lon, st.lat], getText: (st) => st.name,
          getSize: 13, getColor: pal.texte, fontFamily: FONT, fontWeight: 350, getTextAnchor: 'start',
          getAlignmentBaseline: 'center', getPixelOffset: [10, 0], fontSettings: { sdf: true, buffer: 6 }, outlineWidth: 4,
          outlineColor: pal.halo, characterSet: 'auto',
        })
      }

      if (zoom >= URBAN_MIN_ZOOM && urban.vehicles.length) {
        const shown: { v: UrbanVehicle; at: [number, number] }[] = []
        for (const v of urban.vehicles) {
          const at = UrbanStore.position(v, t)
          if (at) shown.push({ v, at })
        }
        layers.push(
          new ScatterplotLayer<{ v: UrbanVehicle; at: [number, number] }>({
            id: 'urbain', data: shown, getPosition: (d) => d.at, radiusUnits: 'pixels', getRadius: 3.2, stroked: true,
            getFillColor: (d) => (d.v.color ? rgb(d.v.color) : pal.neutre), getLineColor: pal.terre, lineWidthUnits: 'pixels', getLineWidth: 0.8,
            updateTriggers: { getPosition: t, getFillColor: `${urban.version}-${p.theme}` },
          }),
        )
      }

      layers.push(
        new ScatterplotLayer({
          id: 'trains-gps', data: vis.gps, getPosition: (k: number) => [positions[k * 2], positions[k * 2 + 1]],
          getLineColor: (k: number) => [vis.colors[k * 4], vis.colors[k * 4 + 1], vis.colors[k * 4 + 2], 130],
          getRadius: (k: number) => vis.radii[k] + 3, radiusUnits: 'pixels', radiusScale: scale, filled: false, stroked: true,
          lineWidthUnits: 'pixels', getLineWidth: 1.5, updateTriggers: { getPosition: t },
        }),
        new ScatterplotLayer({
          id: 'trains', pickable: true,
          data: {
            length: vis.n,
            attributes: {
              getPosition: { value: positions, size: 2 },
              getFillColor: { value: vis.colors, size: 4 },
              getRadius: { value: vis.radii, size: 1 },
            },
          },
          radiusUnits: 'pixels', radiusScale: scale, stroked: true, getLineColor: pal.terre, lineWidthUnits: 'pixels', getLineWidth: 0.8,
        }),
      )
      if (selected) {
        const lc = p.trip?.color ?? selected.train.color
        const c = lc ? rgb(lc) : pal.neutre.slice(0, 3) as [number, number, number]
        const sel = [selected]
        const at = (d: Shown) => [d.pos.lon, d.pos.lat] as [number, number]
        layers.push(
          new ScatterplotLayer<Shown>({
            id: 'selection', data: sel, getPosition: at, radiusUnits: 'pixels', getRadius: 13, stroked: true, filled: false,
            getLineColor: pal.texte, lineWidthUnits: 'pixels', getLineWidth: 1.5, updateTriggers: { getPosition: t },
          }),
          new ScatterplotLayer<Shown>({
            id: 'selection-train', data: sel, getPosition: at, radiusUnits: 'pixels', getRadius: 6, stroked: true, pickable: true,
            getFillColor: c, getLineColor: pal.terre, lineWidthUnits: 'pixels', getLineWidth: 2, updateTriggers: { getPosition: t },
          }),
        )
        if (p.follow) map.jumpTo({ center: [selected.pos.lon, selected.pos.lat] })
      }
      if (stopNames) layers.push(stopNames) // names above the trains, like the city names
      const withTrip = p.trip && selected
      layers.push(...cityLayers(zoom, pal, withTrip ? stopCache.boxes : [], withTrip ? stopCache.key : ''))
      if (stationNames.length && !withTrip) {
        layers.push(
          new TextLayer<StationLabel>({
            id: 'gares-noms', data: stationNames, getPosition: (st) => [st.lon, st.lat], getText: (st) => st.name,
            getSize: 11.5, getColor: pal.texte, fontFamily: FONT, fontWeight: 350, getTextAnchor: 'start', getAlignmentBaseline: 'center',
            getPixelOffset: [7, 0], fontSettings: { sdf: true, buffer: 6 }, outlineWidth: 4, outlineColor: pal.halo, characterSet: 'auto',
          }),
        )
      }
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
      clearInterval(urbanTimer)
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

  // The rail network is a Mapbox layer group; the network button shows or hides it.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.isStyleLoaded()) setNetworkVisible(map, props.network)
    else map.once('load', () => setNetworkVisible(map, propsRef.current.network))
  }, [props.network])

  useEffect(() => {
    mapRef.current?.easeTo({ padding: props.padding, duration: 300 })
  }, [props.padding.left, props.padding.right, props.padding.top, props.padding.bottom])

  return <div ref={container} className="carte" />
}
