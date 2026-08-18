import type { AssessResponse } from '../types'

export function NwsStatusBanner({ status }: { status: AssessResponse['nws_status'] }) {
  if (!status) return null
  const active = status.state === 'active'
  return (
    <aside
      role="status"
      className={`rounded border px-3.5 py-2 text-sm ${
        active
          ? 'border-[var(--oi-sky)]/50 bg-[var(--panel)] text-[var(--ink)]'
          : 'border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]'
      }`}
    >
      <p className="font-semibold">{status.message}</p>
      {active && (status.alert_count ?? 0) > 0 && (
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {status.alert_count} official NWS alert{status.alert_count === 1 ? '' : 's'} for this
          point. Near-term numbers use {status.current_temp_source === 'nws' ? 'NWS' : 'Open-Meteo'}{' '}
          temperature
          {(status.near_term_overridden_hours ?? 0) > 0
            ? ` (${status.near_term_overridden_hours} hour${status.near_term_overridden_hours === 1 ? '' : 's'} overridden).`
            : '.'}
        </p>
      )}
    </aside>
  )
}
