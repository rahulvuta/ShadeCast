export function HowWeCalculate() {
  return (
    <details>
      <summary className="dash-section-label touch-target cursor-pointer list-none flex items-center justify-between gap-2">
        How we calculate
        <span className="text-[0.65rem] font-normal normal-case tracking-normal text-[var(--muted)]">
          expand
        </span>
      </summary>
      <div className="mt-2 space-y-2 text-xs leading-relaxed text-[var(--muted)]">
        <p>
          <strong className="text-[var(--ink)]">Heat:</strong> NWS Rothfusz heat index with RH
          adjustments, workload/acclimatization shifts, and a +8°F full-sun screening penalty.
          Screening tool — not WBGT, not medical advice.
        </p>
        <p>
          <strong className="text-[var(--ink)]">Smoke:</strong> Satellite smoke pressure (0–100) from
          upwind NASA FIRMS, weighted by FRP and distance. Not measured PM2.5; never shown as AQI.
        </p>
        <p>
          <strong className="text-[var(--ink)]">Compound:</strong> Explicit GO / CAUTION / RESTRICT /
          STOP matrix with superadditive heat+smoke escalation. UV shortens exposure with elevated
          heat; AQI can escalate the verdict.
        </p>
        <p>
          <strong className="text-[var(--ink)]">Forecast vs climatology:</strong> Open-Meteo drives the
          schedule; NASA POWER is the historical baseline only.
        </p>
        <p>
          Full notes:{' '}
          <a
            className="underline font-semibold text-[var(--ink)]"
            href="https://github.com/rahulvuta/ShadeCast/blob/main/docs/limitations.md"
            target="_blank"
            rel="noreferrer"
          >
            docs/limitations.md
          </a>
        </p>
      </div>
    </details>
  )
}
