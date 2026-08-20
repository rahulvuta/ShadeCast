import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import { buildShiftSheet, type ShiftSheetInput } from './shiftSheet'

export type { ShiftSheetInput }

function wrapText(doc: jsPDF, text: string, x: number, y: number, maxW: number, lineH = 4.2): number {
  const lines = doc.splitTextToSize(text, maxW) as string[]
  doc.text(lines, x, y)
  return y + lines.length * lineH
}

/**
 * Build a one-page letter PDF of the 5-day shift plan for supervisors.
 */
export async function downloadShiftSheetPdf(input: ShiftSheetInput): Promise<void> {
  const sheet = buildShiftSheet(input)
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 14
  const contentW = pageW - margin * 2
  let y = 14

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(sheet.title, margin, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(60)
  doc.text(sheet.subtitle, margin, y)
  doc.setTextColor(0)
  y += 8

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(sheet.locationLabel, margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Date range: ${sheet.dateRange}`, margin, y)
  y += 4.2
  doc.text(sheet.metaLine, margin, y)
  y += 4.2
  doc.text(sheet.todayLine, margin, y)
  y += 7

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

  if (sheet.days.length === 0) {
    doc.text('No day summaries available.', margin, y)
    y += 5
  } else {
    for (const d of sheet.days) {
      doc.text(d.day, col.day, y)
      doc.text(d.safeHours, col.safe, y)
      doc.text(d.worst, col.worst, y)
      doc.text(d.hardStop, col.hard, y)
      doc.text(d.bestWork, col.best, y)
      y += 4.2
    }
  }
  y += 4

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Ranked shift windows', margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  if (sheet.windowsEmpty) {
    doc.text(sheet.windowsEmpty, margin, y)
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
    for (const w of sheet.windows) {
      doc.text(String(w.rank), margin, y)
      doc.text(w.day, margin + 8, y)
      doc.text(w.block, margin + 32, y)
      doc.text(w.daypart, margin + 62, y)
      doc.text(w.hours, margin + 92, y)
      doc.text(w.label.slice(0, 36), margin + 110, y)
      y += 4
    }
  }
  y += 4

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Top action items', margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  if (sheet.actionsEmpty) {
    doc.text(sheet.actionsEmpty, margin, y)
    y += 5
  } else {
    for (const a of sheet.actions) {
      doc.setFont('helvetica', 'bold')
      y = wrapText(doc, `• ${a.title}`, margin, y, contentW - 40)
      doc.setFont('helvetica', 'normal')
      y = wrapText(doc, a.body, margin + 3, y, contentW - 43, 3.8)
      doc.setTextColor(80)
      y = wrapText(doc, `Source: ${a.source}`, margin + 3, y, contentW - 43, 3.6)
      doc.setTextColor(0)
      y += 1.5
      if (y > 230) break
    }
  }

  if (sheet.clothing.length > 0 && y < 210) {
    y += 3
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Clothing and PPE', margin, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    for (const zone of sheet.clothing) {
      doc.setFont('helvetica', 'bold')
      y = wrapText(doc, zone.label, margin, y, contentW - 40)
      doc.setFont('helvetica', 'normal')
      for (const item of zone.items) {
        y = wrapText(doc, `• ${item.title} — ${item.source}`, margin + 3, y, contentW - 43, 3.6)
        if (y > 228) break
      }
      if (y > 228) break
    }
  }

  const qrSize = 32
  const qrDataUrl = await QRCode.toDataURL(sheet.shareUrl, {
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
  y = wrapText(doc, sheet.shareUrl, margin, linkY + 3.5, contentW - qrSize - 8, 3.5)
  doc.setTextColor(0)

  const footerTop = 262
  doc.setDrawColor(160)
  doc.line(margin, footerTop, margin + contentW, footerTop)
  doc.setFontSize(7)
  doc.setTextColor(70)
  let fy = footerTop + 4
  fy = wrapText(doc, sheet.sourcesLine, margin, fy, contentW, 3.2)
  fy = wrapText(doc, sheet.disclaimer, margin, fy + 0.5, contentW, 3.2)
  doc.text(sheet.generatedLine, margin, fy + 1)
  doc.setTextColor(0)

  const safeName = sheet.locationLabel.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)
  doc.save(`ShadeCast_shift_sheet_${safeName || 'plan'}.pdf`)
}
