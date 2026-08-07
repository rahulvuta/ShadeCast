const COPY: Record<string, string> = {
  AGREE: 'FIRMS smoke pressure and CAMS air quality agree on direction.',
  FIRMS_LEADS: 'FIRMS sees elevated smoke while the air-quality model stays quieter — possible fresh local plume.',
  MODEL_LEADS: 'Air-quality model is elevated while FIRMS is quiet — often traffic, industry, dust, or aged haze (not corruption).',
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
    <section aria-labelledby="concordance-heading" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="concordance-heading" className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
          Smoke concordance
        </h2>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-bold">
          {concordance}
        </span>
        {usAqi != null && (
          <span className="text-xs text-[var(--muted)]">US AQI {usAqi.toFixed(0)}</span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed">{COPY[concordance] ?? concordance}</p>
    </section>
  )
}
