// A frame-time readout for measuring the map in any browser: add ?perf to the address.
// Counts the browser's frames with requestAnimationFrame: frames per second, the screen's refresh rate,
// the worst frame and the share of missed frames over the last 5 s, and the freezes (> 100 ms) since load.
import { useEffect, useRef } from 'react'

const WINDOW = 5000
const FREEZE = 100

export function Perf() {
  const out = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frames: [at: number, dt: number][] = []
    let freezes = 0
    let longest = 0
    let prev = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const dt = now - prev
      prev = now
      // A hidden tab stops requestAnimationFrame: that gap is not a freeze.
      if (!document.hidden && dt < 10_000) {
        frames.push([now, dt])
        if (dt > FREEZE) {
          freezes++
          longest = Math.max(longest, dt)
        }
      }
      while (frames.length && frames[0][0] < now - WINDOW) frames.shift()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const show = setInterval(() => {
      if (!out.current || frames.length < 10) return
      const now = performance.now()
      const sorted = frames.map((f) => f[1]).sort((a, b) => a - b)
      const median = sorted[sorted.length >> 1]
      const hz = median < 11 ? 120 : 60
      const missed = sorted.filter((d) => d > median * 1.5).length / sorted.length
      const perSecond = frames.filter((f) => f[0] > now - 1000).length
      out.current.textContent = [
        `${perSecond} i/s (écran ${hz} Hz)`,
        `pire ${Math.round(sorted[sorted.length - 1])} ms`,
        `${Math.round(missed * 100)} % ratées`,
        `${freezes} gel${freezes > 1 ? 's' : ''}${freezes ? ` (max ${Math.round(longest)} ms)` : ''}`,
      ].join(' · ')
    }, 500)

    return () => {
      cancelAnimationFrame(raf)
      clearInterval(show)
    }
  }, [])

  return <div ref={out} className="perf t-legal" aria-live="off">Mesure…</div>
}
