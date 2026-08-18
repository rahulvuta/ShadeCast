import type { ActionItem } from '../types'

const ZONE_ORDER = ['head', 'eyes', 'torso', 'hands', 'feet', 'respiratory'] as const
type BodyZone = (typeof ZONE_ORDER)[number]

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

function ZoneIcon({ zone }: { zone: BodyZone }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    'aria-hidden': true as const,
  }
  switch (zone) {
    case 'head':
      return (
        <svg {...common}>
          <circle cx="12" cy="9" r="5" />
          <path d="M5 20c1.5-3 4-4.5 7-4.5S17.5 17 19 20" />
        </svg>
      )
    case 'eyes':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="12" rx="9" ry="5" />
          <circle cx="12" cy="12" r="2.2" />
        </svg>
      )
    case 'torso':
      return (
        <svg {...common}>
          <path d="M8 5h8l3 5v11H5V10l3-5z" />
        </svg>
      )
    case 'hands':
      return (
        <svg {...common}>
          <path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11" />
          <path d="M11 10.5V5.5a1.5 1.5 0 0 1 3 0V11" />
          <path d="M14 11V7.5a1.5 1.5 0 0 1 3 0V13c0 4-2 7-5 7s-5-3-5-7v-2" />
        </svg>
      )
    case 'feet':
      return (
        <svg {...common}>
          <path d="M5 16h9c2.5 0 4 1.2 4 3H6c-1 0-1.5-.8-1-3z" />
          <path d="M7 16V9c0-2 1.2-3.5 3-3.5h1" />
        </svg>
      )
    case 'respiratory':
      return (
        <svg {...common}>
          <path d="M8 10h8v6H8z" />
          <path d="M10 10V8a2 2 0 0 1 4 0v2" />
          <path d="M9 16v2M15 16v2" />
        </svg>
      )
  }
}

export function ClothingPanel({ actions }: { actions: ActionItem[] }) {
  const clothing = actions.filter((a) => a.category === 'clothing')
  if (!clothing.length) return null

  const grouped = new Map<BodyZone, ActionItem[]>()
  const other: ActionItem[] = []
  for (const item of clothing) {
    if (isBodyZone(item.body_zone)) {
      const list = grouped.get(item.body_zone) ?? []
      list.push(item)
      grouped.set(item.body_zone, list)
    } else {
      other.push(item)
    }
  }

  const zones = ZONE_ORDER.filter((z) => (grouped.get(z) ?? []).length > 0)

  return (
    <section aria-labelledby="clothing-heading" className="dash-panel p-3.5">
      <h2 id="clothing-heading" className="dash-section-label">
        Clothing and PPE
      </h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Deterministic kit list from the same sourced library as the action cards. Grouped by body
        zone.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {zones.map((zone) => (
          <div key={zone} className="rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2">
            <div className="mb-1.5 flex items-center gap-2 text-[var(--ink)]">
              <ZoneIcon zone={zone} />
              <h3 className="text-sm font-bold">{ZONE_LABEL[zone]}</h3>
            </div>
            <ul className="space-y-2">
              {(grouped.get(zone) ?? []).map((a) => (
                <li key={a.id}>
                  <p className="text-sm font-semibold">{a.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{a.body}</p>
                  <p className="mt-1 text-[0.65rem] text-[var(--muted)]">
                    Source:{' '}
                    <a href={a.source_url} target="_blank" rel="noreferrer" className="underline">
                      {a.source_name}
                    </a>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {other.map((a) => (
          <div key={a.id} className="rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2">
            <p className="text-sm font-semibold">{a.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{a.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
