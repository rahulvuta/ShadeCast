import { useEffect, useMemo, useRef, useState } from 'react'
import type { FeatureCollection, Point } from 'geojson'
import * as maplibregl from 'maplibre-gl'
import type { FirePoint } from '../types'
import {
  SEARCH_RADIUS_KM,
  annotateDetections,
  circlePolygon,
  smokeLegendLine,
  upwindConePolygon,
  type AnnotatedDetection,
} from '../lib/smokeGeometry'

/** OSM raster basemap — demotiles.maplibre.org often never fires 'load' (blank box). */
const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

const SRC_RADIUS = 'smoke-radius'
const SRC_CONE = 'smoke-cone'
const SRC_FIRES = 'smoke-fires'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function firesToGeoJSON(annotated: AnnotatedDetection[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: annotated.map((d, i) => {
      const age = d.ageHours
      const freshness = age == null ? 0.75 : Math.max(0.4, 1 - Math.min(age, 48) / 48)
      const frp = d.frp != null && d.frp > 0 ? d.frp : 1
      const sizeBoost = Math.min(10, Math.sqrt(frp) * 0.9)
      return {
        type: 'Feature' as const,
        id: i,
        properties: {
          frp,
          weight: d.weight,
          upwind: d.upwind ? 1 : 0,
          within: d.withinRadius ? 1 : 0,
          distanceKm: d.distanceKm,
          bearingDeg: d.bearingDeg,
          freshness,
          emojiSize: d.upwind
            ? 22 + freshness * 6 + sizeBoost * 0.8
            : d.withinRadius
              ? 18 + freshness * 4 + sizeBoost * 0.5
              : 14 + freshness * 2,
          opacity: d.withinRadius ? (d.upwind ? 0.95 : 0.85) : 0.55,
          label: [
            `FRP ${d.frp ?? 'n/a'}`,
            `${d.distanceKm.toFixed(0)} km`,
            `bearing ${d.bearingDeg.toFixed(0)}°`,
            d.upwind ? `weight ${d.weight.toFixed(2)}` : 'outside cone (no weight)',
          ].join(' · '),
        },
        geometry: { type: 'Point' as const, coordinates: [d.longitude, d.latitude] },
      }
    }),
  }
}

/** Slow wind streamlines — elongated dashes drifting downwind, not rain-like streaks. */
function createWindParticleLayer(
  windFromDeg: number,
  windSpeedKmh: number | null,
): maplibregl.CustomLayerInterface & { updateWind: (from: number, speed: number | null) => void } {
  let windFrom = windFromDeg
  let speed = windSpeedKmh ?? 12
  let map: maplibregl.Map | null = null
  let canvas: HTMLCanvasElement | null = null
  let raf = 0
  let lastTs = 0
  const particles: { x: number; y: number; offset: number }[] = []
  const COUNT = 36

  function spawn() {
    if (!canvas) return
    particles.length = 0
    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        offset: Math.random() * Math.PI * 2,
      })
    }
  }

  function frame(ts: number) {
    if (!map || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    const dt = lastTs ? Math.min(32, ts - lastTs) / 16.67 : 1
    lastTs = ts

    ctx.clearRect(0, 0, w, h)

    // Meteorological from → toward travel direction (+180)
    const toward = ((windFrom + 180) % 360) * (Math.PI / 180)
    const drift = 0.06 + Math.min(0.22, (speed / 40) * 0.22)
    const dx = Math.sin(toward) * drift * dt
    const dy = -Math.cos(toward) * drift * dt
    const streakLen = 36 + Math.min(44, speed * 1.1)
    const perpX = Math.cos(toward)
    const perpY = Math.sin(toward)

    for (const p of particles) {
      p.x += dx
      p.y += dy
      p.offset += 0.02 * dt

      if (p.x < -streakLen || p.x > w + streakLen || p.y < -streakLen || p.y > h + streakLen) {
        p.x = Math.random() * w
        p.y = Math.random() * h
      }

      // Slight wobble so parallel lines feel like air, not vertical rain
      const wobble = Math.sin(p.offset) * 2.5
      const tailX = p.x - Math.sin(toward) * streakLen + perpX * wobble
      const tailY = p.y + Math.cos(toward) * streakLen + perpY * wobble
      const headX = p.x + Math.sin(toward) * 10 + perpX * wobble * 0.5
      const headY = p.y - Math.cos(toward) * 10 + perpY * wobble * 0.5

      const grad = ctx.createLinearGradient(tailX, tailY, headX, headY)
      grad.addColorStop(0, 'rgba(120, 170, 210, 0)')
      grad.addColorStop(0.45, 'rgba(140, 190, 230, 0.18)')
      grad.addColorStop(1, 'rgba(200, 225, 245, 0.42)')

      ctx.strokeStyle = grad
      ctx.lineWidth = 1.6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(tailX, tailY)
      ctx.lineTo(headX, headY)
      ctx.stroke()
    }
    raf = requestAnimationFrame(frame)
  }

  const layer: maplibregl.CustomLayerInterface & {
    updateWind: (from: number, spd: number | null) => void
  } = {
    id: 'wind-particles',
    type: 'custom',
    onAdd(m) {
      map = m
      canvas = document.createElement('canvas')
      canvas.style.position = 'absolute'
      canvas.style.inset = '0'
      canvas.style.pointerEvents = 'none'
      canvas.style.zIndex = '1'
      const container = m.getCanvasContainer()
      container.appendChild(canvas)
      const resize = () => {
        if (!canvas || !map) return
        const c = map.getCanvas()
        canvas.width = c.clientWidth
        canvas.height = c.clientHeight
        spawn()
      }
      resize()
      m.on('resize', resize)
      ;(layer as unknown as { _resize: () => void })._resize = resize
      raf = requestAnimationFrame(frame)
    },
    render() {
      /* animated via rAF */
    },
    onRemove() {
      cancelAnimationFrame(raf)
      if (canvas?.parentNode) canvas.parentNode.removeChild(canvas)
      canvas = null
      map = null
    },
    updateWind(from, spd) {
      windFrom = from
      speed = spd ?? 12
    },
  }
  return layer
}

