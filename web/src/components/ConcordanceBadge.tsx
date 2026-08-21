const COPY: Record<string, string> = {
  AGREE: 'FIRMS heat detections and CAMS air quality agree on direction.',
  FIRMS_LEADS:
    'FIRMS sees nearby heat while the air-quality model stays quieter — possible fresh fire not yet in CAMS.',
  MODEL_LEADS:
    'Air-quality model is elevated while FIRMS is quiet — often traffic, industry, dust, or aged haze (not corruption).',
}

const TONE: Record<string, { rail: string; chip: string }> = {
  AGREE: {
    rail: 'bg-[var(--go)]',
    chip: 'border-[var(--go)]/35 bg-[var(--go-bg)] text-[var(--go)]',
  },
  FIRMS_LEADS: {
    rail: 'bg-[var(--caution)]',
    chip: 'border-[var(--caution)]/40 bg-[var(--caution-bg)] text-[var(--caution)]',
  },
  MODEL_LEADS: {
    rail: 'bg-[var(--oi-sky)]',
    chip: 'border-[color-mix(in_srgb,var(--oi-sky)_40%,var(--border))] bg-[color-mix(in_srgb,var(--oi-sky)_18%,transparent)] text-[var(--oi-sky)]',
  },
}

const FALLBACK_TONE = {
  rail: 'bg-[var(--muted)]',
  chip: 'border-[var(--border)] bg-[var(--chip-bg)] text-[var(--ink)]',
}

export function ConcordanceBadge({
  concordance,
  usAqi,
}: {
  concordance?: string | null
  usAqi?: number | null
}) {
  if (!concordance) return null
  const tone = TONE[concordance] ?? FALLBACK_TONE
  return (
    <section aria-labelledby="concordance-heading" className="dash-panel overflow-hidden p-0">
      <div className="flex">
        <span className={`w-1 shrink-0 ${tone.rail}`} aria-hidden />
        <div className="min-w-0 flex-1 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="concordance-heading" className="dash-section-label">
              FIRMS vs CAMS
            </h2>
            <span
              className={`rounded border px-2 py-0.5 text-[0.65rem] font-bold tracking-wide ${tone.chip}`}
            >
              {concordance.replaceAll('_', ' ')}
            </span>
            {usAqi != null && (
              <span className="rounded border border-[var(--border)] bg-[var(--chip-bg)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--ink)]">
                US AQI {usAqi.toFixed(0)}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
            {COPY[concordance] ?? concordance}
          </p>
        </div>
      </div>
    </section>
  )
}
