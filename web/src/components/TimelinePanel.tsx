import type { AssessResponse } from '../types'
import { RiskClock } from './RiskClock'
import { ScheduleStrip } from './ScheduleStrip'

export function TimelinePanel({
  hourly,
  textMode,
  hardStop,
  bestWork,
  scrubHour,
  dayIsToday = true,
  selectedDay = null,
}: {
  hourly: AssessResponse['hourly']
  textMode: boolean
  hardStop?: string | null
  bestWork?: string | null
  scrubHour?: number | null
  dayIsToday?: boolean
  selectedDay?: string | null
}) {
  return (
    <section aria-labelledby="timeline-heading" className="dash-panel p-4 sm:p-5">
      <div className="mb-3">
        <h2 id="timeline-heading" className="text-base font-bold tracking-tight">
          Timeline & risk peaks
        </h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          Hour-by-hour work/rest and 24-hour severity for {dayIsToday ? 'today' : 'this day'}
        </p>
      </div>

      <ScheduleStrip hourly={hourly} embedded dayIsToday={dayIsToday} />
      {!textMode && (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <RiskClock
            hourly={hourly}
            hardStop={hardStop}
            bestWork={bestWork}
            currentHour={scrubHour}
            embedded
            selectedDay={selectedDay}
          />
        </div>
      )}
    </section>
  )
}
