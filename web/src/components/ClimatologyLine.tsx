export function ClimatologyLine({
  message,
  note,
  todayTemp,
  baseline,
  delta,
}: {
  message: string
  note: string
  todayTemp?: number | null
  baseline?: number | null
  delta?: number | null
}) {
  return (
    <section aria-labelledby="clim-heading" className="dash-panel flex h-full flex-col p-3.5 sm:p-4">
      <p className="dash-section-label">Climatology & trends</p>
      <h2 id="clim-heading" className="text-sm font-bold mt-0.5">
        Today vs NASA POWER
      </h2>
      {(todayTemp != null || baseline != null || delta != null) && (
        <p className="mt-2 text-xs text-[var(--muted)] tabular-nums">
          {todayTemp != null && <span>Today {todayTemp.toFixed(1)}°C</span>}
          {baseline != null && <span> · Baseline {baseline.toFixed(1)}°C</span>}
          {delta != null && (
            <span>
              {' '}
              · Δ {delta >= 0 ? '+' : ''}
              {delta.toFixed(1)}°C
            </span>
          )}
        </p>
      )}
      <p className="mt-3 text-base font-semibold leading-snug flex-1">{message}</p>
      <p className="mt-3 text-[0.7rem] text-[var(--muted)] leading-relaxed">{note}</p>
    </section>
  )
}
