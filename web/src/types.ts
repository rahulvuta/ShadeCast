export type Verdict = 'GO' | 'CAUTION' | 'RESTRICT' | 'STOP'
export type Workload = 'light' | 'moderate' | 'heavy'
export type Lang = 'en' | 'es' | 'vi'
export type ConfidenceLevel = 'HIGH' | 'MODERATE' | 'LOW' | 'UNUSABLE'
export type SensitivityProfile =
  | 'general'
  | 'asthma_respiratory'
  | 'cardiovascular'
  | 'pregnant'
  | 'youth_athlete'
  | 'over_65'

export interface Driver {
  name: string
  contribution: number
  detail: string
}

export interface DataConfidence {
  level: ConfidenceLevel
  score: number
  findings: Array<{
    check_id: string
    severity: string
    message: string
    field: string
    observed?: unknown
    expected_range: string
  }>
  sources_degraded: string[]
  narration?: string | null
  caveat?: string | null
  verdict_escalated?: boolean
}

export interface ActionItem {
  id: string
  title: string
  body: string
  source_url: string
  source_name: string
  trigger: string
}

export interface AssessResponse {
  lat: number
  lon: number
  workload: string
  acclimatized: boolean
  location_label?: string | null
  sensitivity_profile?: string
  current: {
    temperature_c: number | null
    temperature_f: number | null
    relative_humidity: number | null
    heat_index_f: number | null
    heat_band: string
    effective_heat_band: string
    wind_speed_kmh: number | null
    wind_direction_deg: number | null
    wind_gusts_kmh?: number | null
    uv_index?: number | null
    us_aqi?: number | null
    pm2_5?: number | null
    verdict: Verdict | null
    disclaimer: string
  }
  hourly: Array<{
    hour: number
    valid_at?: string | null
    day?: string | null
    temperature_c?: number | null
    heat_index_f?: number | null
    heat_band: string
    smoke_pressure: number
    uv_index?: number | null
    us_aqi?: number | null
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
  days?: Array<{
    day: string
    hard_stop_window: string | null
    best_work_window: string | null
    total_safe_hours: number
    worst_verdict: string
    total_work_minutes: number
  }>
  shift_windows?: Array<{
    day: string
    start_hour: number
    end_hour: number
    required_hours: number
    mean_rank: number
    label: string
  }>
  smoke: {
    smoke_pressure: number
    label: string
    upwind_count: number
    considered_count: number
    note: string
  }
  uv?: {
    daily_max: number
    band: string
    clear_sky_max?: number | null
    peak_hour?: number | null
    minutes_to_burn?: number | null
    skin_type?: number
    note?: string
  } | null
  air?: {
    us_aqi: number | null
    pm2_5: number | null
    aqi_band: string | null
    concordance: string
    dominant_pollutant?: string | null
    note?: string
  } | null
  environmental_load?: {
    load_score: number
    drivers: Driver[]
    concordance: string
    interactions: string[]
    ceiling_reason: string
    reason: string
    exposure_minutes_cap?: number | null
    profile?: string
  } | null
  explain_text?: string | null
  ceiling_reason?: string | null
  actions?: ActionItem[]
  diff_summary?: string | null
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
  data_confidence?: DataConfidence | null
  sources: Array<{ name: string; url: string; role: string }>
  served_from_cache: boolean
  demo_mode: boolean
  last_good_assessment_at?: string | null
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

export interface IncidentLogEntry {
  id: string
  at: string
  lat: number
  lon: number
  label: string
  note: string
  verdict: string | null
}

export const DEMO_LOCATIONS = [
  { key: 'hot_clear', label: 'Phoenix, AZ (hot + clear)', lat: 33.45, lon: -112.07 },
  { key: 'hot_smoky', label: 'Inland Empire, CA (hot + fires nearby)', lat: 34.05, lon: -117.25 },
  { key: 'benign', label: 'Seattle, WA (benign control)', lat: 47.61, lon: -122.33 },
] as const

export const SENSITIVITY_PROFILES: Array<{ key: SensitivityProfile; label: string }> = [
  { key: 'general', label: 'General outdoor worker' },
  { key: 'asthma_respiratory', label: 'Asthma / respiratory' },
  { key: 'cardiovascular', label: 'Cardiovascular' },
  { key: 'pregnant', label: 'Pregnant' },
  { key: 'youth_athlete', label: 'Youth athlete' },
  { key: 'over_65', label: 'Age 65+' },
]
