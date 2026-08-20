import type { AssessResponse } from '../types'

function formatExpiry(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function StormAlertBanner({
  storm,
  alerts,
}: {
  storm: AssessResponse['storm']
  alerts: NonNullable<AssessResponse['active_alerts']>
}) {
  const warnings = alerts.filter((a) => a.is_warning)
  if (warnings.length === 0 && !storm?.hard_stop) return null
  const primary =
    warnings.find((a) => /tornado warning|severe thunderstorm warning/i.test(a.event)) ??
    warnings[0]
  if (!primary && !storm?.hard_stop) return null

  const event =
    primary?.event ??
    storm?.headline_event ??
    storm?.headline_quote ??
    (storm?.source === 'open-meteo' ? 'Model thunderstorm / heavy rain' : 'Official warning')
  const headline = primary?.headline ?? storm?.headline_quote
  const expires = formatExpiry(primary?.expires)
  const href = primary?.web

  return (
    <aside
      role="alert"
      aria-live="assertive"
      className="rounded border-4 border-[var(--stop)] bg-[var(--stop-bg)] px-4 py-3 text-[var(--ink)]"
    >
      <p className="text-[0.65rem] font-bold uppercase tracking-wide text-[var(--stop)]">
        {storm?.source === 'open-meteo' ? 'Model storm (Open-Meteo)' : 'Official NWS warning'}
      </p>
      <p className="mt-1 text-lg font-black tracking-tight">{event}</p>
      {headline && <p className="mt-1 text-sm leading-snug">{headline}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {expires && <span>Expires {expires}</span>}
        {href && (
          <a
            className="touch-target inline-flex items-center font-semibold underline"
            href={href}
            target="_blank"
            rel="noreferrer"
          >
            Full NWS alert
          </a>
        )}
      </div>
    </aside>
  )
}
