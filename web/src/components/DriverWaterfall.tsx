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

const SCALE_MAX = 100

function barColor(step: WaterfallStep): string {
  if (step.kind === 'interaction') return 'transparent'
  if (step.kind === 'final') return DRIVER_COLOR.final
  if (step.kind === 'cap') return DRIVER_COLOR.score_cap
  if (step.id in DRIVER_COLOR) return DRIVER_COLOR[step.id]!
  return '#0072B2'
}

type PositionedStep = {
  step: WaterfallStep
  left: number
  width: number
  end: number
}

function positionDriverSteps(steps: WaterfallStep[]): PositionedStep[] {
  let cumulative = 0
  const positioned: PositionedStep[] = []

  for (const step of steps) {
    if (step.kind !== 'driver' && step.kind !== 'cap') continue

    const left = cumulative
    if (step.kind === 'cap') {
      const end = SCALE_MAX
      const width = Math.max(0, end - left)
      positioned.push({ step, left, width, end })
      cumulative = end
      continue
    }

    const delta = Math.max(step.delta, 0)
    const end = Math.min(SCALE_MAX, cumulative + delta)
    const width = Math.max(0, end - left)
    positioned.push({ step, left, width, end })
    cumulative = end
  }

  return positioned
}

/**
 * Visual waterfall of how load_score accumulates from engine steps.
 * Uses the API waterfall (same math as environmental_load.py) — not a UI invention.
 */
export function DriverWaterfall({ steps }: { steps: WaterfallStep[] }) {
  if (!steps.length) return null

  const interactions = steps.filter((s) => s.kind === 'interaction')
  const finalStep = steps.find((s) => s.kind === 'final')
  const positioned = positionDriverSteps(steps)
  const finalScore = finalStep?.running_total ?? positioned.at(-1)?.end ?? 0

  return (
    <section aria-labelledby="waterfall-heading" className="dash-panel p-4 sm:p-5">
      <h2 id="waterfall-heading" className="text-base font-bold tracking-tight">
        Load score waterfall
      </h2>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        How environmental load accumulates — same deterministic steps as the engine.
      </p>

      <ol className="mt-4 space-y-2" aria-label="Load score accumulation steps">
        {positioned.map(({ step, left, width, end }) => (
          <li key={step.id} className="grid gap-1 sm:grid-cols-[7.5rem_1fr_auto] sm:items-center">
            <span className="type-caption text-[var(--muted)] font-semibold normal-case tracking-normal">
              {step.label}
            </span>
            <div
              className="relative h-7 w-full overflow-hidden rounded border border-[var(--border)] bg-[var(--panel)]"
              role="img"
              aria-label={`${step.label}: ${step.delta >= 0 ? '+' : ''}${step.delta.toFixed(1)}, running ${end.toFixed(1)}`}
            >
              <div
                className="absolute inset-y-0 rounded-sm bg-[var(--border)]/35"
                style={{ left: 0, width: `${(end / SCALE_MAX) * 100}%` }}
                aria-hidden
              />
              {width > 0 && (
                <div
                  className="absolute inset-y-0 rounded-sm"
                  style={{
                    left: `${(left / SCALE_MAX) * 100}%`,
                    width: `${(width / SCALE_MAX) * 100}%`,
                    background: barColor(step),
                    opacity: step.kind === 'cap' ? 0.45 : 0.95,
                  }}
                />
              )}
            </div>
            <div className="text-right tabular-nums text-xs">
              <span className="font-bold">
                {step.delta === 0 ? '—' : `${step.delta > 0 ? '+' : ''}${step.delta.toFixed(1)}`}
              </span>
              {step.raw_value && (
                <p className="text-[0.65rem] text-[var(--muted)] font-normal max-w-[11rem] sm:max-w-none">
                  {step.raw_value}
                </p>
              )}
            </div>
          </li>
        ))}

        {finalStep && (
          <li key={finalStep.id} className="grid gap-1 sm:grid-cols-[7.5rem_1fr_auto] sm:items-center">
            <span className="type-caption font-semibold normal-case tracking-normal">
              {finalStep.label}
            </span>
            <div
              className="relative h-7 w-full overflow-hidden rounded border border-[var(--border)] bg-[var(--panel)]"
              role="img"
              aria-label={`${finalStep.label}: ${finalScore.toFixed(1)} out of 100`}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-sm"
                style={{
                  width: `${(finalScore / SCALE_MAX) * 100}%`,
                  background: barColor(finalStep),
                  opacity: 0.95,
                }}
              />
            </div>
            <div className="text-right tabular-nums text-xs">
              <span className="font-bold">{finalScore.toFixed(1)}</span>
              {finalStep.raw_value && (
                <p className="text-[0.65rem] text-[var(--muted)] font-normal max-w-[11rem] sm:max-w-none">
                  {finalStep.raw_value}
                </p>
              )}
            </div>
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
