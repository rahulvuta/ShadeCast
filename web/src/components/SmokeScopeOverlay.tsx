import { useId, useState } from 'react'
import {
  MAP_FIRE_FETCH_RADIUS_KM,
  SEARCH_RADIUS_KM,
  UPWIND_HALF_ANGLE_DEG,
  type AnnotatedDetection,
} from '../lib/smokeGeometry'
import { metersPerPixel, projectToViewport, upwindWedgePath } from '../lib/mercator'

export function detectionLabel(d: AnnotatedDetection): string {
  return [
    `FRP ${d.frp ?? 'n/a'}`,
    `${d.distanceKm.toFixed(0)} km`,
    `bearing ${d.bearingDeg.toFixed(0)}°`,
    d.upwind ? `weight ${d.weight.toFixed(2)}` : 'outside cone (no weight)',
  ].join(' · ')
}

function markerRadiusPx(d: AnnotatedDetection): number {
  const frp = d.frp != null && d.frp > 0 ? d.frp : 1
  const raw = 4 + Math.sqrt(frp) * 1.2
  return Math.max(4, Math.min(18, raw))
}

function markerFill(d: AnnotatedDetection): string {
  if (d.upwind) return '#D55E00'
  if (d.withinRadius) return '#E69F00'
  return '#9CA3AF'
}

function markerOpacity(d: AnnotatedDetection): number {
  const age = d.ageHours
  const freshness = age == null ? 0.75 : Math.max(0.4, 1 - Math.min(age, 48) / 48)
  if (!d.withinRadius) return 0.55 + freshness * 0.2
  if (d.upwind) return 0.85 + freshness * 0.15
  return 0.7 + freshness * 0.2
}

export function SmokeScopeOverlay({
  lat,
  lon,
  zoom,
  width,
  height,
  windFromDeg,
  annotated,
  legend,
  onSelectDetection,
}: {
  lat: number
  lon: number
  zoom: number
  width: number
  height: number
  windFromDeg: number
  annotated: AnnotatedDetection[]
  legend: string
  onSelectDetection?: (label: string) => void
}) {
  const titleId = useId()
  const [selected, setSelected] = useState<string | null>(null)
  const cx = width / 2
  const cy = height / 2
  const mpp = metersPerPixel(lat, zoom)
  const fetchR = (MAP_FIRE_FETCH_RADIUS_KM * 1000) / mpp
  const searchR = (SEARCH_RADIUS_KM * 1000) / mpp
  const wedge = upwindWedgePath(cx, cy, searchR, windFromDeg, UPWIND_HALF_ANGLE_DEG)

  function activate(d: AnnotatedDetection) {
    const label = detectionLabel(d)
    setSelected(label)
    onSelectDetection?.(label)
  }

  return (
    <figure className="absolute inset-0 m-0" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0"
        role="img"
        aria-labelledby={titleId}
        style={{ pointerEvents: 'none' }}
      >
        <title id={titleId}>Map of fire detections with upwind smoke cone</title>

        {/* Fetch-radius ring */}
        <circle
          cx={cx}
          cy={cy}
          r={fetchR}
          fill="#888888"
          fillOpacity={0.05}
          stroke="#666666"
          strokeWidth={2}
          strokeDasharray="8 6"
          strokeOpacity={0.7}
        />

        {/* Search-radius ring */}
        <circle
          cx={cx}
          cy={cy}
          r={searchR}
          fill="#56B4E9"
          fillOpacity={0.14}
          stroke="#0072B2"
          strokeWidth={2.5}
          strokeOpacity={0.9}
        />

        {/* Upwind wedge */}
        <path
          d={wedge}
          fill="#D55E00"
          fillOpacity={0.3}
          stroke="#D55E00"
          strokeWidth={3}
          strokeOpacity={0.95}
        />

        {/* Detections */}
        {annotated.map((d, i) => {
          const { x, y } = projectToViewport(d.latitude, d.longitude, lat, lon, zoom, width, height)
          if (x < -40 || y < -40 || x > width + 40 || y > height + 40) return null
          const r = markerRadiusPx(d)
          const label = detectionLabel(d)
          return (
            <g
              key={`${d.latitude}-${d.longitude}-${i}`}
              role="button"
              tabIndex={0}
              style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onClick={() => activate(d)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  activate(d)
                }
              }}
            >
              <title>{label}</title>
              {/* 48×48 touch target */}
              <circle cx={x} cy={y} r={24} fill="transparent" />
              <circle
                cx={x}
                cy={y}
                r={r}
                fill={markerFill(d)}
                fillOpacity={markerOpacity(d)}
                stroke="#FFFFFF"
                strokeWidth={1}
              />
            </g>
          )
        })}

        {/* Centre / crew marker */}
        <circle cx={cx} cy={cy} r={10} fill="none" stroke="#0072B2" strokeWidth={3} />
        <circle cx={cx} cy={cy} r={4} fill="#0072B2" />
      </svg>

      {selected && (
        <div
          className="absolute bottom-8 left-1/2 z-[3] max-w-[min(90%,20rem)] -translate-x-1/2 rounded border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--ink)] shadow-md"
          role="status"
        >
          <p>{selected}</p>
          <button
            type="button"
            className="mt-1 text-[10px] font-semibold underline"
            onClick={() => setSelected(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <figcaption className="sr-only">{legend}</figcaption>
    </figure>
  )
}
