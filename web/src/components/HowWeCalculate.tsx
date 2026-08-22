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
          adjustments, workload/acclimatization shifts, and +8°F when cloud cover &lt; 50% (not a
          shade toggle). Screening tool — not WBGT, not medical advice.
        </p>
        <p>
          <strong className="text-[var(--ink)]">Smoke:</strong> CAMS PM2.5 via Open-Meteo
          (modelled particulates — wildfire smoke, dust, and urban aerosol). Not FIRMS FRP and
          not a ground monitor. The map shades CAMS as a weather-style field, not FIRMS fire
          dots.
        </p>
        <p>
          <strong className="text-[var(--ink)]">Storms:</strong> US NWS alerts set verdict floors
          and sourced precautions by type. Outside NWS coverage, Open-Meteo weathercode plus CAPE
          score thunderstorms, heavy rain, and snow.
        </p>
        <p>
          <strong className="text-[var(--ink)]">Compound:</strong> Explicit GO / CAUTION / RESTRICT /
          STOP matrix with superadditive heat+smoke escalation. UV shortens exposure with elevated
          heat; AQI can escalate the verdict.
        </p>
        <p>
          <strong className="text-[var(--ink)]">Forecast vs climatology:</strong> Open-Meteo drives the
          schedule; NASA POWER is the historical baseline only. NWS is US-only and additive:
          official alerts plus a near-term cross-check. Outside the US the same global model
          path is used — that is designed behavior, not a failure.
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
