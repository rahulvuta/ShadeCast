import type { Verdict } from '../types'

const LABELS: Record<Verdict, string> = {
  GO: 'GO',
  CAUTION: 'CAUTION',
  RESTRICT: 'RESTRICT',
  STOP: 'STOP',
}

const ICONS: Record<Verdict, string> = {
  GO: 'OK',
  CAUTION: '!',
  RESTRICT: '!!',
  STOP: 'X',
}

const CLASS: Record<Verdict, string> = {
  GO: 'verdict-go',
  CAUTION: 'verdict-caution',
  RESTRICT: 'verdict-restrict',
  STOP: 'verdict-stop',
}

export function VerdictCard({
  verdict,
  hardStop,
  heatIndex,
  smokePressure,
}: {
  verdict: Verdict
  hardStop: string | null
  heatIndex: number | null
  smokePressure: number
}) {
  return (
    <section aria-labelledby="verdict-heading" className="rounded-2xl overflow-hidden shadow-md border border-[var(--border)]">
      <div
        className={`${CLASS[verdict]} p-5`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <p className="text-sm font-semibold tracking-wide uppercase opacity-90">Today's crew verdict</p>
        <div className="mt-2 flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-black/20 text-2xl font-black"
          >
            {ICONS[verdict]}
          </span>
          <h1 id="verdict-heading" className="text-5xl font-black leading-none tracking-tight">
            {LABELS[verdict]}
          </h1>
        </div>
        <p className="mt-3 text-sm opacity-95">
          Heat index {heatIndex != null ? `${heatIndex.toFixed(0)} F` : 'n/a'} · Smoke pressure{' '}
          {smokePressure.toFixed(0)}/100 (satellite proxy, not AQI)
        </p>
      </div>
      <div className="bg-[var(--card)] p-5">
        <p className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide">Hard-stop window</p>
        <p className="mt-1 text-3xl font-black tabular-nums">
          {hardStop ?? 'No hard stop scheduled'}
        </p>
      </div>
    </section>
  )
}
