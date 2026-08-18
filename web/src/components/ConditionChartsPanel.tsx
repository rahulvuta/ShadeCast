import { useMemo, useState } from 'react'
import type { AssessResponse } from '../types'
import { ConditionsChart } from './ConditionsChart'
import { LoadContributionChart } from './LoadContributionChart'

export function ConditionChartsPanel({
  hourly,
  horizon,
  textMode,
  onSelectHour,
}: {
  hourly: AssessResponse['hourly']
  horizon?: AssessResponse['horizon']
  textMode: boolean
  onSelectHour?: (day: string | null, hour: number) => void
}) {
  const [full, setFull] = useState(false)
  const hours = useMemo(() => {
    if (full && horizon && horizon.length > hourly.length) return horizon
    return hourly
  }, [full, horizon, hourly])

  if (!hourly.length) return null

  return (
    <section aria-labelledby="conditions-charts-heading" className="dash-panel motion-panel-enter p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="conditions-charts-heading" className="text-base font-bold tracking-tight">
            Conditions over time
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Hazard-normalized lines, then how each driver builds the load score. Click an hour to
            inspect it in the verdict card.
          </p>
        </div>
        <button
          type="button"
          className="touch-target rounded border border-[var(--border)] px-3 text-xs font-bold"
          aria-pressed={full}
          onClick={() => setFull((v) => !v)}
        >
          {full ? '24 hours' : '120-hour horizon'}
        </button>
      </div>
      <div className="grid gap-6">
        <ConditionsChart hours={hours} textMode={textMode} onSelectHour={onSelectHour} />
        <LoadContributionChart hours={hours} textMode={textMode} onSelectHour={onSelectHour} />
      </div>
    </section>
  )
}
