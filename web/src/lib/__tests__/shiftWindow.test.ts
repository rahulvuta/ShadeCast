import { describe, expect, it } from 'vitest'
import { hoursInShift, shiftBounds, type SelectedShift } from '../shiftWindow'
import type { HourlyAssessment } from '../../types'

function hour(day: string, h: number): HourlyAssessment {
  return {
    hour: h,
    day,
    heat_band: 'CAUTION',
    smoke_pressure: 0,
    verdict: 'GO',
    work_minutes: 45,
    rest_minutes: 15,
    note: '',
  }
}

describe('hoursInShift', () => {
  it('returns fewer hours than requested when the horizon ends', () => {
    const horizon = [hour('2026-08-22', 20), hour('2026-08-22', 21), hour('2026-08-22', 22)]
    const sel: SelectedShift = { kind: 'custom', day: '2026-08-22', startHour: 20, duration: 8 }
    const rows = hoursInShift(horizon, sel)
    expect(shiftBounds(sel).duration).toBe(8)
    expect(rows.length).toBe(3)
    expect(rows.length).toBeLessThan(8)
  })
})
