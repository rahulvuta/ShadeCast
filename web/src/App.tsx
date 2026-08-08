import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { fetchAssess, fetchBrief, fetchFires } from './api'
import { ActionCards } from './components/ActionCards'
import { BriefingCard } from './components/BriefingCard'
import { ClimatologyLine } from './components/ClimatologyLine'
import { ConcordanceBadge } from './components/ConcordanceBadge'
import { ConfidenceBanner } from './components/ConfidenceBanner'
import { DiffStrip, ShiftPlanner } from './components/DayStrip'
import { FireMap } from './components/FireMap'
import { HowWeCalculate } from './components/HowWeCalculate'
import { IncidentLog } from './components/IncidentLog'
import { SidebarControls } from './components/SidebarControls'
import { StaleBanner } from './components/StaleBanner'
import { TimelinePanel } from './components/TimelinePanel'
import { UVPanel } from './components/UVPanel'
import { VerdictCard } from './components/VerdictCard'
import {
  DEMO_LOCATIONS,
  type AssessResponse,
  type BriefResponse,
  type FirePoint,
  type Lang,
  type SensitivityProfile,
  type Workload,
} from './types'

type ActiveLocation = { lat: number; lon: number; label: string }

type GeocodeHit = {
  id: number
  name: string
  latitude: number
  longitude: number
  country?: string
  admin1?: string
}

function useTextMode(): boolean {
  return useMemo(() => new URLSearchParams(window.location.search).get('text') === '1', [])
}

function useCorruptDemo(): boolean {
  return useMemo(() => new URLSearchParams(window.location.search).get('corrupt') === '1', [])
}

