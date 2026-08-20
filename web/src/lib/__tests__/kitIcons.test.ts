import { describe, expect, it } from 'vitest'
import { climBarPositions } from '../../components/ClimatologyLine'
import {
  KIT_BY_ID,
  KIT_GLYPHS,
  LIBRARY_ACTION_IDS,
  kitGlyphFor,
  triggerFamily,
} from '../kitIcons'

describe('kitGlyphFor', () => {
  it('maps every current library id to a known glyph', () => {
    for (const id of LIBRARY_ACTION_IDS) {
      expect(KIT_GLYPHS).toContain(KIT_BY_ID[id])
    }
    expect(Object.keys(KIT_BY_ID).sort()).toEqual([...LIBRARY_ACTION_IDS].sort())
  })

  it('falls back to warn for unknown ids', () => {
    expect(kitGlyphFor('not_in_library')).toBe('warn')
  })

  it('uses object glyphs for kit items and warn for abstractions', () => {
    expect(kitGlyphFor('uv_spf30')).toBe('sunscreen')
    expect(kitGlyphFor('clothing_uv_hat')).toBe('hat')
    expect(kitGlyphFor('clothing_smoke_n95')).toBe('respirator')
    expect(kitGlyphFor('heat_emergency_cool')).toBe('warn')
    expect(kitGlyphFor('clothing_storm_lightning_metal')).toBe('warn')
  })
})

describe('triggerFamily', () => {
  it('collapses heat variants and crew triggers', () => {
    expect(triggerFamily('heat_ppe')).toBe('heat')
    expect(triggerFamily('heat_emergency')).toBe('heat')
    expect(triggerFamily('youth')).toBe('crew')
    expect(triggerFamily('sensitive')).toBe('crew')
    expect(triggerFamily('overnight')).toBe('night')
    expect(triggerFamily('high_uv')).toBe('uv')
  })
})

describe('climBarPositions', () => {
  it('places today and baseline on a padded scale', () => {
    const bar = climBarPositions(28.5, 24.4, 2)
    expect(bar.todayPct).toBeGreaterThan(bar.baselinePct)
    expect(bar.todayPct).toBeLessThanOrEqual(100)
    expect(bar.baselinePct).toBeGreaterThanOrEqual(0)
  })
})
