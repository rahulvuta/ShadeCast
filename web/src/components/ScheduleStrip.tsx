import type { AssessResponse, Verdict } from '../types'

const CLASS: Record<Verdict, string> = {
  GO: 'verdict-go',
  CAUTION: 'verdict-caution',
  RESTRICT: 'verdict-restrict',
  STOP: 'verdict-stop',
}

export function ScheduleStrip({ hourly }: { hourly: AssessResponse['hourly'] }) {
  const nowHour = new Date().getHours()
  return (
    <section aria-labelledby="schedule-heading" className="rounded-2xl bg-[var(--card)] border border-[var(--border)] p-4 shadow-sm">
      <h2 id="schedule-heading" className="text-lg font-bold">
        Hour-by-hour work / rest
      </h2>
      <p className="text-sm text-[var(--muted)] mb-3">Swipe sideways. Current hour is outlined.</p>
      <ul
        className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {hourly.map((h) => {
          const current = h.hour === nowHour
          return (
            <li
              key={h.hour}
              className={`snap-start shrink-0 w-28 rounded-xl border-2 p-3 ${CLASS[h.verdict]} ${
                current ? 'border-black ring-2 ring-black' : 'border-transparent'
              }`}
              aria-current={current ? 'true' : undefined}
            >
              <p className="text-xs font-bold opacity-90">{String(h.hour).padStart(2, '0')}:00</p>
              <p className="text-lg font-black">{h.verdict}</p>
              <p className="text-xs mt-1">
                {h.work_minutes}m work / {h.rest_minutes}m rest
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
