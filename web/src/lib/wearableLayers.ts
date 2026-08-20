import { LIBRARY_ACTION_IDS } from './kitIcons'

export type WearableZone = 'head' | 'eyes' | 'torso' | 'hands' | 'feet' | 'respiratory' | 'legs'

export const WEARABLE_LAYERS = [
  'jeans',
  'tee',
  'boots',
  'shirt',
  'layers',
  'hivis',
  'towel',
  'n95',
  'sunglasses',
  'goggles',
  'hat',
] as const

export type WearableLayer = (typeof WEARABLE_LAYERS)[number]

export const WEARABLE_SKIP_IDS = [
  'clothing_uv_spf',
  'clothing_heat_ppe_conflict',
  'clothing_storm_lightning_metal',
] as const

const LAYER_ZONE: Record<WearableLayer, WearableZone> = {
  jeans: 'legs',
  tee: 'torso',
  hat: 'head',
  towel: 'head',
  sunglasses: 'eyes',
  goggles: 'eyes',
  n95: 'respiratory',
  shirt: 'torso',
  hivis: 'torso',
  layers: 'torso',
  boots: 'feet',
}

const BASE_LAYERS = new Set<WearableLayer>(['jeans', 'tee'])

/** clothing_* library id → overlay file (null = list-only, not drawn). */
export const WEARABLE_BY_ID: Record<string, WearableLayer | null> = {
  clothing_uv_hat: 'hat',
  clothing_heat_cooling_towel: 'towel',
  clothing_uv_sunglasses: 'sunglasses',
  clothing_smoke_eye: 'goggles',
  clothing_smoke_n95: 'n95',
  clothing_uv_upf_shirt: 'shirt',
  clothing_heat_loose_light: 'shirt',
  clothing_heat_wicking: 'shirt',
  clothing_storm_secure: 'shirt',
  clothing_storm_hivis: 'hivis',
  clothing_overnight_layers: 'layers',
  clothing_storm_footwear: 'boots',
  clothing_overnight_feet: 'boots',
  clothing_uv_spf: null,
  clothing_heat_ppe_conflict: null,
  clothing_storm_lightning_metal: null,
}

export type ActiveWearable = {
  layer: WearableLayer
  src: string
  zone: WearableZone
  base: boolean
}

export function clothingLibraryIds(): string[] {
  return LIBRARY_ACTION_IDS.filter((id) => id.startsWith('clothing_'))
}

export function wearableLayersFor(ids: string[]): ActiveWearable[] {
  const wanted = new Set<WearableLayer>(['jeans'])
  for (const id of ids) {
    if (!(id in WEARABLE_BY_ID)) continue
    const layer = WEARABLE_BY_ID[id]
    if (layer) wanted.add(layer)
  }
  if (wanted.has('goggles')) wanted.delete('sunglasses')
  if (wanted.has('shirt') || wanted.has('layers')) wanted.delete('tee')
  else wanted.add('tee')
  return WEARABLE_LAYERS.filter((layer) => wanted.has(layer)).map((layer) => ({
    layer,
    src: `/kit/${layer}.png`,
    zone: LAYER_ZONE[layer],
    base: BASE_LAYERS.has(layer),
  }))
}
