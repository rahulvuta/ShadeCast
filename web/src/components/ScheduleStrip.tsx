import type { AssessResponse, Verdict } from '../types'

const CLASS: Record<Verdict, string> = {
  GO: 'verdict-go',
  CAUTION: 'verdict-caution',
  RESTRICT: 'verdict-restrict',
  STOP: 'verdict-stop',
}

export function ScheduleStrip({
  hourly,
  embedded = false,
  dayIsToday = true,
}: {
  hourly: AssessResponse['hourly']
  embedded?: boolean
  dayIsToday?: boolean
}) {
  const body = (
    <>
      {!embedded && (
        <>
          <h2 id="schedule-heading" className="text-lg font-bold">
            Hour-by-hour work / rest
          </h2>
          <p className="text-sm text-[var(--muted)] mb-3">
            Swipe sideways. {dayIsToday ? 'Current hour is outlined.' : 'Hours for this day.'}
          </p>
        </>
      )}
      {embedded && (
        <p className="dash-section-label mb-2">
          {dayIsToday ? 'Hour-by-hour (today)' : 'Hour-by-hour (this day)'}
        </p>
      )}
      <ul
        className="flex gap-1.5 overflow-x-auto pb-1 snap-x snap-mandatory"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {hourly.map((h) => {
          const current = Boolean(h.is_current)
          return (
            <li
              key={`${h.day ?? ''}-${h.hour}`}
              className={`hour-pill snap-start shrink-0 w-[4.75rem] rounded border-2 px-2 py-2 ${CLASS[h.verdict]} ${
                current ? 'border-black' : 'border-transparent'
              }`}
              aria-current={current ? 'true' : undefined}
            >
              <p className="text-[0.65rem] font-bold opacity-90">
                {String(h.hour).padStart(2, '0')}:00
              </p>
              <p className="text-sm font-black leading-tight">{h.verdict}</p>
              <p className="text-[0.65rem] mt-0.5 leading-tight opacity-90">
                {h.work_minutes}/{h.rest_minutes}m
              </p>
            </li>
          )
        })}
      </ul>
    </>
  )

  if (embedded) return <div>{body}</div>

  return (
    <section aria-labelledby="schedule-heading" className="dash-panel p-4">
      {body}
    </section>
  )
}
