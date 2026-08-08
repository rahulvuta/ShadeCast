import type { ConfidenceLevel, Driver, Verdict } from '../types'

const LABELS: Record<Verdict, string> = {
  GO: 'GO',
  CAUTION: 'CAUTION',
  RESTRICT: 'RESTRICT',
  STOP: 'STOP',
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
    <section
      aria-labelledby="verdict-heading"
      className="dash-panel overflow-hidden verdict-enter"
    >
      <div
        className={`${headerClass} px-5 py-4 sm:px-6 sm:py-5`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.7rem] font-bold tracking-[0.08em] uppercase opacity-90">
            Crew verdict
          </p>
          {confidence && (
            <span
              className="rounded border border-black/20 bg-black/20 px-2.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide"
              title={`Data confidence ${confidence}`}
            >
              Conf {confidence}
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <h1
            id="verdict-heading"
            className="text-5xl sm:text-6xl font-black leading-none tracking-tight"
          >
            {displayVerdict ? LABELS[displayVerdict] : 'UNUSABLE'}
          </h1>
          <div className="min-w-[12rem] flex-1 sm:text-right">
            <p className="text-[0.65rem] font-bold uppercase tracking-wide opacity-85">
              Hard-stop window
            </p>
            <p className="mt-0.5 text-xl sm:text-2xl font-black tabular-nums leading-tight">
              {unusable ? 'No trusted schedule' : hardStop ?? 'No hard stop scheduled'}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3 sm:px-5">
        <MetricChip
          label="Heat index"
          value={heatIndex != null ? `${heatIndex.toFixed(0)}°F` : 'n/a'}
        />
        <MetricChip label="Smoke" value={`${smokePressure.toFixed(0)}/100`} />
        {loadScore != null && (
          <MetricChip label="Load" value={`${loadScore.toFixed(0)}/100`} />
        )}
      </div>

      {drivers && drivers.length > 0 && (
        <div className="px-4 pt-3 sm:px-5" aria-label="Driver attribution">
          <p className="dash-section-label">Drivers</p>
          <div
            className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-sm border border-[var(--border)]"
            role="img"
            aria-label="Driver contribution bar"
          >
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
          <ul className="mt-1.5 mb-3 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.7rem] text-[var(--muted)]">
            {drivers.map((d) => (
              <li key={d.name} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-sm"
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
        <details className="border-t border-[var(--border)] px-4 py-2.5 sm:px-5">
          <summary className="cursor-pointer text-xs font-semibold touch-target list-none">
            Why this verdict
          </summary>
          {explainText && <p className="mt-2 text-sm leading-relaxed">{explainText}</p>}
          {ceilingReason && (
            <p className="mt-2 text-sm text-[var(--muted)]">
              <span className="font-semibold text-[var(--ink)]">Ceiling: </span>
              {ceilingReason}
            </p>
          )}
        </details>
      )}
    </section>
  )
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--border)] bg-white px-2.5 py-1.5 min-w-[5.5rem]">
      <p className="text-[0.6rem] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="text-sm font-bold tabular-nums leading-tight">{value}</p>
    </div>
  )
}
