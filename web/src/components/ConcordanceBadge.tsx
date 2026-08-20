const COPY: Record<string, string> = {
  AGREE: 'FIRMS heat detections and CAMS air quality agree on direction.',
  FIRMS_LEADS:
    'FIRMS sees nearby heat while the air-quality model stays quieter — possible fresh fire not yet in CAMS.',
  MODEL_LEADS:
    'Air-quality model is elevated while FIRMS is quiet — often traffic, industry, dust, or aged haze (not corruption).',
}

export function ConcordanceBadge({
  concordance,
  usAqi,
}: {
  concordance?: string | null
  usAqi?: number | null
}) {
  if (!concordance) return null
  return (
    <section aria-labelledby="concordance-heading" className="dash-panel p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="concordance-heading" className="dash-section-label">
          FIRMS vs CAMS
        </h2>
        <span className="rounded border border-[var(--border)] px-2 py-0.5 text-[0.65rem] font-bold">
          {concordance}
        </span>
        {usAqi != null && (
          <span className="text-[0.65rem] text-[var(--muted)]">US AQI {usAqi.toFixed(0)}</span>
        )}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
        {COPY[concordance] ?? concordance}
      </p>
    </section>
  )
}
