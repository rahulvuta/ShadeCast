import { verdictPalette, type VerdictKey } from '../design/tokens'
import type { ConfidenceLevel, Verdict } from '../types'

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

export function VerdictCard({
  verdict,
  hardStop,
  bestWork,
  heatIndex,
  smokePressure,
  loadScore,
  explainText,
  ceilingReason,
  confidence,
  unusable,
  interactions,
}: {
  verdict: Verdict | null
  hardStop: string | null
  bestWork?: string | null
  heatIndex: number | null
  smokePressure: number
  loadScore?: number | null
  explainText?: string | null
  ceilingReason?: string | null
  confidence?: ConfidenceLevel | null
  unusable?: boolean
  interactions?: string[]
}) {
  const displayVerdict = unusable || verdict == null ? null : verdict
  const headerClass = displayVerdict
    ? CLASS[displayVerdict]
    : 'bg-[var(--muted)] text-[var(--bg)]'
  const key: VerdictKey = displayVerdict ?? 'UNUSABLE'
  const palette = verdictPalette[key]

  return (
    <section
      aria-labelledby="verdict-heading"
      className="dash-panel dash-panel-elev-3 overflow-hidden verdict-enter"
    >
      <div
        className={`${headerClass} px-5 py-5 sm:px-7 sm:py-7`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{ boxShadow: `inset 0 0 0 1px ${palette.border}33` }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="type-micro opacity-90">Crew verdict</p>
          {confidence && (
            <span
              className="rounded border border-black/25 bg-black/25 px-2.5 py-1 type-micro"
              title={`Data confidence ${confidence}`}
            >
              Confidence {confidence}
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end">
          <div className="flex flex-wrap items-end gap-4">
            <span
              aria-hidden="true"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-black/25 text-2xl font-black"
            >
              {displayVerdict ? ICONS[displayVerdict] : '?'}
            </span>
            <div>
              <p id="verdict-heading" className="type-display tracking-tight">
                {displayVerdict ? LABELS[displayVerdict] : 'UNUSABLE'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4 lg:justify-end">
            {loadScore != null && !unusable && (
              <div className="text-left lg:text-right">
                <p className="type-micro opacity-85">Load score</p>
                <p className="type-display tabular-nums" style={{ fontSize: 'clamp(3rem, 8vw, 4.5rem)' }}>
                  {loadScore.toFixed(0)}
                </p>
              </div>
            )}
            <div className="min-w-[10rem] space-y-3">
              <div>
                <p className="type-micro opacity-85">Hard-stop</p>
                <p className="mt-0.5 text-xl sm:text-2xl font-black tabular-nums leading-tight">
                  {unusable ? 'No trusted schedule' : hardStop ?? 'None'}
                </p>
              </div>
              {bestWork && !unusable && (
                <div>
                  <p className="type-micro opacity-85">Best work</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums leading-tight">{bestWork}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3 sm:px-6">
        <MetricChip
          label="Heat index"
          value={heatIndex != null ? `${heatIndex.toFixed(0)}°F` : 'n/a'}
        />
        <MetricChip label="Smoke" value={`${smokePressure.toFixed(0)}/100`} />
      </div>

      {interactions && interactions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-4 py-2 sm:px-6">
          {interactions.slice(0, 4).map((i) => (
            <span
              key={i}
              className="rounded border border-[var(--border)] bg-[var(--chip-bg)] px-2 py-0.5 type-micro text-[var(--muted)] normal-case tracking-normal"
            >
              {i.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {(explainText || ceilingReason) && (
        <details className="border-t border-[var(--border)] px-4 py-2.5 sm:px-6">
          <summary className="cursor-pointer type-caption font-semibold touch-target list-none">
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
    <div className="rounded border border-[var(--border)] bg-[var(--chip-bg)] px-2.5 py-1.5 min-w-[5.5rem]">
      <p className="type-micro text-[var(--muted)]">{label}</p>
      <p className="text-sm font-bold tabular-nums leading-tight">{value}</p>
    </div>
  )
}
