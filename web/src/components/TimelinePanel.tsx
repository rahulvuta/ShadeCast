import type { AssessResponse } from '../types'
import { FiveDayStrip } from './DayStrip'
import { HourlyChart } from './HourlyChart'
import { ScheduleStrip } from './ScheduleStrip'

export function TimelinePanel({
  hourly,
  days,
  selectedDay,
  onSelectDay,
  textMode,
}: {
  hourly: AssessResponse['hourly']
  days?: AssessResponse['days']
  selectedDay: string | null
  onSelectDay: (day: string) => void
  textMode: boolean
}) {
  return (
    <section aria-labelledby="timeline-heading" className="dash-panel p-4 sm:p-5">
      <div className="mb-3">
        <h2 id="timeline-heading" className="text-base font-bold tracking-tight">
          Timeline & risk peaks
        </h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          Hour-by-hour work/rest and 24-hour severity
        </p>
      </div>

      {days && days.length > 0 && (
        <div className="mb-4">
          <FiveDayStrip days={days} selectedDay={selectedDay} onSelect={onSelectDay} embedded />
        </div>
      )}

      <ScheduleStrip hourly={hourly} embedded />

      {!textMode && (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <HourlyChart hourly={hourly} embedded />
        </div>
      )}
    </section>
  )
}