export default function App() {
  const textMode = useTextMode()
  const corruptDemo = useCorruptDemo()
  const [loc, setLoc] = useState<ActiveLocation>({
    lat: DEMO_LOCATIONS[1].lat,
    lon: DEMO_LOCATIONS[1].lon,
    label: DEMO_LOCATIONS[1].label,
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<GeocodeHit[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [latInput, setLatInput] = useState(String(DEMO_LOCATIONS[1].lat))
  const [lonInput, setLonInput] = useState(String(DEMO_LOCATIONS[1].lon))
  const [workload, setWorkload] = useState<Workload>('moderate')
  const [acclimatized, setAcclimatized] = useState(false)
  const [profile, setProfile] = useState<SensitivityProfile>('general')
  const [requiredHours, setRequiredHours] = useState(4)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [lang, setLang] = useState<Lang>('en')
  const [assess, setAssess] = useState<AssessResponse | null>(null)
  const [brief, setBrief] = useState<BriefResponse | null>(null)
  const [fires, setFires] = useState<FirePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [briefLoading, setBriefLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyLocation = useCallback((next: ActiveLocation) => {
    setLoc(next)
    setLatInput(String(next.lat))
    setLonInput(String(next.lon))
    setSearchHits([])
    setSearchError(null)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const a = await fetchAssess({
        lat: loc.lat,
        lon: loc.lon,
        workload,
        acclimatized,
        profile,
        requiredHours,
        corrupt: corruptDemo,
      })
      setAssess(a)
      setSelectedDay(a.days?.[0]?.day ?? null)
      const bbox = `${loc.lon - 1.5},${loc.lat - 1.5},${loc.lon + 1.5},${loc.lat + 1.5}`
      try {
        const f = await fetchFires(bbox)
        setFires(f.fires)
      } catch {
        setFires([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load assessment')
      setAssess(null)
    } finally {
      setLoading(false)
    }
  }, [loc.lat, loc.lon, workload, acclimatized, profile, requiredHours, corruptDemo])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!assess) return
    let cancelled = false
    setBriefLoading(true)
    void fetchBrief({
      lat: loc.lat,
      lon: loc.lon,
      lang,
      workload,
      acclimatized,
    })
      .then((b) => {
        if (!cancelled) setBrief(b)
      })
      .catch(() => {
        if (!cancelled) setBrief(null)
      })
      .finally(() => {
        if (!cancelled) setBriefLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [assess, lang, loc.lat, loc.lon, workload, acclimatized])

  useEffect(() => {
    document.body.classList.toggle('text-mode', textMode)
  }, [textMode])

  async function runSearch(e?: FormEvent) {
    e?.preventDefault()
    const q = searchQuery.trim()
    if (q.length < 2) {
      setSearchError('Type at least 2 characters')
      return
    }
    setSearchBusy(true)
    setSearchError(null)
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Geocoding failed')
      const data = (await res.json()) as { results?: GeocodeHit[] }
      const hits = data.results ?? []
      setSearchHits(hits)
      if (hits.length === 0) setSearchError('No places found')
    } catch (err) {
      setSearchHits([])
      setSearchError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearchBusy(false)
    }
  }

  function goLatLon(e?: FormEvent) {
    e?.preventDefault()
    const lat = Number(latInput)
    const lon = Number(lonInput)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setError('Latitude must be between -90 and 90')
      return
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setError('Longitude must be between -180 and 180')
      return
    }
    applyLocation({
      lat: Math.round(lat * 1000) / 1000,
      lon: Math.round(lon * 1000) / 1000,
      label: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
    })
  }

  const controlsProps = {
    loc,
    corruptDemo,
    searchQuery,
    searchHits,
    searchBusy,
    searchError,
    latInput,
    lonInput,
    workload,
    lang,
    profile,
    acclimatized,
    onSearchQuery: setSearchQuery,
    onLatInput: setLatInput,
    onLonInput: setLonInput,
    onWorkload: setWorkload,
    onLang: setLang,
    onProfile: setProfile,
    onAcclimatized: setAcclimatized,
    onApplyLocation: applyLocation,
    onRunSearch: runSearch,
    onGoLatLon: goLatLon,
  }

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:p-2 focus:border focus:border-[var(--border)]"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--topbar)]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
          <p className="text-sm font-black tracking-[0.12em] uppercase text-[var(--ink)]">
            ShadeCast
          </p>
          <h1 className="text-base sm:text-lg font-semibold tracking-tight text-[var(--ink)]">
            Is it safe to work outside today?
          </h1>
          <p className="hidden md:block text-xs text-[var(--muted)] ml-auto">
            Environmental load — heat, smoke, UV, air quality
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-5 pb-12">
        {/* Mobile: controls accordion near top */}
        <details className="dash-panel mb-4 lg:hidden">
          <summary className="touch-target cursor-pointer list-none px-3.5 py-3 flex items-center justify-between gap-2">
            <span className="dash-section-label">Controls & settings</span>
            <span className="text-xs text-[var(--muted)]">{loc.label}</span>
          </summary>
          <div className="border-t border-[var(--border)] px-3.5 py-3">
            <SidebarControls {...controlsProps} />
          </div>
        </details>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,4fr)_minmax(280px,1fr)] lg:items-start">
          <main id="main" className="min-w-0 space-y-3">
            {!navigator.onLine && (
              <aside
                role="status"
                className="rounded border-2 border-amber-700 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-950"
              >
                You appear offline. Showing the last cached assessment if available.
              </aside>
            )}
            {loading && (
              <div role="status" className="dash-panel p-5 font-semibold text-sm">
                Loading assessment…
              </div>
            )}
            {error && (
              <div role="alert" className="dash-panel border-2 border-[var(--stop)] p-4">
                <p className="font-bold">Could not load assessment</p>
                <p className="text-sm mt-1">{error}</p>
                <p className="text-sm mt-2 text-[var(--muted)]">
                  Weather data may still be loading for this location. Try again in a moment.
                </p>
                <button
                  type="button"
                  className="touch-target mt-3 rounded bg-[var(--ink)] px-4 py-2 text-sm text-white"
                  onClick={() => void load()}
                >
                  Retry
                </button>
              </div>
            )}

            {assess && !loading && (
              <>
                <StaleBanner
                  freshness={assess.data_freshness}
                  servedFromCache={assess.served_from_cache}
                />
                <ConfidenceBanner confidence={assess.data_confidence} />
                <DiffStrip summary={assess.diff_summary} />

                <VerdictCard
                  verdict={assess.current.verdict}
                  hardStop={assess.schedule.hard_stop_window}
                  heatIndex={assess.current.heat_index_f}
                  smokePressure={assess.smoke.smoke_pressure}
                  loadScore={assess.environmental_load?.load_score}
                  drivers={assess.environmental_load?.drivers}
                  explainText={assess.explain_text}
                  ceilingReason={
                    assess.ceiling_reason ?? assess.environmental_load?.ceiling_reason
                  }
                  confidence={assess.data_confidence?.level}
                  unusable={
                    assess.data_confidence?.level === 'UNUSABLE' ||
                    assess.current.verdict == null
                  }
                />

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr]">
                  <ConcordanceBadge
                    concordance={
                      assess.air?.concordance ?? assess.environmental_load?.concordance
                    }
                    usAqi={assess.air?.us_aqi ?? assess.current.us_aqi}
                  />
                  {assess.uv && <UVPanel uv={assess.uv} />}
                  {assess.actions && assess.actions.length > 0 && (
                    <div className="sm:col-span-2 xl:col-span-1">
                      <ActionCards actions={assess.actions} />
                    </div>
                  )}
                </div>

                <TimelinePanel
                  hourly={assess.hourly}
                  days={assess.days}
                  selectedDay={selectedDay}
                  onSelectDay={setSelectedDay}
                  textMode={textMode}
                />

                <div className="grid gap-3 lg:grid-cols-2 lg:items-stretch">
                  <FireMap
                    lat={assess.lat}
                    lon={assess.lon}
                    windFromDeg={assess.current.wind_direction_deg}
                    fires={fires}
                    textMode={textMode}
                    defaultOpen
                  />
                  <ClimatologyLine
                    message={assess.climatology.message}
                    note={assess.climatology.note}
                  />
                </div>

                <p className="text-[0.7rem] text-[var(--muted)]">{assess.current.disclaimer}</p>
                <p className="text-[0.7rem] text-[var(--muted)]">{assess.smoke.note}</p>
              </>
            )}
          </main>

          <aside
            aria-label="Controls and tools"
            className="dash-panel lg:sticky lg:top-[3.75rem] lg:max-h-[calc(100vh-4.5rem)] lg:overflow-y-auto"
          >
            <div className="hidden lg:block sidebar-module">
              <p className="dash-section-label mb-3">Controls & settings</p>
              <SidebarControls {...controlsProps} />
            </div>

            {assess && !loading && (
              <>
                <div className="sidebar-module">
                  <ShiftPlanner
                    windows={assess.shift_windows ?? []}
                    requiredHours={requiredHours}
                    onRequiredHours={setRequiredHours}
                  />
                </div>
                <div className="sidebar-module">
                  <BriefingCard brief={brief} loading={briefLoading} />
                </div>
                <div className="sidebar-module">
                  <IncidentLog
                    lat={assess.lat}
                    lon={assess.lon}
                    label={loc.label}
                    verdict={assess.current.verdict}
                  />
                </div>
              </>
            )}

            <div className="sidebar-module">
              <HowWeCalculate />
            </div>
          </aside>
        </div>

        <footer className="mt-8 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)] space-y-2">
          <p>
            Data sources:{' '}
            {(assess?.sources ?? []).map((s, i) => (
              <span key={s.name}>
                {i > 0 ? ' · ' : ''}
                <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
              </span>
            ))}
          </p>
          <p>
            Limitations:{' '}
            <a
              className="underline"
              href="https://github.com/rahulvuta/ShadeCast/blob/main/docs/limitations.md"
            >
              docs/limitations.md
            </a>
            {' · '}
            <a
              className="underline"
              href="https://github.com/rahulvuta/ShadeCast/blob/main/docs/validation.md"
            >
              Validation
            </a>
            {' · '}
            <a className="underline" href="?text=1">
              Text-only mode
            </a>
          </p>
          <p>
            Share this location:{' '}
            <a
              className="underline"
              href={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(window.location.href)}`}
              target="_blank"
              rel="noreferrer"
            >
              QR code link
            </a>
            {' · '}
            Integrity demo: add <code>?corrupt=1</code> to the URL
          </p>
          <p>Not medical advice. Screening tool for crew scheduling only.</p>
        </footer>
      </div>
    </div>
  )
}
