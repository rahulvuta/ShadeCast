export type Verdict = 'GO' | 'CAUTION' | 'RESTRICT' | 'STOP'
export type Workload = 'light' | 'moderate' | 'heavy'
export type Lang = 'en' | 'es' | 'vi'
export type ConfidenceLevel = 'HIGH' | 'MODERATE' | 'LOW' | 'UNUSABLE'
export type SensitivityProfile =
  | 'general'
  | 'asthma_respiratory'
  | 'cardiovascular'
  | 'children'
  | 'athlete'
  | 'over_65'

export interface Driver {
  name: string
  contribution: number
  detail: string
}

export interface WaterfallStep {
  id: string
  label: string
  delta: number
  running_total: number
  raw_value?: string | null
  mechanism?: string | null
  kind: string
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
  category?: string | null
  body_zone?: string | null
}

export interface HourlyAssessment {
  hour: number
  valid_at?: string | null
  day?: string | null
  temperature_c?: number | null
  heat_index_f?: number | null
  heat_band: string
  smoke_pressure: number
  uv_index?: number | null
  us_aqi?: number | null
  wind_direction_deg?: number | null
  wind_speed_kmh?: number | null
  wind_gusts_kmh?: number | null
  verdict: Verdict
  work_minutes: number
  rest_minutes: number
  note: string
  is_current?: boolean
  load_score?: number | null
  driver_stack?: Record<string, number>
  interactions?: string[]
  relative_humidity?: number | null
  humidity_band?: string | null
  weather_text?: string | null
  weather_source?: string | null
  precipitation_probability?: number | null
  weathercode?: number | null
  storm_band?: string | null
  lightning_risk?: boolean
  precaution?: string | null
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
  hourly: HourlyAssessment[]
  horizon?: HourlyAssessment[]
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
    daypart?: string
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
    waterfall?: WaterfallStep[]
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
  is_historical?: boolean
  historical_event?: {
    id: string
    label: string
    start_date: string
    end_date: string
    hour_offset: number
    description?: string
    source_url?: string
    retrieved_at?: string | null
  } | null
  expected_verdict?: string[]
  actual_vs_expected?: {
    status: string
    matched?: boolean | null
    actual?: string | null
    expected: string[]
  } | null
  /** FIRMS detections used by the engine (historical bundles include these for the map). */
  fires?: FirePoint[]
  nws_status?: {
    available: boolean
    state: 'active' | 'outside_us' | 'pending' | 'unavailable'
    message: string
    office?: string | null
    current_temp_source?: 'open-meteo' | 'nws'
    current_wind_source?: 'open-meteo' | 'nws'
    near_term_overridden_hours?: number
    alert_count?: number
  } | null
  active_alerts?: Array<{
    id: string
    event: string
    severity?: string | null
    urgency?: string | null
    certainty?: string | null
    onset?: string | null
    expires?: string | null
    headline?: string | null
    description?: string | null
    area?: string | null
    web?: string | null
    is_warning?: boolean
    is_watch?: boolean
  }>
  storm?: {
    storm_band: string
    lightning_risk: boolean
    hard_stop: boolean
    watch_note?: string | null
    headline_quote?: string | null
    headline_event?: string | null
    source?: string
    hazard_class?: string | null
    hazard_classes?: string[]
  } | null
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

/** Hidden 4th demo — shown only when ?corrupt=1 */
export const CORRUPT_DEMO = {
  key: 'corrupt',
  label: 'Integrity demo (corrupt feed)',
  lat: -89.9,
  lon: 179.9,
} as const

export const SENSITIVITY_PROFILES: Array<{ key: SensitivityProfile; label: string }> = [
  { key: 'general', label: 'Regular' },
  { key: 'asthma_respiratory', label: 'Respiratory weakness' },
  { key: 'cardiovascular', label: 'Cardiovascular weakness' },
  { key: 'children', label: 'Children' },
  { key: 'athlete', label: 'Athlete' },
  { key: 'over_65', label: 'Age 65+' },
]
