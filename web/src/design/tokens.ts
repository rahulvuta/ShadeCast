/**
 * ShadeCast design tokens — single source for type, spacing, elevation, verdict color.
 * CSS custom properties in index.css mirror these for runtime theming.
 */

export const typeScale = {
  display: { size: 'clamp(4.5rem, 12vw, 6rem)', weight: 900, lineHeight: 0.95 },
  h1: { size: '1.75rem', weight: 700, lineHeight: 1.15 },
  h2: { size: '1.125rem', weight: 700, lineHeight: 1.25 },
  body: { size: '0.9375rem', weight: 400, lineHeight: 1.45 },
  caption: { size: '0.75rem', weight: 600, lineHeight: 1.35 },
  micro: { size: '0.65rem', weight: 600, lineHeight: 1.3 },
} as const

/** Spacing scale in px (4/8/12/16/24/32/48) */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
  7: 48,
} as const

export type VerdictKey = 'GO' | 'CAUTION' | 'RESTRICT' | 'STOP' | 'UNUSABLE'

/** Okabe–Ito-derived verdict palette with AA-oriented text on base. */
export const verdictPalette: Record<
  VerdictKey,
  { base: string; bg: string; border: string; text: string; glow: string }
> = {
  GO: {
    base: '#009E73',
    bg: 'rgba(0, 158, 115, 0.18)',
    border: '#009E73',
    text: '#FFFFFF',
    glow: 'rgba(0, 158, 115, 0.45)',
  },
  CAUTION: {
    base: '#E69F00',
    bg: 'rgba(230, 159, 0, 0.22)',
    border: '#E69F00',
    text: '#111111',
    glow: 'rgba(230, 159, 0, 0.4)',
  },
  RESTRICT: {
    base: '#D55E00',
    bg: 'rgba(213, 94, 0, 0.2)',
    border: '#D55E00',
    text: '#FFFFFF',
    glow: 'rgba(213, 94, 0, 0.45)',
  },
  STOP: {
    base: '#5A2D52',
    bg: 'rgba(90, 45, 82, 0.28)',
    border: '#5A2D52',
    text: '#FFFFFF',
    glow: 'rgba(90, 45, 82, 0.5)',
  },
  UNUSABLE: {
    base: '#5A6570',
    bg: 'rgba(90, 101, 112, 0.25)',
    border: '#5A6570',
    text: '#FFFFFF',
    glow: 'rgba(90, 101, 112, 0.35)',
  },
}

/** Relative luminance for WCAG contrast (sRGB). */
export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrastRatio(hexA: string, hexB: string): number {
  const L1 = relativeLuminance(hexA)
  const L2 = relativeLuminance(hexB)
  const lighter = Math.max(L1, L2)
  const darker = Math.min(L1, L2)
  return (lighter + 0.05) / (darker + 0.05)
}

export const THEME_STORAGE_KEY = 'shadecast_theme_v1'
export type ThemeMode = 'ops' | 'sunlight'
