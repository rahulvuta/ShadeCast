import { describe, expect, it } from 'vitest'
import { cellScore, type AirGridCell } from '../../components/AirQualityOverlay'

function cell(partial: Partial<AirGridCell>): AirGridCell {
  return {
    latitude: 34,
    longitude: -117,
    pm2_5: null,
    us_aqi: null,
    dust: null,
    pm10_wildfires: null,
    ...partial,
  }
}

describe('cellScore', () => {
  it('prefers US AQI when present', () => {
    expect(cellScore(cell({ us_aqi: 72, pm2_5: 200 }))).toBe(72)
  })

  it('maps clean PM2.5 into the good band', () => {
    const score = cellScore(cell({ pm2_5: 8 }))
    expect(score).not.toBeNull()
    expect(score!).toBeLessThan(50)
  })

  it('maps high PM2.5 into unhealthy', () => {
    const score = cellScore(cell({ pm2_5: 60 }))
    expect(score).not.toBeNull()
    expect(score!).toBeGreaterThan(150)
  })
})
