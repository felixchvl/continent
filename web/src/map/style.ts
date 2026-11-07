// Base map built from the design tokens, on Mapbox Streets vector tiles: a quiet ground
// (land, sea, borders, and roads/rails only when zoomed in) so the operators' colours carry
// the map. City names are drawn by deck.gl in Halyard, like the rest of the interface.

import type { Map as MapboxMap, StyleSpecification } from 'mapbox-gl'
import { tokenCss } from '../theme'

const notMaritime = ['match', ['to-string', ['get', 'maritime']], 'true', false, true]
const notDisputed = ['match', ['to-string', ['get', 'disputed']], 'true', false, true]
const worldview = ['match', ['get', 'worldview'], ['all', 'US'], true, false]

export function buildStyle(): StyleSpecification {
  const c = tokenCss
  return {
    version: 8,
    projection: { name: 'mercator' },
    sources: { streets: { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' } },
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
        id: 'voies', type: 'line', source: 'streets', 'source-layer': 'road', minzoom: 9,
        filter: ['==', ['get', 'class'], 'major_rail'],
        paint: { 'line-color': c('carte-reseau-classique'), 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 15, 2] },
      },
      {
        id: 'frontieres', type: 'line', source: 'streets', 'source-layer': 'admin',
        filter: ['all', ['==', ['get', 'admin_level'], 0], notMaritime, notDisputed, worldview],
        paint: { 'line-color': c('carte-frontiere'), 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 1.2] },
      },
    ],
  }
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
  set('voies', 'line-color', c('carte-reseau-classique'))
  set('frontieres', 'line-color', c('carte-frontiere'))
}
