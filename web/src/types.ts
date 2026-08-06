export type Verdict = 'GO' | 'CAUTION' | 'RESTRICT' | 'STOP'
export type Workload = 'light' | 'moderate' | 'heavy'
export type Lang = 'en' | 'es' | 'vi'

export interface AssessResponse {
  lat: number
  lon: number
  workload: string
  acclimatized: boolean
  location_label?: string | null
  current: {
    temperature_c: number | null
    temperature_f: number | null
    relative_humidity: number | null
    heat_index_f: number | null
    heat_band: string
    effective_heat_band: string
    wind_speed_kmh: number | null
    wind_direction_deg: number | null
    verdict: Verdict
    disclaimer: string
  }
  hourly: Array<{
    hour: number
    valid_at?: string | null
    temperature_c?: number | null
    heat_index_f?: number | null
    heat_band: string
    smoke_pressure: number
    verdict: Verdict
    work_minutes: number
    rest_minutes: number
    note: string
  }>
  schedule: {
    hard_stop_window: string | null
    best_work_window: string | null
    total_safe_hours: number
  }
  smoke: {
    smoke_pressure: number
    label: string
    upwind_count: number
    considered_count: number
    note: string
  }
  climatology: {
    today_temp_c: number | null
    baseline_temp_c: number | null
    delta_c: number | null
    message: string
    note: string
  }
  data_freshness: {
    items: Array<{ source: string; fetched_at: string | null; is_stale: boolean }>
    any_stale: boolean
  }
  sources: Array<{ name: string; url: string; role: string }>
  served_from_cache: boolean
  demo_mode: boolean
}

export interface BriefResponse {
  verdict_line: string
  three_actions: [string, string, string] | string[]
  schedule_sentence: string
  warning_signs: [string, string, string] | string[]
  language: string
  used_fallback: boolean
  cached: boolean
}

export interface FirePoint {
  latitude: number
  longitude: number
  frp: number | null
  acq_date: string
  acq_time: string
  satellite: string
}

export const DEMO_LOCATIONS = [
  { key: 'hot_clear', label: 'Phoenix, AZ (hot + clear)', lat: 33.45, lon: -112.07 },
  { key: 'hot_smoky', label: 'Inland Empire, CA (hot + fires nearby)', lat: 34.05, lon: -117.25 },
  { key: 'benign', label: 'Seattle, WA (benign control)', lat: 47.61, lon: -122.33 },
] as const
