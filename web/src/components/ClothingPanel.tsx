import { useMemo, useState } from 'react'
import type { ActionItem } from '../types'
import { kitGlyphFor } from '../lib/kitIcons'
import { wearableLayersFor } from '../lib/wearableLayers'
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
  clothingIds,
}: {
  occupied: Set<BodyZone>
  selected: BodyZone
  onSelect: (zone: BodyZone) => void
  clothingIds: string[]
}) {
  const layers = wearableLayersFor(clothingIds)

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
        className={`absolute z-10 border-0 bg-transparent p-0 ${enabled ? 'cursor-pointer' : 'cursor-default'} ${className}`}
      >
        <span className="sr-only">{label}</span>
      </button>
    )
  }

  return (
    <figure
      className="relative mx-auto w-full max-w-[220px]"
      aria-label="Body zones with clothing recommendations"
    >
      <img
        src="/kit/figure.png"
        alt=""
        className="kit-figure-outline relative z-0 h-auto w-full"
        draggable={false}
      />
      {layers.map((layer) => (
        <img
          key={layer.layer}
          src={layer.src}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 z-[1] h-full w-full object-contain"
          style={{ opacity: layer.zone === selected ? 1 : 0.55 }}
        />
      ))}
      <ZoneHit zone="head" label="Head" className="left-[32%] top-[1%] h-[15%] w-[36%]" />
      <ZoneHit zone="eyes" label="Eyes" className="left-[36%] top-[7%] h-[5%] w-[28%]" />
      <ZoneHit zone="respiratory" label="Respiratory" className="left-[36%] top-[12%] h-[6%] w-[28%]" />
      <ZoneHit zone="torso" label="Torso" className="left-[28%] top-[20%] h-[32%] w-[44%]" />
      <ZoneHit zone="hands" label="Hands" className="left-[2%] top-[36%] h-[16%] w-[22%]" />
      <ZoneHit zone="hands" label="Hands" className="right-[2%] top-[36%] h-[16%] w-[22%]" />
      <ZoneHit zone="feet" label="Feet" className="left-[18%] top-[84%] h-[14%] w-[64%]" />
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
  const clothingIds = clothing.map((a) => a.id)

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
        <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-start">
          {active && (
            <BodyFigure
              occupied={occupied}
              selected={active}
              onSelect={setSelected}
              clothingIds={clothingIds}
            />
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
