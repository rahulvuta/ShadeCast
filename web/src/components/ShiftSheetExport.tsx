import { useEffect, useMemo, useState } from 'react'
import type { AssessResponse, SensitivityProfile, Workload } from '../types'
import { buildShiftSheet, formatShiftSheetText } from '../lib/shiftSheet'

export function ShiftSheetExport({
  assess,
  locationLabel,
  workload,
  profile,
  textMode,
}: {
  assess: AssessResponse
  locationLabel: string
  workload: Workload
  profile: SensitivityProfile
  textMode: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [qrSrc, setQrSrc] = useState<string | null>(null)

  const shareUrl = typeof window !== 'undefined' ? window.location.href : ''
  const sheet = useMemo(
    () =>
      buildShiftSheet({
        assess,
        locationLabel,
        workload,
        profile,
        shareUrl,
      }),
    [assess, locationLabel, workload, profile, shareUrl],
  )
  const plainText = useMemo(() => formatShiftSheetText(sheet), [sheet])

  useEffect(() => {
    if (textMode || !sheet.shareUrl) {
      setQrSrc(null)
      return
    }
    let cancelled = false
    void import('qrcode')
      .then((QRCode) =>
        QRCode.toDataURL(sheet.shareUrl, {
          margin: 1,
          width: 192,
          errorCorrectionLevel: 'M',
        }),
      )
      .then((url) => {
        if (!cancelled) setQrSrc(url)
      })
      .catch(() => {
        if (!cancelled) setQrSrc(null)
      })
    return () => {
      cancelled = true
    }
  }, [sheet.shareUrl, textMode])

  async function onCopy() {
    setError(null)
    try {
      await navigator.clipboard.writeText(plainText)
      setCopied(true)
      setStatus('Shift sheet copied to clipboard')
      window.setTimeout(() => {
        setCopied(false)
        setStatus(null)
      }, 2000)
    } catch {
      setCopied(false)
      setError('Could not copy to clipboard')
    }
  }

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
        shareUrl,
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
            Shift sheet
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Preview the 5-day plan, then copy the text or download a one-page PDF with a QR to the
            live assessment.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="touch-target rounded border border-[var(--border)] bg-[var(--panel)] px-4 text-sm font-semibold disabled:opacity-50"
            onClick={() => void onCopy()}
          >
            {copied ? 'Copied' : 'Copy text'}
          </button>
          <button
            type="button"
            className="btn-primary touch-target rounded px-4 text-sm font-semibold disabled:opacity-50"
            disabled={busy}
            onClick={() => void onExport()}
          >
            {busy ? 'Building PDF…' : 'Download PDF'}
          </button>
        </div>
      </div>
      <div className="sr-only" aria-live="polite">
        {status}
        {error}
      </div>
      {error && (
        <p className="mt-2 text-sm text-[var(--restrict)]" role="alert">
          {error}
        </p>
      )}

      <article
        aria-label="Shift sheet preview"
        className="mt-4 rounded border border-[var(--border)] bg-[var(--bg)] p-4 sm:p-5"
      >
        <header className="border-b border-[var(--border)] pb-3">
          <p className="text-sm font-bold tracking-tight">{sheet.title}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{sheet.subtitle}</p>
          <h3 className="mt-3 text-base font-bold">{sheet.locationLabel}</h3>
          <p className="mt-1 text-xs">Date range: {sheet.dateRange}</p>
          <p className="text-xs">{sheet.metaLine}</p>
          <p className="text-xs">{sheet.todayLine}</p>
        </header>

        <section className="mt-4" aria-labelledby="shift-sheet-days">
          <h4 id="shift-sheet-days" className="text-sm font-bold">
            5-day overview
          </h4>
          {sheet.days.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--muted)]">No day summaries available.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-1 pr-3 font-semibold">Day</th>
                    <th className="py-1 pr-3 font-semibold">Safe h</th>
                    <th className="py-1 pr-3 font-semibold">Worst</th>
                    <th className="py-1 pr-3 font-semibold">Hard-stop</th>
                    <th className="py-1 font-semibold">Best work</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.days.map((d) => (
                    <tr key={d.day} className="border-b border-[var(--border)]">
                      <td className="py-1 pr-3 tabular-nums">{d.day}</td>
                      <td className="py-1 pr-3 tabular-nums">{d.safeHours}</td>
                      <td className="py-1 pr-3">{d.worst}</td>
                      <td className="py-1 pr-3">{d.hardStop}</td>
                      <td className="py-1">{d.bestWork}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-4" aria-labelledby="shift-sheet-windows">
          <h4 id="shift-sheet-windows" className="text-sm font-bold">
            Ranked shift windows
          </h4>
          {sheet.windowsEmpty ? (
            <p className="mt-2 text-xs text-[var(--muted)]">{sheet.windowsEmpty}</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-1 pr-3 font-semibold">#</th>
                    <th className="py-1 pr-3 font-semibold">Day</th>
                    <th className="py-1 pr-3 font-semibold">Block</th>
                    <th className="py-1 pr-3 font-semibold">Daypart</th>
                    <th className="py-1 pr-3 font-semibold">Hours</th>
                    <th className="py-1 font-semibold">Label</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.windows.map((w) => (
                    <tr key={`${w.day}-${w.block}-${w.rank}`} className="border-b border-[var(--border)]">
                      <td className="py-1 pr-3 tabular-nums">{w.rank}</td>
                      <td className="py-1 pr-3 tabular-nums">{w.day}</td>
                      <td className="py-1 pr-3 tabular-nums">{w.block}</td>
                      <td className="py-1 pr-3">{w.daypart}</td>
                      <td className="py-1 pr-3 tabular-nums">{w.hours}</td>
                      <td className="py-1">{w.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-4" aria-labelledby="shift-sheet-actions">
          <h4 id="shift-sheet-actions" className="text-sm font-bold">
            Top action items
          </h4>
          {sheet.actionsEmpty ? (
            <p className="mt-2 text-xs text-[var(--muted)]">{sheet.actionsEmpty}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {sheet.actions.map((a) => (
                <li key={a.title}>
                  <p className="text-xs font-bold">{a.title}</p>
                  <p className="text-xs leading-relaxed">{a.body}</p>
                  <p className="text-[0.65rem] text-[var(--muted)]">Source: {a.source}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {sheet.clothing.length > 0 && (
          <section className="mt-4" aria-labelledby="shift-sheet-clothing">
            <h4 id="shift-sheet-clothing" className="text-sm font-bold">
              Clothing and PPE
            </h4>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {sheet.clothing.map((zone) => (
                <div key={zone.zone}>
                  <p className="text-xs font-semibold">{zone.label}</p>
                  <ul className="mt-0.5 list-disc pl-4 text-xs">
                    {zone.items.map((item) => (
                      <li key={`${zone.zone}-${item.title}`}>
                        {item.title} — {item.source}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-[var(--border)] pt-3">
          <div className="min-w-0 flex-1">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Live assessment URL
            </p>
            <p className="mt-0.5 break-all text-xs text-[var(--oi-sky)]">{sheet.shareUrl}</p>
            <p className="mt-2 text-[0.65rem] text-[var(--muted)]">{sheet.sourcesLine}</p>
            <p className="text-[0.65rem] text-[var(--muted)]">{sheet.disclaimer}</p>
            <p className="mt-1 text-[0.65rem] text-[var(--muted)]">{sheet.generatedLine}</p>
          </div>
          {qrSrc && (
            <figure className="shrink-0 text-center">
              <img
                src={qrSrc}
                alt="QR code linking to the live assessment"
                width={96}
                height={96}
                className="mx-auto size-24 rounded border border-[var(--border)] bg-white p-1"
              />
              <figcaption className="mt-1 text-[0.65rem] text-[var(--muted)]">
                Scan for live plan
              </figcaption>
            </figure>
          )}
        </footer>
      </article>
    </section>
  )
}
