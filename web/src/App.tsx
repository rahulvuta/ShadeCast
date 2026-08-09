import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { fetchAssess, fetchBrief, fetchFires, fetchGeocode, type GeocodeHit } from './api'
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

const WORKLOADS: Workload[] = ['light', 'moderate', 'heavy']
const PROFILES: SensitivityProfile[] = [
  'general',
  'asthma_respiratory',
  'cardiovascular',
  'pregnant',
  'youth_athlete',
  'over_65',
]

function parseWorkload(raw: string | null): Workload | null {
  if (raw && (WORKLOADS as string[]).includes(raw)) return raw as Workload
  return null
}

function parseProfile(raw: string | null): SensitivityProfile | null {
  if (raw && (PROFILES as string[]).includes(raw)) return raw as SensitivityProfile
  return null
}

function initialLocation(): ActiveLocation {
  const params = new URLSearchParams(window.location.search)
  const lat = Number(params.get('lat'))
  const lon = Number(params.get('lon'))
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  ) {
    const roundedLat = Math.round(lat * 1000) / 1000
    const roundedLon = Math.round(lon * 1000) / 1000
    return {
      lat: roundedLat,
      lon: roundedLon,
      label: `${roundedLat.toFixed(3)}, ${roundedLon.toFixed(3)}`,
    }
  }
  return {
    lat: DEMO_LOCATIONS[1].lat,
    lon: DEMO_LOCATIONS[1].lon,
    label: DEMO_LOCATIONS[1].label,
  }
}

const BOOT_LOC = typeof window !== 'undefined' ? initialLocation() : DEMO_LOCATIONS[1]

function initialWorkload(): Workload {
  return parseWorkload(new URLSearchParams(window.location.search).get('workload')) ?? 'moderate'
}

function initialProfile(): SensitivityProfile {
  return parseProfile(new URLSearchParams(window.location.search).get('profile')) ?? 'general'
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
  const [loc, setLoc] = useState<ActiveLocation>(() => ({
    lat: BOOT_LOC.lat,
    lon: BOOT_LOC.lon,
    label: BOOT_LOC.label,
  }))
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<GeocodeHit[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [latInput, setLatInput] = useState(() => String(BOOT_LOC.lat))
  const [lonInput, setLonInput] = useState(() => String(BOOT_LOC.lon))
  const [workload, setWorkload] = useState<Workload>(() => initialWorkload())
  const [acclimatized, setAcclimatized] = useState(false)
  const [profile, setProfile] = useState<SensitivityProfile>(() => initialProfile())
  const [requiredHours, setRequiredHours] = useState(4)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [lang, setLang] = useState<Lang>('en')
  const [assess, setAssess] = useState<AssessResponse | null>(null)
  const [brief, setBrief] = useState<BriefResponse | null>(null)
  const [fires, setFires] = useState<FirePoint[]>([])
  const [firesError, setFiresError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [mapDefaultOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  )

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
      const half = 2.7
      const bbox = `${loc.lon - half},${loc.lat - half},${loc.lon + half},${loc.lat + half}`
      try {
        const f = await fetchFires(bbox)
        setFires(f.fires)
        setFiresError(null)
      } catch (e) {
        setFires([])
        setFiresError(e instanceof Error ? e.message : 'Fire detections unavailable')
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
    setBriefError(null)
    void fetchBrief({
      lat: loc.lat,
      lon: loc.lon,
      lang,
      workload,
      acclimatized,
      profile,
      engine: assess,
    })
      .then((b) => {
        if (!cancelled) {
          setBrief(b)
          setBriefError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setBrief(null)
          setBriefError(e instanceof Error ? e.message : 'Failed to load briefing')
        }
      })
      .finally(() => {
        if (!cancelled) setBriefLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [assess, lang, loc.lat, loc.lon, workload, acclimatized, profile])

  useEffect(() => {
    document.body.classList.toggle('text-mode', textMode)
  }, [textMode])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    params.set('lat', String(loc.lat))
    params.set('lon', String(loc.lon))
    params.set('workload', workload)
    params.set('profile', profile)
    if (textMode) params.set('text', '1')
    else params.delete('text')
    if (corruptDemo) params.set('corrupt', '1')
    else params.delete('corrupt')
    const qs = params.toString()
    const next = `${window.location.pathname}?${qs}${window.location.hash}`
    window.history.replaceState(null, '', next)
  }, [loc.lat, loc.lon, workload, profile, textMode, corruptDemo])

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
      const data = await fetchGeocode(q)
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

  function renderBriefingShiftLog() {
    if (!assess) return null
    return (
      <>
        <div className="sidebar-module">
          <BriefingCard brief={brief} loading={briefLoading} error={briefError} />
        </div>
        <div className="sidebar-module">
          <ShiftPlanner
            windows={assess.shift_windows ?? []}
            requiredHours={requiredHours}
            onRequiredHours={setRequiredHours}
          />
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
    )
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
          <p className="text-sm font-bold tracking-[0.12em] uppercase text-[var(--ink)]">
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
            {!online && (
              <aside
                role="status"
                className="rounded border-2 border-amber-700 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-950"
              >
                You appear offline. Showing the last cached assessment if available.
              </aside>
            )}
            {loading && !assess && (
              <div role="status" className="dash-panel p-5 font-semibold text-sm">
                Loading assessment…
              </div>
            )}
            {loading && assess && (
              <div
                role="status"
                className="rounded border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2 text-xs font-semibold text-[var(--muted)]"
              >
                Updating assessment…
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

            {assess && (
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
                  bestWork={assess.schedule.best_work_window}
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
                  interactions={assess.environmental_load?.interactions}
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
                  todayIso={assess.days?.[0]?.day ?? null}
                />

                <div className="dash-panel lg:hidden">{renderBriefingShiftLog()}</div>

                <div className="grid gap-3 lg:grid-cols-2 lg:items-stretch">
                  <div className="min-w-0">
                    <FireMap
                      lat={assess.lat}
                      lon={assess.lon}
                      windFromDeg={assess.current.wind_direction_deg}
                      fires={fires}
                      textMode={textMode}
                      defaultOpen={mapDefaultOpen}
                    />
                    {firesError && (
                      <p className="mt-1.5 text-[0.7rem] text-[var(--muted)]">
                        Fire detections unavailable
                      </p>
                    )}
                  </div>
                  <ClimatologyLine
                    message={assess.climatology.message}
                    note={assess.climatology.note}
                    todayTemp={assess.climatology.today_temp_c}
                    baseline={assess.climatology.baseline_temp_c}
                    delta={assess.climatology.delta_c}
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

            {assess && <div className="hidden lg:block">{renderBriefingShiftLog()}</div>}

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
