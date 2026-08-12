import { useMemo, useState, type CSSProperties } from 'react'
import type { AssessResponse, Verdict } from '../types'
import { HourlyChart } from './HourlyChart'
import { verdictPalette } from '../design/tokens'
import { usePrefersReducedMotion } from '../design/usePrefersReducedMotion'

const VERDICT_COLOR: Record<string, string> = {
  GO: verdictPalette.GO.base,
  CAUTION: verdictPalette.CAUTION.base,
  RESTRICT: verdictPalette.RESTRICT.base,
  STOP: verdictPalette.STOP.base,
}

/** Parse "13:00–17:00" or "13:00-17:00" into hour range [start, endExclusive). */
export function parseWindowHours(window: string | null | undefined): [number, number] | null {
  if (!window) return null
  const m = window.match(/(\d{1,2}):(\d{2})\s*[–\-]\s*(\d{1,2}):(\d{2})/)
  if (!m) return null
  const start = Number(m[1])
  const end = Number(m[3])
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return [start, end === start ? start + 1 : end]
}

function hourAngle(hour: number): number {
  // 0 at top (midnight), clockwise
  return (hour / 24) * 360 - 90
}

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function arcPath(cx: number, cy: number, r: number, startHour: number, endHour: number): string {
  const startA = hourAngle(startHour)
  const endA = hourAngle(endHour)
  const [x1, y1] = polar(cx, cy, r, startA)
  const [x2, y2] = polar(cx, cy, r, endA)
  let sweep = endA - startA
  if (sweep < 0) sweep += 360
  const large = sweep > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}

function sectorPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startHour: number,
  endHour: number,
): string {
  const startA = hourAngle(startHour)
  const endA = hourAngle(endHour)
  const [x1, y1] = polar(cx, cy, rOuter, startA)
  const [x2, y2] = polar(cx, cy, rOuter, endA)
  const [x3, y3] = polar(cx, cy, rInner, endA)
  const [x4, y4] = polar(cx, cy, rInner, startA)
  let sweep = endA - startA
  if (sweep < 0) sweep += 360
  const large = sweep > 180 ? 1 : 0
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ')
}