function ensureGeometryLayers(map: maplibregl.Map) {
  if (!map.getSource(SRC_RADIUS)) {
    map.addSource(SRC_RADIUS, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'smoke-radius-fill',
      type: 'fill',
      source: SRC_RADIUS,
      paint: { 'fill-color': '#56B4E9', 'fill-opacity': 0.1 },
    })
    map.addLayer({
      id: 'smoke-radius-line',
      type: 'line',
      source: SRC_RADIUS,
      paint: { 'line-color': '#0072B2', 'line-width': 2.5, 'line-opacity': 0.8 },
    })
  }
  if (!map.getSource(SRC_CONE)) {
    map.addSource(SRC_CONE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'smoke-cone-fill',
      type: 'fill',
      source: SRC_CONE,
      paint: { 'fill-color': '#D55E00', 'fill-opacity': 0.32 },
    })
    map.addLayer({
      id: 'smoke-cone-line',
      type: 'line',
      source: SRC_CONE,
      paint: { 'line-color': '#D55E00', 'line-width': 3, 'line-opacity': 0.95 },
    })
  }
  if (!map.getSource(SRC_FIRES)) {
    map.addSource(SRC_FIRES, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'fire-points',
      type: 'symbol',
      source: SRC_FIRES,
      layout: {
        'text-field': '🔥',
        'text-size': ['get', 'emojiSize'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-anchor': 'center',
      },
      paint: {
        'text-opacity': ['get', 'opacity'],
      },
    })
  }
}

function setGeometryData(
  map: maplibregl.Map,
  lat: number,
  lon: number,
  windFromDeg: number,
  annotated: AnnotatedDetection[],
) {
  const radiusSrc = map.getSource(SRC_RADIUS) as maplibregl.GeoJSONSource | undefined
  const coneSrc = map.getSource(SRC_CONE) as maplibregl.GeoJSONSource | undefined
  const fireSrc = map.getSource(SRC_FIRES) as maplibregl.GeoJSONSource | undefined
  if (radiusSrc) {
    radiusSrc.setData({
      type: 'FeatureCollection',
      features: [circlePolygon(lat, lon, SEARCH_RADIUS_KM)],
    })
  }
  if (coneSrc) {
    coneSrc.setData({
      type: 'FeatureCollection',
      features: [upwindConePolygon(lat, lon, windFromDeg)],
    })
  }
  if (fireSrc) fireSrc.setData(firesToGeoJSON(annotated))
}

