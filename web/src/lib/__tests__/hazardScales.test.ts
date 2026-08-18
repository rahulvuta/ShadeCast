import { describe, expect, it } from 'vitest'
import { stackFromDriverMap, stackSumsToLoadScore } from '../hazardScales'

describe('stackFromDriverMap', () => {
  it('sums to load_score when already aligned', () => {
    const parts = { heat: 20, smoke: 10, air_quality: 5, uv: 4, wind: 1 }
    const load = 40
    const stack = stackFromDriverMap(parts, load)
    expect(stackSumsToLoadScore(stack, load)).toBe(true)
  })

  it('rescales driver slices when they exceed the cap', () => {
    const parts = { heat: 80, smoke: 50, air_quality: 20 }
    const load = 100
    const stack = stackFromDriverMap(parts, load)
    const sum = Object.values(stack).reduce((a, b) => a + b, 0)
    expect(Math.abs(sum - load)).toBeLessThan(0.05)
  })
})
