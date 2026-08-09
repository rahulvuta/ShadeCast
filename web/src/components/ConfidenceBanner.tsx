import type { DataConfidence } from '../types'

export function ConfidenceBanner({ confidence }: { confidence: DataConfidence | null | undefined }) {
  if (!confidence || confidence.level === 'HIGH') return null
  const tone =
    confidence.level === 'UNUSABLE'
      ? 'border-[var(--stop)] bg-[var(--stop-bg)] text-[var(--ink)]'
      : confidence.level === 'LOW'
        ? 'border-[var(--restrict)] bg-[var(--restrict-bg)] text-[var(--ink)]'
        : 'border-[var(--caution)] bg-[var(--caution-bg)] text-[var(--ink)]'

  return (
    <aside
      role="status"
      aria-live="polite"
      className={`rounded border-2 px-3.5 py-2.5 ${tone}`}
    >
      <p className="text-sm font-bold uppercase tracking-wide">
        Data confidence: {confidence.level}
        {confidence.verdict_escalated ? ' (verdict escalated)' : ''}
      </p>
      <p className="mt-1 text-sm leading-relaxed">
        {confidence.caveat || confidence.narration || 'Some input checks raised concerns.'}
      </p>
      {confidence.sources_degraded.length > 0 && (
        <p className="mt-2 text-xs">
          Sources flagged: {confidence.sources_degraded.join(', ')}
        </p>
      )}
    </aside>
  )
}
