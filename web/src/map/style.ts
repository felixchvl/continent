// Base map built from the design tokens, on Mapbox Streets vector tiles: a quiet ground
// (land, sea, borders, roads only when zoomed in) so the operators' colours carry the map.
// The rail network comes from OpenStreetMap (our own tiles, web/scripts/build-rail.sh): every
// passenger line in Europe, high-speed lines darker, main lines thicker than branch lines.
// City names are drawn by deck.gl in Halyard, like the rest of the interface.

import type { Map as MapboxMap, StyleSpecification } from 'mapbox-gl'
import { tokenCss } from '../theme'

const notMaritime = ['match', ['to-string', ['get', 'maritime']], 'true', false, true]
const notDisputed = ['match', ['to-string', ['get', 'disputed']], 'true', false, true]
const worldview = ['match', ['get', 'worldview'], ['all', 'US'], true, false]

/** The rail network layers, bottom to top; the network button shows or hides them together. */
export const NETWORK_LAYERS = ['reseau-secondaire', 'reseau-principal', 'reseau-gv'] as const

const width = (z4: number, z8: number, z12: number, z16: number) =>
  ['interpolate', ['exponential', 1.4], ['zoom'], 4, z4, 8, z8, 12, z12, 16, z16]

export function buildStyle(): StyleSpecification {
  const c = tokenCss
  const rail = (id: string, cls: string, color: string, w: unknown, minzoom = 4) => ({
    id, type: 'line' as const, source: 'rail', 'source-layer': 'rail', minzoom,
    filter: ['==', ['get', 'c'], cls],
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: { 'line-color': c(color), 'line-width': w as number },
  })
  return {
    version: 8,
    projection: { name: 'mercator' },
    sources: {
      streets: { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' },
      rail: {
        type: 'vector', tiles: [`${location.origin}/tiles/rail/{z}/{x}/{y}.pbf`], minzoom: 4, maxzoom: 11,
        attribution: '© OpenStreetMap',
      },
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
      rail('reseau-secondaire', 'branch', 'carte-reseau-secondaire', width(0.45, 0.8, 1.3, 2.4), 6),
      rail('reseau-principal', 'main', 'carte-reseau-classique', width(0.65, 1.15, 1.8, 3)),
      rail('reseau-gv', 'gv', 'carte-reseau-gv', width(0.95, 1.5, 2.4, 3.6)),
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
  const set = (layer: string, prop: string, value: string) => {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop as never, value as never)
  }
  set('terre', 'background-color', c('carte-terre'))
  set('mer', 'fill-color', c('carte-mer'))
  set('rivieres', 'line-color', c('carte-mer'))
  set('routes', 'line-color', c('carte-frontiere'))
  set('reseau-secondaire', 'line-color', c('carte-reseau-secondaire'))
  set('reseau-principal', 'line-color', c('carte-reseau-classique'))
  set('reseau-gv', 'line-color', c('carte-reseau-gv'))
  set('frontieres', 'line-color', c('carte-frontiere'))
}
