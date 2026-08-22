import { describe, expect, it } from 'vitest'
import { parseDeepLinkLocation, parseLatLonInputs } from '../coords'

describe('parseLatLonInputs', () => {
  it('rejects empty and blank strings instead of coercing to 0', () => {
    expect(parseLatLonInputs('', '').ok).toBe(false)
    expect(parseLatLonInputs('  ', '1').ok).toBe(false)
    expect(parseLatLonInputs('1', '').ok).toBe(false)
    expect(Number('')).toBe(0)
  })

  it('accepts a real equator / prime-meridian point', () => {
    const parsed = parseLatLonInputs('0', '0')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.lat).toBe(0)
      expect(parsed.lon).toBe(0)
    }
  })

  it('rejects out-of-range values', () => {
    expect(parseLatLonInputs('91', '0').ok).toBe(false)
    expect(parseLatLonInputs('0', '181').ok).toBe(false)
  })
})

describe('parseDeepLinkLocation', () => {
  it('allows 0,0 shares', () => {
    const loc = parseDeepLinkLocation('?lat=0&lon=0')
    expect(loc).toEqual({ lat: 0, lon: 0, label: '0.000, 0.000' })
  })

  it('rejects missing or blank lat/lon', () => {
    expect(parseDeepLinkLocation('?lon=10')).toBeNull()
    expect(parseDeepLinkLocation('?lat=&lon=10')).toBeNull()
    expect(parseDeepLinkLocation('')).toBeNull()
  })
})
