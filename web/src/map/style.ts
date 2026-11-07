// Map style built from the design tokens, on Mapbox Streets vector tiles:
// land, sea, borders and city labels only. The rail network and trains are drawn by deck.gl.

import type { Map as MapboxMap, StyleSpecification } from 'mapbox-gl'
import { tokenCss } from '../theme'

export const LABEL_LAYER = 'villes'

const notMaritime = ['match', ['to-string', ['get', 'maritime']], 'true', false, true]
const notDisputed = ['match', ['to-string', ['get', 'disputed']], 'true', false, true]
const worldview = ['match', ['get', 'worldview'], ['all', 'US'], true, false]

export function buildStyle(): StyleSpecification {
  const c = tokenCss
  return {
    version: 8,
    glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
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
        id: 'routes', type: 'line', source: 'streets', 'source-layer': 'road', minzoom: 7,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
        paint: {
          'line-color': c('carte-frontiere'),
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.25, 12, 0.5],
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.4, 14, 3],
        },
      },
      {
        id: 'voies', type: 'line', source: 'streets', 'source-layer': 'road', minzoom: 9,
        filter: ['==', ['get', 'class'], 'major_rail'],
        paint: { 'line-color': c('carte-reseau-classique'), 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 15, 2] },
      },
      {
        id: 'regions', type: 'line', source: 'streets', 'source-layer': 'admin', minzoom: 5.5,
        filter: ['all', ['==', ['get', 'admin_level'], 1], notMaritime, worldview],
        paint: { 'line-color': c('carte-frontiere'), 'line-width': 0.6, 'line-dasharray': [2, 2], 'line-opacity': 0.7 },
      },
      {
        id: 'frontieres', type: 'line', source: 'streets', 'source-layer': 'admin',
        filter: ['all', ['==', ['get', 'admin_level'], 0], notMaritime, notDisputed, worldview],
        paint: { 'line-color': c('carte-frontiere'), 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 10, 1.6] },
      },
      {
        id: LABEL_LAYER, type: 'symbol', source: 'streets', 'source-layer': 'place_label',
        filter: [
          'all',
          ['==', ['get', 'class'], 'settlement'],
          ['step', ['zoom'], ['<=', ['get', 'symbolrank'], 8], 5, ['<=', ['get', 'symbolrank'], 10], 6.5, ['<=', ['get', 'symbolrank'], 12], 8.5, true],
        ],
        layout: {
          'text-field': ['coalesce', ['get', 'name_fr'], ['get', 'name']],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, ['match', ['get', 'capital'], 2, 13, 11], 10, ['match', ['get', 'capital'], 2, 16, 14]],
          'text-anchor': 'left',
          'text-offset': [0.6, 0],
          'text-max-width': 9,
          'icon-image': 'point',
          'icon-size': ['match', ['get', 'capital'], 2, 0.9, 0.7],
          'symbol-sort-key': ['get', 'symbolrank'],
        },
        paint: {
          'text-color': ['match', ['get', 'capital'], 2, c('texte-primaire'), c('carte-ville')],
          'icon-color': ['match', ['get', 'capital'], 2, c('texte-primaire'), c('carte-ville')],
          'text-halo-color': c('effet-halo-etiquette'),
          'text-halo-width': 1.4,
          'text-halo-blur': 0.4,
        },
      },
    ],
  }
}

/** Small dot drawn next to city names (SDF, so it takes the label colour). */
export function addCityDot(map: MapboxMap) {
  const size = 16
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, 3.2, 0, Math.PI * 2)
  ctx.fill()
  if (!map.hasImage('point')) map.addImage('point', ctx.getImageData(0, 0, size, size), { sdf: true, pixelRatio: 2 })
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
  set('voies', 'line-color', c('carte-reseau-classique'))
  set('regions', 'line-color', c('carte-frontiere'))
  set('frontieres', 'line-color', c('carte-frontiere'))
  const label = ['match', ['get', 'capital'], 2, c('texte-primaire'), c('carte-ville')]
  set(LABEL_LAYER, 'text-color', label)
  set(LABEL_LAYER, 'icon-color', label)
  set(LABEL_LAYER, 'text-halo-color', c('effet-halo-etiquette'))
}
