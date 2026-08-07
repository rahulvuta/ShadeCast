import type { AssessResponse } from '../types'

export function DiffStrip({ summary }: { summary?: string | null }) {
  if (!summary) return null
  return (
    <aside role="status" className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm">
      <span className="font-semibold">What changed: </span>
      {summary.replace(/^What changed:\s*/i, '')}
    </aside>
  )
}

export function FiveDayStrip({
  days,
  selectedDay,
  onSelect,
}: {
  days: NonNullable<AssessResponse['days']>
  selectedDay: string | null
  onSelect: (day: string) => void
}) {
  if (!days.length) return null
  return (
    <section aria-labelledby="fiveday-heading" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 id="fiveday-heading" className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
        5-day outlook
      </h2>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="list">
        {days.map((d) => {
          const active = selectedDay === d.day
          return (
            <button
              key={d.day}
              type="button"
              role="listitem"
              onClick={() => onSelect(d.day)}
              aria-pressed={active}
              className={`touch-target min-w-[7.5rem] shrink-0 rounded-xl border px-3 py-3 text-left ${
                active
                  ? 'border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]'
                  : 'border-[var(--border)] bg-[var(--bg)]'
              }`}
            >
              <p className="text-xs font-semibold opacity-80">{d.day.slice(5)}</p>
              <p className="mt-1 text-lg font-black">{d.worst_verdict}</p>
              <p className="mt-1 text-xs opacity-80">{d.total_safe_hours.toFixed(1)} safe hrs</p>
            </button>
          )
        })}
      </div>
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
    <section aria-labelledby="shift-heading" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="shift-heading" className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
          Shift planner
        </h2>
        <label className="text-sm">
          Required hours
          <input
            type="number"
            min={1}
            max={12}
            value={requiredHours}
            onChange={(e) => onRequiredHours(Number(e.target.value) || 4)}
            className="ml-2 w-16 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 touch-target"
          />
        </label>
      </div>
      {windows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">No contiguous window meets that requirement in the next 5 days.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {windows.map((w) => (
            <li key={w.label} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
              <span className="font-semibold">{w.label}</span>
              <span className="text-[var(--muted)]"> · rank {w.mean_rank.toFixed(2)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
