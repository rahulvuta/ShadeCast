import type { AssessResponse } from '../types'
import type { SelectedShift } from '../lib/shiftWindow'
import { selectedKey, shiftBounds } from '../lib/shiftWindow'

type ShiftWindow = NonNullable<AssessResponse['shift_windows']>[number]

function formatHour12(hour: number): string {
  const h = hour % 24
  const period = h < 12 ? 'AM' : 'PM'
  const hour12 = h % 12 || 12
  return `${hour12}:00 ${period}`
}

function formatDayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatWindow(w: ShiftWindow): { dayLabel: string; timeRange: string } {
  const dayLabel = formatDayLabel(w.day)
  const spansNextDay = w.end_hour <= w.start_hour
  const timeRange = spansNextDay
    ? `${formatHour12(w.start_hour)} – ${formatHour12(w.end_hour)} (next day)`
    : `${formatHour12(w.start_hour)} – ${formatHour12(w.end_hour)}`
  return { dayLabel, timeRange }
}

function daypartFromHour(hour: number): string {
  const h = hour % 24
  if (h >= 6 && h <= 11) return 'morning'
  if (h >= 12 && h <= 15) return 'afternoon'
  if (h >= 16 && h <= 20) return 'evening'
  return 'overnight'
}

const DAYPART_LABEL: Record<string, string> = {
  overnight: 'Overnight',
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
}

function daypartLabel(w: ShiftWindow): string {
  const id = w.daypart || daypartFromHour(w.start_hour)
  return DAYPART_LABEL[id] ?? id
}

function windowQuality(meanRank: number): { label: string; tone: 'go' | 'caution' | 'restrict' | 'marginal' } {
  if (meanRank < 0.25) return { label: 'All GO', tone: 'go' }
  if (meanRank < 0.75) return { label: 'Mostly GO', tone: 'go' }
  if (meanRank < 1.25) return { label: 'Caution mix', tone: 'caution' }
  if (meanRank < 2) return { label: 'Some restrictions', tone: 'restrict' }
  return { label: 'Marginal', tone: 'marginal' }
}

const QUALITY_CLASS: Record<ReturnType<typeof windowQuality>['tone'], string> = {
  go: 'border-[var(--go)]/35 bg-[var(--go-bg)] text-[var(--go)]',
  caution: 'border-[var(--caution)]/40 bg-[var(--caution-bg)] text-[var(--caution)]',
  restrict: 'border-[var(--restrict)]/35 bg-[var(--restrict-bg)] text-[var(--restrict)]',
  marginal: 'border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]',
}

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
                  ? 'btn-selected'
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

function customSeed(
  selected: SelectedShift | null,
  days: string[],
  fallbackHours: number,
): { day: string; startHour: number; duration: number } {
  const day = selected?.day ?? days[0] ?? ''
  const startHour = selected?.startHour ?? 6
  const duration = selected ? Math.min(12, shiftBounds(selected).duration) : fallbackHours
  return { day, startHour, duration }
}

