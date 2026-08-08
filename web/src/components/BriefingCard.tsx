import { useState } from 'react'
import type { BriefResponse } from '../types'

export function BriefingCard({ brief, loading }: { brief: BriefResponse | null; loading: boolean }) {
  const [copied, setCopied] = useState(false)

  function plainText(): string {
    if (!brief) return ''
    return [
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
    const text = plainText()
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section aria-labelledby="brief-heading">
      <div className="flex items-start justify-between gap-2">
        <h2 id="brief-heading" className="dash-section-label">
          Crew briefing
        </h2>
        <button
          type="button"
          className="touch-target rounded bg-[var(--ink)] px-2.5 py-1.5 text-[0.7rem] font-semibold text-white disabled:opacity-50"
          onClick={() => void copy()}
          disabled={!brief || loading}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {loading && <p className="mt-2 text-xs text-[var(--muted)]">Writing briefing…</p>}
      {!loading && brief && (
        <div className="mt-2 space-y-2 text-xs leading-relaxed">
          <p className="text-sm font-bold">{brief.verdict_line}</p>
          <ol className="list-decimal pl-4 space-y-1">
            {brief.three_actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
          <p>{brief.schedule_sentence}</p>
          <div>
            <p className="font-semibold text-[0.65rem] uppercase tracking-wide text-[var(--muted)]">
              Warning signs
            </p>
            <ul className="list-disc pl-4 mt-0.5">
              {brief.warning_signs.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
          {brief.used_fallback && (
            <p className="text-[0.65rem] text-[var(--muted)]">Template briefing (LLM offline).</p>
          )}
        </div>
      )}
    </section>
  )
}
