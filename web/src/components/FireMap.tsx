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
  defaultOpen = true,
}: {
  lat: number
  lon: number
  windFromDeg: number | null
  fires: FirePoint[]
  textMode: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
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
    <section aria-labelledby="map-heading" className="dash-panel flex h-full flex-col p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="dash-section-label">Environmental context</p>
          <h2 id="map-heading" className="text-sm font-bold mt-0.5">
            FIRMS fire & wind
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
      <p className="text-xs text-[var(--muted)] mt-1">
        {fires.length} detections · {windLabel}
        {windFromDeg != null && (
          <span
            aria-hidden="true"
            className="ml-1.5 inline-block"
            style={{ transform: `rotate(${windFromDeg}deg)` }}
          >
            ↑
          </span>
        )}
      </p>
      <div
        ref={containerRef}
        className={`mt-2 min-h-[16rem] flex-1 w-full overflow-hidden rounded border border-[var(--border)] ${
          open && !textMode ? '' : 'hidden'
        }`}
        role="img"
        aria-label="Map of fire detections"
        aria-hidden={!open || textMode}
      />
      {open && textMode && (
        <ul className="mt-2 max-h-64 overflow-auto text-xs space-y-1">
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
