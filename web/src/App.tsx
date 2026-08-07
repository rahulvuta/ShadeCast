import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { fetchAssess, fetchBrief, fetchFires } from './api'
import { ActionCards } from './components/ActionCards'
import { BriefingCard } from './components/BriefingCard'
import { ClimatologyLine } from './components/ClimatologyLine'
import { ConcordanceBadge } from './components/ConcordanceBadge'
import { ConfidenceBanner } from './components/ConfidenceBanner'
import { DiffStrip, FiveDayStrip, ShiftPlanner } from './components/DayStrip'
import { FireMap } from './components/FireMap'
import { HourlyChart } from './components/HourlyChart'
import { HowWeCalculate } from './components/HowWeCalculate'
import { IncidentLog } from './components/IncidentLog'
import { ScheduleStrip } from './components/ScheduleStrip'
import { StaleBanner } from './components/StaleBanner'
import { UVPanel } from './components/UVPanel'
import { VerdictCard } from './components/VerdictCard'
import {
  DEMO_LOCATIONS,
  SENSITIVITY_PROFILES,
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

function formatGeocodeLabel(h: GeocodeHit): string {
  const parts = [h.name, h.admin1, h.country].filter(Boolean)
  return parts.join(', ')
}

export default function App() {
  const textMode = useTextMode()
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
  }, [loc.lat, loc.lon, workload, acclimatized, profile, requiredHours])

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

  return (
    <div className="mx-auto max-w-xl px-4 py-4 pb-16">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <header className="mb-4">
        <p className="text-sm font-semibold tracking-wide uppercase text-[var(--muted)]">ShadeCast</p>
        <h1 className="text-2xl font-black">Is it safe to work outside today?</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Environmental load scheduling — heat, smoke, UV, and air quality for outdoor crews.
        </p>
      </header>

      <nav
        aria-label="Location and settings"
        className="mb-4 space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <div>
          <p className="text-sm font-semibold mb-2">Quick demos</p>
          <div className="flex flex-wrap gap-2">
            {DEMO_LOCATIONS.map((d) => {
              const active = Math.abs(loc.lat - d.lat) < 0.01 && Math.abs(loc.lon - d.lon) < 0.01
              return (
                <button
                  key={d.key}
                  type="button"
                  className={`touch-target rounded-xl border px-3 py-2 text-sm font-semibold ${
                    active ? 'bg-black text-white border-black' : 'border-black bg-white'
                  }`}
                  onClick={() =>
                    applyLocation({ lat: d.lat, lon: d.lon, label: d.label })
                  }
                >
                  {d.label.split(' (')[0]}
                </button>
              )
            })}
          </div>
        </div>

        <form onSubmit={(e) => void runSearch(e)} className="space-y-2">
          <label className="block text-sm font-semibold" htmlFor="place-search">
            Search any place
          </label>
          <div className="flex gap-2">
            <input
              id="place-search"
              className="touch-target min-w-0 flex-1 rounded-xl border border-black bg-white px-3 text-base"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="City or town"
              autoComplete="off"
            />
            <button
              type="submit"
              className="touch-target shrink-0 rounded-xl bg-black px-4 text-sm font-semibold text-white disabled:opacity-50"
              disabled={searchBusy}
            >
              {searchBusy ? '…' : 'Search'}
            </button>
          </div>
          {searchError && <p className="text-sm text-[var(--oi-vermillion)]">{searchError}</p>}
          {searchHits.length > 0 && (
            <ul className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
              {searchHits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className="touch-target w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg)]"
                    onClick={() =>
                      applyLocation({
                        lat: h.latitude,
                        lon: h.longitude,
                        label: formatGeocodeLabel(h),
                      })
                    }
                  >
                    {formatGeocodeLabel(h)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>

        <form onSubmit={goLatLon} className="space-y-2">
          <p className="text-sm font-semibold">Or enter coordinates</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-semibold">
              Latitude
              <input
                type="number"
                step="any"
                className="touch-target mt-1 w-full rounded-xl border border-black bg-white px-3 text-base"
                value={latInput}
                onChange={(e) => setLatInput(e.target.value)}
              />
            </label>
            <label className="block text-xs font-semibold">
              Longitude
              <input
                type="number"
                step="any"
                className="touch-target mt-1 w-full rounded-xl border border-black bg-white px-3 text-base"
                value={lonInput}
                onChange={(e) => setLonInput(e.target.value)}
              />
            </label>
          </div>
          <button
            type="submit"
            className="touch-target w-full rounded-xl border border-black px-4 py-2 text-sm font-semibold"
          >
            Go to coordinates
          </button>
        </form>

        <p className="text-xs text-[var(--muted)]">
          Active: <strong>{loc.label}</strong> ({loc.lat.toFixed(3)}, {loc.lon.toFixed(3)})
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">
            Workload
            <select
              className="touch-target mt-1 w-full rounded-xl border border-black bg-white px-3 text-base"
              value={workload}
              onChange={(e) => setWorkload(e.target.value as Workload)}
            >
              <option value="light">Light</option>
              <option value="moderate">Moderate</option>
              <option value="heavy">Heavy</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Briefing language
            <select
              className="touch-target mt-1 w-full rounded-xl border border-black bg-white px-3 text-base"
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="vi">Vietnamese</option>
            </select>
          </label>
        </div>
        <label className="block text-sm font-semibold">
          Who is this for?
          <select
            className="touch-target mt-1 w-full rounded-xl border border-black bg-white px-3 text-base"
            value={profile}
            onChange={(e) => setProfile(e.target.value as SensitivityProfile)}
          >
            {SENSITIVITY_PROFILES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={acclimatized}
            onChange={(e) => setAcclimatized(e.target.checked)}
          />
          Crew acclimatized (1–2+ weeks on the job)
        </label>
      </nav>

      <main id="main" className="space-y-4">
        {loading && (
          <div
            role="status"
            className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 font-semibold"
          >
            Loading assessment…
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-2xl border-2 border-[var(--stop)] bg-white p-4">
            <p className="font-bold">Could not load assessment</p>
            <p className="text-sm mt-1">{error}</p>
            <button
              type="button"
              className="touch-target mt-3 rounded-xl bg-black px-4 py-2 text-white"
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
              ceilingReason={assess.ceiling_reason ?? assess.environmental_load?.ceiling_reason}
              confidence={assess.data_confidence?.level}
              unusable={assess.data_confidence?.level === 'UNUSABLE' || assess.current.verdict == null}
            />
            <ConcordanceBadge
              concordance={assess.air?.concordance ?? assess.environmental_load?.concordance}
              usAqi={assess.air?.us_aqi ?? assess.current.us_aqi}
            />
            {assess.days && assess.days.length > 0 && (
              <FiveDayStrip
                days={assess.days}
                selectedDay={selectedDay}
                onSelect={setSelectedDay}
              />
            )}
            <ShiftPlanner
              windows={assess.shift_windows ?? []}
              requiredHours={requiredHours}
              onRequiredHours={setRequiredHours}
            />
            <ScheduleStrip hourly={assess.hourly} />
            {!textMode && <HourlyChart hourly={assess.hourly} />}
            {assess.uv && <UVPanel uv={assess.uv} />}
            {assess.actions && assess.actions.length > 0 && <ActionCards actions={assess.actions} />}
            <BriefingCard brief={brief} loading={briefLoading} />
            <FireMap
              lat={assess.lat}
              lon={assess.lon}
              windFromDeg={assess.current.wind_direction_deg}
              fires={fires}
              textMode={textMode}
            />
            <ClimatologyLine message={assess.climatology.message} note={assess.climatology.note} />
            <IncidentLog
              lat={assess.lat}
              lon={assess.lon}
              label={loc.label}
              verdict={assess.current.verdict}
            />
            <HowWeCalculate />
            <p className="text-xs text-[var(--muted)]">{assess.current.disclaimer}</p>
            <p className="text-xs text-[var(--muted)]">{assess.smoke.note}</p>
          </>
        )}
      </main>

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
        <p>Not medical advice. Screening tool for crew scheduling only.</p>
      </footer>
    </div>
  )
}
