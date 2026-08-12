import { useEffect, useMemo, useRef, useState } from 'react'
import type { FeatureCollection, Point } from 'geojson'
import * as maplibregl from 'maplibre-gl'
import type { FirePoint } from '../types'
import {
  SEARCH_RADIUS_KM,
  MAP_FIRE_FETCH_RADIUS_KM,
  annotateDetections,
  circlePolygon,
  destinationPoint,
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
const SRC_FETCH_RADIUS = 'fire-fetch-radius'
const SRC_CONE = 'smoke-cone'
const SRC_FIRES = 'smoke-fires'
const FIRE_ICON_ID = 'fire-icon'
/** Pixel size of the canvas-rendered fire icon; icon-size = emojiSize / this. */
const FIRE_ICON_BASE_PX = 64

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
      const frpBoost = Math.min(14, Math.sqrt(frp) * 1.1)
      const distant = !d.withinRadius
      const distFade = distant
        ? Math.max(0.55, 1 - (d.distanceKm - SEARCH_RADIUS_KM) / 220)
        : 1
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
          emojiSize:
            (d.upwind ? 24 : d.withinRadius ? 20 : 16) * distFade +
            freshness * 4 +
            frpBoost * (distant ? 1.4 : 1),
          opacity: distant ? 0.7 + frpBoost * 0.02 : d.upwind ? 0.98 : 0.9,
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

function imageHasVisiblePixels(imageData: ImageData): boolean {
  const { data } = imageData
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! > 24) return true
  }
  return false
}

