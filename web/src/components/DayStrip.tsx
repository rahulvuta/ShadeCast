import type { AssessResponse } from '../types'

export function DiffStrip({ summary }: { summary?: string | null }) {
  if (!summary) return null
  return (
    <aside
      role="status"
      className="dash-panel px-3.5 py-2.5 text-sm"
    >
      <span className="font-semibold">What changed: </span>
      {summary.replace(/^What changed:\s*/i, '')}
    </aside>
  )
}

export function FiveDayStrip({
  days,
  selectedDay,
  onSelect,
  embedded = false,
}: {
  days: NonNullable<AssessResponse['days']>
  selectedDay: string | null
  onSelect: (day: string) => void
  embedded?: boolean
}) {
  if (!days.length) return null
  const body = (
    <>
      <h2
        id="fiveday-heading"
        className={embedded ? 'dash-section-label mb-2' : 'text-sm font-bold uppercase tracking-wide text-[var(--muted)]'}
      >
        5-day outlook
      </h2>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="list">
        {days.map((d) => {
          const active = selectedDay === d.day
          return (
            <button
              key={d.day}
              type="button"
              role="listitem"
              onClick={() => onSelect(d.day)}
              aria-pressed={active}
              className={`touch-target min-w-[5.5rem] shrink-0 rounded border px-2.5 py-2 text-left ${
                active
                  ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                  : 'border-[var(--border)] bg-[var(--panel)] hover:border-[var(--ink)]'
              }`}
            >
              <p className="text-[0.65rem] font-semibold opacity-80">{d.day.slice(5)}</p>
              <p className="mt-0.5 text-sm font-black">{d.worst_verdict}</p>
              <p className="mt-0.5 text-[0.65rem] opacity-80">{d.total_safe_hours.toFixed(1)}h safe</p>
            </button>
          )
        })}
      </div>
    </>
  )

  if (embedded) return <div>{body}</div>

  return (
    <section aria-labelledby="fiveday-heading" className="dash-panel p-4">
      {body}
    </section>
  )
}

export function ShiftPlanner({
  windows,
  requiredHours,
  onRequiredHours,
}: {
  windows: NonNullable<AssessResponse['shift_windows']>
  requiredHours: number
  onRequiredHours: (n: number) => void
}) {
  return (
    <section aria-labelledby="shift-heading">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="shift-heading" className="dash-section-label">
          Shift planner
        </h2>
        <label className="text-xs font-semibold">
          Hours
          <input
            type="number"
            min={1}
            max={12}
            value={requiredHours}
            onChange={(e) => onRequiredHours(Number(e.target.value) || 4)}
            className="ml-1.5 w-14 rounded border border-[var(--border)] bg-white px-2 py-1.5 text-sm touch-target"
          />
        </label>
      </div>
      {windows.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--muted)]">
          No contiguous window meets that requirement in the next 5 days.
        </p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {windows.map((w) => (
            <li
              key={w.label}
              className="rounded border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5 text-xs"
            >
              <span className="font-semibold">{w.label}</span>
              <span className="text-[var(--muted)]"> · rank {w.mean_rank.toFixed(2)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
