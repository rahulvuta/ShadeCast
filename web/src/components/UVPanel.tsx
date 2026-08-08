import type { AssessResponse } from '../types'

export function UVPanel({ uv }: { uv: NonNullable<AssessResponse['uv']> }) {
  return (
    <section aria-labelledby="uv-heading" className="dash-panel p-3.5">
      <h2 id="uv-heading" className="dash-section-label">
        UV
      </h2>
      <p className="mt-1.5 text-2xl font-black tabular-nums">
        {uv.daily_max.toFixed(1)}{' '}
        <span className="text-sm font-semibold">{uv.band}</span>
      </p>
      <ul className="mt-1.5 space-y-0.5 text-xs text-[var(--muted)]">
        {uv.clear_sky_max != null && <li>Clear-sky {uv.clear_sky_max.toFixed(1)}</li>}
        {uv.peak_hour != null && (
          <li>Peak {String(uv.peak_hour).padStart(2, '0')}:00</li>
        )}
        {uv.minutes_to_burn != null && (
          <li>~{uv.minutes_to_burn.toFixed(0)} min to burn (skin type {uv.skin_type ?? 3})</li>
        )}
      </ul>
      {uv.note && <p className="mt-1.5 text-[0.65rem] text-[var(--muted)]">{uv.note}</p>}
    </section>
  )
}
