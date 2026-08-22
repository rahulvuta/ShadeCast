import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  fetchAssess,
  fetchBrief,
  fetchEvents,
  fetchGeocode,
  isAbortError,
  type GeocodeHit,
  type HistoricalEventSummary,
} from './api'
import { ActionCards } from './components/ActionCards'
import { ClothingPanel } from './components/ClothingPanel'
import { BriefingCard } from './components/BriefingCard'
import { ClimatologyLine } from './components/ClimatologyLine'
import { ConcordanceBadge } from './components/ConcordanceBadge'
import { ConfidenceBanner } from './components/ConfidenceBanner'
import { DiffStrip, FiveDayStrip, ShiftPlanner } from './components/DayStrip'
import { DriverWaterfall } from './components/DriverWaterfall'
import { FireMap } from './components/FireMap'
import { HowWeCalculate } from './components/HowWeCalculate'
import { HourlyShiftForecast } from './components/HourlyShiftForecast'
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
import { mergeQuery, parseDeepLinkLocation, parseLatLonInputs, roundCoord } from './lib/coords'
import { hoursInShift, shiftBounds, type SelectedShift } from './lib/shiftWindow'
import {
  INTEGRITY_TAB_ID,
  isUnusable,
  newTabId,
  sameLocationTab,
  type IntegrityTabState,
  type LocationTab,
} from './tabs/types'
import {
  type BriefResponse,
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

const DEEP_LINK_LOC = typeof window !== 'undefined' ? parseDeepLinkLocation() : null

function bootSearchParams(): URLSearchParams {
  return new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
}

function initialAcclimatized(): boolean {
  const v = bootSearchParams().get('acclimatized')
  return v === '1' || v === 'true'
}

function initialRequiredHours(): number {
  const n = Number(bootSearchParams().get('required_hours'))
  if (!Number.isFinite(n) || n < 1 || n > 12) return 4
  return n
}

function initialSkinType(): number {
  const n = Number(bootSearchParams().get('skin_type'))
  if (!Number.isFinite(n)) return 3
  const i = Math.round(n)
  return i >= 1 && i <= 6 ? i : 3
}

function initialHourOffset(): number | null {
  const raw = bootSearchParams().get('hour_offset')
  if (raw == null || raw.trim() === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(200, Math.round(n))
}

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
  const [latInput, setLatInput] = useState(() => (DEEP_LINK_LOC ? String(DEEP_LINK_LOC.lat) : ''))
  const [lonInput, setLonInput] = useState(() => (DEEP_LINK_LOC ? String(DEEP_LINK_LOC.lon) : ''))
  const [workload, setWorkload] = useState<Workload>(() => initialWorkload())
  const [acclimatized, setAcclimatized] = useState(() => initialAcclimatized())
  const [profile, setProfile] = useState<SensitivityProfile>(() => initialProfile())
  const [requiredHours, setRequiredHours] = useState(() => initialRequiredHours())
  const [skinType, setSkinType] = useState(() => initialSkinType())
  const [selectedShift, setSelectedShift] = useState<SelectedShift | null>(null)
  const [historicalEvents, setHistoricalEvents] = useState<HistoricalEventSummary[]>([])
  const [hourOffset, setHourOffset] = useState<number | null>(() => initialHourOffset())
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
  const [screeningDone, setScreeningDone] = useState(false)
  const [brief, setBrief] = useState<BriefResponse | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [settingsRefreshing, setSettingsRefreshing] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)

  const bootDone = useRef(false)
  const commitGen = useRef(0)
  const settingsRefreshGen = useRef(0)
  const settingsAbort = useRef<AbortController | null>(null)
  const pendingTabRef = useRef<{ gen: number; tab: LocationTab } | null>(null)
  const skipSettingsOnce = useRef(false)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const onIntegrityTab = activeTabId === INTEGRITY_TAB_ID
  const assess = onIntegrityTab ? integrity.assess : activeTab?.assess ?? null
  const locationReady = Boolean(activeTab || integrity.label)
  const locLabel = activeTab?.label ?? (integrity.label || 'Pick a location')
  const locLat = activeTab?.lat ?? (integrity.label ? integrity.lat : null)
  const locLon = activeTab?.lon ?? (integrity.label ? integrity.lon : null)
  const activeEventId = onIntegrityTab ? integrity.eventId : activeTab?.eventId ?? null
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const integrityRef = useRef(integrity)
  integrityRef.current = integrity
  const onIntegrityRef = useRef(onIntegrityTab)
  onIntegrityRef.current = onIntegrityTab

  const placeKey = `${assess?.lat ?? ''}|${assess?.lon ?? ''}|${activeEventId ?? ''}`
  const placeKeyRef = useRef(placeKey)

  useEffect(() => {
    const windows = assess?.shift_windows ?? []
    const placeChanged = placeKeyRef.current !== placeKey
    placeKeyRef.current = placeKey
    if (windows.length === 0) return
    const days = new Set((assess?.days ?? []).map((d) => d.day))
    setSelectedShift((prev) => {
      if (!placeChanged && prev?.kind === 'custom' && days.has(prev.day)) return prev
      if (!placeChanged && prev?.kind === 'plan') {
        const still = windows.some(
          (w) =>
            w.day === prev.day && w.start_hour === prev.startHour && w.end_hour === prev.endHour,
        )
        if (still) return prev
      }
      const w = windows[0]!
      return { kind: 'plan', day: w.day, startHour: w.start_hour, endHour: w.end_hour }
    })
  }, [assess, placeKey])

  const shiftHours = useMemo(() => {
    if (!assess) return []
    const pool = assess.horizon?.length ? assess.horizon : assess.hourly
    return hoursInShift(pool ?? [], selectedShift)
  }, [assess, selectedShift])

  const sidebarLoc: ActiveLocation | null = locationReady
    ? { lat: locLat!, lon: locLon!, label: locLabel }
    : null

  useEffect(() => {
    void fetchEvents()
      .then((r) => setHistoricalEvents(r.events))
      .catch(() => setHistoricalEvents([]))
  }, [])

  const promotePendingLocation = useCallback(() => {
    const pending = pendingTabRef.current
    if (!pending || pending.gen !== commitGen.current) return
    pendingTabRef.current = null
    const tab = pending.tab
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
  }, [])

  const finishIntegrityScreening = useCallback(() => {
    setScreeningDone(true)
    promotePendingLocation()
  }, [promotePendingLocation])

  const commitAssess = useCallback(
    async (target: {
      lat: number
      lon: number
      label: string
      eventId: string | null
      skipCoordFields?: boolean
      hourOffset?: number | null
    }) => {
      const gen = ++commitGen.current
      const offset = target.hourOffset !== undefined ? target.hourOffset : hourOffset
      pendingTabRef.current = null
      setScreeningDone(false)
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
      if (!target.skipCoordFields) {
        setLatInput(String(target.lat))
        setLonInput(String(target.lon))
      }
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
          skinType,
          corrupt: corruptDemo && !target.eventId,
          event: target.eventId,
          hourOffset: offset,
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

        pendingTabRef.current = {
          gen,
          tab: {
            id: newTabId(),
            label,
            lat,
            lon,
            eventId: target.eventId,
            assess: a,
            fires: [],
            firesError: null,
            selectedDay: a.days?.[0]?.day ?? null,
          },
        }
      } catch (e) {
        if (gen !== commitGen.current) return
        pendingTabRef.current = null
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
    [workload, acclimatized, profile, requiredHours, skinType, corruptDemo, hourOffset],
  )

  const refreshLocationTab = useCallback(
    async (target: LocationTab, signal?: AbortSignal) => {
      const gen = settingsRefreshGen.current
      try {
        const a = await fetchAssess({
          lat: target.lat,
          lon: target.lon,
          workload,
          acclimatized,
          profile,
          requiredHours,
          skinType,
          corrupt: corruptDemo && !target.eventId,
          event: target.eventId,
          hourOffset,
          signal,
        })
        if (gen !== settingsRefreshGen.current) return

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

        setTabs((prev) =>
          prev.map((t) =>
            t.id === target.id
              ? {
                  ...t,
                  label,
                  lat,
                  lon,
                  assess: a,
                  fires: [],
                  firesError: null,
                  selectedDay:
                    t.selectedDay && (a.days ?? []).some((d) => d.day === t.selectedDay)
                      ? t.selectedDay
                      : a.days?.[0]?.day ?? t.selectedDay,
                }
              : t,
          ),
        )
      } catch (e) {
        if (isAbortError(e)) return
        /* keep existing tab data on refresh failure */
      }
    },
    [workload, acclimatized, profile, requiredHours, skinType, corruptDemo, hourOffset],
  )

  // Boot: only auto-load when the URL names a place (?lat/&lon or ?event).
  useEffect(() => {
    if (bootDone.current) return
    bootDone.current = true
    const params = new URLSearchParams(window.location.search)
    const event = params.get('event')
    const urlLoc = parseDeepLinkLocation()
    if (event) {
      void commitAssess({
        lat: urlLoc?.lat ?? 0,
        lon: urlLoc?.lon ?? 0,
        label: event,
        eventId: event,
        skipCoordFields: !urlLoc,
        hourOffset,
      })
    } else if (urlLoc) {
      void commitAssess({
        lat: urlLoc.lat,
        lon: urlLoc.lon,
        label: urlLoc.label,
        eventId: null,
      })
    }
  }, [commitAssess, hourOffset])

  // Refresh every location tab (or re-assess Integrity) when shared settings change.
  const settingsKey = `${workload}|${acclimatized}|${profile}|${requiredHours}|${skinType}|${hourOffset ?? ''}`
  const prevSettings = useRef(settingsKey)
  useEffect(() => {
    if (prevSettings.current === settingsKey) return
    prevSettings.current = settingsKey
    if (skipSettingsOnce.current) {
      skipSettingsOnce.current = false
      return
    }

    settingsAbort.current?.abort()
    const ac = new AbortController()
    settingsAbort.current = ac
    const gen = ++settingsRefreshGen.current
    setSettingsRefreshing(true)
    const finish = () => {
      if (gen === settingsRefreshGen.current) setSettingsRefreshing(false)
    }

    if (onIntegrityRef.current) {
      const integ = integrityRef.current
      if (integ.label && (integ.eventId || integ.assess || integ.loading)) {
        void commitAssess({
          lat: integ.lat,
          lon: integ.lon,
          label: integ.label,
          eventId: integ.eventId,
          skipCoordFields: Boolean(integ.eventId) && integ.lat === 0 && integ.lon === 0 && !integ.assess,
        }).finally(finish)
        return
      }
      finish()
      return
    }

    const currentTabs = tabsRef.current
    if (currentTabs.length === 0) {
      finish()
      return
    }
    void Promise.all(currentTabs.map((t) => refreshLocationTab(t, ac.signal))).finally(finish)
  }, [settingsKey, commitAssess, refreshLocationTab])

  useEffect(() => () => settingsAbort.current?.abort(), [])

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
        setHourOffset(null)
        pendingTabRef.current = null
        setScreeningDone(false)
        if (locLat != null && locLon != null) {
          skipSettingsOnce.current = true
          void commitAssess({
            lat: locLat,
            lon: locLon,
            label:
              locLabel === 'Pick a location'
                ? `${locLat.toFixed(3)}, ${locLon.toFixed(3)}`
                : locLabel,
            eventId: null,
            hourOffset: null,
          })
          return
        }
        setActiveTabId(INTEGRITY_TAB_ID)
        setIntegrity({
          label: '',
          lat: 0,
          lon: 0,
          eventId: null,
          loading: false,
          error: null,
          assess: null,
        })
        return
      }
      const ev = historicalEvents.find((e) => e.id === eventId)
      const offset = ev?.default_hour_offset ?? 0
      setHourOffset(offset)
      skipSettingsOnce.current = true
      void commitAssess({
        lat: ev?.lat ?? locLat ?? 0,
        lon: ev?.lon ?? locLon ?? 0,
        label: ev?.label ?? eventId,
        eventId,
        skipCoordFields: !ev && (locLat == null || locLon == null),
        hourOffset: offset,
      })
    },
    [commitAssess, historicalEvents, locLat, locLon, locLabel],
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
      workload,
      acclimatized,
      profile,
      engine: {
        ...assess,
        hourly: shiftHours.length > 0 ? shiftHours : assess.hourly,
      },
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
  }, [onIntegrityTab, assess, workload, acclimatized, profile, shiftHours])

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
  const displayWind = focusedRow?.wind_direction_deg ?? assess?.current.wind_direction_deg ?? null
  const displayWindSpeed = focusedRow?.wind_speed_kmh ?? assess?.current.wind_speed_kmh ?? null
  const currentHour =
    assess?.hourly.find((h) => h.is_current)?.hour ?? assess?.hourly[0]?.hour ?? null
  const scrubHour = focusHour?.hour ?? currentHour
  const inspectingLabel = focusedRow
    ? `Inspecting ${focusedRow.day ? `${focusedRow.day} ` : ''}${String(focusedRow.hour).padStart(2, '0')}:00`
    : null
  const todayKey =
    assess?.hourly.find((h) => h.is_current)?.day ?? assess?.days?.[0]?.day ?? null
  const selectedDay = onIntegrityTab ? null : (activeTab?.selectedDay ?? todayKey)
  const dayIsToday = !selectedDay || selectedDay === todayKey
  const dayHourly = useMemo(() => {
    if (!assess) return []
    const pool = assess.horizon?.length ? assess.horizon : assess.hourly
    if (!selectedDay) return assess.hourly
    const rows = pool.filter((h) => h.day === selectedDay)
    return rows.length > 0 ? rows : assess.hourly
  }, [assess, selectedDay])
  const requestedShiftHours = selectedShift ? shiftBounds(selectedShift).duration : 0
  const siteValidAt =
    assess?.hourly.find((h) => h.is_current)?.valid_at ?? assess?.hourly[0]?.valid_at ?? null

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
    } else if (locLat != null && locLon != null) {
      params.delete('event')
      params.set('lat', String(locLat))
      params.set('lon', String(locLon))
    } else {
      params.delete('event')
      params.delete('lat')
      params.delete('lon')
    }
    params.set('workload', workload)
    params.set('profile', profile)
    params.set('acclimatized', acclimatized ? '1' : '0')
    params.set('required_hours', String(requiredHours))
    params.set('skin_type', String(skinType))
    if (activeEventId && hourOffset != null) params.set('hour_offset', String(hourOffset))
    else params.delete('hour_offset')
    if (theme === 'sunlight' || theme === 'ops') params.set('theme', theme)
    if (textMode) params.set('text', '1')
    else params.delete('text')
    if (corruptDemo) params.set('corrupt', '1')
    else params.delete('corrupt')
    const qs = params.toString()
    const next = `${window.location.pathname}?${qs}${window.location.hash}`
    window.history.replaceState(null, '', next)
  }, [
    locLat,
    locLon,
    workload,
    profile,
    acclimatized,
    requiredHours,
    skinType,
    hourOffset,
    theme,
    textMode,
    corruptDemo,
    activeEventId,
  ])

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
    const parsed = parseLatLonInputs(latInput, lonInput)
    if (!parsed.ok) {
      setActiveTabId(INTEGRITY_TAB_ID)
      setIntegrity((s) => ({
        ...s,
        loading: false,
        error: parsed.error,
        assess: null,
      }))
      return
    }
    applyLocation({
      lat: roundCoord(parsed.lat),
      lon: roundCoord(parsed.lon),
      label: `${parsed.lat.toFixed(3)}, ${parsed.lon.toFixed(3)}`,
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
    profile,
    acclimatized,
    skinType,
    historicalEvents,
    activeEventId,
    hourOffset,
    onSearchQuery: setSearchQuery,
    onLatInput: setLatInput,
    onLonInput: setLonInput,
    onWorkload: setWorkload,
    onProfile: setProfile,
    onAcclimatized: setAcclimatized,
    onSkinType: setSkinType,
    onHourOffset: setHourOffset,
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
        selected={selectedShift}
        onSelect={setSelectedShift}
        days={(assess.days ?? []).map((d) => d.day)}
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
            <SidebarControls {...controlsProps} idPrefix="mobile" />
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
                {locLabel && locLabel !== 'Pick a location'
                  ? `You appear offline. Showing the last cached assessment for ${locLabel} if available.`
                  : 'You appear offline. Showing the last cached assessment if available.'}
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
                      Stay on this tab while checks run. A location tab opens after the score
                      settles.
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
                    opens after the live score settles.
                  </div>
                )}

                {integrity.assess && (
                  <>
                    {screeningDone && integrityBlocked && (
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
                    {!screeningDone && !integrityBlocked && (
                      <p className="text-xs text-[var(--muted)]">
                        Watch the live screening. A location tab opens when the confidence score
                        settles at the top.
                      </p>
                    )}
                    {screeningDone && (
                      <ConfidenceBanner confidence={integrity.assess.data_confidence} />
                    )}
                    <IntegrityTheater
                      key={`${integrity.lat}|${integrity.lon}|${integrity.eventId}|${integrity.assess.data_confidence?.score}|${(integrity.assess.data_confidence?.findings ?? []).map((f) => f.check_id).join(',')}`}
                      confidence={integrity.assess.data_confidence}
                      nwsActive={integrity.assess.nws_status?.state === 'active'}
                      forceOpen={true}
                      onComplete={finishIntegrityScreening}
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
                  {assess.data_confidence && (
                    <p className="text-xs text-[var(--muted)]">
                      Integrity {assess.data_confidence.level} ({assess.data_confidence.score}) —
                      screening complete.
                    </p>
                  )}
                  <StormAlertBanner
                    storm={assess.storm}
                    alerts={assess.active_alerts ?? []}
                    siteValidAt={siteValidAt}
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
                      hardStopLabel={
                        inspectingLabel
                          ? "Today's hard-stop — not this hour"
                          : 'Hard-stop'
                      }
                      bestWorkLabel={
                        inspectingLabel
                          ? "Today's best work — not this hour"
                          : 'Best work'
                      }
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
                    {assess.uv && (
                      <UVPanel uv={assess.uv} skinType={skinType} onSkinType={setSkinType} />
                    )}
                  </div>
                </div>

                <div className="map-stage dash-panel overflow-hidden accent-border">
                  <FireMap
                    lat={assess.lat}
                    lon={assess.lon}
                    windFromDeg={displayWind}
                    windSpeedKmh={displayWindSpeed}
                    smokePressure={mapSmoke}
                    textMode={textMode}
                    defaultOpen={true}
                    historicalStart={assess.historical_event?.start_date ?? null}
                    historicalEnd={assess.historical_event?.end_date ?? null}
                  />
                </div>
                {assess.fires && assess.fires.length > 0 && (
                  <section className="dash-panel p-3.5">
                    <h2 className="dash-section-label">FIRMS heat detections (not smoke)</h2>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Satellite fire radiative power near this historical bundle. Not a smoke field
                      and not AQI.
                    </p>
                    <ul className="mt-2 max-h-40 overflow-auto space-y-1 text-xs">
                      {assess.fires.slice(0, 40).map((f, i) => (
                        <li key={`${f.latitude}-${f.longitude}-${f.acq_date}-${f.acq_time}-${i}`}>
                          {f.latitude.toFixed(3)}, {f.longitude.toFixed(3)} · FRP{' '}
                          {f.frp != null ? f.frp.toFixed(1) : 'n/a'} · {f.acq_date} {f.acq_time} ·{' '}
                          {f.satellite}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <HourlyShiftForecast
                  hours={shiftHours}
                  textMode={textMode}
                  requestedHours={requestedShiftHours}
                />

                {(assess.days ?? []).length > 0 && (
                  <FiveDayStrip
                    days={assess.days ?? []}
                    selectedDay={selectedDay}
                    onSelect={setSelectedDay}
                  />
                )}

                <ConditionChartsPanel
                  hourly={dayHourly.length ? dayHourly : assess.hourly}
                  horizon={assess.horizon}
                  textMode={textMode}
                  onSelectHour={onSelectHour}
                  selectedDay={selectedDay}
                />

                <TimelinePanel
                  hourly={dayHourly.length ? dayHourly : assess.hourly}
                  textMode={textMode}
                  hardStop={assess.schedule.hard_stop_window}
                  bestWork={assess.schedule.best_work_window}
                  scrubHour={scrubHour}
                  dayIsToday={dayIsToday}
                  selectedDay={selectedDay}
                />

                <ShiftSheetExport
                  assess={assess}
                  locationLabel={activeTab.label}
                  workload={workload}
                  profile={profile}
                  textMode={textMode}
                  selected={selectedShift}
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
              <SidebarControls {...controlsProps} idPrefix="desktop" />
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
            <a className="underline" href={mergeQuery({ text: textMode ? null : '1' })}>
              {textMode ? 'Leave text-only' : 'Text-only mode'}
            </a>
          </p>
          <p>
            Integrity demo: add <code>?corrupt=1</code> to the URL
          </p>
          <p>Not medical advice. Screening tool for crew scheduling only.</p>
        </footer>
      </div>
    </div>
  )
}
