import { useMemo, useState } from 'react'
import type { ActionItem } from '../types'
import { kitGlyphFor } from '../lib/kitIcons'
import { KitIcon } from './KitIcon'
import { WhySource } from './WhySource'

export const ZONE_ORDER = ['head', 'eyes', 'torso', 'hands', 'feet', 'respiratory'] as const
export type BodyZone = (typeof ZONE_ORDER)[number]

const ZONE_LABEL: Record<BodyZone, string> = {
  head: 'Head',
  eyes: 'Eyes',
  torso: 'Torso',
  hands: 'Hands',
  feet: 'Feet',
  respiratory: 'Respiratory',
}

function isBodyZone(z: string | null | undefined): z is BodyZone {
  return !!z && (ZONE_ORDER as readonly string[]).includes(z)
}

function ItemRows({ items }: { items: ActionItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id} className="flex items-start gap-2">
          <KitIcon glyph={kitGlyphFor(a.id)} className="mt-0.5 inline-flex shrink-0 text-[var(--ink)]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{a.title}</p>
            <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{a.body}</p>
            <WhySource body={a.body} sourceUrl={a.source_url} sourceName={a.source_name} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function BodyFigure({
  occupied,
  selected,
  onSelect,
}: {
  occupied: Set<BodyZone>
  selected: BodyZone
  onSelect: (zone: BodyZone) => void
}) {
  const fill = (zone: BodyZone, active: boolean) => {
    if (!occupied.has(zone)) return 'transparent'
    if (active) return 'color-mix(in srgb, var(--ink) 28%, transparent)'
    return 'color-mix(in srgb, var(--ink) 10%, transparent)'
  }
  const stroke = (zone: BodyZone, active: boolean) => {
    if (!occupied.has(zone)) return 'var(--border)'
    if (active) return 'var(--ink)'
    return 'color-mix(in srgb, var(--ink) 45%, var(--border))'
  }

  function ZoneHit({
    zone,
    label,
    className,
  }: {
    zone: BodyZone
    label: string
    className: string
  }) {
    const enabled = occupied.has(zone)
    return (
      <button
        type="button"
        disabled={!enabled}
        aria-pressed={selected === zone}
        aria-label={`${label}${enabled ? '' : ' (none recommended)'}`}
        onClick={() => onSelect(zone)}
        className={`absolute border-0 bg-transparent p-0 ${enabled ? 'cursor-pointer' : 'cursor-default'} ${className}`}
      >
        <span className="sr-only">{label}</span>
      </button>
    )
  }

  return (
    <figure className="relative mx-auto w-full max-w-[180px]">
      <svg
        viewBox="0 0 120 280"
        className="h-auto w-full"
        role="img"
        aria-label="Body zones with clothing recommendations"
      >
        {/* Head */}
        <circle
          cx="60"
          cy="32"
          r="22"
          fill={fill('head', selected === 'head')}
          stroke={stroke('head', selected === 'head')}
          strokeWidth="1.8"
        />
        {/* Eyes */}
        <ellipse
          cx="52"
          cy="30"
          rx="6"
          ry="3.5"
          fill={fill('eyes', selected === 'eyes')}
          stroke={stroke('eyes', selected === 'eyes')}
          strokeWidth="1.4"
        />
        <ellipse
          cx="68"
          cy="30"
          rx="6"
          ry="3.5"
          fill={fill('eyes', selected === 'eyes')}
          stroke={stroke('eyes', selected === 'eyes')}
          strokeWidth="1.4"
        />
        {/* Respiratory / lower face */}
        <path
          d="M46 40h28v12c0 6-6 11-14 11s-14-5-14-11z"
          fill={fill('respiratory', selected === 'respiratory')}
          stroke={stroke('respiratory', selected === 'respiratory')}
          strokeWidth="1.4"
        />
        {/* Torso */}
        <path
          d="M38 68h44l8 18v78H30V86z"
          fill={fill('torso', selected === 'torso')}
          stroke={stroke('torso', selected === 'torso')}
          strokeWidth="1.8"
        />
        {/* Hands / arms */}
        <path
          d="M38 72 18 108l10 8 16-28"
          fill={fill('hands', selected === 'hands')}
          stroke={stroke('hands', selected === 'hands')}
          strokeWidth="1.8"
        />
        <path
          d="M82 72l20 36-10 8-16-28"
          fill={fill('hands', selected === 'hands')}
          stroke={stroke('hands', selected === 'hands')}
          strokeWidth="1.8"
        />
        <circle
          cx="16"
          cy="118"
          r="8"
          fill={fill('hands', selected === 'hands')}
          stroke={stroke('hands', selected === 'hands')}
          strokeWidth="1.6"
        />
        <circle
          cx="104"
          cy="118"
          r="8"
          fill={fill('hands', selected === 'hands')}
          stroke={stroke('hands', selected === 'hands')}
          strokeWidth="1.6"
        />
        {/* Legs + feet */}
        <path
          d="M38 164h18v70H34z"
          fill="transparent"
          stroke="var(--border)"
          strokeWidth="1.6"
        />
        <path
          d="M64 164h18v70H64z"
          fill="transparent"
          stroke="var(--border)"
          strokeWidth="1.6"
        />
        <path
          d="M22 236h36v16H26c-4 0-6-3-4-16z"
          fill={fill('feet', selected === 'feet')}
          stroke={stroke('feet', selected === 'feet')}
          strokeWidth="1.8"
        />
        <path
          d="M62 236h36l-4 16H62z"
          fill={fill('feet', selected === 'feet')}
          stroke={stroke('feet', selected === 'feet')}
          strokeWidth="1.8"
        />
      </svg>
      <ZoneHit zone="head" label="Head" className="left-[28%] top-[2%] h-[16%] w-[44%]" />
      <ZoneHit zone="eyes" label="Eyes" className="left-[32%] top-[8%] h-[6%] w-[36%]" />
      <ZoneHit zone="respiratory" label="Respiratory" className="left-[32%] top-[13%] h-[8%] w-[36%]" />
      <ZoneHit zone="torso" label="Torso" className="left-[24%] top-[24%] h-[34%] w-[52%]" />
      <ZoneHit zone="hands" label="Hands" className="left-[2%] top-[26%] h-[22%] w-[22%]" />
      <ZoneHit zone="hands" label="Hands" className="right-[2%] top-[26%] h-[22%] w-[22%]" />
      <ZoneHit zone="feet" label="Feet" className="left-[12%] top-[82%] h-[14%] w-[76%]" />
    </figure>
  )
}

export function ClothingPanel({
  actions,
  textMode = false,
}: {
  actions: ActionItem[]
  textMode?: boolean
}) {
  const clothing = actions.filter((a) => a.category === 'clothing')
  const grouped = useMemo(() => {
    const map = new Map<BodyZone, ActionItem[]>()
    const other: ActionItem[] = []
    for (const item of clothing) {
      if (isBodyZone(item.body_zone)) {
        const list = map.get(item.body_zone) ?? []
        list.push(item)
        map.set(item.body_zone, list)
      } else {
        other.push(item)
      }
    }
    return { map, other }
  }, [clothing])

  const zones = ZONE_ORDER.filter((z) => (grouped.map.get(z) ?? []).length > 0)
  const occupied = useMemo(() => new Set(zones), [zones])
  const [selected, setSelected] = useState<BodyZone | null>(null)
  const active = selected && occupied.has(selected) ? selected : (zones[0] ?? null)

  if (!clothing.length) return null

  return (
    <section aria-labelledby="clothing-heading" className="dash-panel p-3.5">
      <h2 id="clothing-heading" className="dash-section-label">
        Clothing and PPE
      </h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Deterministic kit list from the same sourced library as the action cards. Select a body zone.
      </p>

      {textMode ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {zones.map((zone) => (
            <div key={zone}>
              <h3 className="text-sm font-bold">{ZONE_LABEL[zone]}</h3>
              <div className="mt-1.5">
                <ItemRows items={grouped.map.get(zone) ?? []} />
              </div>
            </div>
          ))}
          {grouped.other.length > 0 && (
            <div>
              <h3 className="text-sm font-bold">Other</h3>
              <div className="mt-1.5">
                <ItemRows items={grouped.other} />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,180px)_1fr] sm:items-start">
          {active && (
            <BodyFigure occupied={occupied} selected={active} onSelect={setSelected} />
          )}
          <div>
            {active ? (
              <>
                <h3 className="text-sm font-bold">{ZONE_LABEL[active]}</h3>
                <div className="mt-2">
                  <ItemRows items={grouped.map.get(active) ?? []} />
                </div>
              </>
            ) : (
              <p className="text-xs text-[var(--muted)]">No zone-specific items.</p>
            )}
            {grouped.other.length > 0 && (
              <div className="mt-4 border-t border-[var(--border)] pt-3">
                <h3 className="text-sm font-bold">Other</h3>
                <div className="mt-2">
                  <ItemRows items={grouped.other} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
