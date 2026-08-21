import { useEffect, useMemo, useRef, useState } from 'react'
import type { DataConfidence } from '../types'
import {
  INTEGRITY_CATALOG,
  catalogIdForFinding,
  groupedCatalog,
} from '../lib/integrityCatalog'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function formatObserved(v: unknown): string {
  if (v == null) return 'n/a'
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

type RowState = 'pending' | 'pass' | 'fail'

const CHECK_MS = 80
const GAUGE_MS = 700
const SETTLE_MS = 500

/**
 * Integrity theater — staged checklist + confidence gauge.
 * Auto-plays when findings exist (e.g. ?corrupt=1); healthy assessments use an expander.
 */
export function IntegrityTheater({
  confidence,
  forceOpen = false,
  onComplete,
}: {
  confidence: DataConfidence | null | undefined
  /** When true (corrupt demo), expand and animate immediately. */
  forceOpen?: boolean
  /** Fires after the checklist and score have settled (or immediately if motion is reduced). */
  onComplete?: () => void
}) {
  const findings = confidence?.findings ?? []
  const score = confidence?.score ?? 100
  const level = confidence?.level ?? 'HIGH'
  const escalated = Boolean(confidence?.verdict_escalated)
  const hasFailures = findings.length > 0
  const autoPlay = forceOpen || hasFailures || level === 'LOW' || level === 'UNUSABLE'

  const failMap = useMemo(() => {
    const m = new Map<string, (typeof findings)[number]>()
    for (const f of findings) {
      const cid = catalogIdForFinding(f.check_id)
      const prev = m.get(cid)
      if (!prev) {
        m.set(cid, f)
        continue
      }
      const rank = { INFO: 0, WARNING: 1, ERROR: 2, CRITICAL: 3 } as Record<string, number>
      if ((rank[f.severity] ?? 0) >= (rank[prev.severity] ?? 0)) m.set(cid, f)
    }
    return m
  }, [findings])

  const groups = useMemo(() => groupedCatalog(), [])
  const flatIds = useMemo(() => INTEGRITY_CATALOG.map((c) => c.id), [])

  const [open, setOpen] = useState(autoPlay)
  const [revealed, setRevealed] = useState(autoPlay && prefersReducedMotion() ? flatIds.length : 0)
  const [gauge, setGauge] = useState(autoPlay && prefersReducedMotion() ? score : 100)
  const [showEscalate, setShowEscalate] = useState(
    autoPlay && prefersReducedMotion() ? escalated : false,
  )
  const runKey = `${level}|${score}|${findings.map((f) => f.check_id).join(',')}`
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const autoPlayRef = useRef(autoPlay)
  autoPlayRef.current = autoPlay
  const finishedRef = useRef(false)

  useEffect(() => {
    if (autoPlay) setOpen(true)
  }, [autoPlay, runKey])

  useEffect(() => {
    finishedRef.current = false
  }, [runKey])

  useEffect(() => {
    if (!open) return

    let raf = 0
    let tick = 0
    let settle = 0

    const finish = () => {
      if (finishedRef.current) return
      finishedRef.current = true
      if (autoPlayRef.current) onCompleteRef.current?.()
    }

    if (prefersReducedMotion()) {
      setRevealed(flatIds.length)
      setGauge(score)
      setShowEscalate(escalated)
      finish()
      return
    }

    setRevealed(0)
    setGauge(100)
    setShowEscalate(false)

    let i = 0
    tick = window.setInterval(() => {
      i += 1
      setRevealed(i)
      if (i >= flatIds.length) {
        window.clearInterval(tick)
        tick = 0
        const start = performance.now()
        const from = 100
        const to = score
        const afterGauge = () => {
          setGauge(to)
          setShowEscalate(escalated)
          settle = window.setTimeout(finish, SETTLE_MS)
        }
        if (from === to) {
          afterGauge()
          return
        }
        const step = (t: number) => {
          const p = Math.min(1, (t - start) / GAUGE_MS)
          const eased = 1 - (1 - p) ** 2
          setGauge(Math.round(from + (to - from) * eased))
          if (p < 1) {
            raf = requestAnimationFrame(step)
          } else {
            afterGauge()
          }
        }
        raf = requestAnimationFrame(step)
      }
    }, CHECK_MS)

    return () => {
      if (tick) window.clearInterval(tick)
      cancelAnimationFrame(raf)
      if (settle) window.clearTimeout(settle)
    }
  }, [open, runKey, flatIds.length, score, escalated])

  function rowState(checkId: string, index: number): RowState {
    if (index >= revealed) return 'pending'
    return failMap.has(checkId) ? 'fail' : 'pass'
  }

  const gaugeTone =
    gauge >= 80 ? 'var(--go)' : gauge >= 55 ? 'var(--caution)' : gauge >= 30 ? 'var(--restrict)' : 'var(--stop)'

  const body = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="dash-section-label">Confidence score</p>
          <p className="mt-1 text-4xl font-black tabular-nums tracking-tight" style={{ color: gaugeTone }}>
            {gauge}
            <span className="ml-1 text-lg font-semibold text-[var(--muted)]">/100</span>
          </p>
          <p className="type-micro text-[var(--muted)] normal-case tracking-normal font-normal mt-1">
            Level {level}
            {confidence?.sources_degraded.length
              ? ` · degraded: ${confidence.sources_degraded.join(', ')}`
              : ''}
          </p>
        </div>
        <div
          className="h-3 w-40 max-w-full overflow-hidden rounded border border-[var(--border)] bg-[var(--panel)]"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={gauge}
          aria-label="Data confidence score"
        >
          <div
            className="motion-integrity-gauge h-full transition-[width] duration-500 ease-out"
            style={{ width: `${gauge}%`, background: gaugeTone }}
          />
        </div>
      </div>

      {showEscalate && escalated && (
        <aside
          role="status"
          aria-live="polite"
          className="rounded border-2 border-[var(--restrict)] bg-[var(--restrict-bg)] px-3.5 py-2.5 text-sm font-semibold"
        >
          {level === 'LOW' || level === 'UNUSABLE'
            ? `${level} confidence — verdict escalated one level more conservative.`
            : 'Verdict escalated one level more conservative due to data confidence.'}
        </aside>
      )}

      <div className="space-y-4" aria-live="polite">
        {groups.map((g) => (
          <div key={g.category}>
            <p className="dash-section-label mb-1.5">{g.label}</p>
            <ul className="space-y-1">
              {g.checks.map((check) => {
                const idx = flatIds.indexOf(check.id)
                const state = rowState(check.id, idx)
                const finding = failMap.get(check.id)
                return (
                  <li
                    key={check.id}
                    className={`rounded border px-2.5 py-1.5 text-sm transition-colors ${
                      state === 'pending'
                        ? 'border-[var(--border)] bg-[var(--panel)] opacity-40'
                        : state === 'pass'
                          ? 'border-[var(--go)]/40 bg-[var(--go-bg)]'
                          : 'border-[var(--restrict)]/50 bg-[var(--restrict-bg)]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[0.7rem] font-black"
                        aria-hidden
                      >
                        {state === 'pending' ? '·' : state === 'pass' ? 'OK' : 'X'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-snug">{check.label}</p>
                        {state === 'fail' && finding && (
                          <div className="mt-1 space-y-0.5 text-xs text-[var(--muted)] font-normal">
                            <p className="text-[var(--ink)]">{finding.message}</p>
                            <p>
                              Observed:{' '}
                              <span className="font-mono tabular-nums">
                                {formatObserved(finding.observed)}
                              </span>
                            </p>
                            <p>
                              Expected: <span className="font-mono">{finding.expected_range}</span>
                            </p>
                            <p className="type-micro normal-case tracking-normal">
                              {finding.check_id} · {finding.severity}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      {!hasFailures && revealed >= flatIds.length && (
        <p className="text-sm text-[var(--go)] font-semibold">
          All integrity checks passed — inputs look trustworthy for this assessment.
        </p>
      )}
    </div>
  )

  if (autoPlay && open) {
    return (
      <section
        aria-labelledby="integrity-theater-heading"
        className="dash-panel motion-panel-enter border-2 border-[var(--verdict-accent)] p-4 sm:p-5"
      >
        <h2 id="integrity-theater-heading" className="text-base font-bold tracking-tight">
          Integrity checks
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Live input screening before the engine trusts a bundle.
        </p>
        <div className="mt-4">{body}</div>
      </section>
    )
  }

  return (
    <details
      className="dash-panel p-4 sm:p-5"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="touch-target cursor-pointer list-none">
        <span className="text-base font-bold tracking-tight">Show integrity checks</span>
        <span className="mt-0.5 block text-xs font-normal text-[var(--muted)]">
          {hasFailures
            ? `${findings.length} finding${findings.length === 1 ? '' : 's'} · confidence ${level}`
            : 'All checks green is itself reassuring'}
        </span>
      </summary>
      <div className="mt-4 border-t border-[var(--border)] pt-4">{body}</div>
    </details>
  )
}
