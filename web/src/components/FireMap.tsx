import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { FirePoint } from '../types'

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
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!open || textMode || !mapEl.current) return
    if (mapRef.current) return

    const map = new maplibregl.Map({
      container: mapEl.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [lon, lat],
      zoom: 7,
    })
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
    mapRef.current = map

    map.on('load', () => {
      new maplibregl.Marker({ color: '#0072B2' }).setLngLat([lon, lat]).addTo(map)
      for (const f of fires.slice(0, 200)) {
        new maplibregl.Marker({ color: '#D55E00', scale: 0.6 })
          .setLngLat([f.longitude, f.latitude])
          .setPopup(
            new maplibregl.Popup({ offset: 12 }).setText(
              `FRP ${f.frp ?? 'n/a'} · ${f.acq_date} ${f.acq_time} · ${f.satellite}`,
            ),
          )
          .addTo(map)
      }
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [open, textMode, lat, lon, fires])

  const windLabel =
    windFromDeg == null ? 'Wind n/a' : `Wind from ${Math.round(windFromDeg)}° (met. convention)`

  return (
    <section aria-labelledby="map-heading" className="rounded-2xl bg-[var(--card)] border border-[var(--border)] p-4 shadow-sm">
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
          <span aria-hidden="true" className="ml-2 inline-block" style={{ transform: `rotate(${windFromDeg}deg)` }}>
            ↑
          </span>
        )}
      </p>
      {open && !textMode && <div ref={mapEl} className="mt-3 h-64 w-full rounded-xl overflow-hidden" role="img" aria-label="Map of fire detections" />}
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
