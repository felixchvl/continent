// French formatting helpers (times in the station's own time zone, durations, numbers).

const timeFmt = new Map<string, Intl.DateTimeFormat>()

export function hhmm(t: number | undefined, tz?: string): string {
  if (t === undefined || Number.isNaN(t)) return '--:--'
  const key = tz ?? ''
  let f = timeFmt.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz })
    timeFmt.set(key, f)
  }
  return f.format(t)
}

export function duration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

const nf = new Intl.NumberFormat('fr-FR')
export const nombre = (n: number) => nf.format(n)

export const delayLabel = (min: number) => (min >= 1 ? `+${Math.round(min)} min` : "À l'heure")
