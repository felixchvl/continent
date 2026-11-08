// Light / dark theme. "auto" follows the system; the choice is remembered in localStorage.
// The data-theme attribute is set before React renders, so CSS variables are already right
// when components read them (see the inline script in index.html).

import { useCallback, useEffect, useState } from 'react'

export type ThemePref = 'auto' | 'clair' | 'sombre'
export type Theme = 'clair' | 'sombre'

const KEY = 'continent.theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'clair' || v === 'sombre' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

const resolve = (p: ThemePref): Theme => (p === 'auto' ? (media.matches ? 'sombre' : 'clair') : p)

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref)
  const [theme, setTheme] = useState<Theme>(() => resolve(readPref()))

  useEffect(() => {
    const onChange = () => {
      if (readPref() !== 'auto') return
      const t = resolve('auto')
      apply(t)
      setTheme(t)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const cycle = useCallback(() => {
    const order: ThemePref[] = ['auto', 'clair', 'sombre']
    const next = order[(order.indexOf(readPref()) + 1) % order.length]
    try {
      if (next === 'auto') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    const t = resolve(next)
    apply(t)
    setPref(next)
    setTheme(t)
  }, [])

  return { pref, theme, cycle }
}

export type RGBA = [number, number, number, number]

/** Reads a colour token from the current theme, as RGBA (0-255) for deck.gl. */
export function token(name: string): RGBA {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
  if (v.startsWith('#')) {
    // The CSS minifier shortens #ffffff to #fff: expand the short forms (#rgb, #rgba) first.
    let h = v.slice(1)
    if (h.length <= 4) h = [...h].map((ch) => ch + ch).join('')
    const n = parseInt(h.slice(0, 6), 16)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a]
  }
  const m = v.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+)(%?))?\s*\)/)
  if (!m) return [128, 128, 128, 255]
  const a = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4])
  return [Number(m[1]), Number(m[2]), Number(m[3]), Math.round(a * 255)]
}

/** Same token as a CSS rgba() string, for Mapbox paint properties. */
export function tokenCss(name: string): string {
  const [r, g, b, a] = token(name)
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`
}
