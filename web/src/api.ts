import type { AssessResponse, BriefResponse, FirePoint, Lang, SensitivityProfile, Workload } from './types'

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

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
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
}): Promise<AssessResponse> {
  const q = new URLSearchParams({
    lat: String(opts.lat),
    lon: String(opts.lon),
    workload: opts.workload,
    acclimatized: String(opts.acclimatized),
    profile: opts.profile ?? 'general',
    required_hours: String(opts.requiredHours ?? 4),
  })
  if (opts.corrupt) q.set('corrupt', 'true')
  return getJson(`/api/assess?${q}`)
}

export function fetchFires(bbox: string): Promise<{ fires: FirePoint[]; count: number }> {
  return getJson(`/api/fires?bbox=${encodeURIComponent(bbox)}`)
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
  lang: Lang
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
      lang: opts.lang,
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
