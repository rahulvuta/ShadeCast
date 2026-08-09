import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { fetchAssess, fetchBrief, fetchEvents, fetchFires, fetchGeocode, type GeocodeHit, type HistoricalEventSummary } from './api'
import { ActionCards } from './components/ActionCards'
import { BriefingCard } from './components/BriefingCard'
import { ClimatologyLine } from './components/ClimatologyLine'
import { ComparePanel } from './components/ComparePanel'
import { ConcordanceBadge } from './components/ConcordanceBadge'
import { ConfidenceBanner } from './components/ConfidenceBanner'
import { DiffStrip, ShiftPlanner } from './components/DayStrip'
import { DriverWaterfall } from './components/DriverWaterfall'
import { FireMap } from './components/FireMap'
import { HowWeCalculate } from './components/HowWeCalculate'
import { IntegrityTheater } from './components/IntegrityTheater'
import { SidebarControls } from './components/SidebarControls'
import { ShiftSheetExport } from './components/ShiftSheetExport'
import { StaleBanner } from './components/StaleBanner'
import { TimelinePanel } from './components/TimelinePanel'
import { TimeScrubber } from './components/TimeScrubber'
import { UVPanel } from './components/UVPanel'
import { VerdictCard } from './components/VerdictCard'
import { verdictPalette, type VerdictKey } from './design/tokens'
import { useThemeMode } from './design/useThemeMode'
import {
  DEMO_LOCATIONS,
  type AssessResponse,
  type BriefResponse,
  type FirePoint,
  type Lang,
  type SensitivityProfile,
  type Verdict,
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
  const { theme, toggleTheme } = useThemeMode()
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
  const [historicalEvents, setHistoricalEvents] = useState<HistoricalEventSummary[]>([])
  const [activeEventId, setActiveEventId] = useState<string | null>(() => {
    return new URLSearchParams(window.location.search).get('event')
  })
  const [hourOffset, setHourOffset] = useState<number | null>(null)
  const [assess, setAssess] = useState<AssessResponse | null>(null)
  const [brief, setBrief] = useState<BriefResponse | null>(null)
  const [fires, setFires] = useState<FirePoint[]>([])
  const [firesError, setFiresError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [scrubIndex, setScrubIndex] = useState(0)
  const [scrubPlaying, setScrubPlaying] = useState(false)

  const applyLocation = useCallback((next: ActiveLocation) => {
    setActiveEventId(null)
    setHourOffset(null)
    setLoc(next)
    setLatInput(String(next.lat))
    setLonInput(String(next.lon))
    setSearchHits([])
    setSearchError(null)
  }, [])

  const applyHistoricalEvent = useCallback((eventId: string | null) => {
    setActiveEventId(eventId)
    setHourOffset(null)
  }, [])

  useEffect(() => {
    void fetchEvents()
      .then((r) => setHistoricalEvents(r.events))
      .catch(() => setHistoricalEvents([]))
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
        corrupt: corruptDemo && !activeEventId,
        event: activeEventId,
        hourOffset,
      })
      setAssess(a)
      const curIdx = a.hourly.findIndex((h) => h.is_current)
      setScrubIndex(curIdx >= 0 ? curIdx : 0)
      setScrubPlaying(false)
      if (a.is_historical && a.lat != null && a.lon != null) {
        setLoc({
          lat: a.lat,
          lon: a.lon,
          label: a.historical_event?.label ?? a.location_label ?? loc.label,
        })
        setLatInput(String(a.lat))
        setLonInput(String(a.lon))
      }
      setSelectedDay(a.days?.[0]?.day ?? null)
      if (!a.is_historical) {
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
      } else {
        setFires([])
        setFiresError(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load assessment')
      setAssess(null)
    } finally {
      setLoading(false)
    }
  }, [
    loc.lat,
    loc.lon,
    loc.label,
    workload,
    acclimatized,
    profile,
    requiredHours,
    corruptDemo,
    activeEventId,
    hourOffset,
  ])

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

  const scrubHour = assess?.hourly[scrubIndex] ?? null
  const displayVerdict = (scrubHour?.verdict as Verdict | undefined) ?? assess?.current.verdict ?? null
  const displayHeat = scrubHour?.heat_index_f ?? assess?.current.heat_index_f ?? null
  const displaySmoke = scrubHour?.smoke_pressure ?? assess?.smoke.smoke_pressure ?? 0
  const displayWind =
    scrubHour?.wind_direction_deg ?? assess?.current.wind_direction_deg ?? null
  const displayWindSpeed =
    scrubHour?.wind_speed_kmh ?? assess?.current.wind_speed_kmh ?? null
  const scrubbingAway =
    scrubHour != null && !scrubHour.is_current && (assess?.hourly.length ?? 0) > 1

  useEffect(() => {
    document.body.classList.toggle('text-mode', textMode)
  }, [textMode])

  useEffect(() => {
    const v: VerdictKey =
      assess?.data_confidence?.level === 'UNUSABLE' || displayVerdict == null
        ? 'UNUSABLE'
        : (displayVerdict as Verdict)
    const palette = verdictPalette[v]
    const root = document.documentElement
    root.style.setProperty('--verdict-accent', palette.base)
    root.style.setProperty('--verdict-glow', palette.glow)
    root.style.setProperty('--verdict-wash', palette.bg)
  }, [displayVerdict, assess?.data_confidence?.level])

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
    if (activeEventId) {
      params.set('event', activeEventId)
      params.delete('lat')
      params.delete('lon')
    } else {
      params.delete('event')
      params.set('lat', String(loc.lat))
      params.set('lon', String(loc.lon))
    }
    params.set('workload', workload)
    params.set('profile', profile)
    if (textMode) params.set('text', '1')
    else params.delete('text')
    if (corruptDemo) params.set('corrupt', '1')
    else params.delete('corrupt')
    const qs = params.toString()
    const next = `${window.location.pathname}?${qs}${window.location.hash}`
    window.history.replaceState(null, '', next)
  }, [loc.lat, loc.lon, workload, profile, textMode, corruptDemo, activeEventId])

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
    historicalEvents,
    activeEventId,
    onSearchQuery: setSearchQuery,
    onLatInput: setLatInput,
    onLonInput: setLonInput,
    onWorkload: setWorkload,
    onLang: setLang,
    onProfile: setProfile,
    onAcclimatized: setAcclimatized,
    onApplyLocation: applyLocation,
    onSelectHistoricalEvent: applyHistoricalEvent,
    onRunSearch: runSearch,
    onGoLatLon: goLatLon,
  }

  function renderBriefingShift() {
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
      </>
    )
  }

  return (
    <div className="app-shell min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-[var(--card)] focus:p-2 focus:border focus:border-[var(--border)]"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--topbar)]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
          <p className="text-sm font-bold tracking-[0.12em] uppercase text-[var(--ink)]">
            ShadeCast
          </p>
          <h1 className="type-h2 tracking-tight text-[var(--ink)]">
            Is it safe to work outside today?
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <p className="hidden md:block type-caption text-[var(--muted)] font-normal">
              Environmental load — heat, smoke, UV, air
            </p>
            <button
              type="button"
              className="theme-toggle touch-target"
              onClick={toggleTheme}
              aria-pressed={theme === 'sunlight'}
              title={
                theme === 'ops'
                  ? 'Switch to Sunlight mode (high contrast for outdoor glare)'
                  : 'Switch to Ops dark theme'
              }
            >
              {theme === 'ops' ? 'Sunlight' : 'Ops dark'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-5 pb-12 layout-stack">
        <details className="dash-panel lg:hidden">
          <summary className="touch-target cursor-pointer list-none px-3.5 py-3 flex items-center justify-between gap-2">
            <span className="dash-section-label">Controls & settings</span>
            <span className="type-caption text-[var(--muted)] font-normal">{loc.label}</span>
          </summary>
          <div className="border-t border-[var(--border)] px-3.5 py-3">
            <SidebarControls {...controlsProps} />
          </div>
        </details>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(280px,1fr)] lg:items-start">
          <main id="main" className="min-w-0 layout-stack">
            {!online && (
              <aside
                role="status"
                className="rounded border-2 border-[var(--caution)] bg-[var(--caution-bg)] px-3.5 py-2.5 text-sm"
              >
                You appear offline. Showing the last cached assessment if available.
              </aside>
            )}
            {assess?.is_historical && assess.historical_event && (
              <aside
                role="status"
                className="rounded border-2 accent-border bg-[var(--panel)] px-3.5 py-3 text-sm"
              >
                <p className="type-micro text-[var(--muted)]">
                  Historical replay — not live data
                </p>
                <p className="mt-1 font-semibold text-[var(--ink)]">
                  {assess.historical_event.label}
                  {assess.historical_event.start_date
                    ? ` — ${assess.historical_event.start_date}`
                    : ''}
                </p>
                {assess.actual_vs_expected && (
                  <p className="mt-2 text-sm">
                    Expected{' '}
                    <span className="font-semibold">
                      {assess.actual_vs_expected.expected.join(' / ') || 'n/a'}
                    </span>
                    {' · '}
                    Engine{' '}
                    <span className="font-semibold">{assess.actual_vs_expected.actual ?? 'n/a'}</span>
                    {' · '}
                    <span
                      className={
                        assess.actual_vs_expected.status === 'pass'
                          ? 'font-bold text-[var(--go)]'
                          : 'font-bold text-[var(--restrict)]'
                      }
                    >
                      {assess.actual_vs_expected.status.toUpperCase()}
                    </span>
                  </p>
                )}
                {assess.historical_event.source_url && (
                  <p className="mt-1 type-micro text-[var(--muted)] normal-case tracking-normal font-normal">
                    <a
                      className="underline"
                      href={assess.historical_event.source_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Event source
                    </a>
                  </p>
                )}
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
                className="rounded border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2 type-caption text-[var(--muted)]"
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
                  className="touch-target mt-3 rounded bg-[var(--ink)] px-4 py-2 text-sm text-[var(--bg)]"
                  onClick={() => void load()}
                >
                  Retry
                </button>
              </div>
            )}

            {assess && (
              <>
                {/* Row 1 — Hero */}
                <div className="layout-hero-band">
                  <StaleBanner
                    freshness={assess.data_freshness}
                    servedFromCache={assess.served_from_cache}
                  />
                  <div className="mt-2 space-y-2">
                    <ConfidenceBanner confidence={assess.data_confidence} />
                    <IntegrityTheater
                      confidence={assess.data_confidence}
                      forceOpen={corruptDemo && !activeEventId}
                    />
                    <DiffStrip summary={assess.diff_summary} />
                    <VerdictCard
                      verdict={displayVerdict}
                      hardStop={assess.schedule.hard_stop_window}
                      bestWork={assess.schedule.best_work_window}
                      heatIndex={displayHeat}
                      smokePressure={displaySmoke}
                      loadScore={assess.environmental_load?.load_score}
                      explainText={
                        scrubbingAway
                          ? `Scrubbed hour ${scrubHour?.valid_at ?? scrubHour?.hour} — schedule windows still reflect the full assessment.`
                          : assess.explain_text
                      }
                      ceilingReason={
                        assess.ceiling_reason ?? assess.environmental_load?.ceiling_reason
                      }
                      confidence={assess.data_confidence?.level}
                      unusable={
                        assess.data_confidence?.level === 'UNUSABLE' ||
                        displayVerdict == null
                      }
                      interactions={assess.environmental_load?.interactions}
                    />
                  </div>
                </div>

                {/* Row 2 — Reasoning charts */}
                <div className="grid gap-4 lg:grid-cols-2">
                  {assess.environmental_load?.waterfall &&
                    assess.environmental_load.waterfall.length > 0 && (
                      <DriverWaterfall steps={assess.environmental_load.waterfall} />
                    )}
                  <div className="grid gap-4 content-start">
                    <ConcordanceBadge
                      concordance={
                        assess.air?.concordance ?? assess.environmental_load?.concordance
                      }
                      usAqi={assess.air?.us_aqi ?? assess.current.us_aqi}
                    />
                    {assess.uv && <UVPanel uv={assess.uv} />}
                  </div>
                </div>

                {/* Row 3 — Map dominant + scrubber */}
                <TimeScrubber
                  hours={assess.hourly}
                  index={scrubIndex}
                  onIndex={setScrubIndex}
                  playing={scrubPlaying}
                  onPlaying={setScrubPlaying}
                />
                <div className="map-stage dash-panel overflow-hidden accent-border">
                  <FireMap
                    lat={assess.lat}
                    lon={assess.lon}
                    windFromDeg={displayWind}
                    windSpeedKmh={displayWindSpeed}
                    smokePressure={displaySmoke}
                    fires={fires}
                    textMode={textMode}
                    defaultOpen={true}
                  />
                  {firesError && (
                    <p className="px-3 py-2 type-micro text-[var(--muted)] normal-case tracking-normal font-normal">
                      Fire detections unavailable
                    </p>
                  )}
                </div>

                {/* Row 4 — Timeline */}
                <TimelinePanel
                  hourly={assess.hourly}
                  days={assess.days}
                  selectedDay={selectedDay}
                  onSelectDay={setSelectedDay}
                  textMode={textMode}
                  todayIso={assess.days?.[0]?.day ?? null}
                  hardStop={assess.schedule.hard_stop_window}
                  bestWork={assess.schedule.best_work_window}
                  scrubHour={scrubHour?.hour ?? null}
                />

                <ComparePanel
                  lat={assess.lat}
                  lon={assess.lon}
                  primaryProfile={profile}
                  primaryWorkload={workload}
                  acclimatized={acclimatized}
                  requiredHours={requiredHours}
                  corrupt={corruptDemo && !activeEventId}
                  event={activeEventId}
                  hourOffset={hourOffset}
                />

                <ShiftSheetExport
                  assess={assess}
                  locationLabel={loc.label}
                  workload={workload}
                  profile={profile}
                />

                {/* Row 5 — Actions / briefing / climatology */}
                <div className="dash-panel lg:hidden">{renderBriefingShift()}</div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {assess.actions && assess.actions.length > 0 && (
                    <ActionCards actions={assess.actions} />
                  )}
                  <ClimatologyLine
                    message={assess.climatology.message}
                    note={assess.climatology.note}
                    todayTemp={assess.climatology.today_temp_c}
                    baseline={assess.climatology.baseline_temp_c}
                    delta={assess.climatology.delta_c}
                  />
                </div>

                <p className="type-micro text-[var(--muted)] normal-case tracking-normal font-normal">
                  {assess.current.disclaimer}
                  {assess.smoke.note ? ` ${assess.smoke.note}` : ''}
                </p>
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

            {assess && <div className="hidden lg:block">{renderBriefingShift()}</div>}

            <div className="sidebar-module">
              <HowWeCalculate />
            </div>
          </aside>
        </div>

        <footer className="border-t border-[var(--border)] pt-4 footer-micro space-y-2 font-normal normal-case tracking-normal">
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
