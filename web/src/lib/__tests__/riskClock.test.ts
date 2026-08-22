import { describe, expect, it } from 'vitest'
import { clockHoursForDay } from '../riskClock'
import type { HourlyAssessment } from '../../types'

function hour(day: string, h: number, verdict: HourlyAssessment['verdict'] = 'RESTRICT'): HourlyAssessment {
  return {
    hour: h,
    day,
    heat_band: 'CAUTION',
    smoke_pressure: 0,
    verdict,
    work_minutes: 15,
    rest_minutes: 45,
    note: '',
  }
}

describe('clockHoursForDay', () => {
  it('leaves missing clock hours as no-data instead of GO', () => {
    const rows = clockHoursForDay([hour('2026-08-22', 6, 'STOP'), hour('2026-08-22', 14, 'CAUTION')])
    expect(rows).toHaveLength(24)
    expect(rows[6]?.verdict).toBe('STOP')
    expect(rows[14]?.verdict).toBe('CAUTION')
    expect(rows[0]?.verdict).toBeNull()
    expect(rows.filter((h) => h.verdict == null).length).toBe(22)
    expect(rows.every((h) => h.verdict !== 'GO')).toBe(true)
  })

  it('prefers the selected day instead of first 24 unique hours across days', () => {
    const hourly = [
      hour('2026-08-22', 8, 'GO'),
      hour('2026-08-23', 8, 'STOP'),
      hour('2026-08-23', 9, 'RESTRICT'),
    ]
    const rows = clockHoursForDay(hourly, '2026-08-23')
    expect(rows[8]?.verdict).toBe('STOP')
    expect(rows[9]?.verdict).toBe('RESTRICT')
  })
})
