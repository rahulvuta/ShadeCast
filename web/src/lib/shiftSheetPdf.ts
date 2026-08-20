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
 * Supervisor shift sheet. A second letter page is allowed when the hour
 * table does not fit; type stays readable (no shrink-to-fit).
 */
export async function downloadShiftSheetPdf(input: ShiftSheetInput): Promise<void> {
  const sheet = buildShiftSheet(input)
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 14
  const contentW = pageW - margin * 2
  const bottom = pageH - 18
  let y = 14

  const need = (h: number) => {
    if (y + h > bottom) {
      doc.addPage()
      y = 14
    }
  }

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
  y = wrapText(doc, sheet.metaLine, margin, y, contentW, 4.2)
  y = wrapText(doc, sheet.todayLine, margin, y, contentW, 4.2)
  y += 3

  if (sheet.chosenHeader) {
    need(16)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Chosen shift', margin, y)
    y += 5
    doc.setFontSize(10)
    doc.text(sheet.chosenHeader, margin, y)
    y += 4.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(
      `Worst hour: ${sheet.chosenWorst ?? '—'} · Safe outdoor minutes: ${sheet.chosenSafeMinutes ?? 0}`,
      margin,
      y,
    )
    y += 6
  }

  if (sheet.stormLines.length > 0) {
    need(8 + sheet.stormLines.length * 4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Storm / precautions', margin, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    for (const line of sheet.stormLines) {
      need(5)
      y = wrapText(doc, `• ${line}`, margin, y, contentW, 3.8)
    }
    y += 3
  }

  if (sheet.hourRows.length > 0) {
    need(16)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Hour forecast', margin, y)
    y += 5
    doc.setFontSize(7)
    const cols = {
      time: margin,
      wx: margin + 16,
      heat: margin + 48,
      rh: margin + 72,
      uv: margin + 90,
      air: margin + 100,
      wind: margin + 120,
      rating: margin + 148,
      mins: margin + 168,
    }
    doc.text('Time', cols.time, y)
    doc.text('Weather', cols.wx, y)
    doc.text('Heat', cols.heat, y)
    doc.text('RH', cols.rh, y)
    doc.text('UV', cols.uv, y)
    doc.text('Air', cols.air, y)
    doc.text('Wind', cols.wind, y)
    doc.text('Rating', cols.rating, y)
    doc.text('Min', cols.mins, y)
    y += 1.2
    doc.setDrawColor(180)
    doc.line(margin, y, margin + contentW, y)
    y += 3.6
    doc.setFont('helvetica', 'normal')
    for (const h of sheet.hourRows) {
      need(h.precaution ? 8 : 5)
      doc.text(h.time, cols.time, y)
      doc.text(h.weather.slice(0, 18), cols.wx, y)
      doc.text(h.heat, cols.heat, y)
      doc.text(h.humidityBand, cols.rh, y)
      doc.text(h.uv, cols.uv, y)
      doc.text(h.air, cols.air, y)
      doc.text(h.wind.slice(0, 12), cols.wind, y)
      doc.setFont('helvetica', 'bold')
      doc.text(h.rating, cols.rating, y)
      doc.setFont('helvetica', 'normal')
      doc.text(`${h.workMinutes}/${h.restMinutes}`, cols.mins, y)
      y += 3.6
      if (h.precaution) {
        doc.setTextColor(120, 20, 20)
        y = wrapText(doc, h.precaution, cols.wx, y, contentW - 16, 3.4)
        doc.setTextColor(0)
      }
    }
    y += 3
  }

  need(20)
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
      need(5)
      doc.text(d.day, col.day, y)
      doc.text(d.safeHours, col.safe, y)
      doc.text(d.worst, col.worst, y)
      doc.text(d.hardStop, col.hard, y)
      doc.text(d.bestWork, col.best, y)
      y += 4.2
    }
  }
  y += 4

  need(12)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(sheet.otherWindowsLine ? 'Other dayparts' : 'Ranked shift windows', margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  if (sheet.windowsEmpty) {
    y = wrapText(doc, sheet.windowsEmpty, margin, y, contentW, 3.8)
    y += 2
  } else if (sheet.otherWindowsLine) {
    y = wrapText(doc, sheet.otherWindowsLine, margin, y, contentW, 3.8)
    y += 2
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
      need(5)
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

  need(14)
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
      need(16)
      doc.setFont('helvetica', 'bold')
      y = wrapText(doc, `• ${a.title}`, margin, y, contentW)
      doc.setFont('helvetica', 'normal')
      y = wrapText(doc, a.body, margin + 3, y, contentW - 3, 3.8)
      doc.setTextColor(80)
      y = wrapText(doc, `Source: ${a.source}`, margin + 3, y, contentW - 3, 3.6)
      doc.setTextColor(0)
      y += 1.5
    }
  }

  if (sheet.clothing.length > 0) {
    need(14)
    y += 3
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Clothing and PPE', margin, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    for (const zone of sheet.clothing) {
      need(10)
      doc.setFont('helvetica', 'bold')
      y = wrapText(doc, zone.label, margin, y, contentW)
      doc.setFont('helvetica', 'normal')
      for (const item of zone.items) {
        need(5)
        y = wrapText(doc, `• ${item.title} — ${item.source}`, margin + 3, y, contentW - 3, 3.6)
      }
    }
  }

  const qrSize = 32
  need(qrSize + 16)
  const qrDataUrl = await QRCode.toDataURL(sheet.shareUrl, {
    margin: 1,
    width: 256,
    errorCorrectionLevel: 'M',
  })
  const qrX = pageW - margin - qrSize
  const qrY = y
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.text('Scan for live plan', qrX, qrY + qrSize + 4, { maxWidth: qrSize })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('Live assessment URL:', margin, qrY)
  doc.setTextColor(0, 80, 140)
  y = wrapText(doc, sheet.shareUrl, margin, qrY + 3.5, contentW - qrSize - 8, 3.5)
  doc.setTextColor(0)
  y = Math.max(y, qrY + qrSize + 8)

  need(18)
  doc.setDrawColor(160)
  doc.line(margin, y, margin + contentW, y)
  y += 4
  doc.setFontSize(7)
  doc.setTextColor(70)
  y = wrapText(doc, sheet.sourcesLine, margin, y, contentW, 3.2)
  y = wrapText(doc, sheet.disclaimer, margin, y + 0.5, contentW, 3.2)
  doc.text(sheet.generatedLine, margin, y + 1)
  doc.setTextColor(0)

  const safeName = sheet.locationLabel.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)
  doc.save(`ShadeCast_shift_sheet_${safeName || 'plan'}.pdf`)
}
