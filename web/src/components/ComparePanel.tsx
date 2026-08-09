import { useEffect, useState } from 'react'
import { fetchAssess } from '../api'
import {
  SENSITIVITY_PROFILES,
  type AssessResponse,
  type SensitivityProfile,
  type Verdict,
  type Workload,
} from '../types'

const WORKLOADS: Workload[] = ['light', 'moderate', 'heavy']

function verdictClass(v: Verdict | null | undefined): string {
  switch (v) {
    case 'GO':
      return 'verdict-go'
    case 'CAUTION':
      return 'verdict-caution'
    case 'RESTRICT':
      return 'verdict-restrict'
    case 'STOP':
      return 'verdict-stop'
    default:
      return 'bg-[var(--muted)] text-[var(--bg)]'
  }
}

function CompareColumn({
  title,
  assess,
  loading,
  error,
}: {
  title: string
  assess: AssessResponse | null
  loading: boolean
  error: string | null
}) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--panel)] p-3 min-w-0">
      <p className="dash-section-label">{title}</p>
      {loading && <p className="mt-3 text-sm text-[var(--muted)]">Loading…</p>}
      {error && (
        <p className="mt-3 text-sm text-[var(--restrict)]" role="alert">
          {error}
        </p>
      )}
      {assess && !loading && (
        <div className="mt-3 space-y-2">
          <div className={`rounded px-3 py-2 ${verdictClass(assess.current.verdict)}`}>
            <p className="type-micro opacity-90">Verdict</p>
            <p className="text-2xl font-black tracking-tight">
              {assess.current.verdict ?? 'UNUSABLE'}
            </p>
          </div>
          <p className="text-sm">
            <span className="text-[var(--muted)]">Load score </span>
            <span className="font-bold tabular-nums">
              {assess.environmental_load?.load_score?.toFixed(0) ?? 'n/a'}
            </span>
          </p>
          <p className="text-sm">
            <span className="text-[var(--muted)]">Hard-stop </span>
            <span className="font-semibold">{assess.schedule.hard_stop_window ?? 'None'}</span>
          </p>
          <p className="text-sm">
            <span className="text-[var(--muted)]">Best work </span>
            <span className="font-semibold">{assess.schedule.best_work_window ?? 'n/a'}</span>
          </p>
          <p className="text-sm">
            <span className="text-[var(--muted)]">Safe hours </span>
            <span className="font-semibold tabular-nums">
              {assess.schedule.total_safe_hours.toFixed(1)}h
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

export function ComparePanel({
  lat,
  lon,
  primaryProfile,
  primaryWorkload,
  acclimatized,
  requiredHours,
  corrupt,
  event,
  hourOffset,
}: {
  lat: number
  lon: number
  primaryProfile: SensitivityProfile
  primaryWorkload: Workload
  acclimatized: boolean
  requiredHours: number
  corrupt?: boolean
  event?: string | null
  hourOffset?: number | null
}) {
  const defaultCompare: SensitivityProfile =
    primaryProfile === 'asthma_respiratory' ? 'general' : 'asthma_respiratory'
  const [mode, setMode] = useState<'profile' | 'workload'>('profile')
  const [compareProfile, setCompareProfile] = useState<SensitivityProfile>(defaultCompare)
  const [compareWorkload, setCompareWorkload] = useState<Workload>(
    primaryWorkload === 'heavy' ? 'light' : 'heavy',
  )
  const [left, setLeft] = useState<AssessResponse | null>(null)
  const [right, setRight] = useState<AssessResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const leftOpts = {
      lat,
      lon,
      workload: primaryWorkload,
      acclimatized,
      profile: primaryProfile,
      requiredHours,
      corrupt,
      event,
      hourOffset,
    }
    const rightOpts = {
      lat,
      lon,
      workload: mode === 'workload' ? compareWorkload : primaryWorkload,
      acclimatized,
      profile: mode === 'profile' ? compareProfile : primaryProfile,
      requiredHours,
      corrupt,
      event,
      hourOffset,
    }
    Promise.all([fetchAssess(leftOpts), fetchAssess(rightOpts)])
      .then(([a, b]) => {
        if (cancelled) return
        setLeft(a)
        setRight(b)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Compare failed')
        setLeft(null)
        setRight(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    lat,
    lon,
    primaryProfile,
    primaryWorkload,
    compareProfile,
    compareWorkload,
    mode,
    acclimatized,
    requiredHours,
    corrupt,
    event,
    hourOffset,
  ])

  const leftTitle =
    mode === 'profile'
      ? SENSITIVITY_PROFILES.find((p) => p.key === primaryProfile)?.label ?? primaryProfile
      : `Workload: ${primaryWorkload}`
  const rightTitle =
    mode === 'profile'
      ? SENSITIVITY_PROFILES.find((p) => p.key === compareProfile)?.label ?? compareProfile
      : `Workload: ${compareWorkload}`

  const diffBits: string[] = []
  if (left && right) {
    if (left.current.verdict !== right.current.verdict) {
      diffBits.push(`Verdict ${left.current.verdict ?? 'n/a'} vs ${right.current.verdict ?? 'n/a'}`)
    }
    const ls = left.environmental_load?.load_score
    const rs = right.environmental_load?.load_score
    if (ls != null && rs != null && Math.abs(ls - rs) >= 0.5) {
      diffBits.push(`Load ${ls.toFixed(0)} vs ${rs.toFixed(0)}`)
    }
    if (left.schedule.hard_stop_window !== right.schedule.hard_stop_window) {
      diffBits.push('Hard-stop windows differ')
    }
    const safeDelta = right.schedule.total_safe_hours - left.schedule.total_safe_hours
    if (Math.abs(safeDelta) >= 0.5) {
      diffBits.push(
        `Safe hours ${safeDelta > 0 ? '+' : ''}${safeDelta.toFixed(1)}h on the right`,
      )
    }
    if (diffBits.length === 0) diffBits.push('Same verdict and schedule under both settings')
  }

  return (
    <section aria-labelledby="compare-heading" className="dash-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="compare-heading" className="text-base font-bold tracking-tight">
            Split-screen compare
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Same location — two profiles or workloads side by side.
          </p>
        </div>
        <div className="flex rounded border border-[var(--border)] bg-[var(--chip-bg)] p-0.5">
          <button
            type="button"
            className={`touch-target rounded px-3 text-xs font-semibold ${
              mode === 'profile' ? 'btn-selected' : ''
            }`}
            aria-pressed={mode === 'profile'}
            onClick={() => setMode('profile')}
          >
            Profiles
          </button>
          <button
            type="button"
            className={`touch-target rounded px-3 text-xs font-semibold ${
              mode === 'workload' ? 'btn-selected' : ''
            }`}
            aria-pressed={mode === 'workload'}
            onClick={() => setMode('workload')}
          >
            Workloads
          </button>
        </div>
      </div>

      <label className="mt-3 block text-xs font-semibold">
        Compare against
        {mode === 'profile' ? (
          <select
            className="touch-target mt-1 w-full max-w-md rounded border border-[var(--border)] bg-[var(--input-bg)] px-2.5 text-sm"
            value={compareProfile}
            onChange={(e) => setCompareProfile(e.target.value as SensitivityProfile)}
          >
            {SENSITIVITY_PROFILES.filter((p) => p.key !== primaryProfile).map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        ) : (
          <select
            className="touch-target mt-1 w-full max-w-md rounded border border-[var(--border)] bg-[var(--input-bg)] px-2.5 text-sm"
            value={compareWorkload}
            onChange={(e) => setCompareWorkload(e.target.value as Workload)}
          >
            {WORKLOADS.filter((w) => w !== primaryWorkload).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        )}
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <CompareColumn title={leftTitle} assess={left} loading={loading} error={null} />
        <CompareColumn title={rightTitle} assess={right} loading={loading} error={error} />
      </div>

      {diffBits.length > 0 && !loading && (
        <aside
          className="mt-4 rounded border border-[var(--border)] bg-[var(--card)] px-3 py-2.5"
          aria-live="polite"
        >
          <p className="dash-section-label">Diff summary</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-sm">
            {diffBits.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </aside>
      )}
    </section>
  )
}
