import type { WaterfallStep } from '../types'

const DRIVER_COLOR: Record<string, string> = {
  heat: '#E69F00',
  smoke: '#D55E00',
  air_quality: '#CC79A7',
  uv: '#F0E442',
  wind: '#56B4E9',
  score_cap: '#5A6570',
  final: '#009E73',
}

/** Fixed 0–100 scale so +26 fills 26% of every equal-length track. */
const SCALE_MAX = 100

function barColor(step: WaterfallStep): string {
  if (step.kind === 'final') return DRIVER_COLOR.final
  if (step.kind === 'cap') return DRIVER_COLOR.score_cap
  if (step.id in DRIVER_COLOR) return DRIVER_COLOR[step.id]!
  return '#5A6570'
}

type Positioned = {
  step: WaterfallStep
  leftPct: number
  widthPct: number
  endPct: number
}

function positionDrivers(steps: WaterfallStep[]): Positioned[] {
  let running = 0
  const out: Positioned[] = []

  for (const step of steps) {
    if (step.kind !== 'driver' && step.kind !== 'cap') continue

    const left = running
    let end: number
    if (step.kind === 'cap') {
      end = SCALE_MAX
    } else {
      end = Math.min(SCALE_MAX, running + Math.max(step.delta, 0))
    }
    const width = Math.max(0, end - left)
    out.push({
      step,
      leftPct: (left / SCALE_MAX) * 100,
      widthPct: (width / SCALE_MAX) * 100,
      endPct: (end / SCALE_MAX) * 100,
    })
    running = end
  }

  return out
}

/**
 * Waterfall on a fixed 0–100 scale: every track is the same length;
 * fills are literal percentages of that track (e.g. +26 → 26%).
 */
export function DriverWaterfall({ steps }: { steps: WaterfallStep[] }) {
  if (!steps.length) return null

  const interactions = steps.filter((s) => s.kind === 'interaction')
  const finalStep = steps.find((s) => s.kind === 'final')
  const positioned = positionDrivers(steps)
  const finalScore = Math.min(
    SCALE_MAX,
    Math.max(0, finalStep?.running_total ?? positioned.at(-1)?.endPct ?? 0),
  )
  const finalPct = (finalScore / SCALE_MAX) * 100

  return (
    <section aria-labelledby="waterfall-heading" className="dash-panel p-4 sm:p-5">
      <h2 id="waterfall-heading" className="text-base font-bold tracking-tight">
        Load score waterfall
      </h2>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        How environmental load accumulates on a 0–100 scale.
      </p>

      <ol className="mt-4 space-y-2" aria-label="Load score accumulation steps">
        {positioned.map(({ step, leftPct, widthPct, endPct }) => (
          <li
            key={step.id}
            className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.5rem] items-center gap-2"
          >
            <span className="type-caption text-[var(--muted)] font-semibold normal-case tracking-normal truncate">
              {step.label}
            </span>
            <div
              className="relative h-7 w-full min-w-0 overflow-hidden rounded border border-[var(--border)] bg-[var(--panel)]"
              role="img"
              aria-label={`${step.label}: ${step.delta >= 0 ? '+' : ''}${step.delta.toFixed(1)}, running ${endPct.toFixed(1)} of 100`}
            >
              {/* Prior cumulative (muted) so segments abut without gaps */}
              {leftPct > 0 && (
                <div
                  className="absolute inset-y-0 left-0 bg-[var(--border)]/40"
                  style={{ width: `${leftPct}%` }}
                  aria-hidden
                />
              )}
              {widthPct > 0 && (
                <div
                  className="absolute inset-y-0"
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    background: barColor(step),
                    opacity: step.kind === 'cap' ? 0.45 : 0.95,
                  }}
                />
              )}
            </div>
            <div className="text-right tabular-nums text-xs font-bold">
              {step.delta === 0 ? '—' : `${step.delta > 0 ? '+' : ''}${step.delta.toFixed(1)}`}
            </div>
          </li>
        ))}

        {finalStep && (
          <li
            key={finalStep.id}
            className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.5rem] items-center gap-2"
          >
            <span className="type-caption font-semibold normal-case tracking-normal truncate">
              {finalStep.label}
            </span>
            <div
              className="relative h-7 w-full min-w-0 overflow-hidden rounded border border-[var(--border)] bg-[var(--panel)]"
              role="img"
              aria-label={`${finalStep.label}: ${finalScore.toFixed(1)} out of 100`}
            >
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${finalPct}%`,
                  background: barColor(finalStep),
                  opacity: 0.95,
                }}
              />
            </div>
            <div className="text-right tabular-nums text-xs font-bold">{finalScore.toFixed(1)}</div>
          </li>
        )}
      </ol>

      {interactions.length > 0 && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <p className="dash-section-label">Interaction mechanisms</p>
          <ul className="mt-2 space-y-2">
            {interactions.map((s) => (
              <li
                key={s.id}
                className="rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm"
              >
                <p className="font-semibold">{s.label}</p>
                {s.mechanism && (
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{s.mechanism}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
