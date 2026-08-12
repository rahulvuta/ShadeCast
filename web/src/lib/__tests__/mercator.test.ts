import { describe, expect, it } from 'vitest'
import { destinationPoint } from '../smokeGeometry'
import {
  bearingPoint,
  latLonToWorldPx,
  metersPerPixel,
  projectToViewport,
  upwindWedgePath,
  worldPxToLatLon,
  zoomToFitRadius,
} from '../mercator'

describe('latLonToWorldPx', () => {
  it('maps (0, 0) at zoom 0 to the world center', () => {
    expect(latLonToWorldPx(0, 0, 0)).toEqual({ x: 128, y: 128 })
  })
})

describe('round-trip', () => {
  const samples: [number, number, number][] = [
    [0, 0, 0],
    [37.7749, -122.4194, 6],
    [-33.8688, 151.2093, 8],
    [60.0, 10.0, 4],
    [-45.5, -170.2, 5],
    [33.448, -112.074, 7],
  ]

  it.each(samples)('recovers lat=%s lon=%s z=%s within 1e-6', (lat, lon, z) => {
    const px = latLonToWorldPx(lat, lon, z)
    const back = worldPxToLatLon(px.x, px.y, z)
    expect(Math.abs(back.lat - lat)).toBeLessThan(1e-6)
    expect(Math.abs(back.lon - lon)).toBeLessThan(1e-6)
  })
})

describe('metersPerPixel', () => {
  it('matches equatorial resolution at z=0', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03392, 4)
  })

  it('is roughly half at latitude 60', () => {
    const eq = metersPerPixel(0, 5)
    const high = metersPerPixel(60, 5)
    expect(high / eq).toBeCloseTo(0.5, 2)
  })
})

describe('projectToViewport orientation', () => {
  const W = 600
  const H = 400
  const z = 6
  const cLat = 33.448
  const cLon = -112.074

  it('places the centre at (width/2, height/2)', () => {
    const p = projectToViewport(cLat, cLon, cLat, cLon, z, W, H)
    expect(p.x).toBeCloseTo(W / 2, 6)
    expect(p.y).toBeCloseTo(H / 2, 6)
  })

  it('projects due north to a smaller y', () => {
    const [nLon, nLat] = destinationPoint(cLat, cLon, 0, 50)
    const p = projectToViewport(nLat, nLon, cLat, cLon, z, W, H)
    expect(p.y).toBeLessThan(H / 2)
  })

  it('projects due east to a larger x', () => {
    const [eLon, eLat] = destinationPoint(cLat, cLon, 90, 50)
    const p = projectToViewport(eLat, eLon, cLat, cLon, z, W, H)
    expect(p.x).toBeGreaterThan(W / 2)
  })

  it('lands a bearing-315° / 120 km fire in the upper-left quadrant', () => {
    const [fLon, fLat] = destinationPoint(cLat, cLon, 315, 120)
    const p = projectToViewport(fLat, fLon, cLat, cLon, z, W, H)
    expect(p.x).toBeLessThan(W / 2)
    expect(p.y).toBeLessThan(H / 2)
  })
})

describe('zoomToFitRadius', () => {
  it('keeps a 300 km radius inside half the viewport height for 600×400', () => {
    const lat = 33.448
    const radiusKm = 300
    const z = zoomToFitRadius(lat, radiusKm, 600, 400, 48)
    expect(z).toBeGreaterThanOrEqual(1)
    expect(z).toBeLessThanOrEqual(12)
    const radiusPx = (radiusKm * 1000) / metersPerPixel(lat, z)
    expect(radiusPx).toBeLessThan(400 / 2)
  })
})

describe('latitude clamping', () => {
  it('does not produce Infinity or NaN for −89.9', () => {
    const px = latLonToWorldPx(-89.9, 0, 4)
    expect(Number.isFinite(px.x)).toBe(true)
    expect(Number.isFinite(px.y)).toBe(true)
    expect(Number.isNaN(px.x)).toBe(false)
    expect(Number.isNaN(px.y)).toBe(false)
  })
})

describe('bearingPoint screen-space conversion', () => {
  it('maps 0° (north) to −Y and 90° (east) to +X', () => {
    const n = bearingPoint(100, 100, 50, 0)
    expect(n.x).toBeCloseTo(100, 6)
    expect(n.y).toBeCloseTo(50, 6)

    const e = bearingPoint(100, 100, 50, 90)
    expect(e.x).toBeCloseTo(150, 6)
    expect(e.y).toBeCloseTo(100, 6)
  })
})

describe('upwindWedgePath', () => {
  it('starts at centre and arcs around wind-from ±45°', () => {
    const path = upwindWedgePath(200, 150, 80, 90)
    expect(path.startsWith('M 200 150')).toBe(true)
    const east = bearingPoint(200, 150, 80, 90)
    expect(path).toContain(`L ${east.x}`)
    expect(path.endsWith('Z')).toBe(true)
  })
})
