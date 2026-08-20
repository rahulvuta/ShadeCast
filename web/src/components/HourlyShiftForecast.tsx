import type { HourlyAssessment, Verdict } from '../types'

function fmtHour(h: number): string {
  const period = h % 24 < 12 ? 'AM' : 'PM'
  const hour12 = h % 12 || 12
  return `${hour12}:00 ${period}`
}

function heatF(c: number | null | undefined, hi: number | null | undefined): string {
  if (hi != null) return `${Math.round(hi)} F HI`
  if (c == null) return '—'
  return `${Math.round((c * 9) / 5 + 32)} F`
}

const VERDICT_CLASS: Record<string, string> = {
  GO: 'text-[var(--go)]',
  CAUTION: 'text-[var(--caution)]',
  RESTRICT: 'text-[var(--restrict)]',
  STOP: 'text-[var(--stop)]',
}

export function HourlyShiftForecast({
  hours,
  textMode,
}: {
  hours: HourlyAssessment[]
  textMode: boolean
}) {
  if (hours.length === 0) {
    return (
      <section className="dash-panel p-3.5">
        <h2 className="dash-section-label">Shift hour forecast</h2>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Select a recommended window or enter a custom shift to see hour-by-hour conditions.
        </p>
      </section>
    )
  }

  return (
    <section className="dash-panel p-3.5" aria-labelledby="shift-hours-heading">
      <h2 id="shift-hours-heading" className="dash-section-label">
        Shift hour forecast
      </h2>
      <p className="mt-1 text-[0.65rem] text-[var(--muted)]">
        Weather from NWS when available, otherwise Open-Meteo. Humidity is low / moderate / high.
      </p>
      {textMode ? (
        <ul className="mt-2 space-y-1 text-xs">
          {hours.map((h) => (
            <li key={`${h.day}-${h.hour}`}>
              {h.day} {fmtHour(h.hour)} · {h.weather_text ?? '—'} · {heatF(h.temperature_c, h.heat_index_f)}{' '}
              · RH {h.humidity_band ?? '—'} · UV {h.uv_index ?? '—'} · AQI {h.us_aqi ?? '—'} · {h.verdict}{' '}
              · {h.work_minutes} min work / {h.rest_minutes} rest
              {h.precaution ? ` · ${h.precaution}` : ''}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-[0.65rem] uppercase tracking-wide text-[var(--muted)]">
                <th className="py-1.5 pr-2 font-semibold">Time</th>
                <th className="py-1.5 pr-2 font-semibold">Weather</th>
                <th className="py-1.5 pr-2 font-semibold">Heat / RH</th>
                <th className="py-1.5 pr-2 font-semibold">UV</th>
                <th className="py-1.5 pr-2 font-semibold">Air</th>
                <th className="py-1.5 pr-2 font-semibold">Wind</th>
                <th className="py-1.5 pr-2 font-semibold">Rating</th>
                <th className="py-1.5 pr-2 font-semibold">Safe min</th>
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={`${h.day}-${h.hour}`} className="border-b border-[var(--border)]/70">
                  <td className="py-1.5 pr-2 whitespace-nowrap font-semibold">
                    {fmtHour(h.hour)}
                    <span className="block text-[0.6rem] font-normal text-[var(--muted)]">{h.day}</span>
                  </td>
                  <td className="py-1.5 pr-2">
                    {h.weather_text ?? '—'}
                    {h.precaution ? (
                      <span className="mt-0.5 block text-[0.6rem] font-semibold text-[var(--stop)]">
                        {h.precaution}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {heatF(h.temperature_c, h.heat_index_f)}
                    <span className="block text-[0.6rem] text-[var(--muted)]">
                      RH {h.humidity_band ?? '—'}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums">{h.uv_index != null ? h.uv_index.toFixed(0) : '—'}</td>
                  <td className="py-1.5 pr-2 tabular-nums">
                    {h.us_aqi != null ? `AQI ${Math.round(h.us_aqi)}` : '—'}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap">
                    {h.wind_speed_kmh != null ? `${Math.round(h.wind_speed_kmh)} km/h` : '—'}
                    {h.wind_gusts_kmh != null ? (
                      <span className="block text-[0.6rem] text-[var(--muted)]">
                        gust {Math.round(h.wind_gusts_kmh)}
                      </span>
                    ) : null}
                  </td>
                  <td className={`py-1.5 pr-2 font-bold ${VERDICT_CLASS[h.verdict] ?? ''}`}>
                    {h.verdict as Verdict}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap">
                    {h.work_minutes} / {h.rest_minutes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
