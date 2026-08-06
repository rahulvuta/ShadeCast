import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAssess, fetchBrief, fetchFires } from './api'
import { BriefingCard } from './components/BriefingCard'
import { ClimatologyLine } from './components/ClimatologyLine'
import { FireMap } from './components/FireMap'
import { HourlyChart } from './components/HourlyChart'
import { HowWeCalculate } from './components/HowWeCalculate'
import { ScheduleStrip } from './components/ScheduleStrip'
import { StaleBanner } from './components/StaleBanner'
import { VerdictCard } from './components/VerdictCard'
import {
  DEMO_LOCATIONS,
  type AssessResponse,
  type BriefResponse,
  type FirePoint,
  type Lang,
  type Workload,
} from './types'

function useTextMode(): boolean {
  return useMemo(() => new URLSearchParams(window.location.search).get('text') === '1', [])
}

export default function App() {
  const textMode = useTextMode()
  const [locKey, setLocKey] = useState<(typeof DEMO_LOCATIONS)[number]['key']>('hot_smoky')
  const loc = DEMO_LOCATIONS.find((l) => l.key === locKey) ?? DEMO_LOCATIONS[1]
  const [workload, setWorkload] = useState<Workload>('moderate')
  const [acclimatized, setAcclimatized] = useState(false)
  const [lang, setLang] = useState<Lang>('en')
  const [assess, setAssess] = useState<AssessResponse | null>(null)
  const [brief, setBrief] = useState<BriefResponse | null>(null)
  const [fires, setFires] = useState<FirePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [briefLoading, setBriefLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const a = await fetchAssess({
        lat: loc.lat,
        lon: loc.lon,
        workload,
        acclimatized,
      })
      setAssess(a)
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
  }, [loc.lat, loc.lon, workload, acclimatized])

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

  return (
    <div className="mx-auto max-w-xl px-4 py-4 pb-16">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-white focus:p-2">
        Skip to content
      </a>
      <header className="mb-4">
        <p className="text-sm font-semibold tracking-wide uppercase text-[var(--muted)]">ShadeCast</p>
        <h1 className="text-2xl font-black">Is it safe to work outside today?</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Compound heat + wildfire-smoke scheduling for outdoor crews.
        </p>
      </header>

      <nav aria-label="Location and settings" className="mb-4 space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <label className="block text-sm font-semibold">
          Demo location
          <select
            className="touch-target mt-1 w-full rounded-xl border border-black bg-white px-3 text-base"
            value={locKey}
            onChange={(e) => setLocKey(e.target.value as typeof locKey)}
          >
            {DEMO_LOCATIONS.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
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
          <div role="status" className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 font-semibold">
            Loading assessment…
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-2xl border-2 border-[var(--stop)] bg-white p-4">
            <p className="font-bold">Could not load assessment</p>
            <p className="text-sm mt-1">{error}</p>
            <button type="button" className="touch-target mt-3 rounded-xl bg-black px-4 py-2 text-white" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}
        {assess && !loading && (
          <>
            <StaleBanner freshness={assess.data_freshness} servedFromCache={assess.served_from_cache} />
            <VerdictCard
              verdict={assess.current.verdict}
              hardStop={assess.schedule.hard_stop_window}
              heatIndex={assess.current.heat_index_f}
              smokePressure={assess.smoke.smoke_pressure}
            />
            <ScheduleStrip hourly={assess.hourly} />
            {!textMode && <HourlyChart hourly={assess.hourly} />}
            <BriefingCard brief={brief} loading={briefLoading} />
            <FireMap
              lat={assess.lat}
              lon={assess.lon}
              windFromDeg={assess.current.wind_direction_deg}
              fires={fires}
              textMode={textMode}
            />
            <ClimatologyLine message={assess.climatology.message} note={assess.climatology.note} />
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
          <a className="underline" href="https://github.com/rahulvuta/ShadeCast/blob/main/docs/limitations.md">
            docs/limitations.md
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
