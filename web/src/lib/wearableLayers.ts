import { LIBRARY_ACTION_IDS } from './kitIcons'

export type WearableZone = 'head' | 'eyes' | 'torso' | 'hands' | 'feet' | 'respiratory'

export const WEARABLE_LAYERS = [
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
}

export function clothingLibraryIds(): string[] {
  return LIBRARY_ACTION_IDS.filter((id) => id.startsWith('clothing_'))
}

export function wearableLayersFor(ids: string[]): ActiveWearable[] {
  const wanted = new Set<WearableLayer>()
  for (const id of ids) {
    if (!(id in WEARABLE_BY_ID)) continue
    const layer = WEARABLE_BY_ID[id]
    if (layer) wanted.add(layer)
  }
  if (wanted.has('goggles')) wanted.delete('sunglasses')
  return WEARABLE_LAYERS.filter((layer) => wanted.has(layer)).map((layer) => ({
    layer,
    src: `/kit/${layer}.png`,
    zone: LAYER_ZONE[layer],
  }))
}