function CustomShiftFields({
  days,
  hours,
  selected,
  onSelect,
}: {
  days: string[]
  hours: number
  selected: SelectedShift | null
  onSelect: (sel: SelectedShift) => void
}) {
  const seed = customSeed(selected, days, hours)
  return (
    <div className="mt-3 rounded border border-[var(--border)] bg-[var(--panel)] p-2.5">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Custom shift
      </p>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <label className="block text-[0.65rem] font-semibold">
          Day
          <select
            className="touch-target mt-1 w-full rounded border border-[var(--border)] bg-[var(--input-bg)] px-1.5 text-xs"
            value={seed.day}
            onChange={(e) =>
              onSelect({
                kind: 'custom',
                day: e.target.value,
                startHour: seed.startHour,
                duration: seed.duration,
              })
            }
          >
            {days.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[0.65rem] font-semibold">
          Start
          <select
            className="touch-target mt-1 w-full rounded border border-[var(--border)] bg-[var(--input-bg)] px-1.5 text-xs"
            value={seed.startHour}
            onChange={(e) =>
              onSelect({
                kind: 'custom',
                day: seed.day,
                startHour: Number(e.target.value),
                duration: seed.duration,
              })
            }
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {formatHour12(h)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[0.65rem] font-semibold">
          Hours
          <select
            className="touch-target mt-1 w-full rounded border border-[var(--border)] bg-[var(--input-bg)] px-1.5 text-xs"
            value={seed.duration}
            onChange={(e) =>
              onSelect({
                kind: 'custom',
                day: seed.day,
                startHour: seed.startHour,
                duration: Number(e.target.value),
              })
            }
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}h
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

export function ShiftPlanner({
  windows,
  requiredHours,
  onRequiredHours,
  refreshing = false,
  selected = null,
  onSelect,
  days = [],
}: {
  windows: NonNullable<AssessResponse['shift_windows']>
  requiredHours: number
  onRequiredHours: (n: number) => void
  refreshing?: boolean
  selected?: SelectedShift | null
  onSelect?: (sel: SelectedShift) => void
  days?: string[]
}) {
  const hours = Math.min(12, Math.max(1, requiredHours))

  function stepHours(delta: number) {
    onRequiredHours(Math.min(12, Math.max(1, hours + delta)))
  }

  return (
    <section aria-labelledby="shift-heading" aria-busy={refreshing}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="shift-heading" className="dash-section-label">
            Shift planner
          </h2>
          <p className="mt-1 text-xs leading-snug text-[var(--muted)]">
            Best block per time of day when conditions allow.
          </p>
        </div>
        <div
          className={`flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--chip-bg)] p-0.5 transition-opacity ${refreshing ? 'opacity-70' : ''}`}
        >
          <span className="px-2 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Block
          </span>
          <button
            type="button"
            onClick={() => stepHours(-1)}
            disabled={hours <= 1 || refreshing}
            aria-label="Shorter block"
            className="touch-target flex h-8 w-8 items-center justify-center rounded text-sm font-bold disabled:opacity-40"
          >
            −
          </button>
          <span
            className="flex min-w-[2rem] items-center justify-center gap-1.5 text-center text-sm font-bold tabular-nums"
            aria-live="polite"
          >
            {refreshing && <span className="loading-spinner loading-spinner-sm" aria-hidden />}
            {hours}h
          </span>
          <button
            type="button"
            onClick={() => stepHours(1)}
            disabled={hours >= 12 || refreshing}
            aria-label="Longer block"
            className="touch-target flex h-8 w-8 items-center justify-center rounded text-sm font-bold disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      <div className="relative mt-3">
        {refreshing && (
          <div
            className="shift-refresh-overlay"
            role="status"
            aria-live="polite"
          >
            <span className="loading-spinner" aria-hidden />
            <span>Updating shift plan…</span>
          </div>
        )}

        <div className={refreshing ? 'pointer-events-none opacity-45' : undefined}>
          {windows.length === 0 ? (
            <p className="rounded border border-dashed border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 text-xs text-[var(--muted)]">
              No {hours}-hour window fits in the next 5 days without a hard stop.
            </p>
          ) : (
            <ol className="space-y-2">
              {windows.map((w, index) => {
                const { dayLabel, timeRange } = formatWindow(w)
                const quality = windowQuality(w.mean_rank)
                const key: SelectedShift = {
                  kind: 'plan',
                  day: w.day,
                  startHour: w.start_hour,
                  endHour: w.end_hour,
                }
                const active = selected != null && selectedKey(selected) === selectedKey(key)
                return (
                  <li key={`${w.day}-${w.start_hour}-${w.end_hour}`}>
                    <button
                      type="button"
                      className={`w-full rounded-md border px-3 py-2.5 text-left ${
                        active
                          ? 'btn-selected border-[var(--ink)]'
                          : 'border-[var(--border)] bg-[var(--panel)] hover:border-[var(--ink)]'
                      }`}
                      onClick={() => onSelect?.(key)}
                      aria-pressed={active}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className="btn-selected mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-bold"
                          aria-hidden
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-[var(--muted)]">{dayLabel}</p>
                          <p className="mt-0.5 text-sm font-bold tracking-tight text-[var(--ink)]">{timeRange}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="rounded border border-[var(--border)] bg-[var(--chip-bg)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--muted)]">
                              {daypartLabel(w)}
                            </span>
                            <span className="rounded border border-[var(--border)] bg-[var(--chip-bg)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--muted)]">
                              {w.required_hours}h block
                            </span>
                            <span
                              className={`rounded border px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ${QUALITY_CLASS[quality.tone]}`}
                            >
                              {quality.label}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
          {days.length > 0 && onSelect && (
            <CustomShiftFields
              days={days}
              hours={hours}
              selected={selected}
              onSelect={onSelect}
            />
          )}
        </div>
      </div>
    </section>
  )
}
