import type { ConfidenceLevel, Driver, Verdict } from '../types'

const LABELS: Record<Verdict, string> = {
  GO: 'GO',
  CAUTION: 'CAUTION',
  RESTRICT: 'RESTRICT',
  STOP: 'STOP',
}

const ICONS: Record<Verdict, string> = {
  GO: 'OK',
  CAUTION: '!',
  RESTRICT: '!!',
  STOP: 'X',
}

const CLASS: Record<Verdict, string> = {
  GO: 'verdict-go',
  CAUTION: 'verdict-caution',
  RESTRICT: 'verdict-restrict',
  STOP: 'verdict-stop',
}

const DRIVER_COLORS: Record<string, string> = {
  heat: '#E69F00',
  smoke: '#D55E00',
  air_quality: '#CC79A7',
  uv: '#F0E442',
  wind: '#56B4E9',
  confidence: '#0072B2',
  workload: '#009E73',
}

export function VerdictCard({
  verdict,
  hardStop,
  heatIndex,
  smokePressure,
  loadScore,
  drivers,
  explainText,
  ceilingReason,
  confidence,
  unusable,
}: {
  verdict: Verdict | null
  hardStop: string | null
  heatIndex: number | null
  smokePressure: number
  loadScore?: number | null
  drivers?: Driver[]
  explainText?: string | null
  ceilingReason?: string | null
  confidence?: ConfidenceLevel | null
  unusable?: boolean
}) {
  const displayVerdict = unusable || verdict == null ? null : verdict
  const headerClass = displayVerdict ? CLASS[displayVerdict] : 'bg-zinc-700 text-white'

  return (
    <section aria-labelledby="verdict-heading" className="rounded-2xl overflow-hidden shadow-md border border-[var(--border)]">
      <div className={`${headerClass} p-5`} role="status" aria-live="polite" aria-atomic="true">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold tracking-wide uppercase opacity-90">Today's crew verdict</p>
          {confidence && (
            <span
              className="rounded-full bg-black/25 px-3 py-1 text-xs font-bold uppercase tracking-wide"
              title={`Data confidence ${confidence}`}
            >
              Confidence {confidence}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-black/20 text-2xl font-black"
          >
            {displayVerdict ? ICONS[displayVerdict] : '?'}
          </span>
          <h1 id="verdict-heading" className="text-5xl font-black leading-none tracking-tight">
            {displayVerdict ? LABELS[displayVerdict] : 'UNUSABLE'}
          </h1>
        </div>
        <p className="mt-3 text-sm opacity-95">
          Heat index {heatIndex != null ? `${heatIndex.toFixed(0)} F` : 'n/a'} · Smoke pressure{' '}
          {smokePressure.toFixed(0)}/100 (satellite proxy, not AQI)
          {loadScore != null ? ` · Load ${loadScore.toFixed(0)}/100` : ''}
        </p>
      </div>

      {drivers && drivers.length > 0 && (
        <div className="bg-[var(--card)] px-5 pt-4" aria-label="Driver attribution">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">What's driving this</p>
          <div className="mt-2 flex h-4 w-full overflow-hidden rounded-full border border-[var(--border)]" role="img" aria-label="Driver contribution bar">
            {drivers.map((d) => (
              <div
                key={d.name}
                style={{
                  width: `${Math.max(2, d.contribution)}%`,
                  background: DRIVER_COLORS[d.name] ?? '#999',
                }}
                title={`${d.name}: ${d.contribution.toFixed(0)}%`}
              />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
            {drivers.map((d) => (
              <li key={d.name} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: DRIVER_COLORS[d.name] ?? '#999' }}
                  aria-hidden="true"
                />
                {d.name.replace('_', ' ')} {d.contribution.toFixed(0)}%
              </li>
            ))}
          </ul>
        </div>
      )}

      {(explainText || ceilingReason) && (
        <details className="bg-[var(--card)] px-5 py-3 border-t border-[var(--border)]">
          <summary className="cursor-pointer text-sm font-semibold touch-target">Why this verdict</summary>
          {explainText && <p className="mt-2 text-sm leading-relaxed">{explainText}</p>}
          {ceilingReason && (
            <p className="mt-2 text-sm text-[var(--muted)]">
              <span className="font-semibold text-[var(--fg)]">Ceiling: </span>
              {ceilingReason}
            </p>
          )}
        </details>
      )}

      <div className="bg-[var(--card)] p-5 border-t border-[var(--border)]">
        <p className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide">Hard-stop window</p>
        <p className="mt-1 text-3xl font-black tabular-nums">
          {unusable ? 'No trusted schedule' : hardStop ?? 'No hard stop scheduled'}
        </p>
      </div>
    </section>
  )
}
