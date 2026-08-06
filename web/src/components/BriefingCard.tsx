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
    <section aria-labelledby="brief-heading" className="rounded-2xl bg-[var(--card)] border border-[var(--border)] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 id="brief-heading" className="text-lg font-bold">
          Crew briefing
        </h2>
        <button
          type="button"
          className="touch-target rounded-xl bg-black text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          onClick={() => void copy()}
          disabled={!brief || loading}
        >
          {copied ? 'Copied' : 'Copy briefing for crew'}
        </button>
      </div>
      {loading && <p className="mt-3 text-sm">Writing briefing…</p>}
      {!loading && brief && (
        <div className="mt-3 space-y-3">
          <p className="text-xl font-bold">{brief.verdict_line}</p>
          <ol className="list-decimal pl-5 space-y-1">
            {brief.three_actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
          <p>{brief.schedule_sentence}</p>
          <div>
            <p className="font-semibold">Warning signs</p>
            <ul className="list-disc pl-5">
              {brief.warning_signs.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
          {brief.used_fallback && (
            <p className="text-xs text-[var(--muted)]">Template briefing (LLM offline or skipped).</p>
          )}
        </div>
      )}
    </section>
  )
}