/** Procedural flame — always renders without relying on emoji font support. */
function drawProceduralFlame(ctx: CanvasRenderingContext2D, size: number) {
  const cx = size / 2
  const cy = size / 2 + size * 0.06
  ctx.clearRect(0, 0, size, size)

  const outer = ctx.createRadialGradient(cx, cy - size * 0.08, size * 0.04, cx, cy, size * 0.42)
  outer.addColorStop(0, '#FFE566')
  outer.addColorStop(0.45, '#FF8C00')
  outer.addColorStop(1, 'rgba(213, 94, 0, 0)')

  ctx.fillStyle = outer
  ctx.beginPath()
  ctx.ellipse(cx, cy, size * 0.22, size * 0.34, 0, 0, Math.PI * 2)
  ctx.fill()

  const inner = ctx.createRadialGradient(cx, cy + size * 0.04, 0, cx, cy + size * 0.04, size * 0.18)
  inner.addColorStop(0, '#FFF4A8')
  inner.addColorStop(0.55, '#FF6B00')
  inner.addColorStop(1, 'rgba(180, 40, 0, 0)')

  ctx.fillStyle = inner
  ctx.beginPath()
  ctx.ellipse(cx, cy + size * 0.02, size * 0.12, size * 0.2, 0, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Register a fire marker image with MapLibre. Returns false on failure so callers
 * can fall back to circle layers without blocking radius/cone geometry.
 */
function registerFireIcon(map: maplibregl.Map): boolean {
  if (map.hasImage(FIRE_ICON_ID)) return true

  const size = FIRE_ICON_BASE_PX
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  ctx.clearRect(0, 0, size, size)
  ctx.font = `${Math.round(size * 0.78)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('🔥', size / 2, size / 2 + 1)

  let imageData = ctx.getImageData(0, 0, size, size)
  if (!imageHasVisiblePixels(imageData)) {
    drawProceduralFlame(ctx, size)
    imageData = ctx.getImageData(0, 0, size, size)
  }

  const payload = { width: size, height: size, data: imageData.data }
  try {
    map.addImage(FIRE_ICON_ID, payload)
    return true
  } catch (err) {
    console.warn('[FireMap] fire icon registration failed, using circle markers', err)
    return false
  }
}

type WindOverlay = {
  updateWind: (from: number, speed: number | null) => void
  destroy: () => void
}

/** Slow wind streamlines as a plain canvas overlay — no MapLibre custom GL layer. */
function attachWindOverlay(
  map: maplibregl.Map,
  windFromDeg: number,
  windSpeedKmh: number | null,
): WindOverlay {
  let windFrom = windFromDeg
  let speed = windSpeedKmh ?? 12
  let canvas: HTMLCanvasElement | null = document.createElement('canvas')
  let raf = 0
  let lastTs = 0
  const particles: { x: number; y: number; offset: number }[] = []
  const COUNT = 36

  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  canvas.style.pointerEvents = 'none'
  canvas.style.zIndex = '1'
  map.getCanvasContainer().appendChild(canvas)

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

  function resize() {
    if (!canvas) return
    const c = map.getCanvas()
    canvas.width = c.clientWidth
    canvas.height = c.clientHeight
    spawn()
  }

  function frame(ts: number) {
    if (!canvas) return
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

  resize()
  map.on('resize', resize)
  raf = requestAnimationFrame(frame)

  return {
    updateWind(from, spd) {
      windFrom = from
      speed = spd ?? 12
    },
    destroy() {
      cancelAnimationFrame(raf)
      map.off('resize', resize)
      if (canvas?.parentNode) canvas.parentNode.removeChild(canvas)
      canvas = null
    },
  }
}

function ensureGeometryLayers(map: maplibregl.Map) {
  if (!map.getSource(SRC_FETCH_RADIUS)) {
    map.addSource(SRC_FETCH_RADIUS, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'fire-fetch-radius-fill',
      type: 'fill',
      source: SRC_FETCH_RADIUS,
      paint: { 'fill-color': '#888888', 'fill-opacity': 0.06 },
    })
    map.addLayer({
      id: 'fire-fetch-radius-line',
      type: 'line',
      source: SRC_FETCH_RADIUS,
      paint: {
        'line-color': '#666666',
        'line-width': 2,
        'line-opacity': 0.55,
        'line-dasharray': [3, 2],
      },
    })
  }
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
    const hasIcon = registerFireIcon(map)
    if (hasIcon) {
      map.addLayer({
        id: 'fire-points',
        type: 'symbol',
        source: SRC_FIRES,
        layout: {
          'icon-image': FIRE_ICON_ID,
          'icon-size': ['/', ['get', 'emojiSize'], FIRE_ICON_BASE_PX / 2],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-anchor': 'center',
        },
        paint: {
          'icon-opacity': ['get', 'opacity'],
        },
      })
    } else {
      map.addLayer({
        id: 'fire-points',
        type: 'circle',
        source: SRC_FIRES,
        paint: {
          'circle-radius': ['max', 4, ['/', ['get', 'emojiSize'], 2.5]],
          'circle-color': [
            'case',
            ['==', ['get', 'upwind'], 1],
            '#D55E00',
            '#E69F00',
          ],
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#FFFFFF',
        },
      })
    }
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
  const fetchRadiusSrc = map.getSource(SRC_FETCH_RADIUS) as maplibregl.GeoJSONSource | undefined
  const coneSrc = map.getSource(SRC_CONE) as maplibregl.GeoJSONSource | undefined
  const fireSrc = map.getSource(SRC_FIRES) as maplibregl.GeoJSONSource | undefined
  if (fetchRadiusSrc) {
    fetchRadiusSrc.setData({
      type: 'FeatureCollection',
      features: [circlePolygon(lat, lon, MAP_FIRE_FETCH_RADIUS_KM)],
    })
  }
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

function fitMapToScene(
  map: maplibregl.Map,
  lat: number,
  lon: number,
  annotated: AnnotatedDetection[],
) {
  const bounds = new maplibregl.LngLatBounds()
  bounds.extend([lon, lat])
  for (const bearing of [0, 90, 180, 270]) {
    // destinationPoint returns GeoJSON [lon, lat]
    const [fetchLon, fetchLat] = destinationPoint(lat, lon, bearing, MAP_FIRE_FETCH_RADIUS_KM)
    bounds.extend([fetchLon, fetchLat])
  }
  for (const d of annotated) {
    bounds.extend([d.longitude, d.latitude])
  }
  if (annotated.length === 0) {
    map.jumpTo({ center: [lon, lat], zoom: 6 })
    return
  }
  map.fitBounds(bounds, { padding: 48, maxZoom: 7.25, duration: 0 })
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
  const windOverlayRef = useRef<WindOverlay | null>(null)

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
        windOverlayRef.current?.destroy()
        windOverlayRef.current = null
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

    // Wind overlay needs only the canvas container — attach immediately, not in onLoad.
    if (!prefersReducedMotion()) {
      try {
        windOverlayRef.current = attachWindOverlay(map, wind, windSpeedKmh)
      } catch (err) {
        console.error('[FireMap] wind overlay failed', err)
      }
    }

    const onLoad = () => {
      try {
        ensureGeometryLayers(map)
        setGeometryData(map, lat, lon, wind, annotated)
        fitMapToScene(map, lat, lon, annotated)
        // #region agent log
        const sorted = [...annotated].sort((a, b) => b.distanceKm - a.distanceKm)
        const farthest3 = sorted.slice(0, 3).map((d) => ({ lat: d.latitude, lon: d.longitude, distanceKm: d.distanceKm }))
        fetch('http://127.0.0.1:7671/ingest/1ae2e689-c464-4b2f-ae77-a71986aceeb1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'65d34c'},body:JSON.stringify({sessionId:'65d34c',location:'FireMap.tsx:onLoad-fires-distance-check',message:'checking whether fires array matches the rendered lat/lon and requested radius',data:{renderLat:lat,renderLon:lon,fireCount:annotated.length,maxDistanceKm:sorted[0]?.distanceKm ?? null,beyondFetchRadiusCount:annotated.filter((d) => d.distanceKm > MAP_FIRE_FETCH_RADIUS_KM).length,farthest3,zoom:map.getZoom(),bounds:map.getBounds()},hypothesisId:'H10-fires-distance-mismatch',timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        // #region agent log
        // Don't wait on 'idle' (raster basemap tiles can take a while); check after a
        // fixed number of real render frames instead, since vector/geojson layers paint
        // independently of the raster layer's load state.
        let frame = 0
        const checkAfterFrames = () => {
          frame += 1
          if (frame < 20) {
            requestAnimationFrame(checkAfterFrames)
            return
          }
          const centerPx = map.project(map.getCenter())
          const renderedRadius = map.queryRenderedFeatures(undefined, { layers: ['smoke-radius-fill'] })
          const renderedFetchRing = map.queryRenderedFeatures(undefined, { layers: ['fire-fetch-radius-line'] })
          const renderedFires = map.queryRenderedFeatures(undefined, { layers: ['fire-points'] })
          const renderedAtCenter = map.queryRenderedFeatures([centerPx.x, centerPx.y], { layers: ['smoke-radius-fill'] })
          const allLayerIds = map.getStyle().layers?.map((l) => l.id) ?? []
          // Ground-truth pixel readback: sample the actual GPU framebuffer at a point on the
          // search-radius circle's boundary, where the opaque blue line (#0072B2) should be.
          let pixelAtRingEdge: number[] | null = null
          try {
            const edgeLngLat = destinationPoint(lat, lon, 0, SEARCH_RADIUS_KM)
            const edgePx = map.project([edgeLngLat[0], edgeLngLat[1]])
            const gl = map.getCanvas().getContext('webgl2') || map.getCanvas().getContext('webgl')
            if (gl) {
              const buf = new Uint8Array(4)
              const dpr = window.devicePixelRatio || 1
              const glY = gl.drawingBufferHeight - Math.round(edgePx.y * dpr)
              gl.readPixels(Math.round(edgePx.x * dpr), glY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf)
              pixelAtRingEdge = Array.from(buf)
            }
          } catch (e) {
            pixelAtRingEdge = null
          }
          // Inspect the source's actual held data + layer visibility/paint state directly,
          // to distinguish "data never made it to the source" from "data is there but not painted".
          const radiusSource = map.getSource(SRC_RADIUS) as maplibregl.GeoJSONSource | undefined
          let sourceDataSummary: unknown = 'no-source'
          try {
            const serialized = radiusSource?.serialize() as { data?: FeatureCollection } | undefined
            const data = serialized?.data
            sourceDataSummary = data
              ? { featureCount: data.features?.length ?? 0, firstGeomType: data.features?.[0]?.geometry?.type }
              : 'no-data'
          } catch (e) {
            sourceDataSummary = `serialize-threw:${e instanceof Error ? e.message : String(e)}`
          }
          fetch('http://127.0.0.1:7671/ingest/1ae2e689-c464-4b2f-ae77-a71986aceeb1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'65d34c'},body:JSON.stringify({sessionId:'65d34c',location:'FireMap.tsx:onLoad-frame-check',message:'queried rendered features + sampled GPU pixel after 20 real render frames',data:{renderedRadiusCount:renderedRadius.length,renderedFetchRingCount:renderedFetchRing.length,renderedFiresCount:renderedFires.length,renderedAtCenterCount:renderedAtCenter.length,styleLayerIds:allLayerIds,canvasWidth:map.getCanvas().width,canvasHeight:map.getCanvas().height,pixelAtRingEdgeRGBA:pixelAtRingEdge,isSourceLoaded:map.isSourceLoaded(SRC_RADIUS),sourceDataSummary,fillOpacity:map.getPaintProperty('smoke-radius-fill','fill-opacity'),lineOpacity:map.getPaintProperty('smoke-radius-line','line-opacity'),fillVisibility:map.getLayoutProperty('smoke-radius-fill','visibility'),lineVisibility:map.getLayoutProperty('smoke-radius-line','visibility')},hypothesisId:'H9-paint-not-happening',timestamp:Date.now()})}).catch(()=>{});
        }
        requestAnimationFrame(checkAfterFrames)
        // #endregion
      } catch (err) {
        console.error('[FireMap] geometry setup failed', err)
      }

      try {
        userMarkerRef.current?.remove()
        userMarkerRef.current = new maplibregl.Marker({ color: '#0072B2' }).setLngLat([lon, lat]).addTo(map)
      } catch (err) {
        console.error('[FireMap] user marker failed', err)
      }

      try {
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
      } catch (err) {
        console.error('[FireMap] fire event handlers failed', err)
      }

      requestAnimationFrame(() => map.resize())
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
      windOverlayRef.current?.destroy()
      windOverlayRef.current = null
      map.remove()
      mapRef.current = null
      // #region agent log
      fetch('http://127.0.0.1:7671/ingest/1ae2e689-c464-4b2f-ae77-a71986aceeb1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'65d34c'},body:JSON.stringify({sessionId:'65d34c',location:'FireMap.tsx:effect-cleanup',message:'map-creation effect cleanup ran',data:{childCountAfterRemove:el.childElementCount,childTags:Array.from(el.children).map((c)=>c.tagName)},hypothesisId:'H6-stale-dom',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }
    // Map instance only — data updates handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, textMode])

  useEffect(() => {
    const map = mapRef.current
    if (!open || textMode || !map) return
    const apply = () => {
      try {
        ensureGeometryLayers(map)
        setGeometryData(map, lat, lon, wind, annotated)
        fitMapToScene(map, lat, lon, annotated)
        userMarkerRef.current?.setLngLat([lon, lat])
        windOverlayRef.current?.updateWind(wind, windSpeedKmh)
        map.resize()
        // #region agent log
        const sorted = [...annotated].sort((a, b) => b.distanceKm - a.distanceKm)
        fetch('http://127.0.0.1:7671/ingest/1ae2e689-c464-4b2f-ae77-a71986aceeb1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'65d34c'},body:JSON.stringify({sessionId:'65d34c',location:'FireMap.tsx:apply-fires-distance-check',message:'checking fires-vs-location mismatch on prop update (tab switch/refresh path)',data:{renderLat:lat,renderLon:lon,fireCount:annotated.length,maxDistanceKm:sorted[0]?.distanceKm ?? null,beyondFetchRadiusCount:annotated.filter((d) => d.distanceKm > MAP_FIRE_FETCH_RADIUS_KM).length,zoom:map.getZoom(),bounds:map.getBounds()},hypothesisId:'H10-fires-distance-mismatch',timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      } catch (err) {
        console.error('[FireMap] apply update failed', err)
      }
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
  const distantCount = annotated.filter((d) => !d.withinRadius).length

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
          : `${fires.length} fire detections · ${upwindCount} upwind · ${withinCount} in ${SEARCH_RADIUS_KM} km${
              distantCount > 0 ? ` · ${distantCount} farther out` : ''
            }`}
      </p>
      <p className="type-micro text-[var(--muted)] mt-1 normal-case tracking-normal font-normal">
        Dashed outer ring = {MAP_FIRE_FETCH_RADIUS_KM} km fire visibility · solid inner ring ={' '}
        {SEARCH_RADIUS_KM} km smoke search · filled wedge = ±45° upwind · {windLabel}
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
