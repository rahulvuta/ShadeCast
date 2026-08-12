/** Spherical Web Mercator helpers — pure math, no DOM. */

export const TILE_SIZE = 256

/** Mercator is undefined at the poles; clamp before projecting. */
export const MAX_LAT = 85.05112878

const EARTH_CIRCUMFERENCE_M = 40075016.686
const EQUATORIAL_MPP_Z0 = EARTH_CIRCUMFERENCE_M / TILE_SIZE // 156543.03392804097

function clampLat(lat: number): number {
  return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))
}

/** Normalize longitude into [-180, 180). */
export function normalizeLon(lon: number): number {
  let x = lon
  while (x < -180) x += 360
  while (x >= 180) x -= 360
  return x
}

function positiveMod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/** Web Mercator world pixel coordinates at a given zoom. */
export function latLonToWorldPx(lat: number, lon: number, z: number): { x: number; y: number } {
  const latC = clampLat(lat)
  const lonN = normalizeLon(lon)
  const scale = TILE_SIZE * 2 ** z
  const x = ((lonN + 180) / 360) * scale
  const s = Math.sin((latC * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale
  return { x, y }
}

/** Inverse of latLonToWorldPx, for hit-testing and hover. */
export function worldPxToLatLon(x: number, y: number, z: number): { lat: number; lon: number } {
  const scale = TILE_SIZE * 2 ** z
  const lon = (x / scale) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / scale
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { lat: clampLat(lat), lon: normalizeLon(lon) }
}

/** Ground resolution in metres per pixel at a latitude and zoom. */
export function metersPerPixel(lat: number, z: number): number {
  return (EQUATORIAL_MPP_Z0 * Math.cos((clampLat(lat) * Math.PI) / 180)) / 2 ** z
}

/**
 * Largest integer zoom at which a circle of `radiusKm` around `lat`
 * fits inside a viewport of `widthPx` x `heightPx` with `paddingPx` to spare.
 * Clamp to [1, 12].
 */
export function zoomToFitRadius(
  lat: number,
  radiusKm: number,
  widthPx: number,
  heightPx: number,
  paddingPx: number,
): number {
  const usableW = Math.max(1, widthPx - 2 * paddingPx)
  const usableH = Math.max(1, heightPx - 2 * paddingPx)
  const diameterPxBudget = Math.min(usableW, usableH)
  const radiusPxBudget = diameterPxBudget / 2
  const radiusM = radiusKm * 1000

  let best = 1
  for (let z = 1; z <= 12; z++) {
    const mpp = metersPerPixel(lat, z)
    const radiusPx = radiusM / mpp
    if (radiusPx <= radiusPxBudget) best = z
    else break
  }
  return best
}

export type ViewportTile = {
  z: number
  x: number
  y: number
  left: number
  top: number
}

/** Tile x/y/z indices covering a viewport, with CSS left/top already computed. */
export function tilesForViewport(
  centerLat: number,
  centerLon: number,
  z: number,
  widthPx: number,
  heightPx: number,
): ViewportTile[] {
  const center = latLonToWorldPx(centerLat, centerLon, z)
  const leftWorld = center.x - widthPx / 2
  const topWorld = center.y - heightPx / 2
  const rightWorld = leftWorld + widthPx
  const bottomWorld = topWorld + heightPx

  const n = 2 ** z
  const minTx = Math.floor(leftWorld / TILE_SIZE)
  const maxTx = Math.floor((rightWorld - 1e-9) / TILE_SIZE)
  const minTy = Math.max(0, Math.floor(topWorld / TILE_SIZE))
  const maxTy = Math.min(n - 1, Math.floor((bottomWorld - 1e-9) / TILE_SIZE))

  const tiles: ViewportTile[] = []
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const wrappedX = positiveMod(tx, n)
      tiles.push({
        z,
        x: wrappedX,
        y: ty,
        left: tx * TILE_SIZE - leftWorld,
        top: ty * TILE_SIZE - topWorld,
      })
    }
  }
  return tiles
}

/** Project a lat/lon to pixel coordinates within the viewport (0,0 = top-left). */
export function projectToViewport(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number,
  z: number,
  widthPx: number,
  heightPx: number,
): { x: number; y: number } {
  const center = latLonToWorldPx(centerLat, centerLon, z)
  const p = latLonToWorldPx(lat, lon, z)
  let dx = p.x - center.x
  const worldWidth = TILE_SIZE * 2 ** z
  // Shortest path across the antimeridian
  if (dx > worldWidth / 2) dx -= worldWidth
  if (dx < -worldWidth / 2) dx += worldWidth
  return {
    x: widthPx / 2 + dx,
    y: heightPx / 2 + (p.y - center.y),
  }
}

/**
 * Screen-space point on a circle for a meteorological bearing (degrees from north).
 * 0° = −Y (north), 90° = +X (east).
 */
export function bearingPoint(
  cx: number,
  cy: number,
  radiusPx: number,
  bearingDeg: number,
): { x: number; y: number } {
  const θ = (bearingDeg * Math.PI) / 180
  return {
    x: cx + radiusPx * Math.sin(θ),
    y: cy - radiusPx * Math.cos(θ),
  }
}

/** SVG path for a ±halfAngle wedge from centre along wind-from. */
export function upwindWedgePath(
  cx: number,
  cy: number,
  radiusPx: number,
  windFromDeg: number,
  halfAngle = 45,
  arcSteps = 32,
): string {
  const start = windFromDeg - halfAngle
  const end = windFromDeg + halfAngle
  const first = bearingPoint(cx, cy, radiusPx, start)
  const parts = [`M ${cx} ${cy}`, `L ${first.x} ${first.y}`]
  for (let i = 1; i <= arcSteps; i++) {
    const t = i / arcSteps
    const bearing = start + (end - start) * t
    const p = bearingPoint(cx, cy, radiusPx, bearing)
    parts.push(`L ${p.x} ${p.y}`)
  }
  parts.push('Z')
  return parts.join(' ')
}
