export type LatLonOk = { ok: true; lat: number; lon: number }
export type LatLonErr = { ok: false; error: string }
export type LatLonParse = LatLonOk | LatLonErr

export type DeepLinkLocation = { lat: number; lon: number; label: string }

/** Empty / blank strings are invalid — `Number('') === 0` must not become the equator. */
export function parseLatLonInputs(latRaw: string, lonRaw: string): LatLonParse {
  const latS = latRaw.trim()
  const lonS = lonRaw.trim()
  if (!latS || !lonS) {
    return { ok: false, error: 'Enter both latitude and longitude' }
  }
  const lat = Number(latS)
  const lon = Number(lonS)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, error: 'Latitude must be between -90 and 90' }
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { ok: false, error: 'Longitude must be between -180 and 180' }
  }
  return { ok: true, lat, lon }
}

export function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** `?lat=&lon=` deep link. Real 0,0 (Gulf of Guinea) is allowed; missing/blank is not. */
export function parseDeepLinkLocation(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): DeepLinkLocation | null {
  const params = new URLSearchParams(search)
  const latRaw = params.get('lat')
  const lonRaw = params.get('lon')
  if (latRaw == null || lonRaw == null) return null
  const parsed = parseLatLonInputs(latRaw, lonRaw)
  if (!parsed.ok) return null
  const lat = roundCoord(parsed.lat)
  const lon = roundCoord(parsed.lon)
  return {
    lat,
    lon,
    label: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
  }
}

export function mergeQuery(updates: Record<string, string | null>): string {
  const params = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : '',
  )
  for (const [key, value] of Object.entries(updates)) {
    if (value == null) params.delete(key)
    else params.set(key, value)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : '?'
}
