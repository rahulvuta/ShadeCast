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

function barColor(step: WaterfallStep): string {
  if (step.kind === 'interaction') return 'transparent'
  if (step.kind === 'final') return DRIVER_COLOR.final
  if (step.kind === 'cap') return DRIVER_COLOR.score_cap
  if (step.id in DRIVER_COLOR) return DRIVER_COLOR[step.id]!
  return '#0072B2'
}

type Segment = {
  id: string
  left: number
  width: number
  color: string
  opacity: number
}

type DriverLayer = {
  step: WaterfallStep
  segments: Segment[]
  total: number
}

function buildDriverLayers(steps: WaterfallStep[]): DriverLayer[] {
  const layers: DriverLayer[] = []
  const prior: Segment[] = []
  let cumulative = 0

  for (const step of steps) {
    if (step.kind !== 'driver' && step.kind !== 'cap') continue

    const left = cumulative
    let width: number
    let end: number

    if (step.kind === 'cap') {
      end = 100
      width = Math.max(0, end - left)
    } else {
      const delta = Math.max(step.delta, 0)
      end = Math.min(100, cumulative + delta)
      width = Math.max(0, end - left)
    }

    const current: Segment = {
      id: step.id,
      left,
      width,
      color: barColor(step),
      opacity: step.kind === 'cap' ? 0.45 : 1,
    }

    layers.push({
      step,
      segments: [...prior, current],
      total: end,
    })

    prior.push({ ...current, opacity: 0.28 })
    cumulative = end
  }

  return layers
}

function pct(value: number, scaleMax: number): string {
  if (scaleMax <= 0) return '0%'
  return `${(value / scaleMax) * 100}%`
}

function BarTrack({
  segments,
  scaleMax,
  ariaLabel,
}: {
  segments: Segment[]
  scaleMax: number
  ariaLabel: string
}) {
  return (
    <div
      className="relative h-7 w-full overflow-hidden rounded border border-[var(--border)] bg-[var(--panel)]"
      role="img"
      aria-label={ariaLabel}
    >
      {segments.map((seg) => (
        <div
          key={seg.id}
          className="absolute inset-y-0"
          style={{
            left: pct(seg.left, scaleMax),
            width: pct(seg.width, scaleMax),
            background: seg.color,
            opacity: seg.opacity,
          }}
        />
      ))}
    </div>
  )
}

/**
 * Visual waterfall of how load_score accumulates from engine steps.
 * Bars scale to the final score so the last driver row and final row share the same right edge.
 */
export function DriverWaterfall({ steps }: { steps: WaterfallStep[] }) {
  if (!steps.length) return null

  const interactions = steps.filter((s) => s.kind === 'interaction')
  const finalStep = steps.find((s) => s.kind === 'final')
  const layers = buildDriverLayers(steps)
  const driverTotal = layers.at(-1)?.total ?? 0
  const finalScore = finalStep?.running_total ?? driverTotal
  const scaleMax = Math.max(driverTotal, finalScore, 1)

  return (
    <section aria-labelledby="waterfall-heading" className="dash-panel p-4 sm:p-5">
      <h2 id="waterfall-heading" className="text-base font-bold tracking-tight">
        Load score waterfall
      </h2>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        How environmental load accumulates — same deterministic steps as the engine.
      </p>

      <ol className="mt-4 space-y-2" aria-label="Load score accumulation steps">
        {layers.map(({ step, segments, total }) => (
          <li key={step.id} className="grid gap-1 sm:grid-cols-[7.5rem_1fr_auto] sm:items-center">
            <span className="type-caption text-[var(--muted)] font-semibold normal-case tracking-normal">
              {step.label}
            </span>
            <BarTrack
              segments={segments}
              scaleMax={scaleMax}
              ariaLabel={`${step.label}: ${step.delta >= 0 ? '+' : ''}${step.delta.toFixed(1)}, running ${total.toFixed(1)}`}
            />
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
            <BarTrack
              segments={[
                {
                  id: 'final',
                  left: 0,
                  width: driverTotal,
                  color: barColor(finalStep),
                  opacity: 0.95,
                },
              ]}
              scaleMax={scaleMax}
              ariaLabel={`${finalStep.label}: ${finalScore.toFixed(1)} out of 100`}
            />
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
