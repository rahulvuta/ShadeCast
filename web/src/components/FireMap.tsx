import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { FirePoint } from '../types'

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

export function FireMap({
  lat,
  lon,
  windFromDeg,
  fires,
  textMode,
}: {
  lat: number
  lon: number
  windFromDeg: number | null
  fires: FirePoint[]
  textMode: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)

  function clearMarkers() {
    for (const m of markersRef.current) m.remove()
    markersRef.current = []
    if (userMarkerRef.current) {
      userMarkerRef.current.remove()
      userMarkerRef.current = null
    }
  }

  function placeMarkers(map: maplibregl.Map) {
    clearMarkers()
    userMarkerRef.current = new maplibregl.Marker({ color: '#0072B2' }).setLngLat([lon, lat]).addTo(map)
    for (const f of fires.slice(0, 200)) {
      const marker = new maplibregl.Marker({ color: '#D55E00', scale: 0.6 })
        .setLngLat([f.longitude, f.latitude])
        .setPopup(
          new maplibregl.Popup({ offset: 12 }).setText(
            `FRP ${f.frp ?? 'n/a'} · ${f.acq_date} ${f.acq_time} · ${f.satellite}`,
          ),
        )
        .addTo(map)
      markersRef.current.push(marker)
    }
  }

  // Create / destroy map when expanded
  useEffect(() => {
    if (!open || textMode) {
      if (mapRef.current) {
        clearMarkers()
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
      zoom: 7,
    })
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
    mapRef.current = map

    const onLoad = () => {
      placeMarkers(map)
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
      clearMarkers()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, textMode])

  // Update center + markers while map is open
  useEffect(() => {
    const map = mapRef.current
    if (!open || textMode || !map) return
    map.jumpTo({ center: [lon, lat] })
    if (map.loaded()) {
      placeMarkers(map)
      map.resize()
    } else {
      map.once('load', () => {
        placeMarkers(map)
        map.resize()
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, fires, open, textMode])

  const windLabel =
    windFromDeg == null ? 'Wind n/a' : `Wind from ${Math.round(windFromDeg)}° (met. convention)`

  return (
    <section
      aria-labelledby="map-heading"
      className="rounded-2xl bg-[var(--card)] border border-[var(--border)] p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="map-heading" className="text-lg font-bold">
          Nearby satellite fire detections
        </h2>
        <button
          type="button"
          className="touch-target rounded-xl border border-black px-4 py-2 text-sm font-semibold"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Collapse map' : 'Expand map'}
        </button>
      </div>
      <p className="text-sm text-[var(--muted)] mt-1">
        {fires.length} FIRMS points in view · {windLabel}
        {windFromDeg != null && (
          <span
            aria-hidden="true"
            className="ml-2 inline-block"
            style={{ transform: `rotate(${windFromDeg}deg)` }}
          >
            ↑
          </span>
        )}
      </p>
      <div
        ref={containerRef}
        className={`mt-3 h-64 w-full rounded-xl overflow-hidden ${open && !textMode ? '' : 'hidden'}`}
        role="img"
        aria-label="Map of fire detections"
        aria-hidden={!open || textMode}
      />
      {open && textMode && (
        <ul className="mt-3 max-h-64 overflow-auto text-sm space-y-1">
          {fires.slice(0, 50).map((f, i) => (
            <li key={`${f.latitude}-${f.longitude}-${i}`}>
              {f.latitude.toFixed(3)}, {f.longitude.toFixed(3)} · FRP {f.frp ?? 'n/a'} · {f.acq_date}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
