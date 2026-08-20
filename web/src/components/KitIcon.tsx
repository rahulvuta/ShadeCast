import type { JSX } from 'react'
import type { KitGlyph } from '../lib/kitIcons'

const common = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
}

function WaterIcon() {
  return (
    <svg {...common}>
      <path d="M12 3c0 0-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z" />
    </svg>
  )
}

function PaceIcon() {
  return (
    <svg {...common}>
      <circle cx="8" cy="6" r="2" />
      <path d="M10 9.5 8 14l3 2.5M8 14 5.5 20" />
      <path d="M12 11h4l2 3" />
      <path d="M16 20h4" />
    </svg>
  )
}

function SunscreenIcon() {
  return (
    <svg {...common}>
      <rect x="8" y="8" width="8" height="13" rx="1.5" />
      <path d="M10 8V5.5a2 2 0 0 1 4 0V8" />
      <path d="M11 13h2" />
    </svg>
  )
}

function HatIcon() {
  return (
    <svg {...common}>
      <path d="M4 14c2-1 4.5-1.5 8-1.5s6 .5 8 1.5" />
      <path d="M8 13.5V11c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5v2.5" />
    </svg>
  )
}

function ShirtIcon() {
  return (
    <svg {...common}>
      <path d="M9 5.5 12 7.5 15 5.5l3.5 2.5L16.5 11V20H7.5V11L5.5 8z" />
    </svg>
  )
}

function GlassesIcon() {
  return (
    <svg {...common}>
      <circle cx="8" cy="13" r="3.2" />
      <circle cx="16" cy="13" r="3.2" />
      <path d="M11.2 13h1.6M5 13H3.5M21 13h-1.5" />
    </svg>
  )
}

function RespiratorIcon() {
  return (
    <svg {...common}>
      <path d="M8 10h8v6H8z" />
      <path d="M10 10V8a2 2 0 0 1 4 0v2" />
      <path d="M9 16v2M15 16v2" />
      <path d="M8 13H6.5M18 13h-1.5" />
    </svg>
  )
}

function BootsIcon() {
  return (
    <svg {...common}>
      <path d="M6 16h9c2.2 0 3.5 1.1 3.5 2.8H7c-1.1 0-1.6-.8-1-2.8z" />
      <path d="M8 16V9.2c0-1.8 1.1-3.2 2.8-3.2H12" />
    </svg>
  )
}

function WarnIcon() {
  return (
    <svg {...common}>
      <path d="M12 4 21 19H3z" />
      <path d="M12 10v5" />
      <path d="M12 17.2v.3" />
    </svg>
  )
}

const GLYPH: Record<KitGlyph, () => JSX.Element> = {
  water: WaterIcon,
  pace: PaceIcon,
  sunscreen: SunscreenIcon,
  hat: HatIcon,
  shirt: ShirtIcon,
  glasses: GlassesIcon,
  respirator: RespiratorIcon,
  boots: BootsIcon,
  warn: WarnIcon,
}

export function KitIcon({ glyph, className }: { glyph: KitGlyph; className?: string }) {
  const Node = GLYPH[glyph]
  return (
    <span className={className ?? 'inline-flex shrink-0 text-[var(--ink)]'}>
      <Node />
    </span>
  )
}
