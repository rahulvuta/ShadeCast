export function climBarPositions(
  today: number,
  baseline: number,
  pad = 2,
): { todayPct: number; baselinePct: number } {
  const lo = Math.min(today, baseline) - pad
  const hi = Math.max(today, baseline) + pad
  const span = hi - lo || 1
  const clamp = (n: number) => Math.min(100, Math.max(0, n))
  return {
    todayPct: clamp(((today - lo) / span) * 100),
    baselinePct: clamp(((baseline - lo) / span) * 100),
  }
}

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
  const hasBar = todayTemp != null && baseline != null
  const warmer = (delta ?? 0) > 0
  const cooler = (delta ?? 0) < 0
  const deltaColor = warmer
    ? 'text-[var(--restrict)]'
    : cooler
      ? 'text-[var(--oi-blue)]'
      : 'text-[var(--ink)]'
  const bar = hasBar ? climBarPositions(todayTemp, baseline) : null

  return (
    <section aria-labelledby="clim-heading" className="dash-panel flex h-full flex-col p-3.5 sm:p-4">
      <p className="dash-section-label">Climatology & trends</p>
      <h2 id="clim-heading" className="mt-0.5 text-sm font-bold">
        Today vs POWER baseline (POWER time is solar LST, not civil TZ)
      </h2>
      {delta != null && (
        <p className={`mt-3 text-3xl font-black tabular-nums tracking-tight ${deltaColor}`}>
          Δ {delta >= 0 ? '+' : ''}
          {delta.toFixed(1)}°C
        </p>
      )}
      {(todayTemp != null || baseline != null) && (
        <p className="mt-1 text-xs text-[var(--muted)] tabular-nums">
          {todayTemp != null && <span>Today {todayTemp.toFixed(1)}°C</span>}
          {baseline != null && <span> · Baseline {baseline.toFixed(1)}°C</span>}
        </p>
      )}
      {bar && (
        <div className="mt-3" aria-hidden>
          <div className="relative h-2 rounded-full bg-[var(--chip-bg)]">
            <span
              className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-[var(--muted)]"
              style={{ left: `${bar.baselinePct}%` }}
              title="Baseline"
            />
            <span
              className={`absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm ${
                warmer ? 'bg-[var(--restrict)]' : cooler ? 'bg-[var(--oi-blue)]' : 'bg-[var(--ink)]'
              }`}
              style={{ left: `${bar.todayPct}%` }}
              title="Today"
            />
          </div>
          <div className="mt-1 flex justify-between text-[0.6rem] text-[var(--muted)]">
            <span>Baseline</span>
            <span>Today</span>
          </div>
        </div>
      )}
      <p className="mt-3 flex-1 text-sm font-semibold leading-snug">{message}</p>
      <p className="mt-3 text-[0.7rem] leading-relaxed text-[var(--muted)]">{note}</p>
    </section>
  )
}
