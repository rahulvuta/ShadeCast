import { useState } from 'react'
import type { BriefResponse } from '../types'

export function BriefingCard({
  brief,
  loading,
  error,
}: {
  brief: BriefResponse | null
  loading: boolean
  error?: string | null
}) {
  const [copied, setCopied] = useState(false)

  function plainText(): string {
    if (!brief) return ''
    return [
      'Shift summary',
      brief.verdict_line,
      '',
      'Actions:',
      ...brief.three_actions.map((a, i) => `${i + 1}. ${a}`),
      '',
      brief.schedule_sentence,
      '',
      'Warning signs:',
      ...brief.warning_signs.map((w) => `- ${w}`),
    ].join('\n')
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(plainText())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section aria-labelledby="brief-heading">
      <div className="flex items-start justify-between gap-2">
        <h2 id="brief-heading" className="dash-section-label">
          Shift summary
        </h2>
        <button
          type="button"
          className="btn-primary touch-target rounded px-2.5 py-1.5 text-[0.7rem] font-semibold disabled:opacity-50"
          onClick={() => void copy()}
          disabled={!brief || loading}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {loading && <p className="mt-2 text-xs text-[var(--muted)]">Writing summary…</p>}
      {!loading && error && (
        <p className="mt-2 text-xs text-[var(--oi-vermillion)]">{error}</p>
      )}
      {!loading && !error && !brief && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          No shift summary available yet. Retry after the assessment loads.
        </p>
      )}
      {!loading && brief && (
        <div className="mt-3 space-y-3">
          <p className="text-base font-bold leading-snug tracking-tight text-[var(--ink)]">
            {brief.verdict_line}
          </p>
          <ol className="space-y-2">
            {brief.three_actions.map((a, i) => (
              <li
                key={a}
                className="flex items-start gap-2.5 rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2"
              >
                <span
                  className="btn-selected mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-bold"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--ink)]">{a}</p>
              </li>
            ))}
          </ol>
          <p className="rounded border border-[var(--border)] bg-[var(--chip-bg)] px-3 py-2 text-xs leading-relaxed text-[var(--ink)]">
            {brief.schedule_sentence}
          </p>
          <div className="flex overflow-hidden rounded border border-[var(--restrict)]/35 bg-[var(--restrict-bg)]">
            <span className="w-1 shrink-0 bg-[var(--restrict)]" aria-hidden />
            <div className="min-w-0 flex-1 px-3 py-2">
              <p className="text-[0.65rem] font-bold uppercase tracking-wide text-[var(--restrict)]">
                Warning signs
              </p>
              <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-[var(--ink)]">
                {brief.warning_signs.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
          {brief.used_fallback && (
            <p className="text-[0.65rem] text-[var(--muted)]">Template summary (LLM offline).</p>
          )}
        </div>
      )}
    </section>
  )
}