export function RiskClock({
  hourly,
  hardStop,
  bestWork,
  currentHour,
  embedded = false,
}: {
  hourly: AssessResponse['hourly']
  hardStop?: string | null
  bestWork?: string | null
  currentHour?: number | null
  embedded?: boolean
}) {
  const [mode, setMode] = useState<'clock' | 'bars'>('clock')
  const reducedMotion = usePrefersReducedMotion()

  const todayHours = useMemo(() => {
    const byHour = new Map<number, Verdict>()
    for (const h of hourly) {
      // Prefer today's is_current day cluster: take first 24 unique hours in order
      if (!byHour.has(h.hour)) byHour.set(h.hour, h.verdict)
    }
    // Build full 24 from available; fill missing as GO lightly
    const out: { hour: number; verdict: Verdict }[] = []
    for (let h = 0; h < 24; h++) {
      out.push({ hour: h, verdict: byHour.get(h) ?? 'GO' })
    }
    return out
  }, [hourly])

  const needleHour =
    currentHour ??
    hourly.find((h) => h.is_current)?.hour ??
    new Date().getHours()

  const hard = parseWindowHours(hardStop)
  const best = parseWindowHours(bestWork)

  const size = 280
  const cx = size / 2
  const cy = size / 2
  const rOuter = 118
  const rInner = 78
  const needleRotate = `${hourAngle(needleHour + 0.5) + 90}deg`

  const clock = (
    <div className="flex flex-col items-center gap-3 motion-panel-enter">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`24-hour risk clock. Current hour ${needleHour}. Hard-stop ${hardStop ?? 'none'}. Best work ${bestWork ?? 'n/a'}.`}
      >
        <circle cx={cx} cy={cy} r={rOuter + 4} fill="var(--panel)" stroke="var(--border)" />
        {todayHours.map(({ hour, verdict }) => (
          <path
            key={hour}
            d={sectorPath(cx, cy, rInner, rOuter, hour, hour + 1)}
            fill={VERDICT_COLOR[verdict] ?? '#5A6570'}
            opacity={reducedMotion ? 0.85 : undefined}
            className={reducedMotion ? undefined : 'motion-clock-sector'}
            style={
              reducedMotion
                ? undefined
                : ({ ['--motion-delay' as string]: `${hour * 22}ms` } as CSSProperties)
            }
          >
            <title>{`${String(hour).padStart(2, '0')}:00 — ${verdict}`}</title>
          </path>
        ))}
        {hard && (
          <path
            d={sectorPath(cx, cy, rInner - 6, rOuter + 2, hard[0], hard[1])}
            fill="none"
            stroke="#000"
            strokeWidth={3}
            strokeDasharray="4 3"
            opacity={reducedMotion ? 0.7 : undefined}
            className={reducedMotion ? undefined : 'motion-clock-ring'}
          />
        )}
        {best && (
          <path
            d={arcPath(cx, cy, rInner - 14, best[0], best[1])}
            fill="none"
            stroke="#009E73"
            strokeWidth={5}
            strokeLinecap="round"
            pathLength={100}
            className={reducedMotion ? undefined : 'motion-clock-arc'}
          />
        )}
        <g
          transform={
            reducedMotion
              ? `translate(${cx} ${cy}) rotate(${hourAngle(needleHour + 0.5) + 90})`
              : `translate(${cx} ${cy})`
          }
          className={reducedMotion ? undefined : 'motion-clock-needle'}
          style={
            reducedMotion
              ? undefined
              : ({ ['--needle-rotate' as string]: needleRotate } as CSSProperties)
          }
        >
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={-(rOuter - 8)}
            stroke="var(--ink)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <circle
            cx={0}
            cy={0}
            r={6}
            fill="var(--ink)"
            className={reducedMotion ? undefined : 'motion-clock-hub'}
          />
        </g>
        <text
          x={cx}
          y={cy + 28}
          textAnchor="middle"
          className="fill-[var(--muted)]"
          style={{ fontSize: 11, fontWeight: 600 }}
        >
          {String(needleHour).padStart(2, '0')}:00
        </text>
      </svg>
      <ul className="flex flex-wrap justify-center gap-3 type-micro text-[var(--muted)] normal-case tracking-normal font-normal">
        <li className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: VERDICT_COLOR.GO }} /> GO
        </li>
        <li className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: VERDICT_COLOR.CAUTION }} /> CAUTION
        </li>
        <li className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: VERDICT_COLOR.RESTRICT }} /> RESTRICT
        </li>
        <li className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: VERDICT_COLOR.STOP }} /> STOP
        </li>
      </ul>
      <p className="text-center text-[0.65rem] text-[var(--muted)]">
        Dashed ring = hard-stop window · green arc = best work window
      </p>
    </div>
  )

  const body = (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2
            id="risk-clock-heading"
            className={embedded ? 'dash-section-label !normal-case tracking-wide' : 'text-base font-bold'}
          >
            {mode === 'clock' ? '24-hour risk clock' : '24-hour risk severity'}
          </h2>
        </div>
        <div className="flex rounded border border-[var(--border)] bg-[var(--chip-bg)] p-0.5">
          <button
            type="button"
            className={`touch-target rounded px-3 text-xs font-semibold ${
              mode === 'clock' ? 'btn-selected' : ''
            }`}
            aria-pressed={mode === 'clock'}
            onClick={() => setMode('clock')}
          >
            Clock
          </button>
          <button
            type="button"
            className={`touch-target rounded px-3 text-xs font-semibold ${
              mode === 'bars' ? 'btn-selected' : ''
            }`}
            aria-pressed={mode === 'bars'}
            onClick={() => setMode('bars')}
          >
            Bars
          </button>
        </div>
      </div>
      {mode === 'clock' ? clock : <HourlyChart hourly={hourly} embedded />}
    </>
  )

  if (embedded) return <div>{body}</div>
  return (
    <section
      aria-labelledby="risk-clock-heading"
      className="dash-panel motion-panel-enter p-4 sm:p-5"
    >
      {body}
    </section>
  )
}
