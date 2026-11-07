// French formatting, written the way the mockup reads: "Départ à 9h45", "2 h 15", "1 385".

const fmt = new Map<string, Intl.DateTimeFormat>()

function parts(t: number, tz?: string) {
  const key = tz ?? ''
  let f = fmt.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', minute: '2-digit', timeZone: tz, hourCycle: 'h23' })
    fmt.set(key, f)
  }
  const p = f.formatToParts(t)
  return { h: Number(p.find((x) => x.type === 'hour')?.value ?? 0), m: p.find((x) => x.type === 'minute')?.value ?? '00' }
}

/** "9h45", in the station's own time zone. */
export function heure(t: number | undefined, tz?: string): string {
  if (t === undefined || Number.isNaN(t)) return '—'
  const { h, m } = parts(t, tz)
  return `${h}h${m}`
}

/** Big number + unit, as in the mockup's countdown list ("2 / heures", "38 / min"). */
export function compte(ms: number): { n: string; unite: string } {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return { n: String(min), unite: 'min' }
  const h = Math.floor(min / 60)
  if (h < 24) return { n: String(h), unite: h > 1 ? 'heures' : 'heure' }
  const j = Math.round(h / 24)
  return { n: String(j), unite: j > 1 ? 'jours' : 'jour' }
}

export function duree(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

const nf = new Intl.NumberFormat('fr-FR')
export const nombre = (n: number) => nf.format(n)

const jourFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
export const jour = (t: number) => jourFmt.format(t)
