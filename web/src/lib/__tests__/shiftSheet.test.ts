import { describe, expect, it } from 'vitest'
import type { AssessResponse, SensitivityProfile, Workload } from '../../types'
import { buildShiftSheet, formatShiftSheetText, fmtHour } from '../shiftSheet'

function sampleAssess(overrides: Partial<AssessResponse> = {}): AssessResponse {
  return {
    lat: 33.45,
    lon: -112.07,
    workload: 'moderate',
    acclimatized: true,
    current: {
      temperature_c: 41,
      temperature_f: 106,
      relative_humidity: 12,
      heat_index_f: 108,
      heat_band: 'danger',
      effective_heat_band: 'danger',
      wind_speed_kmh: 8,
      wind_direction_deg: 270,
      verdict: 'RESTRICT',
      disclaimer: 'Not medical advice. Screening tool for crew scheduling only.',
    },
    hourly: [],
    schedule: {
      hard_stop_window: '12:00–17:00',
      best_work_window: '05:00–08:00',
      total_safe_hours: 3.5,
    },
    days: [
      {
        day: '2026-08-18',
        hard_stop_window: '12:00–17:00',
        best_work_window: '05:00–08:00',
        total_safe_hours: 3.5,
        worst_verdict: 'STOP',
        total_work_minutes: 210,
      },
      {
        day: '2026-08-19',
        hard_stop_window: null,
        best_work_window: '06:00–10:00',
        total_safe_hours: 6,
        worst_verdict: 'CAUTION',
        total_work_minutes: 360,
      },
    ],
    shift_windows: [
      {
        day: '2026-08-18',
        start_hour: 5,
        end_hour: 9,
        required_hours: 4,
        mean_rank: 1,
        label: 'Cool morning',
        daypart: 'morning',
      },
    ],
    smoke: {
      smoke_pressure: 10,
      label: 'low',
      upwind_count: 0,
      considered_count: 2,
      note: '',
    },
    climatology: {
      today_temp_c: 41,
      baseline_temp_c: 38,
      delta_c: 3,
      message: '',
      note: '',
    },
    data_freshness: { items: [], any_stale: false },
    sources: [{ name: 'Open-Meteo', url: 'https://open-meteo.com', role: 'forecast' }],
    served_from_cache: false,
    demo_mode: false,
    actions: [
      {
        id: 'a1',
        title: 'More water',
        body: 'Drink every 15 min',
        source_url: 'https://osha.gov',
        source_name: 'OSHA',
        trigger: 'heat',
        category: 'general',
      },
      {
        id: 'c1',
        title: 'Wide-brim hat',
        body: 'Shade the face',
        source_url: 'https://cdc.gov',
        source_name: 'CDC',
        trigger: 'uv',
        category: 'clothing',
        body_zone: 'head',
      },
    ],
    environmental_load: {
      load_score: 72,
      drivers: [],
      concordance: 'ok',
      interactions: [],
      ceiling_reason: '',
      reason: '',
    },
    ...overrides,
  }
}

function sampleSheet(assessOverrides: Partial<AssessResponse> = {}) {
  return buildShiftSheet({
    assess: sampleAssess(assessOverrides),
    locationLabel: 'Phoenix, AZ',
    workload: 'moderate' as Workload,
    profile: 'general' as SensitivityProfile,
    shareUrl: 'https://shadecast.example/plan',
    now: new Date('2026-08-19T16:00:00.000Z'),
  })
}

describe('fmtHour', () => {
  it('zero-pads hours', () => {
    expect(fmtHour(5)).toBe('05:00')
    expect(fmtHour(17)).toBe('17:00')
  })
})

describe('buildShiftSheet', () => {
  it('keeps clothing out of top actions and groups it by body zone', () => {
    const sheet = sampleSheet()
    expect(sheet.actions.map((a) => a.title)).toEqual(['More water'])
    expect(sheet.clothing).toEqual([
      { zone: 'head', label: 'Head', items: [{ title: 'Wide-brim hat', source: 'CDC' }] },
    ])
  })

  it('formats windows and the empty-windows message', () => {
    const filled = sampleSheet()
    expect(filled.windows[0]).toMatchObject({
      rank: 1,
      block: '05:00–09:00',
      daypart: 'morning',
      hours: '4h',
    })
    expect(filled.windowsEmpty).toBeNull()

    const empty = sampleSheet({ shift_windows: [] })
    expect(empty.windows).toEqual([])
    expect(empty.windowsEmpty).toMatch(/No continuous block/)
  })
})

describe('formatShiftSheetText', () => {
  it('includes every supervisor field from the contract', () => {
    const text = formatShiftSheetText(sampleSheet())
    expect(text).toContain('Phoenix, AZ')
    expect(text).toContain('2026-08-18 → 2026-08-19')
    expect(text).toContain('Hard-stop (today): 12:00–17:00')
    expect(text).toContain('2026-08-18 | 3.5 | STOP | 12:00–17:00 | 05:00–08:00')
    expect(text).toContain('1 | 2026-08-18 | 05:00–09:00 | morning | 4h | Cool morning')
    expect(text).toContain('More water')
    expect(text).toContain('Source: OSHA — https://osha.gov')
    expect(text).toContain('Clothing and PPE')
    expect(text).toContain('Wide-brim hat — CDC')
    expect(text).toContain('https://shadecast.example/plan')
    expect(text).toContain('Data sources: Open-Meteo')
    expect(text).toContain('Not medical advice')
    expect(text).toContain('Generated 2026-08-19 16:00 UTC · ShadeCast')
    const actionsBlock = text.slice(
      text.indexOf('Top action items'),
      text.indexOf('Clothing and PPE'),
    )
    expect(actionsBlock).toContain('More water')
    expect(actionsBlock).not.toContain('Wide-brim hat')
  })
})
