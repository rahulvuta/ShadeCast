import type { Feature, Polygon } from 'geojson'

/**
 * Client mirror of api/engine/smoke.py geometry — keep constants in sync.
 * Used to draw the 300 km search radius, ±45° upwind cone, and per-detection weights.
 */

export const EARTH_RADIUS_KM = 6371
export const SEARCH_RADIUS_KM = 300
/** Wider fetch for map display — includes large fires beyond the 300 km smoke radius. */
export const MAP_FIRE_FETCH_RADIUS_KM = 500
export const DECAY_SCALE_KM = 25
export const UPWIND_HALF_ANGLE_DEG = 45

export type FireLike = {
  latitude: number
  longitude: number
  frp: number | null
  acq_date?: string
  acq_time?: string
  satellite?: string
}

export type AnnotatedDetection = FireLike & {
  distanceKm: number
  bearingDeg: number
  withinRadius: boolean
  upwind: boolean
  weight: number
  ageHours: number | null
}

function toRad(d: number) {
  return (d * Math.PI) / 180
}
function toDeg(r: number) {
  return (r * 180) / Math.PI
}

export function bboxForRadiusKm(
  lat: number,
  lon: number,
  radiusKm: number,
): { west: number; south: number; east: number; north: number } {
  const latDeg = radiusKm / 111
  const cosLat = Math.max(0.15, Math.abs(Math.cos(toRad(lat))))
  const lonDeg = radiusKm / (111 * cosLat)
  return {
    west: lon - lonDeg,
    south: lat - latDeg,
    east: lon + lonDeg,
    north: lat + latDeg,
  }
}

export function firesBboxString(lat: number, lon: number, radiusKm: number): string {
  const { west, south, east, north } = bboxForRadiusKm(lat, lon, radiusKm)
  return `${west},${south},${east},${north}`
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rlat1 = toRad(lat1)
  const rlon1 = toRad(lon1)
  const rlat2 = toRad(lat2)
  const rlon2 = toRad(lon2)
  const dlat = rlat2 - rlat1
  const dlon = rlon2 - rlon1
  const a =
    Math.sin(dlat / 2) ** 2 + Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dlon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rlat1 = toRad(lat1)
  const rlon1 = toRad(lon1)
  const rlat2 = toRad(lat2)
  const rlon2 = toRad(lon2)
  const dlon = rlon2 - rlon1
  const x = Math.sin(dlon) * Math.cos(rlat2)
  const y =
    Math.cos(rlat1) * Math.sin(rlat2) - Math.sin(rlat1) * Math.cos(rlat2) * Math.cos(dlon)
  return (toDeg(Math.atan2(x, y)) + 360) % 360
}

export function angleDeltaDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

export function isUpwind(
  userLat: number,
  userLon: number,
  fireLat: number,
  fireLon: number,
  windFromDeg: number,
  halfAngle = UPWIND_HALF_ANGLE_DEG,
): boolean {
  const bearing = initialBearingDeg(userLat, userLon, fireLat, fireLon)
  return angleDeltaDeg(bearing, windFromDeg) <= halfAngle
}

export function detectionWeight(frp: number, distanceKm: number): number {
  return frp / (1 + (distanceKm / DECAY_SCALE_KM) ** 2)
}

export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceKm: number,
): [number, number] {
  const δ = distanceKm / EARTH_RADIUS_KM
  const θ = toRad(bearingDeg)
  const φ1 = toRad(lat)
  const λ1 = toRad(lon)
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    )
  const lat2 = toDeg(φ2)
  let lon2 = toDeg(λ2)
  lon2 = ((lon2 + 540) % 360) - 180
  return [lon2, lat2] // GeoJSON order
}

export function circlePolygon(
  lat: number,
  lon: number,
  radiusKm: number,
  steps = 64,
): Feature<Polygon> {
  const ring: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 360
    ring.push(destinationPoint(lat, lon, bearing, radiusKm))
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}

/** Filled wedge: user → arc along wind-from ± halfAngle at SEARCH_RADIUS_KM. */
export function upwindConePolygon(
  lat: number,
  lon: number,
  windFromDeg: number,
  halfAngle = UPWIND_HALF_ANGLE_DEG,
  radiusKm = SEARCH_RADIUS_KM,
  arcSteps = 32,
): Feature<Polygon> {
  const start = windFromDeg - halfAngle
  const coords: [number, number][] = [[lon, lat]]
  for (let i = 0; i <= arcSteps; i++) {
    const bearing = start + (i / arcSteps) * (halfAngle * 2)
    coords.push(destinationPoint(lat, lon, bearing, radiusKm))
  }
  coords.push([lon, lat])
  return {
    type: 'Feature',
    properties: { windFromDeg },
    geometry: { type: 'Polygon', coordinates: [coords] },
  }
}

export function parseAcquisitionAgeHours(
  acqDate?: string,
  acqTime?: string,
  now = Date.now(),
): number | null {
  if (!acqDate) return null
  // FIRMS: acq_date YYYY-MM-DD, acq_time HHMM (UTC)
  const t = (acqTime ?? '0000').padStart(4, '0')
  const iso = `${acqDate}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return Math.max(0, (now - ms) / 3_600_000)
}

export function annotateDetections(
  userLat: number,
  userLon: number,
  fires: FireLike[],
  windFromDeg: number,
  now = Date.now(),
): AnnotatedDetection[] {
  return fires.map((f) => {
    const distanceKm = haversineKm(userLat, userLon, f.latitude, f.longitude)
    const bearingDeg = initialBearingDeg(userLat, userLon, f.latitude, f.longitude)
    const withinRadius = distanceKm <= SEARCH_RADIUS_KM
    const upwind =
      withinRadius && isUpwind(userLat, userLon, f.latitude, f.longitude, windFromDeg)
    const frpEff = f.frp != null && f.frp > 0 ? f.frp : 1
    const weight = upwind ? detectionWeight(frpEff, distanceKm) : 0
    return {
      ...f,
      distanceKm: Math.round(distanceKm * 100) / 100,
      bearingDeg: Math.round(bearingDeg * 10) / 10,
      withinRadius,
      upwind,
      weight: Math.round(weight * 1000) / 1000,
      ageHours: parseAcquisitionAgeHours(f.acq_date, f.acq_time, now),
    }
  })
}

export function smokeLegendLine(
  annotated: AnnotatedDetection[],
  smokePressure: number,
): string {
  const considered = annotated.filter((d) => d.withinRadius)
  const upwind = considered.filter((d) => d.upwind)
  return `${upwind.length} of ${considered.length} detections are upwind and contribute to smoke pressure ${smokePressure.toFixed(0)}/100.`
}
