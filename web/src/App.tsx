import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { fetchAssess, fetchBrief, fetchEvents, fetchFires, fetchGeocode, type GeocodeHit, type HistoricalEventSummary } from './api'
import { ActionCards } from './components/ActionCards'
import { ClothingPanel } from './components/ClothingPanel'
import { BriefingCard } from './components/BriefingCard'
import { ClimatologyLine } from './components/ClimatologyLine'
import { ConcordanceBadge } from './components/ConcordanceBadge'
import { ConfidenceBanner } from './components/ConfidenceBanner'
import { DiffStrip, ShiftPlanner } from './components/DayStrip'
import { DriverWaterfall } from './components/DriverWaterfall'
import { FireMap } from './components/FireMap'
import { HowWeCalculate } from './components/HowWeCalculate'
import { IntegrityTheater } from './components/IntegrityTheater'
import { LocationTabBar } from './components/LocationTabBar'
import { SidebarControls } from './components/SidebarControls'
import { ShiftSheetExport } from './components/ShiftSheetExport'
import { StaleBanner } from './components/StaleBanner'
import { NwsStatusBanner } from './components/NwsStatusBanner'
import { StormAlertBanner } from './components/StormAlertBanner'
import { ConditionChartsPanel } from './components/ConditionChartsPanel'
import { TimelinePanel } from './components/TimelinePanel'
import { UVPanel } from './components/UVPanel'
import { VerdictCard } from './components/VerdictCard'
import { verdictPalette, type VerdictKey } from './design/tokens'
import { useThemeMode } from './design/useThemeMode'
import { MAP_FIRE_FETCH_RADIUS_KM } from './lib/smokeGeometry'
import {
  INTEGRITY_TAB_ID,
  isUnusable,
  newTabId,
  sameLocationTab,
  type IntegrityTabState,
  type LocationTab,
} from './tabs/types'
import {
  DEMO_LOCATIONS,
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
  'children',
  'athlete',
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
  const [lang, setLang] = useState<Lang>('en')
  const [historicalEvents, setHistoricalEvents] = useState<HistoricalEventSummary[]>([])
  const [hourOffset] = useState<number | null>(null)
  const [focusHour, setFocusHour] = useState<{ day: string | null; hour: number } | null>(null)

  const [tabs, setTabs] = useState<LocationTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>(INTEGRITY_TAB_ID)
  const [integrity, setIntegrity] = useState<IntegrityTabState>({
    label: '',
    lat: 0,
    lon: 0,
    eventId: null,
    loading: false,
    error: null,
    assess: null,
  })
  const [brief, setBrief] = useState<BriefResponse | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [settingsRefreshing, setSettingsRefreshing] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)

  const bootDone = useRef(false)
  const commitGen = useRef(0)
  const settingsRefreshGen = useRef(0)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const onIntegrityTab = activeTabId === INTEGRITY_TAB_ID
  const assess = onIntegrityTab ? integrity.assess : activeTab?.assess ?? null
  const fires = activeTab?.fires ?? []
  const firesError = activeTab?.firesError ?? null
  const selectedDay = activeTab?.selectedDay ?? null
  const locLabel = onIntegrityTab
    ? integrity.label || BOOT_LOC.label
    : activeTab?.label ?? BOOT_LOC.label
  const locLat = onIntegrityTab ? integrity.lat || BOOT_LOC.lat : activeTab?.lat ?? BOOT_LOC.lat
  const locLon = onIntegrityTab ? integrity.lon || BOOT_LOC.lon : activeTab?.lon ?? BOOT_LOC.lon
  const activeEventId = onIntegrityTab ? integrity.eventId : activeTab?.eventId ?? null

  const sidebarLoc: ActiveLocation = {
    lat: locLat,
    lon: locLon,
    label: locLabel,
  }

  useEffect(() => {
    void fetchEvents()
      .then((r) => setHistoricalEvents(r.events))
      .catch(() => setHistoricalEvents([]))
  }, [])

  const commitAssess = useCallback(
    async (target: {
      lat: number
      lon: number
      label: string
      eventId: string | null
    }) => {
      const gen = ++commitGen.current
      setActiveTabId(INTEGRITY_TAB_ID)
      setIntegrity({
        label: target.label,
        lat: target.lat,
        lon: target.lon,
        eventId: target.eventId,
        loading: true,
        error: null,
        assess: null,
      })
      setLatInput(String(target.lat))
      setLonInput(String(target.lon))
      setSearchHits([])
      setSearchError(null)

      try {
        const a = await fetchAssess({
          lat: target.lat,
          lon: target.lon,
          workload,
          acclimatized,
          profile,
          requiredHours,
          corrupt: corruptDemo && !target.eventId,
          event: target.eventId,
          hourOffset,
        })
        if (gen !== commitGen.current) return

        let label = target.label
        let lat = target.lat
        let lon = target.lon
        if (a.is_historical && a.lat != null && a.lon != null) {
          lat = a.lat
          lon = a.lon
          label = a.historical_event?.label ?? a.location_label ?? target.label
          setLatInput(String(lat))
          setLonInput(String(lon))
        }

        setIntegrity({
          label,
          lat,
          lon,
          eventId: target.eventId,
          loading: false,
          error: null,
          assess: a,
        })

        if (isUnusable(a)) return

        let nextFires: FirePoint[] = []
        let nextFiresError: string | null = null
        if (a.is_historical) {
          nextFires = a.fires ?? []
        } else {
          try {
            const f = await fetchFires(lat, lon, MAP_FIRE_FETCH_RADIUS_KM)
            nextFires = f.fires
          } catch (e) {
            nextFiresError = e instanceof Error ? e.message : 'Fire detections unavailable'
          }
        }
        if (gen !== commitGen.current) return

        const tab: LocationTab = {
          id: newTabId(),
          label,
          lat,
          lon,
          eventId: target.eventId,
          assess: a,
          fires: nextFires,
          firesError: nextFiresError,
          selectedDay: a.days?.[0]?.day ?? null,
        }

        setTabs((prev) => {
          const idx = prev.findIndex((t) =>
            sameLocationTab(
              { lat: t.lat, lon: t.lon, eventId: t.eventId },
              { lat: tab.lat, lon: tab.lon, eventId: tab.eventId },
            ),
          )
          if (idx >= 0) {
            const id = prev[idx]!.id
            const next = [...prev]
            next[idx] = { ...tab, id }
            queueMicrotask(() => setActiveTabId(id))
            return next
          }
          queueMicrotask(() => setActiveTabId(tab.id))
          return [...prev, tab]
        })
      } catch (e) {
        if (gen !== commitGen.current) return
        setIntegrity({
          label: target.label,
          lat: target.lat,
          lon: target.lon,
          eventId: target.eventId,
          loading: false,
          error: e instanceof Error ? e.message : 'Failed to load assessment',
          assess: null,
        })
      }
    },
    [workload, acclimatized, profile, requiredHours, corruptDemo, hourOffset],
  )

  const refreshLocationTab = useCallback(
    async (target: LocationTab) => {
      const gen = ++commitGen.current
      try {
        const a = await fetchAssess({
          lat: target.lat,
          lon: target.lon,
          workload,
          acclimatized,
          profile,
          requiredHours,
          corrupt: corruptDemo && !target.eventId,
          event: target.eventId,
          hourOffset,
        })
        if (gen !== commitGen.current) return

        let label = target.label
        let lat = target.lat
        let lon = target.lon
        if (a.is_historical && a.lat != null && a.lon != null) {
          lat = a.lat
          lon = a.lon
          label = a.historical_event?.label ?? a.location_label ?? target.label
        }

        if (isUnusable(a)) {
          setActiveTabId(INTEGRITY_TAB_ID)
          setIntegrity({
            label,
            lat,
            lon,
            eventId: target.eventId,
            loading: false,
            error: null,
            assess: a,
          })
          setTabs((prev) => prev.filter((t) => t.id !== target.id))
          return
        }

        let nextFires: FirePoint[] = []
        let nextFiresError: string | null = null
        if (a.is_historical) {
          nextFires = a.fires ?? []
        } else {
          try {
            const f = await fetchFires(lat, lon, MAP_FIRE_FETCH_RADIUS_KM)
            nextFires = f.fires
          } catch (e) {
            nextFiresError = e instanceof Error ? e.message : 'Fire detections unavailable'
          }
        }
        if (gen !== commitGen.current) return

        setTabs((prev) =>
          prev.map((t) =>
            t.id === target.id
              ? {
                  ...t,
                  label,
                  lat,
                  lon,
                  assess: a,
                  fires: nextFires,
                  firesError: nextFiresError,
                  selectedDay: a.days?.[0]?.day ?? t.selectedDay,
                }
              : t,
          ),
        )
      } catch {
        /* keep existing tab data on refresh failure */
      }
    },
    [workload, acclimatized, profile, requiredHours, corruptDemo, hourOffset],
  )

  // Boot: open first tab from URL / default demo
  useEffect(() => {
    if (bootDone.current) return
    bootDone.current = true
    const event = new URLSearchParams(window.location.search).get('event')
    void commitAssess({
      lat: BOOT_LOC.lat,
      lon: BOOT_LOC.lon,
      label: event
        ? event
        : BOOT_LOC.label,
      eventId: event,
    })
  }, [commitAssess])

  // Refresh active tab when shared settings change (after boot)
  const settingsKey = `${workload}|${acclimatized}|${profile}|${requiredHours}`
  const prevSettings = useRef(settingsKey)
  useEffect(() => {
    if (prevSettings.current === settingsKey) return
    prevSettings.current = settingsKey
    if (onIntegrityTab || !activeTab) return

    const gen = ++settingsRefreshGen.current
    setSettingsRefreshing(true)
    void refreshLocationTab(activeTab).finally(() => {
      if (gen === settingsRefreshGen.current) setSettingsRefreshing(false)
    })
  }, [settingsKey, onIntegrityTab, activeTab, refreshLocationTab])

  const applyLocation = useCallback(
    (next: ActiveLocation) => {
      void commitAssess({
        lat: next.lat,
        lon: next.lon,
        label: next.label,
        eventId: null,
      })
    },
    [commitAssess],
  )

  const applyHistoricalEvent = useCallback(
    (eventId: string | null) => {
      if (!eventId) {
        void commitAssess({
          lat: BOOT_LOC.lat,
          lon: BOOT_LOC.lon,
          label: BOOT_LOC.label,
          eventId: null,
        })
        return
      }
      const ev = historicalEvents.find((e) => e.id === eventId)
      void commitAssess({
        lat: ev?.lat ?? locLat,
        lon: ev?.lon ?? locLon,
        label: ev?.label ?? eventId,
        eventId,
      })
    },
    [commitAssess, historicalEvents, locLat, locLon],
  )

  useEffect(() => {
    if (onIntegrityTab || !assess || isUnusable(assess)) {
      setBrief(null)
      return
    }
    let cancelled = false
    setBriefLoading(true)
    setBriefError(null)
    void fetchBrief({
      lat: assess.lat,
      lon: assess.lon,
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
  }, [onIntegrityTab, assess, lang, workload, acclimatized, profile])

  const focusedRow = useMemo(() => {
    if (!assess || !focusHour) return null
    const pool = assess.horizon?.length ? assess.horizon : assess.hourly
    return (
      pool.find(
        (h) =>
          h.hour === focusHour.hour &&
          (focusHour.day == null || !h.day || h.day === focusHour.day),
      ) ?? null
    )
  }, [assess, focusHour])

  const displayVerdict = (focusedRow?.verdict ?? assess?.current.verdict ?? null) as Verdict | null
  const displayHeat = focusedRow?.heat_index_f ?? assess?.current.heat_index_f ?? null
  const displaySmoke = focusedRow?.smoke_pressure ?? assess?.smoke.smoke_pressure ?? 0
  const mapSmoke = assess?.smoke.smoke_pressure ?? 0
  const displayLoadScore = focusedRow?.load_score ?? assess?.environmental_load?.load_score
  const displayInteractions = focusedRow?.interactions ?? assess?.environmental_load?.interactions
  const displayWind = assess?.current.wind_direction_deg ?? null
  const displayWindSpeed = assess?.current.wind_speed_kmh ?? null
  const currentHour =
    assess?.hourly.find((h) => h.is_current)?.hour ?? assess?.hourly[0]?.hour ?? null
  const scrubHour = focusHour?.hour ?? currentHour
  const inspectingLabel = focusedRow
    ? `Inspecting ${focusedRow.day ? `${focusedRow.day} ` : ''}${String(focusedRow.hour).padStart(2, '0')}:00`
    : null

  useEffect(() => {
    setFocusHour(null)
  }, [assess, activeTabId])

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
      params.set('lat', String(locLat))
      params.set('lon', String(locLon))
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
  }, [locLat, locLon, workload, profile, textMode, corruptDemo, activeEventId])

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
      setActiveTabId(INTEGRITY_TAB_ID)
      setIntegrity((s) => ({
        ...s,
        label: s.label || 'Invalid coordinates',
        lat: s.lat || locLat,
        lon: s.lon || locLon,
        loading: false,
        error: 'Latitude must be between -90 and 90',
        assess: null,
      }))
      return
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setActiveTabId(INTEGRITY_TAB_ID)
      setIntegrity((s) => ({
        ...s,
        label: s.label || 'Invalid coordinates',
        lat: s.lat || locLat,
        lon: s.lon || locLon,
        loading: false,
        error: 'Longitude must be between -180 and 180',
        assess: null,
      }))
      return
    }
    applyLocation({
      lat: Math.round(lat * 1000) / 1000,
      lon: Math.round(lon * 1000) / 1000,
      label: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
    })
  }

  function selectTab(id: string) {
    setActiveTabId(id)
    if (id === INTEGRITY_TAB_ID) return
    const t = tabs.find((x) => x.id === id)
    if (t) {
      setLatInput(String(t.lat))
      setLonInput(String(t.lon))
    }
  }

  function closeTab(id: string) {
    if (id === INTEGRITY_TAB_ID) return
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (activeTabId === id) {
        const fallback = next[next.length - 1] ?? null
        setActiveTabId(fallback?.id ?? INTEGRITY_TAB_ID)
      }
      return next
    })
  }

  function setSelectedDay(day: string) {
    if (onIntegrityTab || !activeTabId) return
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, selectedDay: day } : t)),
    )
  }

  function onSelectHour(day: string | null, hour: number) {
    setFocusHour({ day, hour })
    if (day) setSelectedDay(day)
  }

  const controlsProps = {
    loc: sidebarLoc,
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

  function renderBriefing() {
    if (!assess || isUnusable(assess)) return null
    return <BriefingCard brief={brief} loading={briefLoading} error={briefError} />
  }

  function renderShiftPlanner() {
    if (!assess || isUnusable(assess)) return null
    return (
      <ShiftPlanner
        windows={assess.shift_windows ?? []}
        requiredHours={requiredHours}
        onRequiredHours={setRequiredHours}
        refreshing={settingsRefreshing}
      />
    )
  }

  const showIntegrityPanel = onIntegrityTab
  const showLocationContent = Boolean(activeTab && !onIntegrityTab)
  const integrityBlocked = Boolean(integrity.assess && isUnusable(integrity.assess))

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
        <LocationTabBar
          integrity={integrity}
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={selectTab}
          onClose={closeTab}
        />

        <details className="dash-panel lg:hidden">
          <summary className="touch-target cursor-pointer list-none px-3.5 py-3 flex items-center justify-between gap-2">
            <span className="dash-section-label">Controls & settings</span>
            <span className="type-caption text-[var(--muted)] font-normal">{locLabel}</span>
          </summary>
          <div className="border-t border-[var(--border)] px-3.5 py-3">
            <SidebarControls {...controlsProps} />
          </div>
        </details>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(280px,1fr)] lg:items-start">
          <main
            id="main"
            className="min-w-0 layout-stack"
            role="tabpanel"
            aria-labelledby={activeTabId ? `tab-${activeTabId}` : undefined}
          >
            {!online && (
              <aside
                role="status"
                className="rounded border-2 border-[var(--caution)] bg-[var(--caution-bg)] px-3.5 py-2.5 text-sm"
              >
                You appear offline. Showing the last cached assessment if available.
              </aside>
            )}

            {showIntegrityPanel && (
              <div className="layout-stack">
                {integrity.loading && (
                  <div role="status" className="dash-panel space-y-3 p-5">
                    <p className="font-semibold text-sm">
                      Checking {integrity.label || 'location'} — running integrity checks…
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      A location tab opens when checks pass. Unusable inputs stay on this tab.
                    </p>
                  </div>
                )}

                {integrity.error && (
                  <div role="alert" className="dash-panel border-2 border-[var(--stop)] p-4">
                    <p className="font-bold">Could not load assessment</p>
                    <p className="text-sm mt-1">{integrity.error}</p>
                    <button
                      type="button"
                      className="btn-primary touch-target mt-3 rounded px-4 py-2 text-sm"
                      onClick={() =>
                        void commitAssess({
                          lat: integrity.lat,
                          lon: integrity.lon,
                          label: integrity.label,
                          eventId: integrity.eventId,
                        })
                      }
                    >
                      Retry
                    </button>
                  </div>
                )}

                {!integrity.loading && !integrity.error && !integrity.assess && (
                  <div className="dash-panel p-6 text-sm text-[var(--muted)]">
                    Search or pick a demo location. Integrity checks run here first; a location tab
                    opens when they pass.
                  </div>
                )}

                {integrity.assess && (
                  <>
                    {integrityBlocked && (
                      <aside
                        role="status"
                        className="rounded border-2 border-[var(--stop)] bg-[var(--stop-bg)] px-3.5 py-3 text-sm"
                      >
                        <p className="font-bold">Integrity checks failed — location tab not opened</p>
                        <p className="mt-1 text-[var(--muted)]">
                          {integrity.label} returned UNUSABLE confidence. Fix the feed or pick another
                          location.
                        </p>
                      </aside>
                    )}
                    {!integrityBlocked && (
                      <aside
                        role="status"
                        className="rounded border-2 border-[var(--go)] bg-[var(--go-bg)] px-3.5 py-3 text-sm"
                      >
                        <p className="font-bold">Integrity checks passed</p>
                        <p className="mt-1 text-[var(--muted)]">
                          {integrity.label} opened in a location tab. Switch tabs above to view the
                          full assessment.
                        </p>
                      </aside>
                    )}
                    <ConfidenceBanner confidence={integrity.assess.data_confidence} />
                    <IntegrityTheater
                      key={`${integrity.lat}|${integrity.lon}|${integrity.eventId}|${integrity.assess.data_confidence?.score}`}
                      confidence={integrity.assess.data_confidence}
                      forceOpen={true}
                    />
                  </>
                )}
              </div>
            )}

            {showLocationContent && assess && activeTab && (
              <>
                {assess.is_historical && assess.historical_event && (
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
                        <span className="font-semibold">
                          {assess.actual_vs_expected.actual ?? 'n/a'}
                        </span>
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
                  </aside>
                )}

                <div className="layout-hero-band space-y-2">
                  <StormAlertBanner
                    storm={assess.storm}
                    alerts={assess.active_alerts ?? []}
                  />
                  <StaleBanner
                    freshness={assess.data_freshness}
                    servedFromCache={assess.served_from_cache}
                  />
                  <div className="space-y-2">
                    <NwsStatusBanner status={assess.nws_status} />
                    <ConfidenceBanner confidence={assess.data_confidence} />
                    <DiffStrip summary={assess.diff_summary} />
                    <VerdictCard
                      verdict={displayVerdict}
                      hardStop={assess.schedule.hard_stop_window}
                      bestWork={assess.schedule.best_work_window}
                      heatIndex={displayHeat}
                      smokePressure={displaySmoke}
                      loadScore={displayLoadScore}
                      explainText={assess.explain_text}
                      ceilingReason={
                        assess.ceiling_reason ?? assess.environmental_load?.ceiling_reason
                      }
                      confidence={assess.data_confidence?.level}
                      unusable={false}
                      interactions={displayInteractions}
                      inspectingLabel={inspectingLabel}
                      onClearInspect={focusHour ? () => setFocusHour(null) : undefined}
                    />
                  </div>
                </div>

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

                <div className="map-stage dash-panel overflow-hidden accent-border">
                  <FireMap
                    lat={assess.lat}
                    lon={assess.lon}
                    windFromDeg={displayWind}
                    windSpeedKmh={displayWindSpeed}
                    smokePressure={mapSmoke}
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

                <ConditionChartsPanel
                  hourly={assess.hourly}
                  horizon={assess.horizon}
                  textMode={textMode}
                  onSelectHour={onSelectHour}
                />

                <TimelinePanel
                  hourly={assess.hourly}
                  days={assess.days}
                  selectedDay={selectedDay}
                  onSelectDay={setSelectedDay}
                  textMode={textMode}
                  todayIso={assess.days?.[0]?.day ?? null}
                  hardStop={assess.schedule.hard_stop_window}
                  bestWork={assess.schedule.best_work_window}
                  scrubHour={scrubHour}
                />

                <ShiftSheetExport
                  assess={assess}
                  locationLabel={activeTab.label}
                  workload={workload}
                  profile={profile}
                  textMode={textMode}
                />

                <div className="dash-panel">{renderBriefing()}</div>
                <div className="dash-panel lg:hidden">{renderShiftPlanner()}</div>
                <div className="grid gap-4 lg:grid-cols-3">
                  {assess.actions && assess.actions.length > 0 && (
                    <div className="lg:col-span-2">
                      <ActionCards actions={assess.actions} />
                    </div>
                  )}
                  <div
                    className={
                      assess.actions && assess.actions.length > 0 ? '' : 'lg:col-span-3'
                    }
                  >
                    <ClimatologyLine
                      message={assess.climatology.message}
                      note={assess.climatology.note}
                      todayTemp={assess.climatology.today_temp_c}
                      baseline={assess.climatology.baseline_temp_c}
                      delta={assess.climatology.delta_c}
                    />
                  </div>
                </div>
                <ClothingPanel actions={assess.actions ?? []} textMode={textMode} />

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

            {showLocationContent && assess && (
              <div className="hidden lg:block sidebar-module">{renderShiftPlanner()}</div>
            )}

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
