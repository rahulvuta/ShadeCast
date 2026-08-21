import type { AssessResponse, BriefResponse, FirePoint, SensitivityProfile, Workload } from './types'
import { firesBboxString } from './lib/smokeGeometry'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export function formatApiError(statusText: string, body: string): string {
  const trimmed = body.trim()
  if (!trimmed) return statusText || 'Request failed'
  try {
    const parsed = JSON.parse(trimmed) as { detail?: unknown; message?: unknown }
    if (typeof parsed.detail === 'string' && parsed.detail) {
      return parsed.detail
    }
    if (Array.isArray(parsed.detail)) {
      return parsed.detail
        .map((d) => (typeof d === 'object' && d && 'msg' in d ? String((d as { msg: string }).msg) : String(d)))
        .join('; ')
    }
    if (typeof parsed.message === 'string' && parsed.message) {
      return parsed.message
    }
  } catch {
    // not JSON — fall through
  }
  return trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : err instanceof Error && err.name === 'AbortError'
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, signal ? { signal } : undefined)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(formatApiError(res.statusText, text))
  }
  return res.json() as Promise<T>
}

export function fetchAssess(opts: {
  lat: number
  lon: number
  workload: Workload
  acclimatized: boolean
  profile?: SensitivityProfile
  requiredHours?: number
  corrupt?: boolean
  event?: string | null
  hourOffset?: number | null
  signal?: AbortSignal
}): Promise<AssessResponse> {
  const q = new URLSearchParams({
    workload: opts.workload,
    acclimatized: String(opts.acclimatized),
    profile: opts.profile ?? 'general',
    required_hours: String(opts.requiredHours ?? 4),
  })
  if (opts.event) {
    q.set('event', opts.event)
    if (opts.hourOffset != null) q.set('hour_offset', String(opts.hourOffset))
  } else {
    q.set('lat', String(opts.lat))
    q.set('lon', String(opts.lon))
  }
  if (opts.corrupt) q.set('corrupt', 'true')
  return getJson(`/api/assess?${q}`, opts.signal)
}

export type HistoricalEventSummary = {
  id: string
  label: string
  lat: number
  lon: number
  start_date: string
  end_date: string
  default_hour_offset: number
  description: string
  source_url: string
  expected_verdicts: string[]
}

export function fetchEvents(): Promise<{ events: HistoricalEventSummary[] }> {
  return getJson('/api/events')
}

export type AirGridCell = {
  latitude: number
  longitude: number
  pm2_5: number | null
  us_aqi: number | null
  dust: number | null
  pm10_wildfires: number | null
}

export function fetchAirGrid(
  lat: number,
  lon: number,
  opts?: { startDate?: string; endDate?: string },
): Promise<{ cells: AirGridCell[]; valid_hour: string | null; served_from_cache: boolean }> {
  const q = new URLSearchParams({ lat: String(lat), lon: String(lon) })
  if (opts?.startDate) q.set('start_date', opts.startDate)
  if (opts?.endDate) q.set('end_date', opts.endDate)
  return getJson(`/api/air-grid?${q}`)
}

export function fetchFires(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<{ fires: FirePoint[]; count: number }> {
  const bbox = firesBboxString(lat, lon, radiusKm)
  return getJson(
    `/api/fires?bbox=${encodeURIComponent(bbox)}&lat=${lat}&lon=${lon}&radius_km=${radiusKm}`,
  )
}

export type GeocodeHit = {
  id: number
  name: string
  latitude: number
  longitude: number
  country?: string
  admin1?: string
}

export function fetchGeocode(q: string): Promise<{ results: GeocodeHit[]; cached?: boolean }> {
  return getJson(`/api/geocode?q=${encodeURIComponent(q)}`)
}

export async function fetchBrief(opts: {
  lat: number
  lon: number
  workload: Workload
  acclimatized: boolean
  profile?: SensitivityProfile
  engine?: AssessResponse | Record<string, unknown>
}): Promise<BriefResponse> {
  const res = await fetch(`${API_BASE}/api/brief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat: opts.lat,
      lon: opts.lon,
      lang: 'en',
      workload: opts.workload,
      acclimatized: opts.acclimatized,
      profile: opts.profile ?? 'general',
      engine: opts.engine ?? null,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(formatApiError(res.statusText, text))
  }
  return res.json() as Promise<BriefResponse>
}
