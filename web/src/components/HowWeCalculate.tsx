export function HowWeCalculate() {
  return (
    <details className="rounded-2xl bg-[var(--card)] border border-[var(--border)] p-4 shadow-sm">
      <summary className="touch-target cursor-pointer text-lg font-bold list-none flex items-center justify-between">
        How we calculate this
        <span className="text-sm font-normal text-[var(--muted)]">tap to expand</span>
      </summary>
      <div className="mt-3 space-y-3 text-sm leading-relaxed">
        <p>
          <strong>Heat:</strong> NWS Rothfusz heat index (°F) with low/high RH adjustments. Banded into
          CAUTION / EXTREME_CAUTION / DANGER / EXTREME_DANGER. Workload and acclimatization shift the
          effective band. Full sun adds a documented +8°F screening penalty. This is a screening tool,
          not WBGT, not medical advice.
        </p>
        <p>
          <strong>Smoke:</strong> Satellite-derived <em>smoke pressure</em> (0–100) from upwind NASA
          FIRMS detections weighted by fire radiative power and distance decay. Not measured PM2.5.
          Never shown as AQI.
        </p>
        <p>
          <strong>Compound verdict:</strong> Explicit GO / CAUTION / RESTRICT / STOP matrix. High heat
          plus moderate-or-higher smoke escalates one level (superadditive co-exposure rule).
        </p>
        <p>
          <strong>Forecast vs climatology:</strong> Open-Meteo drives the forward schedule. NASA POWER
          supplies the climatological baseline comparison only (LST time standard may differ from civil
          time).
        </p>
        <p>
          Full honesty notes:{' '}
          <a className="underline font-semibold" href="/docs/limitations.md">
            docs/limitations.md
          </a>{' '}
          (also linked in the app footer on the deployed site).
        </p>
      </div>
    </details>
  )
}
