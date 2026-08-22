import { useEffect, useRef, useState } from 'react'
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

type QualityTone = ReturnType<typeof windowQuality>['tone']

const QUALITY_CLASS: Record<QualityTone, string> = {
  go: 'border-[var(--go)]/35 bg-[var(--go-bg)] text-[var(--go)]',
  caution: 'border-[var(--caution)]/40 bg-[var(--caution-bg)] text-[var(--caution)]',
  restrict: 'border-[var(--restrict)]/35 bg-[var(--restrict-bg)] text-[var(--restrict)]',
  marginal: 'border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]',
}

const QUALITY_RAIL: Record<QualityTone, string> = {
  go: 'bg-[var(--go)]',
  caution: 'bg-[var(--caution)]',
  restrict: 'bg-[var(--restrict)]',
  marginal: 'bg-[var(--muted)]',
}

const QUALITY_WASH: Record<QualityTone, string> = {
  go: 'border-[var(--go)] bg-[var(--go-bg)]',
  caution: 'border-[var(--caution)] bg-[var(--caution-bg)]',
  restrict: 'border-[var(--restrict)] bg-[var(--restrict-bg)]',
  marginal: 'border-[var(--ink)] bg-[var(--panel)]',
}

const DAYPART_CHIP: Record<string, string> = {
  overnight: 'border-[var(--border)] bg-[var(--chip-bg)] text-[var(--muted)]',
  morning: 'border-[color-mix(in_srgb,var(--oi-sky)_40%,var(--border))] bg-[color-mix(in_srgb,var(--oi-sky)_18%,transparent)] text-[var(--oi-sky)]',
  afternoon:
    'border-[color-mix(in_srgb,var(--oi-yellow)_50%,var(--border))] bg-[var(--oi-yellow)] text-[#111111]',
  evening:
    'border-[color-mix(in_srgb,var(--restrict)_40%,var(--border))] bg-[var(--restrict-bg)] text-[var(--restrict)]',
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

const VERDICT_PILL: Record<string, string> = {
  GO: 'border-[var(--go)]/40 bg-[var(--go-bg)] text-[var(--go)]',
  CAUTION: 'border-[var(--caution)]/40 bg-[var(--caution-bg)] text-[var(--caution)]',
  RESTRICT: 'border-[var(--restrict)]/40 bg-[var(--restrict-bg)] text-[var(--restrict)]',
  STOP: 'border-[var(--stop)]/40 bg-[var(--stop-bg)] text-[var(--stop)]',
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
    <section aria-label="Five-day horizon" className="dash-panel p-3.5">
      <p className="dash-section-label mb-1.5">5-day horizon</p>
      <p className="mb-2 text-[0.65rem] text-[var(--muted)]">
        Air-quality forecast ends at 5 days. Selecting a day filters the timeline and risk clock.
      </p>
      <ul className="flex gap-1.5 overflow-x-auto pb-1">
        {days.map((d) => {
          const active = d.day === selectedDay
          const tone = VERDICT_PILL[d.worst_verdict] ?? 'border-[var(--border)] bg-[var(--panel)]'
          return (
            <li key={d.day} className="shrink-0">
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(d.day)}
                className={`touch-target min-w-[6.5rem] rounded border px-2.5 py-2 text-left ${tone} ${
                  active ? 'ring-2 ring-[var(--ink)]' : ''
                }`}
              >
                <span className="block text-[0.65rem] font-semibold">{formatDayLabel(d.day)}</span>
                <span className="mt-0.5 block text-sm font-black">{d.worst_verdict}</span>
                <span className="block text-[0.65rem] opacity-80">
                  {d.total_safe_hours.toFixed(0)}h safe
                </span>
              </button>
            </li>
          )
        })}
      </ul>
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
  const [draft, setDraft] = useState(String(hours))
  const hoursRef = useRef(hours)

  useEffect(() => {
    hoursRef.current = hours
    setDraft(String(hours))
  }, [hours])

  function commitHours(n: number) {
    const next = Math.min(12, Math.max(1, Math.round(n)))
    if (next === hoursRef.current) {
      setDraft(String(next))
      return
    }
    hoursRef.current = next
    setDraft(String(next))
    onRequiredHours(next)
  }

  function stepHours(delta: number) {
    commitHours(hoursRef.current + delta)
  }

  function commitDraft() {
    const parsed = Number.parseInt(draft, 10)
    commitHours(Number.isFinite(parsed) ? parsed : hours)
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
        <div className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--chip-bg)] p-0.5">
          <span className="px-2 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Block
          </span>
          <button
            type="button"
            onClick={() => stepHours(-1)}
            disabled={hours <= 1}
            aria-label="Shorter block"
            className="touch-target flex h-8 w-8 items-center justify-center rounded text-sm font-bold disabled:opacity-40"
          >
            −
          </button>
          <label className="flex min-w-[3.25rem] items-center justify-center gap-0.5">
            <span className="sr-only">Shift length in hours</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={12}
              step={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.currentTarget as HTMLInputElement).blur()
                }
              }}
              className="w-8 bg-transparent text-center text-sm font-bold tabular-nums text-[var(--ink)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              aria-live="polite"
            />
            <span className="text-sm font-bold" aria-hidden>
              h
            </span>
          </label>
          <button
            type="button"
            onClick={() => stepHours(1)}
            disabled={hours >= 12}
            aria-label="Longer block"
            className="touch-target flex h-8 w-8 items-center justify-center rounded text-sm font-bold disabled:opacity-40"
          >
            +
          </button>
          {refreshing && <span className="loading-spinner loading-spinner-sm mr-1" aria-hidden />}
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
                const daypartId = w.daypart || daypartFromHour(w.start_hour)
                return (
                  <li key={`${w.day}-${w.start_hour}-${w.end_hour}`}>
                    <button
                      type="button"
                      className={`flex w-full overflow-hidden rounded-md border text-left text-[var(--ink)] ${
                        active
                          ? QUALITY_WASH[quality.tone]
                          : 'border-[var(--border)] bg-[var(--panel)] hover:border-[var(--ink)]'
                      }`}
                      onClick={() => onSelect?.(key)}
                      aria-pressed={active}
                    >
                      <span
                        className={`w-1 shrink-0 ${QUALITY_RAIL[quality.tone]} ${active ? '' : 'opacity-45'}`}
                        aria-hidden
                      />
                      <div className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5">
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
                            <span
                              className={`rounded border px-2 py-0.5 text-[0.65rem] font-semibold ${DAYPART_CHIP[daypartId] ?? DAYPART_CHIP.overnight}`}
                            >
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
