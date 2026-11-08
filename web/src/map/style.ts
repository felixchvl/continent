// Base map built from the design tokens, on Mapbox Streets vector tiles: a quiet ground
// (land, sea, borders, roads only when zoomed in) so the operators' colours carry the map.
// The rail network comes from OpenStreetMap (our own tiles, server/pipeline/osm.sh): every passenger
// line in Europe in its line's colour or a grey (high-speed darker, main lines thicker than branch
// lines), then metros, trams and funiculars, and the stations, from zoom 9.
// City names are drawn by deck.gl in Halyard, like the rest of the interface.

import type { FilterSpecification, Map as MapboxMap, StyleSpecification } from 'mapbox-gl'
import { tokenCss } from '../theme'

const notMaritime = ['match', ['to-string', ['get', 'maritime']], 'true', false, true]
const notDisputed = ['match', ['to-string', ['get', 'disputed']], 'true', false, true]
const worldview = ['match', ['get', 'worldview'], ['all', 'US'], true, false]

const width = (z4: number, z8: number, z12: number, z16: number) =>
  ['interpolate', ['exponential', 1.4], ['zoom'], 4, z4, 8, z8, 12, z12, 16, z16]

/** The network, bottom to top. A track takes its line's colour (`col`, from OpenStreetMap) when the
 * lines on it agree on one, else the grey of its kind. Built by server/pipeline/osm.sh. */
const NETWORK: { id: string; source: 'rail' | 'urbain'; kinds: string[]; grey: string; width: unknown; minzoom: number }[] = [
  { id: 'reseau-secondaire', source: 'rail', kinds: ['branch'], grey: 'carte-reseau-secondaire', width: width(0.45, 0.8, 1.3, 2.4), minzoom: 6 },
  { id: 'reseau-principal', source: 'rail', kinds: ['main'], grey: 'carte-reseau-classique', width: width(0.65, 1.15, 1.8, 3), minzoom: 4 },
  { id: 'reseau-gv', source: 'rail', kinds: ['gv'], grey: 'carte-reseau-gv', width: width(0.95, 1.5, 2.4, 3.6), minzoom: 4 },
  { id: 'urbain-tram', source: 'urbain', kinds: ['tram'], grey: 'carte-urbain', width: width(0.3, 0.5, 1.3, 3), minzoom: 10 },
  { id: 'urbain-metro', source: 'urbain', kinds: ['metro', 'light_rail', 'monorail', 'funicular'], grey: 'carte-urbain', width: width(0.4, 0.7, 1.8, 4), minzoom: 9 },
]
/** Everything the network button shows or hides. */
export const NETWORK_LAYERS = [...NETWORK.map((l) => l.id), 'gares', 'gares-logos'] as const

const lineColor = (grey: string) => ['coalesce', ['get', 'col'], tokenCss(grey)] as unknown as string

export function buildStyle(): StyleSpecification {
  const c = tokenCss
  const tiles = (set: string) => [`${location.origin}/tiles/${set}/{z}/{x}/{y}.pbf`]
  return {
    version: 8,
    projection: { name: 'mercator' },
    sources: {
      streets: { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' },
      rail: { type: 'vector', tiles: tiles('rail'), minzoom: 4, maxzoom: 13, attribution: '© OpenStreetMap' },
      urbain: { type: 'vector', tiles: tiles('urbain'), minzoom: 9, maxzoom: 14 },
    },
    layers: [
      { id: 'terre', type: 'background', paint: { 'background-color': c('carte-terre') } },
      { id: 'mer', type: 'fill', source: 'streets', 'source-layer': 'water', paint: { 'fill-color': c('carte-mer') } },
      {
        id: 'rivieres', type: 'line', source: 'streets', 'source-layer': 'waterway', minzoom: 8,
        filter: ['in', ['get', 'class'], ['literal', ['river', 'canal']]],
        paint: { 'line-color': c('carte-mer'), 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 3] },
      },
      {
        id: 'routes', type: 'line', source: 'streets', 'source-layer': 'road', minzoom: 8,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
        paint: {
          'line-color': c('carte-frontiere'),
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.2, 12, 0.45],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 14, 3],
        },
      },
      {
        id: 'frontieres', type: 'line', source: 'streets', 'source-layer': 'admin',
        filter: ['all', ['==', ['get', 'admin_level'], 0], notMaritime, notDisputed, worldview],
        paint: { 'line-color': c('carte-frontiere'), 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 1.2] },
      },
      ...NETWORK.map((l) => ({
        id: l.id, type: 'line' as const, source: l.source, 'source-layer': l.source, minzoom: l.minzoom,
        filter: ['in', ['get', 'c'], ['literal', l.kinds]] as FilterSpecification,
        layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
        paint: { 'line-color': lineColor(l.grey), 'line-width': l.width as number },
      })),
      {
        // Stations: white dots ringed in black, like the stops on the train sheet.
        id: 'gares', type: 'circle', source: 'urbain', 'source-layer': 'gares', minzoom: 9,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            9, ['match', ['get', 'k'], ['station'], 2.4, 1.6],
            12, ['match', ['get', 'k'], ['station'], 4, ['halt'], 3, 2.4],
            16, ['match', ['get', 'k'], ['station'], 6.5, ['halt'], 5, 4]] as unknown as number,
          'circle-color': c('fond'), 'circle-stroke-color': c('texte'),
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 1.6] as unknown as number,
        },
      },
      {
        // The logo of the station's network or operator above it (images loaded on demand, see MapView).
        id: 'gares-logos', type: 'symbol', source: 'urbain', 'source-layer': 'gares', minzoom: 13,
        filter: ['has', 'logo'],
        layout: { 'icon-image': ['get', 'logo'] as unknown as string, 'icon-anchor': 'bottom', 'icon-offset': [0, -6], 'icon-padding': 2 },
      },
    ],
  }
}

/** Shows or hides the rail network. */
export function setNetworkVisible(map: MapboxMap, visible: boolean) {
  for (const id of NETWORK_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
}

/** Recolours the map for the current theme without reloading the style. */
export function applyTheme(map: MapboxMap) {
  const c = tokenCss
  const set = (layer: string, prop: string, value: unknown) => {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop as never, value as never)
  }
  set('terre', 'background-color', c('carte-terre'))
  set('mer', 'fill-color', c('carte-mer'))
  set('rivieres', 'line-color', c('carte-mer'))
  set('routes', 'line-color', c('carte-frontiere'))
  for (const l of NETWORK) set(l.id, 'line-color', lineColor(l.grey))
  set('gares', 'circle-color', c('fond'))
  set('gares', 'circle-stroke-color', c('texte'))
  set('frontieres', 'line-color', c('carte-frontiere'))
}
