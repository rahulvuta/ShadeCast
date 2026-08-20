/** Shared field-kit glyphs. One set, keyed by library id — not per-item art. */

export const KIT_GLYPHS = [
  'water',
  'pace',
  'sunscreen',
  'hat',
  'shirt',
  'glasses',
  'respirator',
  'boots',
  'warn',
] as const

export type KitGlyph = (typeof KIT_GLYPHS)[number]

/** Frozen snapshot of api/actions/library.yaml ids. A new YAML row must get a glyph. */
export const LIBRARY_ACTION_IDS = [
  'heat_water_rest_shade',
  'heat_slow_pace',
  'heat_emergency_cool',
  'heat_watch_symptoms',
  'smoke_reduce_exertion',
  'smoke_n95_voluntary',
  'aqi_sensitive_limit',
  'uv_spf30',
  'uv_shade_midday',
  'wind_secure_elevated',
  'athlete_acclimatize',
  'over65_extra_breaks',
  'children_heat_caution',
  'clothing_uv_hat',
  'clothing_uv_upf_shirt',
  'clothing_uv_sunglasses',
  'clothing_uv_spf',
  'clothing_heat_loose_light',
  'clothing_heat_wicking',
  'clothing_heat_cooling_towel',
  'clothing_heat_ppe_conflict',
  'clothing_smoke_n95',
  'clothing_smoke_eye',
  'clothing_storm_secure',
  'clothing_storm_hivis',
  'clothing_storm_lightning_metal',
  'clothing_storm_footwear',
  'clothing_overnight_layers',
  'clothing_overnight_feet',
] as const

export type LibraryActionId = (typeof LIBRARY_ACTION_IDS)[number]

export const KIT_BY_ID: Record<LibraryActionId, KitGlyph> = {
  heat_water_rest_shade: 'water',
  heat_slow_pace: 'pace',
  heat_emergency_cool: 'warn',
  heat_watch_symptoms: 'warn',
  smoke_reduce_exertion: 'pace',
  smoke_n95_voluntary: 'respirator',
  aqi_sensitive_limit: 'warn',
  uv_spf30: 'sunscreen',
  uv_shade_midday: 'hat',
  wind_secure_elevated: 'warn',
  athlete_acclimatize: 'warn',
  over65_extra_breaks: 'warn',
  children_heat_caution: 'warn',
  clothing_uv_hat: 'hat',
  clothing_uv_upf_shirt: 'shirt',
  clothing_uv_sunglasses: 'glasses',
  clothing_uv_spf: 'sunscreen',
  clothing_heat_loose_light: 'shirt',
  clothing_heat_wicking: 'shirt',
  clothing_heat_cooling_towel: 'water',
  clothing_heat_ppe_conflict: 'warn',
  clothing_smoke_n95: 'respirator',
  clothing_smoke_eye: 'glasses',
  clothing_storm_secure: 'shirt',
  clothing_storm_hivis: 'shirt',
  clothing_storm_lightning_metal: 'warn',
  clothing_storm_footwear: 'boots',
  clothing_overnight_layers: 'shirt',
  clothing_overnight_feet: 'boots',
}

export function kitGlyphFor(id: string): KitGlyph {
  if (id in KIT_BY_ID) return KIT_BY_ID[id as LibraryActionId]
  return 'warn'
}

export type TriggerFamily = 'heat' | 'smoke' | 'uv' | 'wind' | 'storm' | 'night' | 'crew'

export function triggerFamily(trigger: string): TriggerFamily {
  if (trigger === 'heat' || trigger === 'heat_emergency' || trigger === 'heat_ppe') return 'heat'
  if (trigger === 'smoke') return 'smoke'
  if (trigger === 'high_uv') return 'uv'
  if (trigger === 'high_wind') return 'wind'
  if (trigger === 'storm') return 'storm'
  if (trigger === 'overnight') return 'night'
  return 'crew'
}

export const TRIGGER_CHIP: Record<TriggerFamily, { label: string; rail: string; chip: string }> = {
  heat: {
    label: 'HEAT',
    rail: 'bg-[var(--restrict)]',
    chip: 'bg-[var(--restrict-bg)] text-[var(--restrict)]',
  },
  smoke: {
    label: 'SMOKE',
    rail: 'bg-[var(--oi-purple)]',
    chip: 'bg-[color-mix(in_srgb,var(--oi-purple)_22%,transparent)] text-[var(--oi-purple)]',
  },
  uv: {
    label: 'UV',
    rail: 'bg-[var(--oi-yellow)]',
    chip: 'bg-[var(--oi-yellow)] text-[#111111]',
  },
  wind: {
    label: 'WIND',
    rail: 'bg-[var(--oi-sky)]',
    chip: 'bg-[color-mix(in_srgb,var(--oi-sky)_22%,transparent)] text-[var(--oi-sky)]',
  },
  storm: {
    label: 'STORM',
    rail: 'bg-[var(--oi-sky)]',
    chip: 'bg-[color-mix(in_srgb,var(--oi-sky)_22%,transparent)] text-[var(--oi-sky)]',
  },
  night: {
    label: 'NIGHT',
    rail: 'bg-[var(--muted)]',
    chip: 'bg-[var(--chip-bg)] text-[var(--muted)]',
  },
  crew: {
    label: 'CREW',
    rail: 'bg-[var(--muted)]',
    chip: 'bg-[var(--chip-bg)] text-[var(--muted)]',
  },
}
