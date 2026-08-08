import type { DataConfidence } from '../types'

export function ConfidenceBanner({ confidence }: { confidence: DataConfidence | null | undefined }) {
  if (!confidence || confidence.level === 'HIGH') return null
  const tone =
    confidence.level === 'UNUSABLE'
      ? 'border-red-700 bg-red-50 text-red-950'
      : confidence.level === 'LOW'
        ? 'border-orange-700 bg-orange-50 text-orange-950'
        : 'border-amber-600 bg-amber-50 text-amber-950'

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
