import { useState } from 'react'
import type { AssessResponse, SensitivityProfile, Workload } from '../types'

export function ShiftSheetExport({
  assess,
  locationLabel,
  workload,
  profile,
}: {
  assess: AssessResponse
  locationLabel: string
  workload: Workload
  profile: SensitivityProfile
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onExport() {
    setBusy(true)
    setError(null)
    try {
      const { downloadShiftSheetPdf } = await import('../lib/shiftSheetPdf')
      await downloadShiftSheetPdf({
        assess,
        locationLabel,
        workload,
        profile,
        shareUrl: window.location.href,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate PDF')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="shift-sheet-heading" className="dash-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="shift-sheet-heading" className="text-base font-bold tracking-tight">
            Printable shift sheet
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            One-page PDF for supervisors — 5-day plan, ranked windows, actions, and a QR to the live
            assessment.
          </p>
        </div>
        <button
          type="button"
          className="touch-target rounded bg-[var(--ink)] px-4 text-sm font-semibold text-[var(--bg)] disabled:opacity-50"
          disabled={busy}
          onClick={() => void onExport()}
        >
          {busy ? 'Building PDF…' : 'Download PDF'}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-[var(--restrict)]" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
