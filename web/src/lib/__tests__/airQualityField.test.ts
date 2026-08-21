import { describe, expect, it } from 'vitest'
import { cellScore, insideRadiusKm, interpolateField, type AirGridCell } from '../../components/AirQualityOverlay'

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

describe('interpolateField', () => {
  const lat = 34
  const lon = -117
  const radiusKm = 110
  const step = 0.4

  function grid(centerValue: number, otherValue: number) {
    const samples: { lat: number; lon: number; v: number }[] = []
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        samples.push({
          lat: lat + i * step,
          lon: lon + j * step,
          v: i === 0 && j === 0 ? centerValue : otherValue,
        })
      }
    }
    return samples
  }

  it('does not punch a site-shaped hole at a single milder cell', () => {
    const hit = interpolateField(lat, lon, grid(80, 500), lat, lon, radiusKm)
    expect(hit).not.toBeNull()
    // Regional hazardous field wins; the 80 cell is not shown as a station.
    expect(hit!.v).toBeGreaterThan(300)
  })

  it('keeps a uniformly heavy field heavy', () => {
    const hit = interpolateField(lat, lon, grid(500, 500), lat, lon, radiusKm)
    expect(hit).not.toBeNull()
    expect(hit!.v).toBeCloseTo(500, 5)
  })
})
