import type { AssessResponse } from '../types'

function formatExpiry(
  iso: string | null | undefined,
  siteValidAt: string | null | undefined,
): { label: string; note: string } | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { label: iso, note: '' }
  const offset = siteValidAt?.match(/([+-]\d{2}:\d{2}|Z)$/)?.[1]
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }
  if (offset) {
    const note = offset === 'Z' ? 'site local time (UTC)' : `site local time (UTC${offset})`
    return { label: d.toLocaleString(undefined, opts), note }
  }
  return { label: d.toLocaleString(undefined, opts), note: 'browser local time' }
}

function isStopFloor(
  storm: AssessResponse['storm'],
  primary: NonNullable<AssessResponse['active_alerts']>[number] | undefined,
): boolean {
  if (storm?.hard_stop) return true
  if (primary && /tornado warning|severe thunderstorm warning/i.test(primary.event)) return true
  return false
}

export function StormAlertBanner({
  storm,
  alerts,
  siteValidAt = null,
}: {
  storm: AssessResponse['storm']
  alerts: NonNullable<AssessResponse['active_alerts']>
  siteValidAt?: string | null
}) {
  const warnings = alerts.filter((a) => a.is_warning)
  if (warnings.length === 0 && !storm?.hard_stop) return null
  const primary =
    warnings.find((a) => /tornado warning|severe thunderstorm warning/i.test(a.event)) ??
    warnings[0]
  if (!primary && !storm?.hard_stop) return null

  const stop = isStopFloor(storm, primary)
  const event =
    primary?.event ??
    storm?.headline_event ??
    storm?.headline_quote ??
    (storm?.source === 'open-meteo' ? 'Model thunderstorm / heavy rain' : 'Official warning')
  const headline = primary?.headline ?? storm?.headline_quote
  const expires = formatExpiry(primary?.expires, siteValidAt)
  const href = primary?.web
  const chrome = stop
    ? 'border-[var(--stop)] bg-[var(--stop-bg)]'
    : 'border-[var(--restrict)] bg-[var(--restrict-bg)]'
  const labelTone = stop ? 'text-[var(--stop)]' : 'text-[var(--restrict)]'

  return (
    <aside
      role="alert"
      aria-live="assertive"
      className={`rounded border-4 px-4 py-3 text-[var(--ink)] ${chrome}`}
    >
      <p className={`text-[0.65rem] font-bold uppercase tracking-wide ${labelTone}`}>
        {storm?.source === 'open-meteo'
          ? 'Open-Meteo model — not an official warning'
          : 'Official NWS warning'}
      </p>
      <p className="mt-1 text-lg font-black tracking-tight">{event}</p>
      {headline && <p className="mt-1 text-sm leading-snug">{headline}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {expires && (
          <span>
            Expires {expires.label} ({expires.note})
          </span>
        )}
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
