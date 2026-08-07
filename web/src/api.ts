import type { AssessResponse, BriefResponse, FirePoint, Lang, SensitivityProfile, Workload } from './types'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
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

export async function fetchBrief(opts: {
  lat: number
  lon: number
  lang: Lang
  workload: Workload
  acclimatized: boolean
}): Promise<BriefResponse> {
  const res = await fetch(`${API_BASE}/api/brief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<BriefResponse>
}
