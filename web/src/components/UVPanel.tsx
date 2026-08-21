import type { AssessResponse } from '../types'

type UvTone = { rail: string; chip: string; meter: string }

const UV_TONE: Record<string, UvTone> = {
  LOW: {
    rail: 'bg-[var(--go)]',
    chip: 'bg-[var(--go-bg)] text-[var(--go)]',
    meter: 'bg-[var(--go)]',
  },
  MODERATE: {
    rail: 'bg-[var(--oi-yellow)]',
    chip: 'bg-[var(--oi-yellow)] text-[#111111]',
    meter: 'bg-[var(--oi-yellow)]',
  },
  HIGH: {
    rail: 'bg-[var(--caution)]',
    chip: 'bg-[var(--caution-bg)] text-[var(--caution)]',
    meter: 'bg-[var(--caution)]',
  },
  VERY_HIGH: {
    rail: 'bg-[var(--restrict)]',
    chip: 'bg-[var(--restrict-bg)] text-[var(--restrict)]',
    meter: 'bg-[var(--restrict)]',
  },
  EXTREME: {
    rail: 'bg-[var(--restrict)]',
    chip: 'bg-[var(--restrict-bg)] text-[var(--restrict)]',
    meter: 'bg-[var(--restrict)]',
  },
}

const FALLBACK_TONE: UvTone = {
  rail: 'bg-[var(--muted)]',
  chip: 'bg-[var(--chip-bg)] text-[var(--ink)]',
  meter: 'bg-[var(--muted)]',
}

function uvMeterPct(value: number): number {
  return Math.max(2, Math.min(100, (value / 12) * 100))
}

export function UVPanel({ uv }: { uv: NonNullable<AssessResponse['uv']> }) {
  const tone = UV_TONE[uv.band] ?? FALLBACK_TONE
  const stats = [
    uv.clear_sky_max != null ? { label: 'Clear-sky', value: uv.clear_sky_max.toFixed(1) } : null,
    uv.peak_hour != null
      ? { label: 'Peak', value: `${String(uv.peak_hour).padStart(2, '0')}:00` }
      : null,
    uv.minutes_to_burn != null
      ? { label: `Burn (type ${uv.skin_type ?? 3})`, value: `~${uv.minutes_to_burn.toFixed(0)} min` }
      : null,
  ].filter((s): s is { label: string; value: string } => s != null)

  return (
    <section aria-labelledby="uv-heading" className="dash-panel overflow-hidden p-0">
      <div className="flex">
        <span className={`w-1 shrink-0 ${tone.rail}`} aria-hidden />
        <div className="min-w-0 flex-1 p-3.5">
          <h2 id="uv-heading" className="dash-section-label">
            UV
          </h2>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-black tabular-nums tracking-tight">{uv.daily_max.toFixed(1)}</span>
            <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-bold tracking-wide ${tone.chip}`}>
              {uv.band.replaceAll('_', ' ')}
            </span>
          </p>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--chip-bg)]"
            role="meter"
            aria-label={`UV index ${uv.daily_max.toFixed(1)} of 12`}
            aria-valuemin={0}
            aria-valuemax={12}
            aria-valuenow={Number(uv.daily_max.toFixed(1))}
          >
            <span className={`block h-full ${tone.meter}`} style={{ width: `${uvMeterPct(uv.daily_max)}%` }} />
          </div>
          {stats.length > 0 && (
            <dl
              className={`mt-2.5 grid gap-2 ${
                stats.length === 3 ? 'grid-cols-3' : stats.length === 2 ? 'grid-cols-2' : 'grid-cols-1'
              }`}
            >
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    {s.label}
                  </dt>
                  <dd className="mt-0.5 text-xs font-bold tabular-nums text-[var(--ink)]">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {uv.note && <p className="mt-2 text-[0.65rem] leading-relaxed text-[var(--muted)]">{uv.note}</p>}
        </div>
      </div>
    </section>
  )
}
