import { describe, expect, it } from 'vitest'
import { LIBRARY_ACTION_IDS } from '../kitIcons'
import {
  WEARABLE_BY_ID,
  WEARABLE_LAYERS,
  clothingLibraryIds,
  wearableLayersFor,
} from '../wearableLayers'

describe('wearableLayersFor', () => {
  it('maps every clothing library id to a layer or an explicit skip', () => {
    const clothing = LIBRARY_ACTION_IDS.filter((id) => id.startsWith('clothing_'))
    expect(clothingLibraryIds()).toEqual(clothing)
    for (const id of clothing) {
      expect(id in WEARABLE_BY_ID).toBe(true)
      const layer = WEARABLE_BY_ID[id]
      if (layer !== null) expect(WEARABLE_LAYERS).toContain(layer)
    }
  })

  it('stacks shirt once, prefers goggles over sunglasses, boots from either footwear id', () => {
    const layers = wearableLayersFor([
      'clothing_uv_upf_shirt',
      'clothing_heat_wicking',
      'clothing_uv_sunglasses',
      'clothing_smoke_eye',
      'clothing_overnight_feet',
      'clothing_uv_spf',
    ])
    expect(layers.map((l) => l.layer)).toEqual(['jeans', 'boots', 'shirt', 'goggles'])
  })

  it('always draws jeans and a t-shirt when no torso garment is recommended', () => {
    const layers = wearableLayersFor(['clothing_uv_spf'])
    expect(layers.map((l) => l.layer)).toEqual(['jeans', 'tee'])
    expect(layers.every((l) => l.base)).toBe(true)
  })
})
