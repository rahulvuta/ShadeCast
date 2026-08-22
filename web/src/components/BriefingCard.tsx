import { useState } from 'react'
import type { BriefResponse } from '../types'
import { CLIPBOARD_FAIL, copyText } from '../lib/clipboard'

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
  const [copyError, setCopyError] = useState<string | null>(null)

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
    setCopyError(null)
    const ok = await copyText(plainText())
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      setCopied(false)
      setCopyError(CLIPBOARD_FAIL)
    }
  }

  return (
    <section aria-labelledby="brief-heading" className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id="brief-heading" className="dash-section-label">
          Shift summary
        </h2>
        <button
          type="button"
          className="btn-primary touch-target shrink-0 rounded px-2.5 py-1.5 text-[0.7rem] font-semibold disabled:opacity-50"
          onClick={() => void copy()}
          disabled={!brief || loading}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {copyError && <p className="mt-2 text-xs text-[var(--oi-vermillion)]">{copyError}</p>}

      {loading && <p className="mt-3 text-sm text-[var(--muted)]">Writing summary…</p>}
      {!loading && error && (
        <p className="mt-3 text-sm text-[var(--oi-vermillion)]">{error}</p>
      )}
      {!loading && !error && !brief && (
        <p className="mt-3 text-sm text-[var(--muted)]">
          No shift summary available yet. Retry after the assessment loads.
        </p>
      )}

      {!loading && brief && (
        <div className="mt-4 max-w-3xl space-y-4">
          <p className="text-lg font-bold leading-snug tracking-tight text-[var(--ink)] sm:text-xl">
            {brief.verdict_line}
          </p>

          <div>
            <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
              What to do
            </p>
            <ol className="space-y-2">
              {brief.three_actions.map((a, i) => (
                <li
                  key={a}
                  className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 sm:px-4"
                >
                  <span
                    className="btn-selected mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-bold"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <p className="min-w-0 flex-1 text-sm leading-relaxed text-[var(--ink)]">{a}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-md border border-[var(--border)] bg-[var(--chip-bg)] px-3.5 py-3 sm:px-4">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Schedule
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink)]">
              {brief.schedule_sentence}
            </p>
          </div>

          <div className="overflow-hidden rounded-md border border-[var(--restrict)]/35 bg-[var(--restrict-bg)]">
            <div className="flex">
              <span className="w-1 shrink-0 bg-[var(--restrict)]" aria-hidden />
              <div className="min-w-0 flex-1 px-3.5 py-3 sm:px-4">
                <p className="text-[0.65rem] font-bold uppercase tracking-wide text-[var(--restrict)]">
                  Warning signs
                </p>
                <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-[var(--ink)]">
                  {brief.warning_signs.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {brief.used_fallback && (
            <p className="text-xs text-[var(--muted)]">Template summary (LLM offline).</p>
          )}
        </div>
      )}
    </section>
  )
}
