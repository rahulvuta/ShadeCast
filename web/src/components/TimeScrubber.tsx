import { useEffect, useId, useRef } from 'react'
import type { Verdict } from '../types'

type HourPoint = {
  hour: number
  day?: string | null
  valid_at?: string | null
  verdict: Verdict | string
  smoke_pressure?: number
  is_current?: boolean
}

function labelFor(h: HourPoint, index: number): string {
  if (h.valid_at) {
    try {
      const d = new Date(h.valid_at)
      return d.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
      })
    } catch {
      /* fall through */
    }
  }
  if (h.day) return `${h.day} · hour ${h.hour}`
  return `Hour ${index}`
}

export function TimeScrubber({
  hours,
  index,
  onIndex,
  playing,
  onPlaying,
}: {
  hours: HourPoint[]
  index: number
  onIndex: (i: number) => void
  playing: boolean
  onPlaying: (p: boolean) => void
}) {
  const id = useId()
  const reduced = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const indexRef = useRef(index)
  indexRef.current = index

  useEffect(() => {
    if (!playing || hours.length === 0 || reduced.current) return
    const tick = window.setInterval(() => {
      const next = (indexRef.current + 1) % hours.length
      onIndex(next)
    }, 700)
    return () => window.clearInterval(tick)
  }, [playing, hours.length, onIndex])

  if (hours.length === 0) return null

  const current = hours[Math.min(index, hours.length - 1)]!
  const max = hours.length - 1
  const valueText = `${labelFor(current, index)}, verdict ${current.verdict}${
    current.smoke_pressure != null ? `, smoke ${current.smoke_pressure.toFixed(0)}` : ''
  }`

  function step(delta: number) {
    onPlaying(false)
    onIndex(Math.min(max, Math.max(0, index + delta)))
  }

  return (
    <section
      aria-labelledby={`${id}-label`}
      className="dash-panel px-3.5 py-3 sm:px-4"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          step(-1)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          step(1)
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p id={`${id}-label`} className="dash-section-label">
            Time scrubber
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">{labelFor(current, index)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="touch-target rounded border border-[var(--border)] px-3 text-xs font-semibold"
            onClick={() => step(-1)}
            aria-label="Previous hour"
          >
            Prev
          </button>
          <button
            type="button"
            className="touch-target rounded border border-[var(--border)] bg-[var(--panel)] px-3 text-xs font-semibold"
            aria-pressed={playing}
            onClick={() => {
              if (reduced.current) {
                onPlaying(false)
                return
              }
              onPlaying(!playing)
            }}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="touch-target rounded border border-[var(--border)] px-3 text-xs font-semibold"
            onClick={() => step(1)}
            aria-label="Next hour"
          >
            Next
          </button>
        </div>
      </div>

      <label className="mt-3 block">
        <span className="sr-only">Scrub forecast hours</span>
        <input
          type="range"
          className="w-full accent-[var(--verdict-accent)] touch-target"
          min={0}
          max={max}
          step={1}
          value={index}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={index}
          aria-valuetext={valueText}
          onChange={(e) => {
            onPlaying(false)
            onIndex(Number(e.target.value))
          }}
        />
      </label>
      <p className="mt-1 type-micro text-[var(--muted)] normal-case tracking-normal font-normal" aria-live="polite">
        {valueText}. Arrow keys step one hour.
      </p>
    </section>
  )
}
