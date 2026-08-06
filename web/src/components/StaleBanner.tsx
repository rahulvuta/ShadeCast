import type { AssessResponse } from '../types'

export function StaleBanner({ freshness, servedFromCache }: { freshness: AssessResponse['data_freshness']; servedFromCache: boolean }) {
  if (!freshness.any_stale && !servedFromCache) return null
  const staleSources = freshness.items.filter((i) => i.is_stale).map((i) => i.source)
  return (
    <div
      role="status"
      className="rounded-xl border-2 border-[var(--oi-orange)] bg-[var(--oi-yellow)] px-4 py-3 text-sm font-semibold text-black"
    >
      {servedFromCache ? 'Serving last-good cached data. ' : ''}
      {staleSources.length > 0
        ? `Stale sources: ${staleSources.join(', ')}.`
        : 'Data may be slightly behind live feeds.'}
    </div>
  )
}
