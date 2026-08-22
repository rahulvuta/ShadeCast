/** Normalize stressors to a 0–100 hazard scale for the multi-condition chart. */

export type HazardKey = 'heat' | 'uv' | 'aqi' | 'smoke' | 'wind'

export const HAZARD_META: Record<
  HazardKey,
  { label: string; color: string; dash: string; unit: string; thresholdLabel: string; thresholdRaw: number }
> = {
  heat: {
    label: 'Heat index',
    color: '#E69F00',
    dash: '0',
    unit: '°F',
    thresholdLabel: 'DANGER',
    thresholdRaw: 103,
  },
  uv: {
    label: 'UV index',
    color: '#0072B2',
    dash: '6 4',
    unit: '',
    thresholdLabel: 'HIGH',
    thresholdRaw: 6,
  },
  aqi: {
    label: 'US AQI',
    color: '#CC79A7',
    dash: '2 4',
    unit: '',
    thresholdLabel: 'Unhealthy',
    thresholdRaw: 151,
  },
  smoke: {
    label: 'Smoke pressure',
    color: '#D55E00',
    dash: '8 4 2 4',
    unit: '',
    thresholdLabel: 'Elevated',
    thresholdRaw: 10,
  },
  wind: {
    label: 'Wind (sustained)',
    color: '#56B4E9',
    dash: '1 6',
    unit: 'km/h',
    thresholdLabel: 'Hard stop',
    thresholdRaw: 40,
  },
}

export function clamp01to100(n: number): number {
  return Math.max(0, Math.min(100, n))
}

export function heatIndexHazard(hiF: number | null | undefined): number | null {
  if (hiF == null) return null
  return clamp01to100(((hiF - 80) / (125 - 80)) * 100)
}

export function uvHazard(uvi: number | null | undefined): number | null {
  if (uvi == null) return null
  return clamp01to100((uvi / 11) * 100)
}

export function aqiHazard(aqi: number | null | undefined): number | null {
  if (aqi == null) return null
  return clamp01to100((aqi / 500) * 100)
}

export function smokeHazard(pressure: number | null | undefined): number | null {
  if (pressure == null) return null
  return clamp01to100(pressure)
}

export function windHazard(gustKmh: number | null | undefined): number | null {
  if (gustKmh == null) return null
  return clamp01to100((gustKmh / 80) * 100)
}

export function thresholdHazard(key: HazardKey): number {
  switch (key) {
    case 'heat':
      return heatIndexHazard(HAZARD_META.heat.thresholdRaw) ?? 0
    case 'uv':
      return uvHazard(HAZARD_META.uv.thresholdRaw) ?? 0
    case 'aqi':
      return aqiHazard(HAZARD_META.aqi.thresholdRaw) ?? 0
    case 'smoke':
      return smokeHazard(HAZARD_META.smoke.thresholdRaw) ?? 0
    case 'wind':
      return windHazard(HAZARD_META.wind.thresholdRaw) ?? 0
  }
}

const DRIVER_IDS = ['heat', 'smoke', 'air_quality', 'uv', 'wind'] as const

/** Scale waterfall driver deltas so they sum to load_score. */
export function stackFromDriverMap(
  parts: Record<string, number>,
  loadScore: number,
): Record<string, number> {
  const total = Object.values(parts).reduce((a, b) => a + b, 0)
  if (total <= 0 || loadScore <= 0) return {}
  let scaled: Record<string, number>
  if (Math.abs(total - loadScore) < 0.05) {
    scaled = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 100) / 100]))
  } else {
    const scale = loadScore / total
    scaled = Object.fromEntries(
      Object.entries(parts).map(([k, v]) => [k, Math.round(v * scale * 100) / 100]),
    )
  }
  const drift =
    Math.round((loadScore - Object.values(scaled).reduce((a, b) => a + b, 0)) * 100) / 100
  const keys = Object.keys(scaled)
  if (keys.length && Math.abs(drift) >= 0.01) {
    const top = keys.reduce((a, b) => (Math.abs(scaled[a] ?? 0) >= Math.abs(scaled[b] ?? 0) ? a : b))
    scaled[top] = Math.round(((scaled[top] ?? 0) + drift) * 100) / 100
  }
  return scaled
}

export function stackSumsToLoadScore(
  stack: Record<string, number>,
  loadScore: number,
  eps = 0.05,
): boolean {
  const sum = DRIVER_IDS.reduce((acc, id) => acc + (stack[id] ?? 0), 0)
  return Math.abs(sum - loadScore) < eps
}
