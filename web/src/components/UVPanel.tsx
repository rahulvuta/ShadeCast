import type { AssessResponse } from '../types'

export function UVPanel({ uv }: { uv: NonNullable<AssessResponse['uv']> }) {
  return (
    <section aria-labelledby="uv-heading" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 id="uv-heading" className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
        UV
      </h2>
      <p className="mt-2 text-3xl font-black tabular-nums">
        {uv.daily_max.toFixed(1)} <span className="text-base font-semibold">{uv.band}</span>
      </p>
      <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
        {uv.clear_sky_max != null && <li>Clear-sky ceiling {uv.clear_sky_max.toFixed(1)}</li>}
        {uv.peak_hour != null && <li>Peak hour (forecast) {String(uv.peak_hour).padStart(2, '0')}:00</li>}
        {uv.minutes_to_burn != null && (
          <li>
            ~{uv.minutes_to_burn.toFixed(0)} min to burn unprotected (Fitzpatrick skin type{' '}
            {uv.skin_type ?? 3} assumed)
          </li>
        )}
      </ul>
      {uv.note && <p className="mt-2 text-xs text-[var(--muted)]">{uv.note}</p>}
    </section>
  )
}
