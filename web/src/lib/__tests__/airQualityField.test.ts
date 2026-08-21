import { describe, expect, it } from 'vitest'
import { cellScore, insideRadiusKm, type AirGridCell } from '../../components/AirQualityOverlay'

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

describe('insideRadiusKm', () => {
  const lat = 34
  const lon = -117
  const radiusKm = 110
  const kmPerDegLat = 111.32

  it('includes the crew point', () => {
    expect(insideRadiusKm(lat, lon, lat, lon, radiusKm)).toBe(true)
  })

  it('includes a point on the radius', () => {
    const edgeLat = lat + radiusKm / kmPerDegLat
    expect(insideRadiusKm(edgeLat, lon, lat, lon, radiusKm)).toBe(true)
  })

  it('excludes a point beyond the radius', () => {
    const farLat = lat + 130 / kmPerDegLat
    expect(insideRadiusKm(farLat, lon, lat, lon, radiusKm)).toBe(false)
  })
})
