import type { AssessResponse } from '../types'
import { FiveDayStrip } from './DayStrip'
import { RiskClock } from './RiskClock'
import { ScheduleStrip } from './ScheduleStrip'

export function TimelinePanel({
  hourly,
  days,
  selectedDay,
  onSelectDay,
  textMode,
  todayIso,
  hardStop,
  bestWork,
  scrubHour,
}: {
  hourly: AssessResponse['hourly']
  days?: AssessResponse['days']
  selectedDay: string | null
  onSelectDay: (day: string) => void
  textMode: boolean
  todayIso: string | null
  hardStop?: string | null
  bestWork?: string | null
  scrubHour?: number | null
}) {
  const selected = days?.find((d) => d.day === selectedDay) ?? null
  const viewingToday = !selectedDay || !todayIso || selectedDay === todayIso

  return (
    <section aria-labelledby="timeline-heading" className="dash-panel p-4 sm:p-5">
      <div className="mb-3">
        <h2 id="timeline-heading" className="text-base font-bold tracking-tight">
          Timeline & risk peaks
        </h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          {viewingToday
            ? 'Hour-by-hour work/rest and 24-hour severity (today)'
            : 'Day summary — hourly detail is available for today only'}
        </p>
      </div>

      {days && days.length > 0 && (
        <div className="mb-4">
          <FiveDayStrip days={days} selectedDay={selectedDay} onSelect={onSelectDay} embedded />
        </div>
      )}

      {viewingToday ? (
        <>
          <ScheduleStrip hourly={hourly} embedded />
          {!textMode && (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <RiskClock
                hourly={hourly}
                hardStop={hardStop}
                bestWork={bestWork}
                currentHour={scrubHour}
                embedded
              />
            </div>
          )}
        </>
      ) : selected ? (
        <div className="rounded border border-[var(--border)] bg-[var(--panel)] p-3 space-y-2 text-sm">
          <p className="dash-section-label">{selected.day}</p>
          <p>
            <span className="font-semibold">Worst verdict:</span> {selected.worst_verdict}
          </p>
          <p>
            <span className="font-semibold">Hard-stop:</span>{' '}
            {selected.hard_stop_window ?? 'None scheduled'}
          </p>
          <p>
            <span className="font-semibold">Best work window:</span>{' '}
            {selected.best_work_window ?? 'n/a'}
          </p>
          <p>
            <span className="font-semibold">Safe hours:</span> {selected.total_safe_hours.toFixed(1)} ·{' '}
            {selected.total_work_minutes} work minutes
          </p>
          <p className="text-xs text-[var(--muted)] pt-1">
            Select today in the 5-day strip to see hour-by-hour pills and the risk clock.
          </p>
        </div>
      ) : null}
    </section>
  )
}