export function FireMap({
  lat,
  lon,
  windFromDeg,
  windSpeedKmh = null,
  smokePressure = 0,
  fires,
  textMode,
  defaultOpen = true,
}: {
  lat: number
  lon: number
  windFromDeg: number | null
  windSpeedKmh?: number | null
  smokePressure?: number
  fires: FirePoint[]
  textMode: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const windLayerRef = useRef<ReturnType<typeof createWindParticleLayer> | null>(null)

  const wind = windFromDeg ?? 0
  const annotated = useMemo(
    () => annotateDetections(lat, lon, fires, wind),
    [lat, lon, fires, wind],
  )
  const legend = smokeLegendLine(annotated, smokePressure)

  useEffect(() => {
    if (!open || textMode) {
      if (mapRef.current) {
        userMarkerRef.current?.remove()
        userMarkerRef.current = null
        popupRef.current?.remove()
        popupRef.current = null
        if (windLayerRef.current && mapRef.current.getLayer('wind-particles')) {
          mapRef.current.removeLayer('wind-particles')
        }
        windLayerRef.current = null
        mapRef.current.remove()
        mapRef.current = null
      }
      return
    }

    const el = containerRef.current
    if (!el) return

    const map = new maplibregl.Map({
      container: el,
      style: OSM_STYLE,
      center: [lon, lat],
      zoom: 6.2,
    })
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
    mapRef.current = map

    const onLoad = () => {
      ensureGeometryLayers(map)
      setGeometryData(map, lat, lon, wind, annotated)
      userMarkerRef.current?.remove()
      userMarkerRef.current = new maplibregl.Marker({ color: '#0072B2' }).setLngLat([lon, lat]).addTo(map)

      if (!prefersReducedMotion()) {
        const windLayer = createWindParticleLayer(wind, windSpeedKmh)
        windLayerRef.current = windLayer
        map.addLayer(windLayer)
      }

      map.on('mouseenter', 'fire-points', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'fire-points', () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('click', 'fire-points', (e) => {
        const f = e.features?.[0]
        if (!f || f.geometry.type !== 'Point') return
        const coords = (f.geometry as Point).coordinates.slice() as [number, number]
        const label = String(f.properties?.label ?? '')
        popupRef.current?.remove()
        popupRef.current = new maplibregl.Popup({ offset: 12 })
          .setLngLat(coords)
          .setText(label)
          .addTo(map)
      })

      requestAnimationFrame(() => {
        map.resize()
        map.setCenter([lon, lat])
      })
    }
    map.on('load', onLoad)

    const t1 = window.setTimeout(() => map.resize(), 50)
    const t2 = window.setTimeout(() => map.resize(), 250)

    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      map.off('load', onLoad)
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
      popupRef.current?.remove()
      popupRef.current = null
      windLayerRef.current = null
      map.remove()
      mapRef.current = null
    }
    // Map instance only — data updates handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, textMode])

  useEffect(() => {
    const map = mapRef.current
    if (!open || textMode || !map) return
    const apply = () => {
      ensureGeometryLayers(map)
      setGeometryData(map, lat, lon, wind, annotated)
      userMarkerRef.current?.setLngLat([lon, lat])
      windLayerRef.current?.updateWind(wind, windSpeedKmh)
      map.jumpTo({ center: [lon, lat] })
      map.resize()
    }
    if (map.loaded()) apply()
    else map.once('load', apply)
  }, [lat, lon, wind, windSpeedKmh, annotated, open, textMode])

  const windLabel =
    windFromDeg == null
      ? 'Wind n/a'
      : `Wind from ${Math.round(windFromDeg)}° · ${windSpeedKmh != null ? `${Math.round(windSpeedKmh)} km/h` : 'speed n/a'}`
  const withinCount = annotated.filter((d) => d.withinRadius).length
  const upwindCount = annotated.filter((d) => d.upwind).length

  return (
    <section aria-labelledby="map-heading" className="flex h-full min-h-[inherit] flex-col p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="dash-section-label">Smoke algorithm</p>
          <h2 id="map-heading" className="text-sm font-bold mt-0.5">
            Upwind cone · FRP · FIRMS
          </h2>
        </div>
        <button
          type="button"
          className="touch-target shrink-0 rounded border border-[var(--border)] px-3 py-1.5 text-xs font-semibold hover:border-[var(--ink)]"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <p className="text-xs text-[var(--muted)] mt-1">{legend}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
        {fires.length === 0
          ? 'No FIRMS fire detections in this area right now'
          : `${fires.length} fire detections · ${upwindCount} upwind · ${withinCount} in ${SEARCH_RADIUS_KM} km`}
      </p>
      <p className="type-micro text-[var(--muted)] mt-1 normal-case tracking-normal font-normal">
        Soft circle = {SEARCH_RADIUS_KM} km search · filled wedge = ±45° upwind of wind-from ·{' '}
        {windLabel}
      </p>
      <div className={`relative mt-2 ${open && !textMode ? '' : 'hidden'}`}>
        <div
          ref={containerRef}
          className="min-h-[22rem] lg:min-h-[28rem] w-full overflow-hidden rounded border border-[var(--border)]"
          role="img"
          aria-label="Map of fire detections with upwind smoke cone"
          aria-hidden={!open || textMode}
        />
        {windFromDeg != null && (
          <div
            className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-3 rounded-lg border-2 border-[var(--ink)] bg-[var(--card)]/95 px-3 py-2.5 shadow-md backdrop-blur-sm"
            aria-hidden
          >
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-[var(--ink)] bg-[var(--panel)]"
              style={{ transform: `rotate(${windFromDeg}deg)` }}
            >
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden>
                <path
                  d="M18 4 L28 26 L18 21 L8 26 Z"
                  fill="var(--ink)"
                  stroke="var(--bg)"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="type-micro text-[var(--muted)]">Wind from</p>
              <p className="text-xl font-bold leading-tight text-[var(--ink)]">
                {Math.round(windFromDeg)}°
              </p>
              <p className="text-xs font-semibold text-[var(--muted)]">
                {windSpeedKmh != null ? `${Math.round(windSpeedKmh)} km/h` : 'speed n/a'}
              </p>
            </div>
          </div>
        )}
      </div>
      {open && textMode && (
        <ul className="mt-2 max-h-64 overflow-auto text-xs space-y-1">
          {annotated.slice(0, 50).map((f, i) => (
            <li key={`${f.latitude}-${f.longitude}-${i}`}>
              {f.latitude.toFixed(3)}, {f.longitude.toFixed(3)} · FRP {f.frp ?? 'n/a'} ·{' '}
              {f.distanceKm.toFixed(0)} km · {f.upwind ? `weight ${f.weight.toFixed(2)}` : 'not upwind'}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
