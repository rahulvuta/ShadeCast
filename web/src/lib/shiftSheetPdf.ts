import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import type { AssessResponse, SensitivityProfile, Workload } from '../types'

function wrapText(doc: jsPDF, text: string, x: number, y: number, maxW: number, lineH = 4.2): number {
  const lines = doc.splitTextToSize(text, maxW) as string[]
  doc.text(lines, x, y)
  return y + lines.length * lineH
}

function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

export type ShiftSheetInput = {
  assess: AssessResponse
  locationLabel: string
  workload: Workload
  profile: SensitivityProfile
  shareUrl: string
}

/**
 * Build a one-page letter PDF of the 5-day shift plan for supervisors.
 */
export async function downloadShiftSheetPdf(input: ShiftSheetInput): Promise<void> {
  const { assess, locationLabel, workload, profile, shareUrl } = input
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 14
  const contentW = pageW - margin * 2
  let y = 14

  // Header
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('ShadeCast — Shift sheet', margin, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(60)
  doc.text('Outdoor crew work/rest plan (decision support — not medical advice)', margin, y)
  doc.setTextColor(0)
  y += 8

  // Meta block
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(locationLabel, margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const days = assess.days ?? []
  const dateRange =
    days.length > 0 ? `${days[0]!.day} → ${days[days.length - 1]!.day}` : 'Next 5 days'
  const verdict = assess.current.verdict ?? 'UNUSABLE'
  const load = assess.environmental_load?.load_score
  doc.text(`Date range: ${dateRange}`, margin, y)
  y += 4.2
  doc.text(
    `Workload: ${workload} · Profile: ${profile.replace(/_/g, ' ')} · Verdict now: ${verdict}${
      load != null ? ` · Load ${load.toFixed(0)}/100` : ''
    }`,
    margin,
    y,
  )
  y += 4.2
  doc.text(
    `Hard-stop (today): ${assess.schedule.hard_stop_window ?? 'None'} · Best work: ${
      assess.schedule.best_work_window ?? 'n/a'
    } · Safe hours: ${assess.schedule.total_safe_hours.toFixed(1)}h`,
    margin,
    y,
  )
  y += 7

  // Per-day table
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('5-day overview', margin, y)
  y += 5

  const col = {
    day: margin,
    safe: margin + 28,
    worst: margin + 48,
    hard: margin + 72,
    best: margin + 118,
  }
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('Day', col.day, y)
  doc.text('Safe h', col.safe, y)
  doc.text('Worst', col.worst, y)
  doc.text('Hard-stop', col.hard, y)
  doc.text('Best work', col.best, y)
  y += 1.5
  doc.setDrawColor(180)
  doc.line(margin, y, margin + contentW, y)
  y += 4
  doc.setFont('helvetica', 'normal')

  if (days.length === 0) {
    doc.text('No day summaries available.', margin, y)
    y += 5
  } else {
    for (const d of days.slice(0, 5)) {
      doc.text(d.day, col.day, y)
      doc.text(d.total_safe_hours.toFixed(1), col.safe, y)
      doc.text(d.worst_verdict, col.worst, y)
      doc.text(d.hard_stop_window ?? 'None', col.hard, y)
      doc.text(d.best_work_window ?? 'n/a', col.best, y)
      y += 4.2
    }
  }
  y += 4

  // Ranked shift windows
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Ranked shift windows', margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const windows = (assess.shift_windows ?? []).slice(0, 8)
  if (windows.length === 0) {
    doc.text('No continuous block fits without a hard stop for the selected length.', margin, y)
    y += 5
  } else {
    doc.setFont('helvetica', 'bold')
    doc.text('#', margin, y)
    doc.text('Day', margin + 8, y)
    doc.text('Block', margin + 32, y)
    doc.text('Daypart', margin + 62, y)
    doc.text('Hours', margin + 92, y)
    doc.text('Label', margin + 110, y)
    y += 4
    doc.setFont('helvetica', 'normal')
    windows.forEach((w, i) => {
      doc.text(String(i + 1), margin, y)
      doc.text(w.day, margin + 8, y)
      doc.text(`${fmtHour(w.start_hour)}–${fmtHour(w.end_hour)}`, margin + 32, y)
      doc.text((w.daypart ?? '—').replace(/_/g, ' '), margin + 62, y)
      doc.text(`${w.required_hours}h`, margin + 92, y)
      doc.text((w.label || '').slice(0, 36), margin + 110, y)
      y += 4
    })
  }
  y += 4

  // Actions
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Top action items', margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const actions = (assess.actions ?? []).filter((a) => a.category !== 'clothing').slice(0, 4)
  if (actions.length === 0) {
    doc.text('No triggered actions for current conditions.', margin, y)
    y += 5
  } else {
    for (const a of actions) {
      doc.setFont('helvetica', 'bold')
      y = wrapText(doc, `• ${a.title}`, margin, y, contentW - 40)
      doc.setFont('helvetica', 'normal')
      y = wrapText(doc, a.body, margin + 3, y, contentW - 43, 3.8)
      doc.setTextColor(80)
      y = wrapText(doc, `Source: ${a.source_name} — ${a.source_url}`, margin + 3, y, contentW - 43, 3.6)
      doc.setTextColor(0)
      y += 1.5
      if (y > 230) break
    }
  }

  const clothing = (assess.actions ?? []).filter((a) => a.category === 'clothing')
  if (clothing.length > 0 && y < 210) {
    y += 3
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Clothing and PPE', margin, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    const zoneOrder = ['head', 'eyes', 'torso', 'hands', 'feet', 'respiratory']
    const zoneLabel: Record<string, string> = {
      head: 'Head',
      eyes: 'Eyes',
      torso: 'Torso',
      hands: 'Hands',
      feet: 'Feet',
      respiratory: 'Respiratory',
    }
    for (const zone of zoneOrder) {
      const items = clothing.filter((a) => a.body_zone === zone)
      if (!items.length) continue
      doc.setFont('helvetica', 'bold')
      y = wrapText(doc, zoneLabel[zone] ?? zone, margin, y, contentW - 40)
      doc.setFont('helvetica', 'normal')
      for (const a of items) {
        y = wrapText(doc, `• ${a.title} — ${a.source_name}`, margin + 3, y, contentW - 43, 3.6)
        if (y > 228) break
      }
      if (y > 228) break
    }
  }

  // QR + share URL (right column near bottom, or below if room)
  const qrSize = 32
  const qrDataUrl = await QRCode.toDataURL(shareUrl, {
    margin: 1,
    width: 256,
    errorCorrectionLevel: 'M',
  })
  const qrX = pageW - margin - qrSize
  const qrY = Math.min(y + 2, 220)
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.text('Scan for live plan', qrX, qrY + qrSize + 4, { maxWidth: qrSize })
  doc.setFont('helvetica', 'normal')
  const linkY = Math.max(y + 2, qrY)
  doc.setFontSize(7.5)
  doc.text('Live assessment URL:', margin, linkY)
  doc.setTextColor(0, 80, 140)
  y = wrapText(doc, shareUrl, margin, linkY + 3.5, contentW - qrSize - 8, 3.5)
  doc.setTextColor(0)

  // Footer
  const footerTop = 262
  doc.setDrawColor(160)
  doc.line(margin, footerTop, margin + contentW, footerTop)
  doc.setFontSize(7)
  doc.setTextColor(70)
  let fy = footerTop + 4
  const sourceLine =
    'Data sources: ' +
    (assess.sources ?? []).map((s) => s.name).join(' · ')
  fy = wrapText(doc, sourceLine || 'Data sources: see live assessment', margin, fy, contentW, 3.2)
  fy = wrapText(
    doc,
    assess.current.disclaimer ||
      'Not medical advice. Screening tool for crew scheduling only. Supervisors remain responsible for site decisions.',
    margin,
    fy + 0.5,
    contentW,
    3.2,
  )
  doc.text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ShadeCast`, margin, fy + 1)
  doc.setTextColor(0)

  const safeName = locationLabel.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)
  doc.save(`ShadeCast_shift_sheet_${safeName || 'plan'}.pdf`)
}
