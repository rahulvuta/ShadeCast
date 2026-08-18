/** Catalog of integrity checks — mirrors api/integrity/checks.py families. */

export type IntegrityCategory =
  | 'range'
  | 'physical'
  | 'cross-source'
  | 'completeness'
  | 'staleness'

export type CatalogCheck = {
  id: string
  category: IntegrityCategory
  label: string
}

export const INTEGRITY_CATALOG: CatalogCheck[] = [
  { id: 'rh_range', category: 'range', label: 'Relative humidity in 0–100%' },
  { id: 'wind_negative', category: 'range', label: 'Wind speed non-negative' },
  { id: 'gust_below_sustained', category: 'range', label: 'Gusts ≥ sustained wind' },
  { id: 'pm25_range', category: 'range', label: 'PM2.5 in 0–1000 µg/m³' },
  { id: 'uv_range', category: 'range', label: 'UV index in 0–15' },
  { id: 'us_aqi_range', category: 'range', label: 'US AQI in 0–500' },

  { id: 'temp_physical_range', category: 'physical', label: 'Temperature within Earth-surface bounds' },
  { id: 'power_sentinel', category: 'physical', label: 'No POWER fill-value sentinel (−999)' },
  { id: 'dew_point_above_temp', category: 'physical', label: 'Dew point ≤ air temperature' },
  { id: 'hi_below_air_temp', category: 'physical', label: 'Heat index vs air temperature consistent' },
  { id: 'uv_above_clear_sky', category: 'physical', label: 'UV ≤ clear-sky ceiling' },

  { id: 'cross_temp_power', category: 'cross-source', label: 'Temp vs POWER climatology' },
  { id: 'uv_cross_source', category: 'cross-source', label: 'Forecast UV vs air-quality UV' },
  { id: 'hi_vs_apparent', category: 'cross-source', label: 'Rothfusz HI vs apparent temperature' },
  { id: 'nws_temp_divergence', category: 'cross-source', label: 'NWS vs Open-Meteo temperature' },
  { id: 'nws_wind_divergence', category: 'cross-source', label: 'NWS vs Open-Meteo wind' },
  { id: 'nws_alert_expired', category: 'cross-source', label: 'NWS alert expiry in the past' },
  { id: 'nws_missing_grid', category: 'completeness', label: 'NWS grid mapping present' },

  { id: 'empty_series', category: 'completeness', label: 'Hourly series present' },
  { id: 'required_nulls', category: 'completeness', label: 'Required temp/RH fields populated' },
  { id: 'partial_nulls', category: 'completeness', label: 'Partial null rate acceptable' },
  { id: 'missing_hours', category: 'completeness', label: 'No large gaps in timeline' },
  { id: 'horizon_short', category: 'completeness', label: 'Horizon coverage sufficient' },

  { id: 'stale_firms', category: 'staleness', label: 'FIRMS freshness' },
  { id: 'stale_forecast', category: 'staleness', label: 'Forecast freshness' },
  { id: 'stale_air_quality', category: 'staleness', label: 'Air-quality freshness' },
  { id: 'stale_climatology', category: 'staleness', label: 'Climatology freshness' },
]

export const CATEGORY_LABELS: Record<IntegrityCategory, string> = {
  range: 'Range',
  physical: 'Physical consistency',
  'cross-source': 'Cross-source',
  completeness: 'Completeness',
  staleness: 'Staleness',
}

const CATEGORY_ORDER: IntegrityCategory[] = [
  'range',
  'physical',
  'cross-source',
  'completeness',
  'staleness',
]

/** Map a finding check_id onto a catalog family id. */
export function catalogIdForFinding(checkId: string): string {
  const id = checkId.toLowerCase()
  if (id === 'firms_fetch_unknown') return 'stale_firms'
  if (id.startsWith('stale_forecast')) return 'stale_forecast'
  if (id.startsWith('hi_below_air_temp')) return 'hi_below_air_temp'
  if (id.startsWith('dew_point_above_temp')) return 'dew_point_above_temp'
  if (id.startsWith('uv_above_clear_sky')) return 'uv_above_clear_sky'
  if (id.startsWith('uv_cross_source')) return 'uv_cross_source'
  if (id.startsWith('hi_vs_apparent')) return 'hi_vs_apparent'
  if (id.startsWith('cross_temp_power')) return 'cross_temp_power'
  if (id.startsWith('nws_temp_divergence')) return 'nws_temp_divergence'
  if (id.startsWith('nws_wind_divergence')) return 'nws_wind_divergence'
  for (const c of INTEGRITY_CATALOG) {
    if (id === c.id || id.startsWith(`${c.id}_`)) return c.id
  }
  return id
}

export function groupedCatalog(): { category: IntegrityCategory; label: string; checks: CatalogCheck[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    checks: INTEGRITY_CATALOG.filter((c) => c.category === category),
  }))
}
