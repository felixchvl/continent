import { useEffect, useMemo, useRef, useState } from 'react'
import { MapView, type City, type Filters, type Hover, type MapApi, type Network, type Padding } from './map/MapView'
import { LiveStore, fetchTrip, type Shown, type TripDetails } from './data/live'
import { RENFE, operatorOf, type Operator } from './shared/operators.ts'
import { useTheme } from './theme'
import { useFollowed } from './useFollowed'
import { Panel, type Stats } from './ui/Panel'
import { TrainSheet } from './ui/TrainSheet'
import { MapControls, Tooltip } from './ui/Overlays'

const mobileQuery = window.matchMedia('(max-width: 760px)')
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function useMobile() {
  const [m, setM] = useState(mobileQuery.matches)
  useEffect(() => {
    const on = () => setM(mobileQuery.matches)
    mobileQuery.addEventListener('change', on)
    return () => mobileQuery.removeEventListener('change', on)
  }, [])
  return m
}

export default function App() {
  const store = useMemo(() => new LiveStore(), [])
  const [version, setVersion] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const { pref, theme, cycle } = useTheme()
  const mobile = useMobile()
  const [filters, setFilters] = useState<Filters>({ gv: true, cl: true, reg: true, gps: true, estimee: true, op: null })
  const [network, setNetwork] = useState<Network | null>(null)
  const [cities, setCities] = useState<City[]>([])
  const [showNetwork, setShowNetwork] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(location.search).get('train'))
  const [trip, setTrip] = useState<TripDetails | null>(null)
  const [tripLoading, setTripLoading] = useState(false)
  const [tripError, setTripError] = useState<string | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [follow, setFollow] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const followed = useFollowed()
  const api = useRef<MapApi | null>(null)
  const pendingFit = useRef<TripDetails['line']['points'] | null>(null)

  useEffect(() => {
    const off = store.subscribe(() => setVersion((v) => v + 1))
    store.start()
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => {
      off()
      store.stop()
      clearInterval(id)
    }
  }, [store])

  useEffect(() => {
    fetch('/data/reseau.json').then((r) => r.json()).then(setNetwork).catch(() => setNetwork(null))
    fetch('/data/villes.json').then((r) => r.json()).then(setCities).catch(() => setCities([]))
  }, [])

  // Selected train: URL, trip details, framing.
  useEffect(() => {
    const url = new URL(location.href)
    if (selectedId) url.searchParams.set('train', selectedId)
    else url.searchParams.delete('train')
    history.replaceState(null, '', url)
    setTrip(null)
    setTripError(null)
    setFollow(false)
    if (!selectedId || selectedId.startsWith('renfe:')) return
    let cancelled = false
    setTripLoading(true)
    fetchTrip(selectedId)
      .then((t) => {
        if (cancelled) return
        setTrip(t)
        if (api.current) api.current.fit(t.line.points)
        else pendingFit.current = t.line.points
      })
      .catch((e: Error) => !cancelled && setTripError(e.message))
      .finally(() => !cancelled && setTripLoading(false))
    return () => {
      cancelled = true
    }
  }, [selectedId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelectedId(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Snapshot of every running train, refreshed every 2 s (counters, search, followed trains).
  const live = useMemo<Shown[]>(() => {
    void version
    return store.all(now)
  }, [now, version, store])

  const stats = useMemo<Stats>(() => {
    const s: Stats = { total: 0, ok: 0, r1: 0, r2: 0, gps: 0, gv: 0, cl: 0, reg: 0, estimee: 0, ops: [] }
    const ops = new Map<string, { op: Operator; n: number }>()
    for (const { train, pos } of live) {
      s[train.kind]++
      s[pos.source]++
      if (!filters[train.kind] || !filters[pos.source]) continue
      const o = ops.get(train.op.id) ?? { op: train.op, n: 0 }
      o.n++
      ops.set(train.op.id, o)
      if (filters.op && train.op.id !== filters.op) continue
      s.total++
      s[pos.statut]++
    }
    s.ops = [...ops.values()].sort((a, b) => Number(a.op.id === 'autre') - Number(b.op.id === 'autre') || b.n - a.n)
    return s
  }, [live, filters])

  const results = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return []
    return live.filter(({ train }) => normalize(`${train.name} ${train.num} ${train.op.name}`).includes(q)).slice(0, 8)
  }, [live, query])

  const byId = useMemo(() => new Map(live.map((s) => [s.train.id, s])), [live])
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null

  const pick = (id: string) => {
    setQuery('')
    setSelectedId(id)
    const s = byId.get(id)
    if (s && id.startsWith('renfe:')) api.current?.flyTo(s.pos.lon, s.pos.lat, 8)
  }

  const toggleFollowed = () => {
    if (!trip) return
    const a = trip.stops[0]
    const b = trip.stops[trip.stops.length - 1]
    followed.toggle({
      id: trip.id, name: trip.name || trip.number, from: a.name, to: b.name,
      dep: a.dep ?? a.sdep ?? now, arr: b.arr ?? b.sarr ?? now, tzFrom: a.tz, tzTo: b.tz,
    })
  }

  const ageMin = (now - store.updated) / 60_000
  const status = store.error && !store.updated ? 'offline' : !store.updated ? 'loading' : ageMin > 6 ? 'stale' : 'live'

  const padding: Padding = mobile
    ? { top: 16, right: 60, left: 16, bottom: selectedId ? Math.round(window.innerHeight * 0.5) : 250 }
    : { top: 32, right: 80, left: 432, bottom: 32 }

  return (
    <div className={`app${mobile ? ' mobile' : ''}${selectedId ? ' avec-fiche' : ''}`}>
      <MapView
        store={store}
        network={showNetwork ? network : null}
        cities={cities}
        theme={theme}
        filters={filters}
        selectedId={selectedId}
        trip={trip}
        follow={follow}
        padding={padding}
        onHover={mobile ? () => {} : setHover}
        onSelect={setSelectedId}
        onReady={(a) => {
          api.current = a
          if (pendingFit.current) a.fit(pendingFit.current)
          pendingFit.current = null
        }}
      />

      {selectedId ? (
        <TrainSheet
          trainId={selectedId}
          live={selected}
          trip={trip}
          operator={selected?.train.op ?? (selectedId.startsWith('renfe:') ? RENFE : operatorOf(selectedId))}
          loading={tripLoading}
          error={tripError}
          now={now}
          followed={followed.has(selectedId)}
          following={follow}
          onBack={() => setSelectedId(null)}
          onToggleFollowed={toggleFollowed}
          onToggleCamera={() => setFollow((f) => !f)}
        />
      ) : (
        <div className={`panneau-conteneur${expanded ? ' deplie' : ''}`}>
          {mobile && (
            <button type="button" className="poignee-bouton" aria-label={expanded ? 'Réduire' : 'Agrandir'} onClick={() => setExpanded((e) => !e)}>
              <span className="poignee" />
            </button>
          )}
          <Panel
            clock={status === 'stale' ? store.updated : now}
            status={status}
            stats={stats}
            filters={filters}
            onFilters={setFilters}
            query={query}
            onQuery={(q) => {
              setQuery(q)
              if (q) setExpanded(true)
            }}
            results={results}
            onPick={pick}
            followed={followed.list.map((f) => ({ f, live: byId.get(f.id) ?? null }))}
          />
        </div>
      )}

      <MapControls
        themePref={pref}
        theme={theme}
        onTheme={cycle}
        network={showNetwork}
        onNetwork={() => setShowNetwork((v) => !v)}
        onZoom={(d) => api.current?.zoomBy(d)}
        onLocate={() => api.current?.locate()}
      />

      {hover && !mobile && hover.shown.train.id !== selectedId && <Tooltip hover={hover} />}
    </div>
  )
}
