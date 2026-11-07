// Train marker atlas for deck.gl's IconLayer: elongated pills pointing east (rotated by bearing).
// Shape = train type (high speed is longer), colour = punctuality, ring = real GPS position.
// Every icon shares the same box, so the outline, ring and fill layers line up exactly.

const W = 192
const H = 64
const LENGTH = { gv: 124, cl: 78 }
const THICK = 26

function pill(ctx: CanvasRenderingContext2D, cy: number, len: number, grow: number) {
  const w = len + grow * 2
  const h = THICK + grow * 2
  const x = (W - w) / 2
  const y = cy + (H - h) / 2
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, h / 2)
}

export type MarkerIcon = 'gv' | 'cl' | 'gv-c' | 'cl-c' | 'gv-h' | 'cl-h'
const ORDER: MarkerIcon[] = ['gv', 'cl', 'gv-c', 'cl-c', 'gv-h', 'cl-h']

export function buildMarkerAtlas() {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H * ORDER.length
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = ctx.strokeStyle = '#fff'
  ORDER.forEach((name, i) => {
    const kind = name.startsWith('gv') ? 'gv' : 'cl'
    const cy = i * H
    if (name.endsWith('-c')) {
      pill(ctx, cy, LENGTH[kind], 4) // outline that separates overlapping trains
      ctx.fill()
    } else if (name.endsWith('-h')) {
      ctx.lineWidth = 5
      pill(ctx, cy, LENGTH[kind], 11)
      ctx.stroke()
    } else {
      pill(ctx, cy, LENGTH[kind], 0)
      ctx.fill()
    }
  })
  const mapping = Object.fromEntries(
    ORDER.map((name, i) => [name, { x: 0, y: i * H, width: W, height: H, anchorX: W / 2, anchorY: H / 2, mask: true }]),
  )
  return { url: canvas.toDataURL(), mapping }
}

/** Icon box height in pixels for a zoom level (the pill itself is ~40% of it). */
export function markerSize(zoom: number) {
  const stops: [number, number][] = [[3, 9], [5, 12], [8, 18], [12, 30], [16, 44]]
  if (zoom <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const [z1, s1] = stops[i]
    const [z0, s0] = stops[i - 1]
    if (zoom <= z1) return s0 + ((zoom - z0) / (z1 - z0)) * (s1 - s0)
  }
  return stops[stops.length - 1][1]
}
